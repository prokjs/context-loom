import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { startServer } from './server.mjs';
import { isSea, getAsset } from 'node:sea';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from './core.mjs';
import packageInfo from './package.json' with { type: 'json' };
const { version } = packageInfo;

const dataDirectory = resolve(process.env.CONTEXT_LOOM_DATA_DIR || join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'ContextLoom'));
const identity = createHash('sha256').update(dataDirectory.toLowerCase()).digest('hex').slice(0, 24);
const pipeName = `\\\\.\\pipe\\context-loom-${identity}`;
const noBrowser = process.argv.includes('--no-browser');
let launcherMessages = {};
function tr(key, parameters = {}) {
  return (launcherMessages[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => String(parameters[name] ?? match));
}
async function loadLauncherLanguage() {
  const catalog = async locale => JSON.parse(isSea()
    ? getAsset(`locales/${locale}.json`, 'utf8')
    : await readFile(new URL(`./public/locales/${locale}.json`, import.meta.url), 'utf8'));
  launcherMessages = await catalog('en');
  let locale = 'en';
  try {
    const stored = JSON.parse(await readFile(join(dataDirectory, 'state.json'), 'utf8'));
    if (Object.hasOwn(LANGUAGES, stored.uiLanguage)) locale = stored.uiLanguage;
  } catch { /* Missing/corrupt state is handled by the state store without overwriting it. */ }
  if (locale !== 'en') launcherMessages = await catalog(locale);
}

function openBrowser(url) {
  if (noBrowser) return;
  const child = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'), [url], { detached: true, stdio: 'ignore', windowsHide: true });
  child.once('error', () => console.error(tr('launcher.browserFailed', { url })));
  child.unref();
}

function existingInstance() {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipeName);
    let text = '';
    socket.setTimeout(5000, () => socket.destroy(new Error('The running app did not respond.')));
    socket.on('data', chunk => {
      text += chunk.toString('utf8');
      if (text.length > 2048) socket.destroy(new Error('Invalid app response.'));
    });
    socket.once('error', reject);
    socket.once('end', () => {
      try {
        const info = JSON.parse(text);
        if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(info.url)) throw new Error('Invalid app URL.');
        resolve(info);
      } catch (error) { reject(error); }
    });
  });
}

async function main() {
  if (process.platform !== 'win32') throw new Error('This launcher requires Windows. Use npm start for source development on other systems.');
  if (process.argv.includes('--licenses')) {
    if (!isSea()) throw new Error('Runtime license display is available in the packaged executable.');
    console.log(getAsset('LICENSE.txt', 'utf8'));
    console.log(getAsset('THIRD-PARTY-NOTICES.txt', 'utf8'));
    return;
  }
  await loadLauncherLanguage();
  let url;
  const waiting = new Set();
  const instance = net.createServer(socket => {
    socket.on('error', () => {});
    socket.setTimeout(5000, () => socket.destroy());
    if (url) socket.end(JSON.stringify({ url, version }));
    else {
      waiting.add(socket);
      socket.once('close', () => waiting.delete(socket));
    }
  });
  try {
    await new Promise((resolve, reject) => {
      instance.once('error', reject);
      instance.listen(pipeName, () => { instance.removeListener('error', reject); resolve(); });
    });
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    const existing = await existingInstance();
    console.log(tr('launcher.alreadyRunning', { url: existing.url }));
    if (noBrowser) console.log(`CONTEXT_LOOM_REUSED ${existing.url}`);
    openBrowser(existing.url);
    return;
  }
  try {
    const server = await startServer({ port: 0, dataDirectory });
    url = `http://127.0.0.1:${server.address().port}/`;
    for (const socket of waiting) socket.end(JSON.stringify({ url, version }));
    waiting.clear();
    console.log(tr('launcher.ready', { version, url }));
    console.log(tr('launcher.privateData', { path: dataDirectory }));
    console.log(tr('launcher.keepOpen'));
    console.log(tr('launcher.browserClosed'));
    console.log(tr('launcher.costWarning'));
    if (noBrowser) console.log(`CONTEXT_LOOM_READY ${url}`);
    openBrowser(url);
    const stop = () => {
      instance.close();
      server.close();
      server.closeIdleConnections();
      // Let in-flight requests finish; a second interrupt closes immediately.
      process.once('SIGINT', () => process.exit(0));
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    for (const socket of waiting) socket.destroy();
    instance.close();
    throw error;
  }
}

main().catch(error => {
  console.error(launcherMessages['launcher.startFailure'] ? tr('launcher.startFailure', { error: error.message }) : `Context Loom could not start: ${error.message}`);
  console.error(launcherMessages['launcher.dataSafe'] ? tr('launcher.dataSafe', { path: dataDirectory }) : `Existing private data has not been reset. Check ${dataDirectory} and restart.`);
  process.exitCode = 1;
  if (process.stdin.isTTY) {
    console.error(launcherMessages['launcher.pressEnter'] ? tr('launcher.pressEnter') : 'Press Enter to close.');
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(1));
  }
});
