import http from 'node:http';
import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isSea, getAsset } from 'node:sea';
import { HttpError, validateState, validateCompileOptions, compileContext, parseResponse, calculateUsage, PRICING, LANGUAGES } from './core.mjs';

const ROOT = isSea() ? dirname(process.execPath) : dirname(fileURLToPath(import.meta.url));
const BODY_LIMIT = 32 * 1024 * 1024;
const RESPONSE_LIMIT = 8 * 1024 * 1024;
const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/i18n.mjs', ['i18n.mjs', 'text/javascript; charset=utf-8']],
  ...Object.keys(LANGUAGES).map(locale => [`/locales/${locale}.json`, [`locales/${locale}.json`, 'application/json; charset=utf-8']])
]);

function validCount(value) { return value === null || (Number.isSafeInteger(value) && value >= 0); }
function validateStoredUsage(value) {
  if (!Array.isArray(value)) throw new Error('Invalid usage history.');
  return value.map(record => {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string' || typeof record.date !== 'string' || !Number.isFinite(Date.parse(record.date)) || typeof record.projectId !== 'string' || typeof record.model !== 'string' || typeof record.status !== 'string') throw new Error('Invalid usage record.');
    for (const field of ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens']) if (!validCount(record[field])) throw new Error('Invalid usage counts.');
    if (record.cacheWriteTokens !== undefined && !validCount(record.cacheWriteTokens)) throw new Error('Invalid cache write count.');
    if (record.costUSD !== null && (typeof record.costUSD !== 'number' || !Number.isFinite(record.costUSD) || record.costUSD < 0)) throw new Error('Invalid usage cost.');
    return {
      id: record.id, date: record.date, projectId: record.projectId, model: record.model,
      inputTokens: record.inputTokens, cachedInputTokens: record.cachedInputTokens,
      cacheWriteTokens: record.cacheWriteTokens ?? null, outputTokens: record.outputTokens,
      reasoningTokens: record.reasoningTokens, costUSD: record.costUSD, status: record.status
    };
  });
}

async function createStateStore(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'state.json');
  let state = { projects: [], activeProjectId: null, uiLanguage: 'en', usage: [] };
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    state = { ...validateState(parsed), usage: validateStoredUsage(parsed.usage) };
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Local state could not be read or validated. It has not been overwritten. Restore a valid data/state.json backup before starting.');
  }
  let pending = Promise.resolve();
  async function atomicWrite(value) {
    const temporary = join(directory, `.state-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, path);
    } catch {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporary).catch(() => {});
      throw new HttpError(503, 'Local state could not be saved. Check free space and data directory permissions.');
    }
  }
  function update(makeNext) {
    const operation = pending.then(async () => {
      const next = makeNext(state);
      await atomicWrite(next);
      state = next;
      return state;
    });
    pending = operation.catch(() => {});
    return operation;
  }
  return {
    get: () => state,
    replaceProjects: value => update(current => ({ ...value, usage: current.usage })),
    appendUsage: record => update(current => ({ ...current, usage: [...current.usage, record] }))
  };
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function sendJSON(res, status, value) {
  if (res.destroyed || res.writableEnded) return;
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function enforceLocalRequest(req, server) {
  const address = req.socket.remoteAddress;
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') throw new HttpError(403, 'Only local requests are allowed.');
  const port = server.address()?.port;
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  if (!hosts.has(req.headers.host?.toLowerCase())) throw new HttpError(403, 'Invalid local host. Open this app using its localhost address.');
  if (req.headers.origin !== undefined) {
    const allowedOrigins = new Set([...hosts].map(host => `http://${host}`));
    if (!allowedOrigins.has(req.headers.origin)) throw new HttpError(403, 'Requests from another origin are not allowed.');
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site requests are not allowed.');
}

function readJSON(req) {
  const mediaType = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') throw new HttpError(415, 'Send mutation requests with Content-Type: application/json.');
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new HttpError(415, 'Encoded request bodies are not supported.');
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > BODY_LIMIT) throw new HttpError(413, 'Request body exceeds the 32 MiB limit.');
  return new Promise((resolveBody, reject) => {
    let bytes = 0;
    let chunks = [];
    let failed = false;
    req.on('data', chunk => {
      if (failed) return;
      bytes += chunk.length;
      if (bytes > BODY_LIMIT) {
        failed = true;
        chunks = [];
        reject(new HttpError(413, 'Request body exceeds the 32 MiB limit.'));
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Request body must be valid JSON.')); }
    });
    req.on('error', () => reject(new HttpError(400, 'Request body could not be read.')));
    req.on('aborted', () => reject(new HttpError(400, 'Request body was interrupted.')));
  });
}

async function readUpstreamJSON(response) {
  if (!response.body) throw new HttpError(502, 'The API returned an empty response. Billing may have occurred; check OpenAI usage before retrying.');
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > RESPONSE_LIMIT) {
        await reader.cancel().catch(() => {});
        throw new HttpError(502, 'The API response exceeded the local safety limit. Billing may have occurred; check OpenAI usage before retrying.');
      }
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new HttpError(502, 'The API returned unreadable data. Billing may have occurred; check OpenAI usage before retrying.'); }
  } finally { reader.releaseLock(); }
}

function upstreamError(status) {
  if (status === 401 || status === 403) return new HttpError(401, 'The API key is invalid, lacks permission, or cannot access this model. Check the key and account permissions. No automatic retry was made.');
  if (status === 429) return new HttpError(429, 'OpenAI rejected the request because of an account quota or rate limit. Check account limits before trying again. No automatic retry was made.');
  if (status === 400 || status === 404 || status === 422) return new HttpError(502, 'OpenAI rejected the model or request settings. Check model availability for your account. No automatic retry was made.');
  return new HttpError(502, 'The API request failed. Billing may have occurred; check your OpenAI usage before retrying. No automatic retry was made.');
}

