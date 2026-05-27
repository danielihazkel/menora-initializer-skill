import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { strict as assert } from 'node:assert';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SKILL_ROOT = dirname(HERE);
export const FIXTURES = join(HERE, 'fixtures');
export const BASE_URL = process.env.MENORA_INITIALIZR_URL || 'http://localhost:8080';

export const SCRIPT = (name) => join(SKILL_ROOT, 'scripts', `${name}.mjs`);

export function runScript(name, args = [], stdin = null) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT(name), ...args], {
      cwd: SKILL_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
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

export async function runJson(name, args = [], stdin = null) {
  const { code, stdout, stderr } = await runScript(name, args, stdin);
  assert.equal(code, 0, `${name} exited ${code}\nstderr: ${stderr}\nstdout: ${stdout.slice(0, 300)}`);
  try {
    return JSON.parse(stdout);
  } catch (e) {
    throw new Error(`${name}: stdout is not JSON\n${stdout.slice(0, 500)}`);
  }
}

// _lib.mjs:fail() writes:  "HTTP <status> <statusText> <url>\n<body>\n" to stderr,
// then exits non-zero. The <body> is JSON when the server returned JSON.
export async function runJsonError(name, args = [], stdin = null) {
  const { code, stderr } = await runScript(name, args, stdin);
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
