import { test, describe, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile, mkdtemp, stat, readFile as readBytes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runScript, runJson, runJsonError, assertFiles, requireBackend, FIXTURES,
} from './helpers.mjs';

let TMP;
let OPENAPI_SPEC;
let WSDL_DOC;
let FULLSTACK_PAYLOAD;

before(async () => {
  await requireBackend();
  TMP = await mkdtemp(join(tmpdir(), 'menora-tests-'));
  OPENAPI_SPEC = await readFile(join(FIXTURES, 'openapi.yaml'), 'utf8');
  WSDL_DOC = await readFile(join(FIXTURES, 'service.wsdl'), 'utf8');
  FULLSTACK_PAYLOAD = await readFile(join(FIXTURES, 'fullstack.json'), 'utf8');
});

// Asserts every path in `prefixes` is the start of at least one file path.
function assertPathPrefixes(preview, prefixes) {
  assert.ok(Array.isArray(preview?.files), 'no files[] in preview response');
  const paths = preview.files.map((f) => f.path);
  for (const pre of prefixes) {
    assert.ok(paths.some((p) => p.startsWith(pre)),
      `no file under '${pre}'\nactual: ${paths.slice(0, 40).join(', ')}`);
  }
}

const COMMON = [
  '--type', 'maven-project',
  '--language', 'java',
  '--packaging', 'jar',
  '--groupId', 'com.demo',
  '--artifactId', 'app',
  '--packageName', 'com.demo.app',
  '--bootVersion', '3.2.1',
  '--javaVersion', '21',
];

async function assertZipFile(path, minBytes = 5000) {
  const s = await stat(path);
  assert.ok(s.size >= minBytes, `${path} too small: ${s.size} bytes`);
  const buf = await readBytes(path);
  assert.equal(buf[0], 0x50, 'zip magic byte 0 (P)');
  assert.equal(buf[1], 0x4b, 'zip magic byte 1 (K)');
  assert.equal(buf[2], 0x03, 'zip magic byte 2');
  assert.equal(buf[3], 0x04, 'zip magic byte 3');
}

describe('metadata', () => {
  const sections = [
    'client', 'extensions', 'compatibility', 'starter-templates',
    'sql-dialects', 'openapi-capable-deps', 'soap-capable-deps',
  ];
  for (const section of sections) {
    test(`--section ${section} returns non-empty JSON`, async () => {
      const data = await runJson('metadata', ['--section', section]);
      assert.ok(data, `empty response for ${section}`);
      if (Array.isArray(data)) {
        // compatibility, openapi-capable-deps, soap-capable-deps, starter-templates
        // may be empty arrays in pristine seed, but should at least parse.
      } else {
        assert.ok(Object.keys(data).length > 0, `${section} returned {} `);
      }
    });
  }

  test('--section all returns an object keyed by section name', async () => {
    const data = await runJson('metadata');
    for (const s of sections) {
      assert.ok(s in data, `section '${s}' missing from --section all`);
    }
  });

  test('dependencies.values[].values[] has leaves with id/name', async () => {
    const data = await runJson('metadata', ['--section', 'client']);
    const groups = data?.dependencies?.values;
    assert.ok(Array.isArray(groups) && groups.length > 0, 'no dependency groups');
    const leaves = groups.flatMap((g) => g.values || []);
    assert.ok(leaves.length > 0, 'no dependency leaves');
    for (const leaf of leaves) {
      assert.ok(leaf.id, `leaf missing id: ${JSON.stringify(leaf)}`);
      assert.ok(leaf.name, `leaf missing name: ${JSON.stringify(leaf)}`);
    }
  });
});

describe('plain generation — preview', () => {
  test('web,data-jpa returns ≥15 files including pom.xml', async () => {
    const j = await runJson('preview', [...COMMON, '--deps', 'web,data-jpa']);
    assert.ok(j.files.length >= 15, `only ${j.files.length} files`);
    assertFiles(j, { contains: ['pom.xml'] });
  });

  test('web,data-jpa,h2 includes h2 in application.yaml', async () => {
    const j = await runJson('preview', [...COMMON, '--deps', 'web,data-jpa,h2']);
    const yaml = j.files.find((f) => f.path.endsWith('application.yaml'));
    assert.ok(yaml, 'no application.yaml in response');
    assert.match(yaml.content, /h2:/, 'h2 config missing from application.yaml');
  });

  test('missing --type surfaces server error to caller', async () => {
    const noType = COMMON.filter((_, i, a) => a[i - 1] !== '--type' && a[i] !== '--type');
    // The global exception handler returns { error: "Internal error", detail } on a 500.
    const body = await runJsonError('preview', [...noType, '--deps', 'web']);
    assert.equal(body.error, 'Internal error', `unexpected error body: ${JSON.stringify(body)}`);
    assert.ok(typeof body.detail === 'string' && body.detail.length > 0, 'no detail on 500');
  });
});

