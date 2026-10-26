import { build } from 'esbuild';
import { inject } from 'postject';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const locales = ['en', 'ko', 'zh-CN', 'ja', 'es', 'fr', 'de', 'ru', 'pt'];
if (process.platform !== 'win32' || process.arch !== 'x64' || Number(process.versions.node.split('.')[0]) !== 24) {
  throw new Error('Build on Windows x64 using Node.js 24. The same runtime generates the blob and supplies the executable.');
}
const work = join(root, 'build');
const output = join(root, 'release');
await mkdir(work, { recursive: true });
await mkdir(output, { recursive: true });
const filename = `Context-Loom-${pkg.version}-windows-x64.exe`;
const executable = join(output, filename);
const bundled = join(work, 'launcher.cjs');
const blob = join(work, 'context-loom.blob');
const config = join(work, 'sea-config.json');
const noticesPath = join(work, 'THIRD-PARTY-NOTICES.txt');

// Include the exact embedded runtime's complete license and dependency notices.
const licenseResponse = await fetch(`https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`, { signal: AbortSignal.timeout(30000) });
if (!licenseResponse.ok) throw new Error(`Cannot obtain Node.js ${process.versions.node} license: HTTP ${licenseResponse.status}`);
const notices = `Context Loom ${pkg.version}\n\nBundled runtime: Node.js ${process.versions.node}\nThe runtime binary was modified to embed Context Loom using Node SEA and postject.\n\n${await licenseResponse.text()}`;
if (!notices.includes('Copyright Node.js contributors')) throw new Error('Unexpected Node.js license response.');
await writeFile(noticesPath, notices);
await build({
  absWorkingDir: root, entryPoints: ['windows-launcher.mjs'], bundle: true, platform: 'node',
  format: 'cjs', target: 'node24', outfile: bundled,
  // In SEA, ROOT and the source-only auto-start guard never evaluate import.meta.url.
  define: { 'import.meta.url': 'undefined' },
});
await writeFile(config, JSON.stringify({
  main: bundled, output: blob, disableExperimentalSEAWarning: true,
  useSnapshot: false, useCodeCache: false, execArgvExtension: 'none',
  assets: {
    'index.html': join(root, 'public', 'index.html'),
    'app.js': join(root, 'public', 'app.js'),
    'style.css': join(root, 'public', 'style.css'),
    'i18n.mjs': join(root, 'public', 'i18n.mjs'),
    ...Object.fromEntries(locales.map(locale => [`locales/${locale}.json`, join(root, 'public', 'locales', `${locale}.json`)])),
    'LICENSE.txt': join(root, 'LICENSE.txt'),
    'THIRD-PARTY-NOTICES.txt': noticesPath,
  },
}, null, 2));
const preparation = spawnSync(process.execPath, ['--experimental-sea-config', config], { cwd: root, stdio: 'inherit' });
if (preparation.error || preparation.status !== 0) throw preparation.error || new Error('Node SEA preparation failed.');
await copyFile(process.execPath, executable);
await inject(executable, 'NODE_SEA_BLOB', await readFile(blob), { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2' });
await copyFile(noticesPath, join(output, 'THIRD-PARTY-NOTICES.txt'));
await copyFile(join(root, 'README.md'), join(output, 'README.md'));
await copyFile(join(root, 'LICENSE.txt'), join(output, 'LICENSE.txt'));
const hash = createHash('sha256').update(await readFile(executable)).digest('hex');
await writeFile(join(output, 'SHA256SUMS.txt'), `${hash}  ${filename}\n`);

// Explicit allowlists: never archive data/, node_modules/, conversation history, or credentials.
const sourceFiles = [
  '.gitignore', 'package.json', 'package-lock.json', 'README.md', 'LICENSE.txt', 'Start-Context-Loom.cmd',
  'core.mjs', 'server.mjs', 'windows-launcher.mjs',
  'public/index.html', 'public/app.js', 'public/style.css',
  'public/i18n.mjs', ...locales.map(locale => `public/locales/${locale}.json`),
  'test/core.test.mjs', 'scripts/build-windows.mjs', 'scripts/smoke-exe.mjs',
  '.github/workflows/release.yml',
];
const sourceStage = await mkdtemp(join(work, 'source-'));
for (const name of sourceFiles) {
  const destination = join(sourceStage, name);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(root, name), destination);
}
// Compress-Archive excludes dotfiles; .NET ZipFile preserves .github and .gitignore.
const zipCode = `Add-Type -AssemblyName System.IO.Compression.FileSystem; if (Test-Path -LiteralPath $env:LOOM_ZIP) { Remove-Item -LiteralPath $env:LOOM_ZIP }; [IO.Compression.ZipFile]::CreateFromDirectory($env:LOOM_SOURCE, $env:LOOM_ZIP, [IO.Compression.CompressionLevel]::Optimal, $false)`;
const archive = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', zipCode], {
  env: { ...process.env, LOOM_SOURCE: sourceStage, LOOM_ZIP: join(output, `context-loom-${pkg.version}-source.zip`) }, stdio: 'inherit',
});
if (archive.error || archive.status !== 0) throw archive.error || new Error('Source archive creation failed.');
await rm(sourceStage, { recursive: true, force: true });
console.log(`Built ${executable}`);
console.log(`SHA-256: ${hash}`);
console.log('Unsigned Windows executable. No publisher certificate or SmartScreen reputation is implied.');
