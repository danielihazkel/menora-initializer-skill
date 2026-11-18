import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SKILL_ROOT = dirname(HERE);
export const FIXTURES = join(HERE, 'fixtures');
export const MI = join(SKILL_ROOT, 'scripts', 'mi.mjs');
export const BASE_URL = process.env.MENORA_INITIALIZR_URL || 'http://localhost:8080';

/** Runs mi.mjs: { code, stdout, stderr }. `opts.cwd`, `opts.env` (merged), `opts.input` (stdin). */
export function mi(args, opts = {}) {
  const r = spawnSync(process.execPath, [MI, ...args], {
    cwd: opts.cwd || SKILL_ROOT,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    input: opts.input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Runs mi.mjs and parses its JSON answer, failing with stderr when it did not succeed. */
export function miJson(args, opts) {
  const r = mi(args, opts);
  assert.equal(r.code, 0, `mi ${args.join(' ')} exited ${r.code}\n${r.stderr}\n${r.stdout.slice(0, 400)}`);
  try { return JSON.parse(r.stdout); } catch { throw new Error(`not JSON:\n${r.stdout.slice(0, 500)}`); }
}

/** Runs mi.mjs expecting a failure: { code, status line, body (parsed when JSON), hint }. */
export function miError(args, opts) {
  const r = mi(args, opts);
  assert.notEqual(r.code, 0, `mi ${args.join(' ')} unexpectedly succeeded`);
  const lines = r.stderr.split('\n');
  const hintAt = lines.findIndex((l) => l.startsWith('hint: '));
  const bodyText = lines.slice(1, hintAt === -1 ? undefined : hintAt).join('\n').trim();
  let body = bodyText;
  try { body = JSON.parse(bodyText); } catch { /* not JSON */ }
  return { code: r.code, first: lines[0], body, hint: hintAt === -1 ? undefined : lines[hintAt].slice(6), stderr: r.stderr };
}

export const tempDir = (name) => mkdtempSync(join(tmpdir(), `mi-test-${name}-`));

export function git(args, cwd) {
  const r = spawnSync('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=mi test', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

export async function requireBackend() {
  try {
    const res = await fetch(`${BASE_URL}/actuator/health`);
    if (res.ok && (await res.json()).status === 'UP') return;
  } catch { /* below */ }
  throw new Error(`The generator is not UP at ${BASE_URL}; start it (on a scratch database) before these tests.`);
}