describe('plain generation — generate (zip)', () => {
  test('generate writes a valid zip', async () => {
    const out = join(TMP, 'plain.zip');
    const r = await runJson('generate', [...COMMON, '--deps', 'web,data-jpa', '--out', out]);
    assert.equal(r.savedTo.replace(/\\/g, '/'), out.replace(/\\/g, '/'));
    await assertZipFile(out);
  });
});

describe('sub-options round-trip', () => {
  test('kafka consumer-example + producer-example surface in files[]', async () => {
    const j = await runJson('preview', [
      ...COMMON.map((v) => (v === 'app' ? 'k' : v === 'com.demo.app' ? 'com.demo.k' : v)),
      '--deps', 'kafka',
      '--opts', 'kafka=consumer-example,producer-example',
    ]);
    assertFiles(j, {
      contains: [
        'src/main/java/com/demo/k/config/KafkaConsumerExample.java',
        'src/main/java/com/demo/k/config/KafkaProducerExample.java',
      ],
    });
  });
});

function wizardBase() {
  return {
    groupId: 'com.demo', artifactId: 'app', packageName: 'com.demo.app',
    type: 'maven-project', language: 'java', packaging: 'jar',
    bootVersion: '3.2.1', javaVersion: '21',
  };
}

describe('SQL wizard', () => {
  const payload = JSON.stringify({
    ...wizardBase(),
    dependencies: ['web', 'data-jpa', 'h2'],
    sqlByDep: { h2: 'CREATE TABLE users (id BIGINT PRIMARY KEY, name VARCHAR(255));' },
    sqlOptions: { h2: { subPackage: 'sql', tables: [{ name: 'users', generateRepository: true }] } },
  });

  test('preview emits Users entity + UsersRepository', async () => {
    const j = await runJson('wizard-preview', [], payload);
    assertFiles(j, {
      contains: [
        'src/main/java/com/demo/app/sql/Users.java',
        'src/main/java/com/demo/app/repository/UsersRepository.java',
      ],
    });
  });

  test('zip writes a valid archive', async () => {
    const out = join(TMP, 'sql.zip');
    await runJson('wizard-generate', ['--out', out], payload);
    await assertZipFile(out);
  });
});

describe('OpenAPI wizard', () => {
  const build = (mode) => JSON.stringify({
    ...wizardBase(),
    dependencies: ['web'],
    specByDep: { web: OPENAPI_SPEC },
    openApiOptions: { web: {
      apiSubPackage: 'api', dtoSubPackage: 'dto', clientSubPackage: 'client',
      mode, baseUrlProperty: 'openapi.client.base-url',
    } },
  });

  test('CONTROLLERS preview: DefaultController under api/', async () => {
    const j = await runJson('wizard-preview', [], build('CONTROLLERS'));
    assertFiles(j, {
      contains: ['src/main/java/com/demo/app/api/DefaultController.java'],
      excludes: ['src/main/java/com/demo/app/client/DefaultClient.java'],
    });
  });

  test('CLIENT preview: client + config, NO controller', async () => {
    const j = await runJson('wizard-preview', [], build('CLIENT'));
    assertFiles(j, {
      contains: [
        'src/main/java/com/demo/app/client/DefaultClient.java',
        'src/main/java/com/demo/app/client/OpenApiClientConfig.java',
      ],
      excludes: ['src/main/java/com/demo/app/api/DefaultController.java'],
    });
  });

  test('BOTH preview: controller + client + config', async () => {
    const j = await runJson('wizard-preview', [], build('BOTH'));
    assertFiles(j, {
      contains: [
        'src/main/java/com/demo/app/api/DefaultController.java',
        'src/main/java/com/demo/app/client/DefaultClient.java',
        'src/main/java/com/demo/app/client/OpenApiClientConfig.java',
      ],
    });
  });

  for (const mode of ['CONTROLLERS', 'CLIENT', 'BOTH']) {
    test(`${mode} zip writes a valid archive`, async () => {
      const out = join(TMP, `openapi-${mode}.zip`);
      await runJson('wizard-generate', ['--out', out], build(mode));
      await assertZipFile(out);
    });
  }
});

