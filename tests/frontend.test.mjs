// Deep tests for the frontend scripts: React-version filtering, server-side
// compatibility resolution (REQUIRES / CONFLICTS), sub-option gating, and
// structural checks on the generated React project.
// Requires the backend up (self-guarded in `before`).

import { test, describe, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runJson, requireBackend, findFile, parseJsonFile, assertZipEntries, pickVersionId,
} from './helpers.mjs';

let TMP;
let FE_META;

before(async () => {
  await requireBackend();
  TMP = await mkdtemp(join(tmpdir(), 'menora-frontend-'));
  FE_META = await runJson('metadata', ['--section', 'frontend']);
});

// Flattens /frontend/metadata's dependencies[].entries[] into a flat id list.
function feDepIds(meta) {
  return (meta.dependencies || []).flatMap((g) => (g.entries || []).map((e) => e.id));
}

describe('React-version compatibility filtering', () => {
  test('design-mui is offered for React 18 and dropped for React 19', async (t) => {
    const v18 = pickVersionId(FE_META, '18');
    const v19 = pickVersionId(FE_META, '19');
    if (!v18 || !v19) {
      t.skip(`need both React 18 and 19 seeded (got 18=${v18}, 19=${v19})`);
      return;
    }
    const m18 = await runJson('metadata', ['--section', 'frontend', '--reactVersion', v18]);
    const m19 = await runJson('metadata', ['--section', 'frontend', '--reactVersion', v19]);
    assert.ok(feDepIds(m18).includes('design-mui'), 'design-mui missing from React 18 catalog');
    assert.ok(!feDepIds(m19).includes('design-mui'), 'design-mui should be filtered out for React 19');
  });
});

describe('server-side compatibility resolution', () => {
  test('REQUIRES: design-shadcn auto-adds Tailwind', async () => {
    const j = await runJson('frontend-preview', ['--projectName', 'demo', '--deps', 'design-shadcn']);
    // shadcn REQUIRES style-tailwind → tailwind config is pulled in even though
    // it was never selected, alongside shadcn's own components.json.
    findFile(j, 'tailwind.config.js');
    findFile(j, 'components.json');
  });

  test('CONFLICTS: the later-selected design system is dropped', async () => {
    const j = await runJson('frontend-preview', ['--projectName', 'demo', '--deps', 'design-shadcn,design-mui']);
    const pkg = parseJsonFile(j, 'package.json');
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    assert.ok(!('@mui/material' in allDeps),
      `@mui/material should have been dropped (CONFLICTS with shadcn)\ndeps: ${Object.keys(allDeps).join(', ')}`);
    findFile(j, 'components.json'); // the surviving (earlier) shadcn selection
  });
});

describe('frontend sub-options', () => {
  test('comp-button + comp-card gate their shadcn UI files', async () => {
    const withOpts = await runJson('frontend-preview', [
      '--projectName', 'demo', '--deps', 'design-shadcn',
      '--opts', 'design-shadcn=comp-button,comp-card',
    ]);
    findFile(withOpts, 'src/shared/ui/button.tsx');
    findFile(withOpts, 'src/shared/ui/card.tsx');

    const without = await runJson('frontend-preview', ['--projectName', 'demo', '--deps', 'design-shadcn']);
    const paths = without.files.map((f) => f.path);
    assert.ok(!paths.some((p) => p.endsWith('src/shared/ui/button.tsx')),
      'button.tsx should be absent without comp-button');
  });
});

describe('frontend artifact structure', () => {
  test('preview yields a valid package.json + Vite/TS config', async () => {
    const j = await runJson('frontend-preview', ['--projectName', 'demo']);
    const pkg = parseJsonFile(j, 'package.json');
    assert.ok(pkg.scripts && pkg.scripts.dev, 'package.json has no dev script');
    assert.ok(pkg.dependencies && Object.keys(pkg.dependencies).length > 0, 'package.json has no dependencies');
    findFile(j, 'tsconfig.json');
    const paths = j.files.map((f) => f.path);
    assert.ok(paths.some((p) => /vite\.config\.[tj]s$/.test(p)),
      `no vite.config.*\nactual: ${paths.slice(0, 40).join(', ')}`);
  });

  test('generate writes a zip with a sane entry count', async () => {
    const out = join(TMP, 'frontend.zip');
    await runJson('frontend-generate', ['--projectName', 'demo', '--out', out]);
    await assertZipEntries(out, 5);
  });
});
