// The script's own logic, without a server: reading every model shape, the request ↔ snapshot
// conversions the web editor shares, the query strings, and the zip reader.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { deflateRawSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  applyFlags, editorSnapshotFromRequest, kindOf, presetSnapshotFromRequest, queryOf, readModel,
  requestFromEditorSnapshot, requestFromExample, requestFromPresetSnapshot,
} from '../scripts/lib/models.mjs';
import { readZip, commonRoot, extract } from '../scripts/lib/zip.mjs';
import { tempDir } from './helpers.mjs';

const ENTITY = { name: 'Order', fields: [{ name: 'id', type: 'LONG', primaryKey: true, generated: true }] };

test('kindOf: entities, wizard documents and modules decide the endpoint', () => {
  assert.equal(kindOf({ dependencies: ['web'] }), 'backend');
  assert.equal(kindOf({ modules: ['api'] }), 'multimodule');
  assert.equal(kindOf({ modules: [] }), 'backend');
  assert.equal(kindOf({ specByDep: { web: 'openapi: 3.0.0' } }), 'wizard');
  assert.equal(kindOf({ sqlByDep: {} }), 'backend');
  assert.equal(kindOf({ entities: [ENTITY] }), 'fullstack');
});

test('readModel: every shape a project can be described in', () => {
  const backend = readModel({ format: 'menora-backend-model/1', kind: 'backend', request: { artifactId: 'a', dependencies: ['web'] }, generator: { catalogHash: 'h' } });
  assert.deepEqual([backend.kind, backend.request.artifactId, backend.catalogHash], ['backend', 'a', 'h']);

  const fsRequest = readModel({ format: 'menora-fullstack-request/1', request: { artifactId: 'f', entities: [ENTITY] }, generator: { templatesHash: 't' } });
  assert.deepEqual([fsRequest.kind, fsRequest.templatesHash], ['fullstack', 't']);

  const editor = readModel({ format: 'menora-fullstack-model/1', meta: { artifactId: 'e', groupId: 'com.x', department: '' },
    entities: [{ uid: 'u1', sourceSql: 'x', ...ENTITY, fields: [{ uid: 'f1', ...ENTITY.fields[0] }], relations: [] }],
    selectedDeps: ['web'], scaffoldOpts: ['audit'], backendSet: 'spring-jpa-crud', frontendSet: 'react-tailwind-crud',
    pages: [{ id: 'home', type: 'dashboard', idLocked: true, widgets: [] }], nav: { style: 'topbar' }, generator: { templatesHash: 'z' } });
  assert.equal(editor.kind, 'fullstack');
  assert.equal(editor.request.artifactId, 'e');
  assert.equal(editor.request.department, undefined, 'an empty meta value is not sent');
  assert.deepEqual(editor.request.opts, { scaffold: ['audit'] });
  assert.equal(editor.request.entities[0].uid, undefined);
  assert.equal(editor.request.entities[0].sourceSql, undefined);
  assert.equal(editor.request.entities[0].fields[0].uid, undefined);
  assert.equal(editor.request.pages[0].idLocked, undefined);
  assert.deepEqual(editor.request.nav, { style: 'topbar' });
  assert.equal(editor.templatesHash, 'z');

  const example = readModel({ id: 'approvals', name: 'Approvals', entities: [ENTITY], pages: null, settings: { scaffold: ['tests'], locale: 'he', nav: { userMenu: true } } });
  assert.equal(example.format, 'example');
  assert.deepEqual(example.request.opts, { scaffold: ['tests'] });
  assert.equal(example.request.locale, 'he');
  assert.equal(example.request.nav, undefined, 'nav needs pages');

  assert.equal(readModel({ artifactId: 'bare', dependencies: ['web'] }).format, 'request');
  assert.throws(() => readModel({ hello: 1 }), /not a project model/);
});

test('an example becomes a request that keeps the defaults it does not set', () => {
  const req = requestFromExample({ id: 'blog', name: 'Blog', description: 'd', entities: [ENTITY], pages: [{ id: 'home', type: 'dashboard' }], settings: { scaffold: ['audit'], nav: { style: 'topbar' }, colorPalette: 'forest' } }, 'my-blog');
  assert.equal(req.artifactId, 'my-blog');
  assert.equal(req.dependencies, undefined, 'absent dependencies = the template set\'s defaults');
  assert.deepEqual(req.nav, { style: 'topbar' });
  assert.equal(req.colorPalette, 'forest');
});

