// Deep tests for the fullstack scripts: the validation matrix, import-ddl
// dialects + error path, and structural checks on generated artifacts.
// Requires the backend up (self-guarded in `before`).

import { test, describe, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runJson, runJsonError, requireBackend, assertFiles,
  findFile, parseJsonFile, assertZipEntries, FIXTURES,
} from './helpers.mjs';

let TMP;

before(async () => {
  await requireBackend();
  TMP = await mkdtemp(join(tmpdir(), 'menora-fullstack-'));
});

// Minimal valid FullstackStarterRequest. Tests deep-clone + mutate this.
function fullstackBase() {
  return {
    groupId: 'com.demo', artifactId: 'app', packageName: 'com.demo.app',
    type: 'maven-project', language: 'java', packaging: 'jar',
    bootVersion: '3.2.1', javaVersion: '21',
    dependencies: ['web', 'data-jpa', 'h2'],
    entities: [{
      name: 'Product', tableName: 'products',
      fields: [
        { name: 'id', type: 'LONG', primaryKey: true, generated: true },
        { name: 'name', type: 'STRING', required: true },
      ],
    }],
  };
}

// Runs fullstack-preview with a mutated body and asserts a 400 "Invalid request"
// whose detail matches `re`.
async function expectInvalid(mutate, re) {
  const body = fullstackBase();
  mutate(body);
  const err = await runJsonError('fullstack-preview', [], JSON.stringify(body));
  assert.equal(err.error, 'Invalid request', `unexpected error body: ${JSON.stringify(err)}`);
  assert.match(err.detail, re, `detail '${err.detail}' did not match ${re}`);
}

describe('fullstack validation matrix', () => {
  test('no entities → 400', () =>
    expectInvalid((b) => { b.entities = []; }, /at least one entity/i));

  test('entity with no fields → 400', () =>
    expectInvalid((b) => { b.entities[0].fields = []; }, /field/i));

  test('no primary key → 400', () =>
    expectInvalid((b) => { b.entities[0].fields[0].primaryKey = false; }, /primary key/i));

  test('multiple primary keys → 400', () =>
    expectInvalid((b) => { b.entities[0].fields[1].primaryKey = true; }, /multiple primary key/i));

  test('unknown field type → 400', () =>
    expectInvalid((b) => { b.entities[0].fields[1].type = 'FLOAT'; }, /FLOAT|type/i));

  test('ENUM without enumValues → 400', () =>
    expectInvalid((b) => { b.entities[0].fields[1].type = 'ENUM'; }, /enumValues/i));

  test('enumValues on non-ENUM → 400', () =>
    expectInvalid((b) => { b.entities[0].fields[1].enumValues = ['A', 'B']; }, /enumValues/i));

  test('length on non-STRING field → 400', () =>
    expectInvalid((b) => { b.entities[0].fields[0].length = 50; }, /length/i));

  test('reserved keyword field name → 400', () =>
    expectInvalid((b) => { b.entities[0].fields[1].name = 'class'; }, /reserved|identifier/i));

  test('duplicate entity names → 400', () =>
    expectInvalid((b) => { b.entities.push({ ...b.entities[0] }); }, /duplicate entity/i));

  test('duplicate field names → 400', () =>
    expectInvalid((b) => { b.entities[0].fields[1].name = 'id'; }, /duplicate field/i));
});

describe('import-ddl', () => {
  test('POSTGRESQL dialect parses CREATE TABLE into entities[]', async () => {
    const ddl = await readFile(join(FIXTURES, 'schema.sql'), 'utf8');
    const entities = await runJson('import-ddl', ['--dialect', 'POSTGRESQL'], ddl);
    assert.ok(Array.isArray(entities) && entities.length === 1, `expected 1 entity: ${JSON.stringify(entities)}`);
    assert.ok(entities[0].fields.some((f) => f.primaryKey), 'no PK field parsed');
  });

  test('bad SQL → structured 400 Invalid SQL', async () => {
    const err = await runJsonError('import-ddl', ['--dialect', 'H2'], 'THIS IS NOT SQL;');
    assert.equal(err.error, 'Invalid SQL');
    assert.ok(typeof err.detail === 'string' && err.detail.length > 0, 'no detail on Invalid SQL');
  });
});

describe('fullstack artifact structure', () => {
  let RICH;
  before(async () => { RICH = await readFile(join(FIXTURES, 'fullstack-rich.json'), 'utf8'); });

  test('preview yields a structurally valid backend + frontend', async () => {
    const j = await runJson('fullstack-preview', [], RICH);

    const pom = findFile(j, 'backend/pom.xml');
    assert.match(pom.content, /<project[\s>]/, 'backend/pom.xml has no <project> root');
    assert.match(pom.content, /<artifactId>app<\/artifactId>/, 'artifactId not substituted into pom');

    const pkg = parseJsonFile(j, 'frontend/package.json'); // throws if not valid JSON
    assert.ok(pkg.name, 'frontend package.json has no name');
    assert.ok(pkg.scripts && pkg.scripts.dev, 'frontend package.json has no dev script');

    const product = findFile(j, 'Product.java');
    assert.match(product.content, /class\s+Product/, 'Product.java has no Product class');

    assertFiles(j, { contains: ['README.md'] });
  });

  test('generate writes a zip with a sane entry count', async () => {
    const out = join(TMP, 'fullstack-rich.zip');
    await runJson('fullstack-generate', ['--out', out], RICH);
    await assertZipEntries(out, 15);
  });
});
