// Shared helpers for the menora-initializr skill scripts.
// Node >= 18 (built-in fetch). No npm dependencies.

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

// Builds a URL for /starter.zip or /starter.preview from CLI flags.
// Translates --deps "web,jpa" → dependencies=web,jpa
// Translates --opts "kafka=consumer-example,producer-example;jpa=hibernate"
//   → opts-kafka=...&opts-jpa=...
export function buildStarterUrl(pathname, flags) {
  const url = new URL(pathname, BASE_URL);
  const passthrough = [
    'type', 'language', 'bootVersion', 'groupId', 'artifactId',
    'name', 'description', 'packageName', 'packaging', 'javaVersion',
  ];
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
