// Shared helpers for the menora-initializr skill scripts.
// Node >= 18 (built-in fetch). No npm dependencies.

import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const BASE_URL = process.env.MENORA_INITIALIZR_URL || 'http://localhost:8080';

export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !String(next).startsWith('--')) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

export function fullUrl(p) {
  const s = String(p);
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return BASE_URL + (s.startsWith('/') ? s : '/' + s);
}

export async function fail(msg, code = 1) {
  process.stderr.write(msg + '\n');
  process.exit(code);
}

export async function readJson(pathOrUrl, init = {}) {
  const url = fullUrl(pathOrUrl);
  const res = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    await fail(`HTTP ${res.status} ${res.statusText} ${url}\n${body}`);
  }
  return res.json();
}

export async function postJson(path, body) {
  return readJson(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function readStdin() {
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

// Passthrough flags whose name maps 1:1 to a query param on the backend
// generation endpoints.
const BACKEND_PASSTHROUGH = [
  'type', 'language', 'bootVersion', 'groupId', 'artifactId',
  'name', 'description', 'packageName', 'packaging', 'javaVersion',
];
const FRONTEND_PASSTHROUGH = [
  'projectName', 'description', 'scope', 'appTitle',
  'reactVersion', 'nodeVersion', 'packageManager', 'basePath',
  'colorPalette', 'apiBaseUrl', 'backendArtifactId',
];

// Builds a generation URL from CLI flags for the given passthrough param set.
// Translates --deps "web,jpa" → dependencies=web,jpa
// Translates --opts "kafka=consumer-example,producer-example;jpa=hibernate"
//   → opts-kafka=...&opts-jpa=...
function buildGenUrl(pathname, flags, passthrough) {
  const url = new URL(pathname, BASE_URL);
  for (const k of passthrough) {
    if (flags[k] !== undefined && flags[k] !== true) {
      url.searchParams.set(k, String(flags[k]));
    }
  }
  if (flags.deps) url.searchParams.set('dependencies', String(flags.deps));
  if (flags.opts) {
    for (const seg of String(flags.opts).split(';')) {
      const eq = seg.indexOf('=');
      if (eq === -1) continue;
      const dep = seg.slice(0, eq).trim();
      const vals = seg.slice(eq + 1).trim();
      if (dep && vals) url.searchParams.set(`opts-${dep}`, vals);
    }
  }
  return url;
}

// Backend single-module generation (/starter.zip, /starter.preview).
export function buildStarterUrl(pathname, flags) {
  return buildGenUrl(pathname, flags, BACKEND_PASSTHROUGH);
}

// Frontend React generation (/frontend/starter.zip, /frontend/starter.preview).
export function buildFrontendUrl(pathname, flags) {
  return buildGenUrl(pathname, flags, FRONTEND_PASSTHROUGH);
}

// Resolves a JSON request body from --file <path> or piped stdin, then parses it.
// Exits with a clear message on empty input or invalid JSON.
export async function resolveBody(flags) {
  const raw = flags.file && flags.file !== true
    ? await readFile(String(flags.file), 'utf8')
    : await readStdin();
  if (!raw.trim()) {
    await fail('No JSON body provided. Pass --file <path> or pipe JSON to stdin.');
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    await fail('Invalid JSON: ' + e.message);
  }
}

// Streams a fetch Response body to disk and reports size. Surfaces a non-OK
// response as a failure with the server's body text. Returns { savedTo, sizeBytes }.
export async function saveZip(res, outPath) {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    await fail(`HTTP ${res.status} ${res.statusText} ${res.url}\n${body}`);
  }
  await mkdir(dirname(outPath), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(outPath));
  const s = await stat(outPath);
  return { savedTo: outPath, sizeBytes: s.size };
}
