// Verifies the scripts honor MENORA_INITIALIZR_URL — both that an unreachable
// URL fails loudly (the agent's signal to ask the user / start the backend) and
// that an explicit URL is used over the localhost:8080 default.
//
// The refused-connection test needs NO backend, so it is intentionally NOT
// behind requireBackend — it is the negative control that still passes when the
// backend is down. The positive test skips itself when the backend is unreachable.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { runScript, runJson, backendIsUp, BASE_URL } from './helpers.mjs';

describe('MENORA_INITIALIZR_URL handling', () => {
  test('an unreachable URL exits non-zero with a network error', async () => {
    const { code, stderr } = await runScript('metadata', ['--section', 'client'], null, {
      env: { MENORA_INITIALIZR_URL: 'http://127.0.0.1:1' },
    });
    assert.notEqual(code, 0, 'script should fail against a dead URL');
    assert.match(stderr, /ECONNREFUSED|fetch failed|ENOTFOUND|ECONNRESET/i,
      `stderr did not look like a network failure:\n${stderr.slice(0, 400)}`);
  });

  test('an explicit reachable URL is honored', async (t) => {
    if (!(await backendIsUp())) { t.skip(`backend not up at ${BASE_URL}`); return; }
    const data = await runJson('metadata', ['--section', 'client'], null, {
      env: { MENORA_INITIALIZR_URL: BASE_URL },
    });
    assert.ok(data?.dependencies?.values?.length > 0, 'explicit URL did not return client metadata');
  });
});
