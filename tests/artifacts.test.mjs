// Structural depth for the backend single-module + wizard generators that the
// smoke suite (run.test.mjs) only checks for zip magic bytes.
// Requires the backend up (self-guarded in `before`).

import { test, describe, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runJson, requireBackend, findFile, assertZipEntries } from './helpers.mjs';

let TMP;

const COMMON = [
  '--type', 'maven-project', '--language', 'java', '--packaging', 'jar',
  '--groupId', 'com.demo', '--artifactId', 'app', '--packageName', 'com.demo.app',
  '--bootVersion', '3.2.1', '--javaVersion', '21',
];

before(async () => {
  await requireBackend();
  TMP = await mkdtemp(join(tmpdir(), 'menora-artifacts-'));
});

describe('backend single-module artifact structure', () => {
  test('preview pom.xml + entry point + config are structurally sound', async () => {
    const j = await runJson('preview', [...COMMON, '--deps', 'web,data-jpa,h2']);

    const pom = findFile(j, 'pom.xml');
    assert.match(pom.content, /<project[\s>]/, 'pom.xml has no <project> root');
    assert.match(pom.content, /<artifactId>app<\/artifactId>/, 'artifactId not substituted');
    assert.match(pom.content, /repo\.menora\.co\.il\/artifactory/, 'Artifactory repo missing from pom');

    const main = j.files.find((f) => /@SpringBootApplication/.test(f.content));
    assert.ok(main, 'no @SpringBootApplication entry-point class in generated project');

    findFile(j, 'application.yaml');
  });

  test('generate writes a zip with a sane entry count', async () => {
    const out = join(TMP, 'backend.zip');
    await runJson('generate', [...COMMON, '--deps', 'web,data-jpa', '--out', out]);
    await assertZipEntries(out, 10);
  });

  test('wizard-generate (SQL) writes a zip with a sane entry count', async () => {
    const out = join(TMP, 'wizard.zip');
    const payload = JSON.stringify({
      groupId: 'com.demo', artifactId: 'app', packageName: 'com.demo.app',
      type: 'maven-project', language: 'java', packaging: 'jar',
      bootVersion: '3.2.1', javaVersion: '21',
      dependencies: ['web', 'data-jpa', 'h2'],
      sqlByDep: { h2: 'CREATE TABLE users (id BIGINT PRIMARY KEY, name VARCHAR(255));' },
      sqlOptions: { h2: { subPackage: 'sql', tables: [{ name: 'users', generateRepository: true }] } },
    });
    await runJson('wizard-generate', ['--out', out], payload);
    await assertZipEntries(out, 10);
  });
});