describe('SOAP wizard', () => {
  const build = (mode) => JSON.stringify({
    ...wizardBase(),
    dependencies: ['web-services'],
    wsdlByDep: { 'web-services': WSDL_DOC },
    soapOptions: { 'web-services': {
      endpointSubPackage: 'endpoint', clientSubPackage: 'client', payloadSubPackage: 'generated',
      mode, baseUrlProperty: 'soap.client.base-url', contextPath: '/ws',
    } },
  });

  test('ENDPOINTS preview: GreetServiceEndpoint + WebServiceConfig under endpoint/', async () => {
    const j = await runJson('wizard-preview', [], build('ENDPOINTS'));
    assertFiles(j, {
      contains: [
        'src/main/java/com/demo/app/endpoint/GreetServiceEndpoint.java',
        'src/main/java/com/demo/app/endpoint/WebServiceConfig.java',
      ],
      excludes: ['src/main/java/com/demo/app/client/GreetServiceClient.java'],
    });
  });

  test('CLIENT preview: GreetServiceClient + SoapClientConfig, NO endpoint', async () => {
    const j = await runJson('wizard-preview', [], build('CLIENT'));
    assertFiles(j, {
      contains: [
        'src/main/java/com/demo/app/client/GreetServiceClient.java',
        'src/main/java/com/demo/app/client/SoapClientConfig.java',
      ],
      excludes: ['src/main/java/com/demo/app/endpoint/GreetServiceEndpoint.java'],
    });
  });

  test('BOTH preview: endpoint + client + both configs', async () => {
    const j = await runJson('wizard-preview', [], build('BOTH'));
    assertFiles(j, {
      contains: [
        'src/main/java/com/demo/app/endpoint/GreetServiceEndpoint.java',
        'src/main/java/com/demo/app/endpoint/WebServiceConfig.java',
        'src/main/java/com/demo/app/client/GreetServiceClient.java',
        'src/main/java/com/demo/app/client/SoapClientConfig.java',
      ],
    });
  });

  for (const mode of ['ENDPOINTS', 'CLIENT', 'BOTH']) {
    test(`${mode} zip writes a valid archive`, async () => {
      const out = join(TMP, `soap-${mode}.zip`);
      await runJson('wizard-generate', ['--out', out], build(mode));
      await assertZipFile(out);
    });
  }
});

describe('detect', () => {
  test('--type paths enumerates GET /users and GET /users/{id}', async () => {
    const j = await runJson('detect', ['--type', 'paths', '--file', join(FIXTURES, 'openapi.yaml')]);
    assert.deepEqual(j.sort(), ['GET /users', 'GET /users/{id}']);
  });

  test('--type services enumerates GreetService.GreetPort: Greet', async () => {
    const j = await runJson('detect', ['--type', 'services', '--file', join(FIXTURES, 'service.wsdl')]);
    assert.deepEqual(j, ['GreetService.GreetPort: Greet']);
  });
});

describe('error paths', () => {
  test('bad SQL returns structured 400', async () => {
    const body = await runJsonError('wizard-preview', [], JSON.stringify({
      ...wizardBase(), dependencies: ['h2'], sqlByDep: { h2: 'NOT VALID SQL' },
    }));
    assert.equal(body.error, 'Invalid SQL');
    assert.equal(body.dep, 'h2');
    assert.ok(typeof body.detail === 'string' && body.detail.length > 0);
    assert.ok('statementIndex' in body);
    assert.ok('snippet' in body);
  });

  test('bad OpenAPI returns 400 with messages[]', async () => {
    const body = await runJsonError('wizard-preview', [], JSON.stringify({
      ...wizardBase(), dependencies: ['web'], specByDep: { web: 'not-yaml: [[' },
    }));
    assert.equal(body.error, 'Invalid OpenAPI spec');
    assert.ok(Array.isArray(body.messages) && body.messages.length > 0);
  });

  test('bad WSDL returns 400 with messages[]', async () => {
    const body = await runJsonError('wizard-preview', [], JSON.stringify({
      ...wizardBase(), dependencies: ['web-services'], wsdlByDep: { 'web-services': '<not wsdl/>' },
    }));
    assert.equal(body.error, 'Invalid WSDL');
    assert.ok(Array.isArray(body.messages) && body.messages.length > 0);
  });

  test('OpenAPI mode="CLIENTS" (typo) → 400 with valid-values list', async () => {
    const body = await runJsonError('wizard-preview', [], JSON.stringify({
      ...wizardBase(),
      dependencies: ['web'],
      specByDep: { web: OPENAPI_SPEC },
      openApiOptions: { web: { mode: 'CLIENTS' } },
    }));
    assert.equal(body.error, 'Invalid request');
    assert.match(body.detail, /Unknown OpenAPI wizard mode.*CLIENTS/);
    assert.match(body.detail, /Valid values: CONTROLLERS, CLIENT, BOTH/);
  });

  test('SOAP mode="CLIENTS" (typo) → 400 with valid-values list', async () => {
    const body = await runJsonError('wizard-preview', [], JSON.stringify({
      ...wizardBase(),
      dependencies: ['web-services'],
      wsdlByDep: { 'web-services': WSDL_DOC },
      soapOptions: { 'web-services': { mode: 'CLIENTS' } },
    }));
    assert.equal(body.error, 'Invalid request');
    assert.match(body.detail, /Unknown SOAP wizard mode.*CLIENTS/);
    assert.match(body.detail, /Valid values: ENDPOINTS, CLIENT, BOTH/);
  });
});

