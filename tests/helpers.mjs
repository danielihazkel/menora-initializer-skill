import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { strict as assert } from 'node:assert';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SKILL_ROOT = dirname(HERE);
export const FIXTURES = join(HERE, 'fixtures');
export const BASE_URL = process.env.MENORA_INITIALIZR_URL || 'http://localhost:8080';

export const SCRIPT = (name) => join(SKILL_ROOT, 'scripts', `${name}.mjs`);

// opts.env is merged over the parent environment, letting a test override
// MENORA_INITIALIZR_URL (or anything else) for a single spawn.
export function runScript(name, args = [], stdin = null, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT(name), ...args], {
      cwd: SKILL_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (stdin !== null) child.stdin.write(stdin);
    child.stdin.end();
  });
}

export async function runJson(name, args = [], stdin = null, opts = {}) {
  const { code, stdout, stderr } = await runScript(name, args, stdin, opts);
  assert.equal(code, 0, `${name} exited ${code}\nstderr: ${stderr}\nstdout: ${stdout.slice(0, 300)}`);
  try {
    return JSON.parse(stdout);
  } catch (e) {
    throw new Error(`${name}: stdout is not JSON\n${stdout.slice(0, 500)}`);
  }
}

// _lib.mjs:fail() writes:  "HTTP <status> <statusText> <url>\n<body>\n" to stderr,
// then exits non-zero. The <body> is JSON when the server returned JSON.
export async function runJsonError(name, args = [], stdin = null, opts = {}) {
  const { code, stderr } = await runScript(name, args, stdin, opts);
  assert.notEqual(code, 0, `${name} unexpectedly succeeded`);
  const httpLineIdx = stderr.indexOf('HTTP ');
  assert.ok(httpLineIdx !== -1, `${name}: no HTTP line in stderr\n${stderr}`);
  const afterStatus = stderr.slice(stderr.indexOf('\n', httpLineIdx) + 1).trim();
  const firstLine = afterStatus.split('\n')[0];
  try {
    return JSON.parse(firstLine);
  } catch (e) {
    throw new Error(`${name}: error body is not JSON\nstderr: ${stderr}`);
  }
}

export function assertFiles(preview, { contains = [], excludes = [] } = {}) {
  assert.ok(Array.isArray(preview?.files), `no files[] in preview response`);
  const paths = preview.files.map((f) => f.path);
  for (const p of contains) {
    assert.ok(paths.includes(p), `expected file '${p}' not in files[]\nactual: ${paths.join(', ')}`);
  }
  for (const p of excludes) {
    assert.ok(!paths.includes(p), `file '${p}' was present but should not be\nactual: ${paths.join(', ')}`);
  }
}

// Locates a file in a preview response by exact path or path suffix.
// Throws (listing what was present) when nothing matches.
export function findFile(preview, suffix) {
  assert.ok(Array.isArray(preview?.files), 'no files[] in preview response');
  const hit = preview.files.find((f) => f.path === suffix || f.path.endsWith(suffix));
  assert.ok(hit, `no file matching '${suffix}'\nactual: ${preview.files.map((f) => f.path).slice(0, 50).join(', ')}`);
  return hit;
}

// Returns the parsed JSON content of the file matched by `suffix`. Fails with
// the raw content on a parse error.
export function parseJsonFile(preview, suffix) {
  const file = findFile(preview, suffix);
  try {
    return JSON.parse(file.content);
  } catch (e) {
    throw new Error(`'${file.path}' is not valid JSON: ${e.message}\n${file.content.slice(0, 300)}`);
  }
}

// Dependency-free structural check on a real .zip: parses the End Of Central
// Directory record to read the total-entry count and asserts it is >= min.
export async function assertZipEntries(path, min) {
  const buf = await readFile(path);
  const EOCD_SIG = 0x06054b50;
  // EOCD is at least 22 bytes and lives at the tail (no zip comment in our output).
  let p = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { p = i; break; }
  }
  assert.ok(p !== -1, `${path}: no End Of Central Directory record (not a zip?)`);
  const total = buf.readUInt16LE(p + 10); // total number of central directory records
  assert.ok(total >= min, `${path}: only ${total} zip entries, expected >= ${min}`);
  return total;
}

// Picks a reactVersions[] id from /frontend/metadata whose major == `major`
// ("18", "19"). Returns null when that major is not seeded, so callers can skip.
export function pickVersionId(frontendMeta, major) {
  const versions = frontendMeta?.reactVersions || [];
  const hit = versions.find((v) => {
    const id = typeof v === 'string' ? v : v.id;
    return typeof id === 'string' && id.split('.')[0] === String(major);
  });
  if (!hit) return null;
  return typeof hit === 'string' ? hit : hit.id;
}

export async function backendIsUp() {
  try {
    const res = await fetch(`${BASE_URL}/actuator/health`);
    if (!res.ok) return false;
    const j = await res.json();
    return j.status === 'UP';
  } catch {
    return false;
  }
}

export async function requireBackend() {
  if (!(await backendIsUp())) {
    throw new Error(
      `Backend not UP at ${BASE_URL} — start it first:\n` +
        `  cd backend && java -jar target/offline-spring-init-1.0.0-SNAPSHOT.jar`,
    );
  }
}
