// Talking to the generator: one place for the base URL, the headers it reads and how its
// refusals are reported. Plain node:http(s) without keep-alive rather than fetch: a pooled fetch
// socket still closing when the process ends trips a libuv assertion on Windows (Node 24).

import http from 'node:http';
import https from 'node:https';

export const BASE_URL = (process.env.MENORA_INITIALIZR_URL || 'http://localhost:8080').replace(/\/+$/, '');

/** Exit codes: what the caller can tell apart without reading stderr. */
export const EXIT = { refused: 1, usage: 2, unreachable: 3, server: 4 };

export class CliError extends Error {
  constructor(message, code = EXIT.usage, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Headers every call carries. `userinfo` names the caller to the server's audit (and is needed
 * where the server's access gate is on); it is sent only when MENORA_USERINFO says who that is.
 */
function baseHeaders() {
  const h = {};
  if (process.env.MENORA_USERINFO) h.userinfo = process.env.MENORA_USERINFO;
  return h;
}

export function url(path, query) {
  const u = new URL(BASE_URL + (path.startsWith('/') ? path : '/' + path));
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === '') continue;
    u.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return u;
}

/** One HTTP call; a network failure becomes a clear "is the server running" error. */
export async function call(method, path, { query, json, headers } = {}) {
  const target = url(path, query);
  const head = { ...baseHeaders(), ...(headers || {}) };
  const body = json === undefined ? null : Buffer.from(JSON.stringify(json));
  if (body) { head['Content-Type'] = 'application/json'; head['Content-Length'] = body.length; }
  const lib = target.protocol === 'https:' ? https : http;
  try {
    return await new Promise((resolveRes, reject) => {
      const req = lib.request(target, { method, headers: head, agent: false }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolveRes(response(res, Buffer.concat(chunks))));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(300000, () => req.destroy(new Error('timed out after 5 minutes')));
      if (body) req.write(body);
      req.end();
    });
  } catch (e) {
    throw new CliError(
      `Cannot reach the generator at ${BASE_URL} (${e.code || e.message}).\n` +
      'Ask the user to start it or for its URL (MENORA_INITIALIZR_URL). Do not start it yourself.',
      EXIT.unreachable);
  }
}

/** The little of fetch's Response the callers use. */
function response(res, buf) {
  return {
    status: res.statusCode,
    ok: res.statusCode >= 200 && res.statusCode < 300,
    headers: { get: (name) => res.headers[name.toLowerCase()] ?? null },
    text: async () => buf.toString('utf8'),
    json: async () => JSON.parse(buf.toString('utf8')),
    buffer: buf,
  };
}

/** The body of a refusal, parsed when it is JSON. */
async function errorBody(res) {
  const text = await res.text().catch(() => '');
  try { return JSON.parse(text); } catch { return text; }
}

/** Throws a CliError carrying the server's own words for a non-2xx answer. */
export async function ensureOk(res, method, path) {
  if (res.ok) return res;
  const body = await errorBody(res);
  throw new CliError(`HTTP ${res.status} ${method} ${path}`, res.status >= 500 ? EXIT.server : EXIT.refused,
    { status: res.status, body, hint: hintFor(res.status, body, path) });
}

export async function getJson(path, query) {
  const res = await ensureOk(await call('GET', path, { query, headers: { Accept: 'application/json' } }), 'GET', path);
  return res.json();
}

export async function sendJson(method, path, json) {
  const res = await ensureOk(await call(method, path, { json, headers: { Accept: 'application/json' } }), method, path);
  return res.status === 204 ? null : res.json();
}

export async function getBytes(method, path, { query, json } = {}) {
  const res = await ensureOk(await call(method, path, { query, json }), method, path);
  return { buf: res.buffer, headers: res.headers };
}

/** What to do about the commonest refusals, said once here rather than in every caller. */
function hintFor(status, body, path) {
  const b = body && typeof body === 'object' ? body : {};
  if (status === 403 && b.code === 'USERINFO_REQUIRED') {
    return 'The server wants to know who is calling: set MENORA_USERINFO to the user\'s login and retry.';
  }
  if (typeof b.path === 'string') return `The problem is at ${b.path} in the request.`;
  if (status === 400 && path === '/starter.zip') {
    return 'The plain endpoint does not say why; run the same request through `mi.mjs preview` to see the reason.';
  }
  if (status === 500 && typeof b.detail === 'string' && /Unknown (dependency|language|type)/.test(b.detail)) {
    return 'Check the ids against `mi.mjs meta deps`.';
  }
  return undefined;
}