describe('frontend & fullstack metadata', () => {
  test('--section frontend returns version dropdowns + dependency catalog', async () => {
    const data = await runJson('metadata', ['--section', 'frontend']);
    assert.ok(Array.isArray(data.reactVersions) && data.reactVersions.length > 0, 'no reactVersions');
    assert.ok(Array.isArray(data.dependencies), 'no dependencies[] in frontend metadata');
    assert.ok('colorPalettes' in data, 'no colorPalettes in frontend metadata');
  });

  test('--section entity-template-sets returns the fullstack template sets', async () => {
    const data = await runJson('metadata', ['--section', 'entity-template-sets']);
    assert.ok(Array.isArray(data) && data.length > 0, 'no entity template sets');
    for (const set of data) assert.ok(set.setKey, `set missing setKey: ${JSON.stringify(set)}`);
  });

  test('--section compatibility --projectKind FRONTEND returns only FE rows', async () => {
    const data = await runJson('metadata', ['--section', 'compatibility', '--projectKind', 'FRONTEND']);
    assert.ok(Array.isArray(data), 'compatibility not an array');
    for (const r of data) {
      assert.equal(r.projectKind, 'FRONTEND', `non-FRONTEND row leaked: ${JSON.stringify(r)}`);
      assert.ok(['REQUIRES', 'CONFLICTS', 'RECOMMENDS'].includes(r.relationType),
        `unexpected relationType: ${r.relationType}`);
    }
  });
});

describe('frontend generation', () => {
  test('preview returns a React project with package.json', async () => {
    const j = await runJson('frontend-preview', ['--projectName', 'demo']);
    assert.ok(Array.isArray(j.files) && j.files.length > 0, 'no files in frontend preview');
    const paths = j.files.map((f) => f.path);
    assert.ok(paths.some((p) => p.endsWith('package.json')),
      `no package.json\nactual: ${paths.slice(0, 40).join(', ')}`);
  });

  test('generate writes a valid zip', async () => {
    const out = join(TMP, 'frontend.zip');
    const r = await runJson('frontend-generate', ['--projectName', 'demo', '--out', out]);
    assert.equal(r.savedTo.replace(/\\/g, '/'), out.replace(/\\/g, '/'));
    await assertZipFile(out, 1000);
  });
});

describe('fullstack', () => {
  test('import-ddl turns CREATE TABLE into an entities[] array', async () => {
    const ddl = await readFile(join(FIXTURES, 'schema.sql'), 'utf8');
    const entities = await runJson('import-ddl', ['--dialect', 'H2'], ddl);
    assert.ok(Array.isArray(entities) && entities.length === 1, `expected 1 entity, got ${JSON.stringify(entities)}`);
    const e = entities[0];
    assert.ok(e.name, 'entity missing name');
    assert.ok(Array.isArray(e.fields) && e.fields.length > 0, 'entity has no fields');
    assert.ok(e.fields.some((f) => f.primaryKey), 'no primary-key field detected from DDL');
  });

  test('preview spans backend/ and frontend/ plus root README.md', async () => {
    const j = await runJson('fullstack-preview', [], FULLSTACK_PAYLOAD);
    assertPathPrefixes(j, ['backend/', 'frontend/']);
    assertFiles(j, { contains: ['README.md'] });
  });

  test('generate writes a valid zip', async () => {
    const out = join(TMP, 'fullstack.zip');
    const r = await runJson('fullstack-generate', ['--out', out], FULLSTACK_PAYLOAD);
    assert.equal(r.savedTo.replace(/\\/g, '/'), out.replace(/\\/g, '/'));
    await assertZipFile(out);
  });

  test('missing entities → structured 400', async () => {
    const body = await runJsonError('fullstack-preview', [], JSON.stringify({
      ...wizardBase(), dependencies: ['web', 'data-jpa', 'h2'],
    }));
    assert.equal(body.error, 'Invalid request');
    assert.match(body.detail, /entity/i);
  });
});
