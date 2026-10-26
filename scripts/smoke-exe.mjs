import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const executable = join(root, 'release', `Context-Loom-${version}-windows-x64.exe`);
const temporary = await mkdtemp(join(tmpdir(), 'context-loom-exe-'));
const privateData = join(temporary, 'private-data');
const children = new Set();
// The executable must work outside its source folder, with no Node.js on PATH.
const env = { ...process.env, CONTEXT_LOOM_DATA_DIR: privateData, PATH: join(process.env.SystemRoot || 'C:\\Windows', 'System32') };
function launch(args = ['--no-browser']) {
  const child = spawn(executable, args, { cwd: temporary, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  children.add(child);
  const result = { child, stdout: '', stderr: '' };
  result.done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => { children.delete(child); resolve(code); });
  });
  child.stdout.on('data', data => { result.stdout += data; });
  child.stderr.on('data', data => { result.stderr += data; });
  return result;
}
function ready(result) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Executable startup timed out: ${result.stderr}`)), 20000);
    const observe = () => {
      const match = /CONTEXT_LOOM_READY (http:\/\/127\.0\.0\.1:\d+\/)/.exec(result.stdout);
      if (match) { clearTimeout(timeout); result.child.stdout.off('data', observe); resolve(match[1]); }
    };
    result.child.stdout.on('data', observe);
    result.done.then(() => { clearTimeout(timeout); reject(new Error(`Executable exited before readiness: ${result.stderr}`)); }, reject);
    observe();
  });
}
async function stop(result) { result.child.kill(); await result.done; }
async function json(url, path, method, body) {
  const response = await fetch(new URL(path, url), { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  return response.json();
}
try {
  const first = launch();
  const url = await ready(first);
  for (const [asset, content] of [['', 'Context Loom'], ['app.js', 'compile'], ['style.css', 'font']]) {
    const response = await fetch(new URL(asset, url));
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes(content));
  }
  for (const locale of ['en', 'ko', 'zh-CN', 'ja', 'es', 'fr', 'de', 'ru', 'pt']) {
    const messages = await json(url, `locales/${locale}.json`, 'GET');
    assert.equal(typeof messages['language.ui'], 'string');
  }
  const project = { id: 'smoke', name: 'Packaged app check', goal: 'Verify standalone persistence', scope: 'Invoice rounding', constraints: 'Preserve totals', style: 'concise', clarification: 'blocking', answerLanguage: 'ja', memories: [{ id: 'cents', text: 'Invoice amounts use integer cents', tags: 'invoice', enabled: true, pinned: true }] };
  await json(url, 'api/state', 'PUT', { projects: [project], activeProjectId: project.id, uiLanguage: 'ko' });
  const compiled = await json(url, 'api/compile', 'POST', { projectId: project.id, task: 'Fix invoice rounding', memoryBudget: 1000, maxOutputTokens: 512, reasoning: 'low' });
  assert.ok(compiled.prompt.includes('Invoice amounts use integer cents'));
  assert.deepEqual(compiled.selectedMemoryIds, ['cents']);
  assert.ok(compiled.estimate.totalUSD > 0);
  const duplicate = launch();
  assert.equal(await duplicate.done, 0);
  assert.ok(duplicate.stdout.includes(`CONTEXT_LOOM_REUSED ${url}`));
  assert.equal((await json(url, 'api/state', 'GET')).projects[0].id, 'smoke');
  await stop(first);
  const restarted = launch();
  const restartURL = await ready(restarted);
  assert.equal((await json(restartURL, 'api/state', 'GET')).projects[0].memories[0].text, 'Invoice amounts use integer cents');
  const restored = await json(restartURL, 'api/state', 'GET');
  assert.equal(restored.uiLanguage, 'ko');
  assert.equal(restored.projects[0].answerLanguage, 'ja');
  await stop(restarted);
  const licenses = launch(['--licenses']);
  assert.equal(await licenses.done, 0);
  assert.ok(licenses.stdout.includes('Copyright Node.js contributors'));
  assert.ok(!JSON.stringify(JSON.parse(await readFile(join(privateData, 'state.json'), 'utf8'))).includes('apiKey'));
  console.log('PASS: real exe serves all nine language catalogs without Node/PATH/source files; compiles context; persists interface/answer languages and memories; reuses running instance; restarts; includes runtime notices. No paid API calls.');
} finally {
  for (const child of children) child.kill();
  await Promise.all([...children].map(child => new Promise(resolve => child.once('close', resolve))));
  await rm(temporary, { recursive: true, force: true });
}
