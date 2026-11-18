// mi update against a running generator: the patch merged into a committed project that a team has
// edited since, conflicts, files git does not track, a project inside a bigger repository, and a
// fullstack model change with its migration.

import { before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { git, mi, miError, miJson, requireBackend, tempDir } from './helpers.mjs';

before(requireBackend);

function generated(name, args) {
  const root = tempDir(name);
  const dir = join(root, name);
  miJson(['generate', '--artifact', name, ...args, '--into', dir]);
  git(['init', '-q'], dir);
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'Generated'], dir);
  return { root, dir };
}

function edit(path, from, to) {
  const text = readFileSync(path, 'utf8');
  assert.ok(text.includes(from), `${path} has no '${from}'`);
  writeFileSync(path, text.replace(from, to));
}

test('an update without --apply changes nothing and says what it holds', () => {
  const { root, dir } = generated('plain1', ['--deps', 'web,data-jpa,postgresql']);
  const r = miJson(['update', dir, '--add-deps', 'kafka', '--out', join(root, 'u')]);
  assert.ok(r.counts.added > 0);
  assert.ok(r.patchedFiles.includes('pom.xml'));
  assert.deepEqual(r.copyWhole, ['menora-model.json']);
  assert.equal(git(['status', '--porcelain'], dir), '');
});

test('the same model is refused; an uncommitted project is refused', () => {
  const { dir } = generated('plain2', ['--deps', 'web']);
  assert.equal(miError(['update', dir]).code, 2);
  writeFileSync(join(dir, 'scratch.txt'), 'x');
  assert.match(miError(['update', dir, '--add-deps', 'validation', '--apply']).stderr, /uncommitted changes/);
});

test('--apply merges with the team\'s edit and copies the new model', () => {
  const { dir } = generated('plain3', ['--deps', 'web,data-jpa,postgresql']);
  const pom = join(dir, 'pom.xml');
  edit(pom, '<description>', '<!-- team: keep --><description>');
  git(['commit', '-qam', 'team edit'], dir);
  const r = miJson(['update', dir, '--add-deps', 'kafka', '--opts', 'kafka=consumer-example', '--apply']);
  assert.equal(r.applied.git.exitCode, 0, r.applied.git.output);
  assert.deepEqual(r.applied.conflicts, []);
  assert.match(readFileSync(pom, 'utf8'), /team: keep/);
  assert.match(readFileSync(pom, 'utf8'), /spring-kafka/);
  assert.ok(JSON.parse(readFileSync(join(dir, 'menora-model.json'), 'utf8')).request.dependencies.includes('kafka'));
});

test('a conflicting edit is left marked and listed', () => {
  const { dir } = generated('plain4', ['--deps', 'web,data-jpa,postgresql']);
  const yaml = join(dir, 'src/main/resources/application.yaml');
  edit(yaml, '      enabled: false', '      enabled: true # team');
  git(['commit', '-qam', 'team: vault on'], dir);
  const r = miJson(['update', dir, '--add-deps', 'kafka', '--apply']);
  assert.deepEqual(r.applied.conflicts, ['src/main/resources/application.yaml']);
  assert.match(readFileSync(yaml, 'utf8'), /<<<<<<< ours/);
});

test('a project inside a bigger repository; an untracked .env is left alone', () => {
  const root = tempDir('mono');
  const dir = join(root, 'services', 'shop');
  mkdirSync(join(root, 'services'), { recursive: true });
  miJson(['generate', '--artifact', 'shop', '--deps', 'web,data-jpa,h2', '--modules', 'api,core,persistence', '--into', join(root, 'tmp')]);
  renameSync(join(root, 'tmp'), dir);
  git(['init', '-q'], root);
  git(['add', '-A'], root);
  git(['commit', '-qm', 'init'], root);
  assert.ok(existsSync(join(dir, 'shop-persistence', '.env')), 'the generated .env is there, git-ignored');
  const r = miJson(['update', dir, '--modules', 'api,core', '--apply']);
  assert.equal(r.applied.git.exitCode, 0, r.applied.git.output);
  assert.match(r.applied.git.command, /--directory=services\/shop/);
  assert.ok(r.applied.leftAlone.some((l) => l.path === 'shop-persistence/.env'));
  assert.ok(existsSync(join(dir, 'shop-persistence', '.env')), 'never deleted');
  assert.equal(existsSync(join(dir, 'shop-persistence', 'pom.xml')), false, 'tracked files of the dropped module go');
});

test('fullstack: a new field arrives as code and as a migration', () => {
  const root = tempDir('fsu');
  const req = join(root, 'req.json');
  miJson(['example', 'approvals', '--artifact', 'claims', '--out', req]);
  const dir = join(root, 'claims');
  miJson(['generate', '--file', req, '--add-deps', 'flyway', '--into', dir]);
  git(['init', '-q'], dir);
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'Generated'], dir);

  const target = join(root, 'target.json');
  miJson(['model', dir, '--out', target]);
  const request = JSON.parse(readFileSync(target, 'utf8'));
  request.entities.find((e) => e.name === 'ExpenseClaim').fields.push({ name: 'receiptNo', type: 'STRING', length: 40 });
  writeFileSync(target, JSON.stringify(request));

  // Fetch and review, then apply exactly that update: its migration keeps the reviewed name.
  const reviewed = miJson(['update', dir, '--target', target, '--out', join(root, 'update')]);
  assert.match(reviewed.next, /--use/);
  const r = miJson(['update', dir, '--use', join(root, 'update'), '--apply']);
  assert.equal(r.migration, reviewed.migration);
  assert.match(r.migration, /__model_update\.sql$/);
  assert.deepEqual(r.applied.conflicts, []);
  assert.match(readFileSync(join(dir, r.migration), 'utf8'), /receipt_no/);
  const entity = mi(['model', dir]);
  assert.match(entity.stdout, /receiptNo/);
});
