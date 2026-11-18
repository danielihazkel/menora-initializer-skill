// mi.mjs against a running generator: discovery, preview, generate (every kind), the wizards,
// imports, live-schema refusals and the exit codes. Start the server on a scratch database first.

import { before, describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { FIXTURES, mi, miError, miJson, requireBackend, tempDir } from './helpers.mjs';

const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8');
const writeJson = (dir, name, value) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(value)); return p; };

before(requireBackend);

describe('discovery', () => {
  test('health and the summary of what the server offers', () => {
    assert.equal(miJson(['health']).status, 'UP');
    const s = miJson(['meta']);
    assert.ok(s.bootVersions.includes('3.2.1'), 'Boot versions without .RELEASE');
    assert.ok(Object.values(s.dependencies).flat().some((d) => d.startsWith('data-jpa')));
    assert.ok(Object.keys(s.wizards.sql).includes('postgresql'));
    assert.ok(s.wizards.events.includes('kafka'));
    assert.ok(s.examples.some((e) => e.startsWith('approvals')));
    assert.ok(s.modules.some((m) => m.startsWith('api')));
  });

  test('meta deps searches ids, names and descriptions, with sub-options', () => {
    const kafka = miJson(['meta', 'deps', 'kafka']).find((d) => d.id === 'kafka');
    assert.ok(kafka.subOptions.includes('consumer-example'));
  });

  test('raw sections and an unknown one', () => {
    assert.ok(Array.isArray(miJson(['meta', 'compatibility', '--kind', 'BACKEND'])));
    assert.ok(miJson(['meta', 'fullstack-schema']).fieldTypes.some((t) => t.type === 'MONEY'));
    assert.ok(miJson(['meta', 'frontend']).colorPalettes.length > 0);
    const e = miError(['meta', 'nope']);
    assert.equal(e.code, 2);
  });

  test('an unreachable server is exit 3 and says not to start it', () => {
    const e = miError(['health'], { env: { MENORA_INITIALIZR_URL: 'http://127.0.0.1:1' } });
    assert.equal(e.code, 3);
    assert.match(e.stderr, /Do not start it yourself/);
  });
});