export async function createAppServer({ dataDirectory = join(ROOT, 'data'), publicDirectory = join(ROOT, 'public'), fetchImpl = globalThis.fetch, apiTimeoutMs = 90000 } = {}) {
  if (!Number.isSafeInteger(apiTimeoutMs) || apiTimeoutMs < 1 || apiTimeoutMs > 180000) throw new Error('API timeout must be 1–180000 milliseconds.');
  const store = await createStateStore(dataDirectory);
  async function paidRun(body) {
    const options = validateCompileOptions(body);
    const project = store.get().projects.find(p => p.id === options.projectId);
    if (!project) throw new HttpError(404, 'The selected project does not exist.');
    const compiled = compileContext(project, options);
    if (body.consent !== true) throw new HttpError(400, 'Explicit consent is required for each paid API request.');
    if (typeof body.approvedEstimateUSD !== 'number' || !Number.isFinite(body.approvedEstimateUSD) || body.approvedEstimateUSD < 0) throw new HttpError(400, 'Approve the current estimated additional cost before running.');
    if (Math.abs(body.approvedEstimateUSD - compiled.estimate.totalUSD) > 1e-12) throw new HttpError(409, 'The estimated cost changed. Compile again and explicitly approve the new estimate before running.');
    if (typeof body.apiKey !== 'string' || !/^sk-[A-Za-z0-9_-]{17,509}$/.test(body.apiKey)) throw new HttpError(400, 'Enter a valid OpenAI secret API key beginning with sk-. The key is used only for this request and is never saved.');
    // The key remains only in request memory, never in state, logs, response data, or error details.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), apiTimeoutMs);
    let upstream;
    let parsed;
    let result;
    let failure;
    try {
      upstream = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${body.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: PRICING.model, instructions: compiled.instructions, input: compiled.input,
          store: false, service_tier: 'default', reasoning: { effort: compiled.settings.reasoning }, max_output_tokens: compiled.settings.maxOutputTokens, tools: [] })
      });
      if (!upstream.ok) {
        // Do not read or forward provider error bodies, which can contain sensitive request details.
        await upstream.body?.cancel().catch(() => {});
        throw upstreamError(upstream.status);
      }
      parsed = await readUpstreamJSON(upstream);
      result = parseResponse(parsed);
    } catch (error) {
      failure = controller.signal.aborted
        ? new HttpError(504, 'The API request timed out. The provider may still complete it and charge you. Check OpenAI usage before retrying; no automatic retry was made.')
        : error instanceof HttpError ? error : new HttpError(502, 'The API connection failed. Billing is uncertain; check OpenAI usage before retrying. No automatic retry was made.');
    } finally { clearTimeout(timeout); }
    const usage = result?.usage ?? calculateUsage(parsed);
    const status = result?.status ?? (controller.signal.aborted ? 'timeout_billing_uncertain' : upstream && !upstream.ok ? 'request_rejected' : 'connection_billing_uncertain');
    const record = { id: randomUUID(), date: new Date().toISOString(), projectId: project.id, model: PRICING.model, ...usage, status };
    let recorded = true;
    try { await store.appendUsage(record); }
    catch { recorded = false; }
    if (failure) throw failure;
    return { ...result, recorded };
  }

  const server = http.createServer(async (req, res) => {
    securityHeaders(res);
    try {
      enforceLocalRequest(req, server);
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/state') return sendJSON(res, 200, store.get());
      if (req.method === 'PUT' && url.pathname === '/api/state') {
        const sanitized = validateState(await readJSON(req));
        return sendJSON(res, 200, await store.replaceProjects(sanitized));
      }
      if (req.method === 'POST' && (url.pathname === '/api/compile' || url.pathname === '/api/run')) {
        const body = await readJSON(req);
        if (url.pathname === '/api/run') return sendJSON(res, 200, await paidRun(body));
        const options = validateCompileOptions(body);
        const project = store.get().projects.find(p => p.id === options.projectId);
        if (!project) throw new HttpError(404, 'The selected project does not exist.');
        return sendJSON(res, 200, compileContext(project, options));
      }
      if (url.pathname.startsWith('/api/')) {
        if (['/api/state', '/api/compile', '/api/run'].includes(url.pathname)) throw new HttpError(405, 'This API route does not support that HTTP method.');
        throw new HttpError(404, 'API route not found.');
      }
      const entry = STATIC_FILES.get(url.pathname);
      if (!entry) throw new HttpError(404, 'Page not found.');
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'This page supports only GET and HEAD.');
      let content;
      try { content = isSea() ? Buffer.from(getAsset(entry[0])) : await readFile(join(publicDirectory, entry[0])); }
      catch { throw new HttpError(503, 'App files are unavailable. Restore the public directory and restart.'); }
      res.writeHead(200, { 'Content-Type': entry[1], 'Content-Length': content.length });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!req.complete) { res.setHeader('Connection', 'close'); req.resume(); }
      const status = error instanceof HttpError ? error.status : 500;
      sendJSON(res, status, { error: error instanceof HttpError ? error.message : 'An unexpected local server error occurred. No sensitive details were returned.' });
    }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  return server;
}

export async function startServer({ port = 4317, ...options } = {}) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
  const server = await createAppServer(options);
  await new Promise((ready, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); ready(); });
  });
  return server;
}

if (!isSea() && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().then(server => {
    console.log(`Context Loom is local at http://localhost:${server.address().port}`);
    console.log('No API requests are made until you explicitly approve and run one in the app.');
  }).catch(() => {
    console.error('Context Loom could not start. Ensure port 4317 is free and data/state.json is valid and writable. Existing state was not overwritten.');
    process.exitCode = 1;
  });
}