test('team preset snapshot ↔ request round trip, wizard entries included', () => {
  const request = {
    groupId: 'com.x', artifactId: 'svc', name: 'svc', packageName: 'com.x.svc', bootVersion: '3.5.16', javaVersion: '21', packaging: 'jar',
    dependencies: ['web', 'postgresql'], opts: { postgresql: ['pg-primary'] },
    sqlByDep: { postgresql: 'CREATE TABLE a (id INT PRIMARY KEY);' }, sqlOptions: { postgresql: { apiMode: 'INLINE_DTO' } },
    specByDep: { web: 'openapi: 3.0.0' }, openApiOptions: { web: { mode: 'BOTH', apiStyle: 'interfaces' } },
  };
  const back = requestFromPresetSnapshot(presetSnapshotFromRequest(request));
  assert.deepEqual(back.sqlByDep, request.sqlByDep);
  assert.deepEqual(back.sqlOptions, request.sqlOptions);
  assert.deepEqual(back.specByDep, request.specByDep);
  assert.deepEqual(back.openApiOptions, request.openApiOptions);
  assert.deepEqual(back.opts, request.opts);
  assert.equal(back.modules, undefined);

  const modules = requestFromPresetSnapshot(presetSnapshotFromRequest({ artifactId: 'm', dependencies: ['web'], modules: ['api', 'core'] }));
  assert.deepEqual(modules.modules, ['api', 'core']);
  // A wizard entry on a dependency that is not selected is not part of the request (as in the UI).
  const stale = requestFromPresetSnapshot({ form: {}, selected: ['web'], sqlByDep: { h2: { sql: 'CREATE TABLE b (id INT);' } } });
  assert.equal(stale.sqlByDep, undefined);
});

test('fullstack request → team model snapshot → request', () => {
  const request = { artifactId: 'claims', dependencies: ['web', 'ldap-auth-rest'], opts: { scaffold: ['tests'] }, entities: [ENTITY], pages: [{ id: 'home', type: 'dashboard' }], nav: { userMenu: true } };
  const snap = editorSnapshotFromRequest(request);
  assert.equal(snap.format, 'menora-fullstack-model/1');
  assert.deepEqual(snap.selectedDeps, ['web', 'ldap-auth-rest']);
  const back = readModel(snap).request;
  assert.deepEqual(back.entities, request.entities);
  assert.deepEqual(back.opts, request.opts);
  assert.deepEqual(back.nav, request.nav);
});

test('flags edit a request; queryOf writes the GET endpoints\' parameters', () => {
  const req = applyFlags({ artifactId: 'a', dependencies: ['web'] }, {
    group: 'com.y', boot: '3.5.16', 'add-deps': 'kafka,web', opts: 'kafka=consumer-example,producer-example;web=rest-example', modules: 'api,core', scaffold: 'audit',
  });
  assert.deepEqual(req.dependencies, ['web', 'kafka']);
  assert.deepEqual(req.opts.kafka, ['consumer-example', 'producer-example']);
  assert.deepEqual(req.opts.scaffold, ['audit']);
  const q = queryOf(req);
  assert.equal(q.dependencies, 'web,kafka');
  assert.equal(q['opts-kafka'], 'consumer-example,producer-example');
  assert.equal(q.modules, 'api,core');
  assert.equal(q.groupId, 'com.y');
});

test('--db puts one database in place of the one the list had', () => {
  const req = applyFlags({ dependencies: ['data-jpa', 'web', 'h2', 'ldap-auth-rest'] }, { db: 'postgresql', 'add-deps': 'flyway' });
  assert.deepEqual(req.dependencies, ['data-jpa', 'web', 'ldap-auth-rest', 'flyway', 'postgresql']);
  assert.deepEqual(applyFlags({ opts: { scaffold: ['audit'], kafka: ['x'] } }, { 'add-scaffold': 'tests,audit' }).opts,
    { scaffold: ['audit', 'tests'], kafka: ['x'] });
});

/** A zip built by hand: stored or deflated entries, optional unix modes. */
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data = '', deflate = false, mode } of entries) {
    const raw = Buffer.from(data);
    const body = deflate ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(mode ? 0x0314 : 0x0014, 4); central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(mode ? (mode << 16) >>> 0 : 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('zip: reads stored and deflated entries, strips the root folder', async () => {
  const zip = makeZip([
    { name: 'app/' },
    { name: 'app/pom.xml', data: '<project/>' },
    { name: 'app/src/Main.java', data: 'class Main {}'.repeat(50), deflate: true },
    { name: 'app/run.sh', data: '#!/bin/sh', mode: 0o100755 },
  ]);
  const entries = readZip(zip);
  assert.equal(commonRoot(entries), 'app/');
  assert.equal(entries.find((e) => e.path === 'app/run.sh').executable, true);
  const dir = tempDir('zip');
  const written = await extract(entries, dir, { strip: 'app/' });
  assert.deepEqual(written.sort(), ['pom.xml', 'run.sh', 'src/Main.java']);
  assert.equal(readFileSync(join(dir, 'src', 'Main.java'), 'utf8'), 'class Main {}'.repeat(50));
});

test('zip: an entry that would land outside the folder is refused', async () => {
  const dir = tempDir('slip');
  await assert.rejects(extract(readZip(makeZip([{ name: '../evil.txt', data: 'x' }])), join(dir, 'inner')), /escapes/);
  assert.equal(existsSync(join(dir, 'evil.txt')), false);
  assert.equal(commonRoot(readZip(makeZip([{ name: 'a.txt' }, { name: 'b/c.txt' }]))), '');
});