describe('preview and the checks made before calling', () => {
  test('lists files, filters, shows one', () => {
    const p = miJson(['preview', '--deps', 'web,kafka', '--opts', 'kafka=consumer-example']);
    assert.equal(p.kind, 'backend');
    assert.ok(p.files.includes('pom.xml'));
    assert.ok(miJson(['preview', '--deps', 'web,kafka', '--opts', 'kafka=consumer-example', '--filter', 'consumer']).files.length > 0);
    const shown = mi(['preview', '--deps', 'web', '--show', 'application.yaml']);
    assert.match(shown.stdout, /^===== src\/main\/resources\/application\.yaml/);
  });

  test('an unknown dependency, version or module is refused with a suggestion (exit 2)', () => {
    const e = miError(['preview', '--deps', 'web,jpa']);
    assert.equal(e.code, 2);
    assert.match(e.stderr, /unknown dependency 'jpa' \(did you mean data-jpa/);
    assert.match(miError(['preview', '--deps', 'web', '--boot', '2.7.0']).stderr, /bootVersion '2.7.0' is not offered/);
    assert.match(miError(['preview', '--deps', 'web', '--modules', 'api,nope']).stderr, /unknown module 'nope'/);
  });

  test('the server\'s refusal comes back with its path (exit 1)', () => {
    const e = miError(['preview', '--file', '-'], { input: JSON.stringify({ artifactId: 'x', entities: [{ name: 'class', fields: [{ name: 'id', type: 'LONG', primaryKey: true }] }] }) });
    assert.equal(e.code, 1);
    assert.equal(e.body.path, 'entities[0].name');
    assert.match(e.hint, /entities\[0\]\.name/);
  });

  test('a CONFLICTS rule is the server\'s 400 naming both', () => {
    const e = miError(['preview', '--deps', 'web,webflux']);
    assert.equal(e.code, 1);
    assert.match(JSON.stringify(e.body), /cannot be used together/);
  });
});

describe('generate', () => {
  test('plain backend into a folder, with its model and next steps', () => {
    const dir = tempDir('plain');
    const r = miJson(['generate', '--artifact', 'billing', '--deps', 'web,data-jpa,postgresql', '--into', join(dir, 'billing')]);
    assert.equal(r.kind, 'backend');
    for (const f of ['pom.xml', 'menora-model.json', 'compose.yaml', 'src/main/resources/application-compose.yaml']) {
      assert.ok(existsSync(join(dir, 'billing', f)), f);
    }
    assert.ok(r.next.some((s) => s.includes('profiles=compose')));
    const again = miError(['generate', '--artifact', 'billing', '--deps', 'web', '--into', join(dir, 'billing')]);
    assert.equal(again.code, 2, 'a non-empty folder is refused');
  });

  test('--zip saves the archive', () => {
    const dir = tempDir('zip');
    const r = miJson(['generate', '--deps', 'web', '--zip', join(dir, 'a.zip')]);
    assert.ok(r.sizeBytes > 1000);
    assert.equal(readFileSync(join(dir, 'a.zip')).subarray(0, 2).toString(), 'PK');
  });

  test('multi-module: one folder per module, the zip root stripped', () => {
    const dir = tempDir('mm');
    miJson(['generate', '--artifact', 'shop', '--deps', 'web,data-jpa,h2', '--modules', 'api,core,persistence', '--into', dir]);
    for (const m of ['shop-api', 'shop-core', 'shop-persistence']) assert.ok(existsSync(join(dir, m, 'pom.xml')), m);
    assert.equal(JSON.parse(readFileSync(join(dir, 'menora-model.json'), 'utf8')).kind, 'multimodule');
  });

  test('a wizard with modules is refused before calling', () => {
    const dir = tempDir('wm');
    const file = writeJson(dir, 'r.json', { dependencies: ['web'], specByDep: { web: fixture('openapi.yaml') }, modules: ['api'] });
    assert.match(miError(['preview', '--file', file]).stderr, /ONE module/);
  });

  test('frontend', () => {
    const dir = tempDir('fe');
    miJson(['generate', 'frontend', '--projectName', 'portal', '--deps', 'router', '--into', dir]);
    assert.ok(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts.dev);
  });

  test('fullstack from an example: backend, frontend, compose and its model', () => {
    const dir = tempDir('fs');
    const req = join(dir, 'req.json');
    miJson(['example', 'approvals', '--artifact', 'claims', '--out', req]);
    const r = miJson(['generate', '--file', req, '--add-deps', 'flyway', '--scaffold', 'audit,tests', '--into', join(dir, 'claims')]);
    assert.equal(r.kind, 'fullstack');
    assert.ok(r.templatesHash);
    for (const f of ['backend/pom.xml', 'frontend/package.json', 'compose.yaml', 'README.md', 'backend/src/main/resources/db/migration/V1__init.sql']) {
      assert.ok(existsSync(join(dir, 'claims', f)), f);
    }
    const model = JSON.parse(readFileSync(join(dir, 'claims', 'menora-model.json'), 'utf8'));
    assert.ok(model.request.dependencies.includes('ldap-auth-rest'), '--add-deps keeps the set\'s defaults');
    assert.ok(model.request.dependencies.includes('flyway'));
    assert.ok(r.next.some((s) => s.includes('profiles=local')));
  });

  test('fullstack on PostgreSQL: --db replaces h2, the next steps start the database', () => {
    const dir = tempDir('fsdb');
    const req = join(dir, 'req.json');
    miJson(['example', 'blog', '--out', req]);
    const yaml = mi(['preview', '--file', req, '--db', 'postgresql', '--add-deps', 'flyway', '--show', 'backend/src/main/resources/application.yaml']).stdout;
    assert.doesNotMatch(yaml, /H2Dialect/);
    const r = miJson(['generate', '--file', req, '--db', 'postgresql', '--add-deps', 'flyway', '--add-scaffold', 'tests', '--into', join(dir, 'blog')]);
    assert.ok(r.next.some((s) => s.startsWith('docker compose up -d postgres')));
    assert.ok(r.next.some((s) => s.includes('profiles=compose,local')));
    assert.ok(r.next.some((s) => s.includes('npm test')));
  });
});

describe('wizards', () => {
  test('SQL + OpenAPI in one request, as the SKILL.md recipe writes it', () => {
    const dir = tempDir('wiz');
    const file = writeJson(dir, 'r.json', {
      artifactId: 'pets', dependencies: ['web', 'postgresql', 'flyway'],
      sqlByDep: { postgresql: 'CREATE TABLE owner (id BIGSERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL);' },
      sqlOptions: { postgresql: { apiMode: 'INLINE_DTO', generateTests: true } },
      specByDep: { web: fixture('openapi.yaml') },
      openApiOptions: { web: { mode: 'CONTROLLERS', apiStyle: 'interfaces', copySpec: true } },
    });
    const files = miJson(['preview', '--file', file]).files;
    assert.ok(files.some((f) => f.endsWith('/entity/Owner.java')));
    assert.ok(files.some((f) => f.endsWith('Api.java')), 'interfaces style');
    assert.ok(files.includes('src/main/resources/db/migration/V1__init.sql'));
    assert.ok(files.some((f) => f.startsWith('src/main/resources/openapi/')), 'copySpec');
  });

  test('SOAP and events', () => {
    const dir = tempDir('wiz2');
    const soap = writeJson(dir, 's.json', { dependencies: ['web-services'], wsdlByDep: { 'web-services': fixture('service.wsdl') }, soapOptions: { 'web-services': { mode: 'BOTH' } } });
    assert.ok(miJson(['preview', '--file', soap]).files.some((f) => /endpoint\//.test(f)));
    const events = writeJson(dir, 'e.json', { dependencies: ['kafka'], asyncApiByDep: { kafka: fixture('asyncapi.yaml') }, eventOptions: { kafka: { generateTests: true } } });
    assert.ok(miJson(['preview', '--file', events]).files.some((f) => /\/events\//.test(f)));
  });

  test('detect and a broken document', () => {
    assert.deepEqual(miJson(['detect', 'paths', '--file', join(FIXTURES, 'openapi.yaml')]), ['GET /users', 'GET /users/{id}']);
    assert.ok(miJson(['detect', 'channels', '--file', join(FIXTURES, 'asyncapi.yaml')]).some((c) => c.name === 'orderCreated'));
    assert.equal(miJson(['detect', 'services', '--file', join(FIXTURES, 'service.wsdl')]).length, 1);
    const dir = tempDir('bad');
    const file = writeJson(dir, 'r.json', { dependencies: ['web'], specByDep: { web: 'openapi: 3.0.0\npaths: [' } });
    const e = miError(['preview', '--file', file]);
    assert.equal(e.body.error, 'Invalid OpenAPI spec');
  });
});

describe('imports and live databases', () => {
  test('DDL → entities', () => {
    const entities = miJson(['import', 'ddl', '--file', join(FIXTURES, 'schema.sql'), '--dialect', 'POSTGRESQL', '--entities-only']);
    assert.equal(entities.length, 1);
    assert.ok(entities[0].fields.some((f) => f.primaryKey));
  });

  test('live: options, and an unknown source is the server\'s 404', () => {
    assert.equal(typeof miJson(['live', 'options']).typedConnections, 'boolean');
    const e = miError(['live', 'tables', '--source', 'no-such-source', '--schema', 'x']);
    assert.equal(e.code, 1);
    assert.equal(e.body.error, 'Unknown source');
    assert.equal(miError(['live', 'tables']).code, 2, 'no connection named');
  });
});

describe('team presets and models (writes shared rows: only with MENORA_TEST_WRITE=1)', { skip: process.env.MENORA_TEST_WRITE !== '1' }, () => {
  test('a preset saved from a request opens as the same request', () => {
    const dir = tempDir('preset');
    const file = writeJson(dir, 'r.json', { artifactId: 'p1', dependencies: ['web'], specByDep: { web: fixture('openapi.yaml') }, openApiOptions: { web: { apiStyle: 'interfaces' } } });
    const saved = miJson(['presets', 'save', '--name', `mi test ${Date.now()}`, '--file', file]);
    try {
      const got = miJson(['presets', 'get', String(saved.id)]);
      assert.equal(got.kind, 'wizard');
      assert.equal(got.request.specByDep.web, fixture('openapi.yaml'));
    } finally {
      miJson(['presets', 'delete', String(saved.id)]);
    }
  });

  test('a team model saved from a request keeps the set\'s default dependencies', () => {
    const dir = tempDir('model');
    const req = join(dir, 'req.json');
    miJson(['example', 'blog', '--out', req]);
    const saved = miJson(['models', 'save', '--name', `mi test ${Date.now()}`, '--file', req]);
    try {
      const got = miJson(['models', 'get', String(saved.id)]);
      assert.ok(got.request.dependencies.includes('ldap-auth-rest'));
    } finally {
      miJson(['models', 'delete', String(saved.id)]);
    }
  });
});
