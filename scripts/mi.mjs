#!/usr/bin/env node
// mi — the Menora Initializr from the command line. One dependency-free script (Node >= 18) over
// the generator's REST API: discover, preview, generate and unpack, and update a project that
// already exists. Run `node mi.mjs help` for the commands. JSON goes to stdout; a refusal goes to
// stderr with the server's own words, and the exit code says what kind of failure it was.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { BASE_URL, CliError, EXIT, getBytes, getJson, sendJson } from './lib/http.mjs';
import { readZip, commonRoot, extract } from './lib/zip.mjs';
import {
  applyFlags, editorSnapshotFromRequest, frontendQueryOf, kindOf, presetSnapshotFromRequest, queryOf, readModel,
  requestFromExample,
} from './lib/models.mjs';

const BOOLEAN_FLAGS = new Set(['json', 'force', 'apply', 'no-check', 'list', 'no-qualify', 'entities-only', 'help', 'pages', 'raw', 'check']);

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const eq = a.indexOf('=');
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (eq !== -1) flags[name] = a.slice(eq + 1);
    else if (BOOLEAN_FLAGS.has(name) || argv[i + 1] === undefined || argv[i + 1].startsWith('--')) flags[name] = true;
    else flags[name] = argv[++i];
  }
  return { flags, positional };
}

const out = (value) => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
const list = (s) => String(s).split(',').map((x) => x.trim()).filter(Boolean);

/** Piped stdin, read synchronously: an open stdin stream trips a libuv assertion on exit on Windows. */
function readStdin() {
  if (process.stdin.isTTY) return '';
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

/** --file <path> (or `-` for stdin): its text. A folder means the menora-model.json in it. */
async function readInput(flags, name = 'file', { required = false } = {}) {
  const value = flags[name];
  if (value === undefined || value === true) {
    if (required) throw new CliError(`--${name} <path> is required`);
    return null;
  }
  if (value === '-') return readStdin();
  let path = String(value);
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'menora-model.json');
  if (!existsSync(path)) throw new CliError(`No such file: ${path}`);
  return readFile(path, 'utf8');
}

function parseJson(text, what) {
  try { return JSON.parse(text); } catch (e) { throw new CliError(`${what} is not JSON: ${e.message}`); }
}

/** The request a command acts on: --file (a request, a model file, an example, a snapshot) with flags over it. */
async function requestFrom(flags) {
  const text = await readInput(flags);
  const base = text === null ? {} : readModel(parseJson(text, flags.file)).request;
  return applyFlags(await withSetDefaults(base, flags), flags);
}

/**
 * A fullstack request without `dependencies` gets its template set's defaults on the server. Editing
 * that list (--add-deps, --db) must start from those defaults, or ldap-auth-rest and the rest are lost.
 */
async function withSetDefaults(req, flags) {
  const editsDeps = typeof flags['add-deps'] === 'string' || typeof flags.db === 'string';
  if (!editsDeps || !Array.isArray(req.entities) || Array.isArray(req.dependencies)) return req;
  const sets = await getJson('/metadata/entity-template-sets');
  const set = sets.find((x) => x.setKey === (req.backendTemplateSet || 'spring-jpa-crud'));
  return { ...req, dependencies: [...(set?.defaultDeps || [])] };
}

// ── Checks the server would make, said before generating ─────────────────────────────────────────

let clientMeta;
async function metadataClient() {
  clientMeta ||= await getJson('/metadata/client');
  return clientMeta;
}

function dependencyIndex(meta) {
  const index = new Map();
  for (const group of meta.dependencies?.values || []) {
    for (const d of group.values || []) index.set(d.id, { id: d.id, name: d.name, group: group.name, versionRange: d.versionRange, description: d.description });
  }
  return index;
}

/** The catalog lists Boot versions as 3.2.1.RELEASE; requests say 3.2.1. */
const plainVersion = (v) => String(v).replace(/[.-]RELEASE$/i, '');

function closest(id, ids) {
  const low = id.toLowerCase();
  return ids.filter((x) => x.includes(low) || low.includes(x) || x.replace(/-/g, '') === low.replace(/-/g, '')).slice(0, 5);
}

/** Refuses unknown dependency ids and versions before a generation, naming near matches. */
async function checkRequest(req, kind, flags) {
  if (flags['no-check'] || kind === 'frontend') return;
  const meta = await metadataClient();
  const index = dependencyIndex(meta);
  const unknown = (req.dependencies || []).filter((d) => !index.has(d));
  const problems = unknown.map((d) => {
    const near = closest(d, [...index.keys()]);
    return `unknown dependency '${d}'${near.length ? ` (did you mean ${near.join(', ')}?)` : ''}`;
  });
  for (const [key, field] of [['bootVersion', 'bootVersion'], ['javaVersion', 'javaVersion']]) {
    const offered = (meta[field]?.values || []).map((v) => plainVersion(v.id));
    if (req[key] && offered.length && !offered.includes(plainVersion(req[key]))) problems.push(`${key} '${req[key]}' is not offered (${offered.join(', ')})`);
  }
  if (kind === 'multimodule') {
    const modules = (await getJson('/metadata/module-templates')).map((m) => m.moduleId);
    for (const m of req.modules || []) if (!modules.includes(m)) problems.push(`unknown module '${m}' (${modules.join(', ')})`);
  }
  if (kind === 'wizard' && Array.isArray(req.modules) && req.modules.length) {
    problems.push('a request with a wizard document is generated as ONE module: drop `modules`, or drop the wizard documents');
  }
  if (problems.length) throw new CliError(`The request would be refused:\n  - ${problems.join('\n  - ')}`, EXIT.usage);
}

// ── Endpoints per kind ────────────────────────────────────────────────────────────────────────────

const ENDPOINTS = {
  backend: { zip: ['GET', '/starter.zip'], preview: ['GET', '/starter.preview'] },
  multimodule: { zip: ['GET', '/starter-multimodule.zip'], preview: ['GET', '/starter-multimodule.preview'] },
  wizard: { zip: ['POST', '/starter-wizard.zip'], preview: ['POST', '/starter-wizard.preview'] },
  fullstack: { zip: ['POST', '/starter-fullstack.zip'], preview: ['POST', '/starter-fullstack.preview'] },
  frontend: { zip: ['GET', '/frontend/starter.zip'], preview: ['GET', '/frontend/starter.preview'] },
};
const KINDS = Object.keys(ENDPOINTS);

async function resolveTarget(positional, flags) {
  const explicit = KINDS.includes(positional[0]) ? positional[0] : null;
  if (positional[0] && !explicit) throw new CliError(`Unknown kind '${positional[0]}' (${KINDS.join(', ')})`);
  if (explicit === 'frontend') {
    const text = await readInput(flags);
    const req = text === null ? {} : parseJson(text, flags.file);
    return { kind: 'frontend', req, query: frontendQueryOf(req, flags) };
  }
  const req = await requestFrom(flags);
  const kind = explicit || kindOf(req);
  if (explicit && explicit !== kindOf(req) && !(explicit === 'wizard' && kindOf(req) === 'backend')) {
    throw new CliError(`The request is a ${kindOf(req)} request, not ${explicit}`);
  }
  return { kind, req, query: kind === 'backend' || kind === 'multimodule' ? queryOf(req) : undefined };
}

async function fetchProject(kind, req, query, what) {
  const [method, path] = ENDPOINTS[kind][what];
  if (what === 'preview') return sendOrGet(method, path, query, req);
  return getBytes(method, path, method === 'GET' ? { query } : { json: req });
}

async function sendOrGet(method, path, query, req) {
  if (method === 'GET') return getJson(path, query);
  return sendJson('POST', path, req);
}

// ── preview ───────────────────────────────────────────────────────────────────────────────────────

async function cmdPreview(positional, flags) {
  const { kind, req, query } = await resolveTarget(positional, flags);
  await checkRequest(req, kind, flags);
  const preview = await fetchProject(kind, req, query, 'preview');
  if (flags.json) return out(preview);
  const files = preview.files || [];
  if (flags.show) {
    const wanted = list(flags.show);
    for (const w of wanted) {
      const hits = files.filter((f) => f.path === w || f.path.endsWith('/' + w) || f.path.endsWith(w));
      if (!hits.length) process.stderr.write(`no file matching '${w}'\n`);
      for (const f of hits) process.stdout.write(`===== ${f.path}\n${f.content}\n`);
    }
    return;
  }
  const filter = typeof flags.filter === 'string' ? flags.filter.toLowerCase() : '';
  const paths = files.map((f) => f.path).filter((p) => p.toLowerCase().includes(filter)).sort();
  out({ kind, endpoint: ENDPOINTS[kind].preview.join(' '), fileCount: files.length, shown: paths.length, files: paths });
}

// ── generate ──────────────────────────────────────────────────────────────────────────────────────

async function isEmptyDir(dir) {
  if (!existsSync(dir)) return true;
  return (await readdir(dir)).length === 0;
}

async function cmdGenerate(positional, flags) {
  const { kind, req, query } = await resolveTarget(positional, flags);
  await checkRequest(req, kind, flags);
  const name = kind === 'frontend' ? (query.projectName || 'demo') : (req.artifactId || 'demo');

  if (typeof flags.zip === 'string') {
    const { buf, headers } = await fetchProject(kind, req, query, 'zip');
    await mkdir(dirname(resolve(flags.zip)), { recursive: true });
    await writeFile(flags.zip, buf);
    return out({ kind, savedTo: resolve(flags.zip), sizeBytes: buf.length, templatesHash: headers.get('x-templates-hash') || undefined });
  }

  const into = resolve(typeof flags.into === 'string' ? flags.into : name);
  if (!(await isEmptyDir(into)) && !flags.force) {
    throw new CliError(`${into} is not empty. Pick another --into, or --force to write over it (files not in the project stay).`);
  }
  const { buf, headers } = await fetchProject(kind, req, query, 'zip');
  const entries = readZip(buf);
  const root = commonRoot(entries);
  const written = await extract(entries, into, { strip: root });
  out({
    kind,
    into,
    fileCount: written.length,
    ...(headers.get('x-templates-hash') ? { templatesHash: headers.get('x-templates-hash') } : {}),
    model: written.includes('menora-model.json') ? join(into, 'menora-model.json') : undefined,
    next: nextSteps(kind, req, written),
  });
}

/** What to run next, from what was actually generated. */
function nextSteps(kind, req, written) {
  const has = (p) => written.includes(p);
  const deps = req.dependencies || [];
  const ldap = kind === 'fullstack' && (!req.dependencies || deps.some((d) => d.startsWith('ldap-auth')));
  if (kind === 'frontend') return ['npm install', 'npm run dev   # http://localhost:5173', 'npm run build'];
  if (kind === 'fullstack') {
    const db = (req.dependencies || []).find((d) => ['postgresql', 'oracle', 'mssql'].includes(d));
    const profiles = [db ? 'compose' : null, ldap ? 'local' : null].filter(Boolean).join(',');
    const steps = [
      'git init && git add -A && git commit -m "Generated"   # the base an update merges with',
      has('backend/settings.xml')
        ? 'cd backend && mvn -s settings.xml verify   # Menora Artifactory: ARTIFACTORY_USER / ARTIFACTORY_PASSWORD'
        : 'cd backend && mvn verify',
    ];
    if (db) steps.push(`docker compose up -d ${db === 'postgresql' ? 'postgres' : db}   # the database only`);
    steps.push(`cd backend && mvn spring-boot:run${profiles ? ` -Dspring-boot.run.profiles=${profiles}` : ''}` +
      `${ldap ? '   # local: dev-user is ADMIN, no LDAP' : ''}`);
    if (db && written.some((p) => p.startsWith('backend/') && p.endsWith('ApiTest.java'))) steps.push('cd backend && mvn test -Pdb-tests   # the API tests on the real database, in Docker');
    steps.push('cd frontend && npm install && npm run dev   # http://localhost:5173, /api proxied to :8080');
    if (written.some((p) => p.startsWith('frontend/') && /\.test\.tsx?$/.test(p))) steps.push('cd frontend && npm test');
    if (has('compose.yaml')) steps.push('docker compose up --build   # everything in Docker → http://localhost:3000 (Menora network only)');
    return steps;
  }
  const steps = ['git init && git add -A && git commit -m "Generated"   # the base an update merges with'];
  steps.push(has('settings.xml') ? 'mvn -s settings.xml verify   # Menora Artifactory: ARTIFACTORY_USER / ARTIFACTORY_PASSWORD' : 'mvn verify');
  if (has('compose.yaml')) steps.push('docker compose up -d && mvn spring-boot:run -Dspring-boot.run.profiles=compose');
  else steps.push('mvn spring-boot:run');
  return steps;
}

// ── metadata ──────────────────────────────────────────────────────────────────────────────────────

const META_PATHS = {
  client: '/metadata/client',
  extensions: '/metadata/extensions',
  compatibility: '/metadata/compatibility',
  'starter-templates': '/metadata/starter-templates',
  'module-templates': '/metadata/module-templates',
  'sql-dialects': '/metadata/sql-dialects',
  'openapi-capable-deps': '/metadata/openapi-capable-deps',
  'events-capable-deps': '/metadata/events-capable-deps',
  'soap-capable-deps': '/metadata/soap-capable-deps',
  'popular-deps': '/metadata/popular-deps',
  departments: '/metadata/departments',
  frontend: '/frontend/metadata',
  'entity-template-sets': '/metadata/entity-template-sets',
  'fullstack-schema': '/metadata/fullstack/schema',
  'live-options': '/metadata/live-schema/options',
};

async function cmdMeta(positional, flags) {
  const section = positional[0];
  if (!section) return out(await summary());
  if (section === 'deps') {
    const q = (positional[1] || '').toLowerCase();
    const deps = [...dependencyIndex(await metadataClient()).values()]
      .filter((d) => !q || d.id.includes(q) || d.name.toLowerCase().includes(q) || (d.description || '').toLowerCase().includes(q) || d.group.toLowerCase().includes(q));
    const subOptions = await getJson('/metadata/extensions');
    return out(deps.map((d) => ({ ...d, ...(subOptions[d.id] ? { subOptions: subOptions[d.id].map((o) => o.id) } : {}) })));
  }
  const path = META_PATHS[section];
  if (!path) throw new CliError(`Unknown section '${section}'. Sections: deps, ${Object.keys(META_PATHS).join(', ')}`);
  const query = {};
  if (flags.kind) Object.assign(query, section === 'popular-deps' ? { kind: flags.kind } : { projectKind: flags.kind });
  if (flags.react) query.reactVersion = flags.react;
  out(await getJson(path, query));
}

/** One answer to "what can this server do": versions, dependency ids, wizards, modules, sets, examples. */
async function summary() {
  const [meta, dialects, openapi, events, soap, modules, sets, examples, departments, ext] = await Promise.all([
    metadataClient(), getJson('/metadata/sql-dialects'), getJson('/metadata/openapi-capable-deps'),
    getJson('/metadata/events-capable-deps'), getJson('/metadata/soap-capable-deps'), getJson('/metadata/module-templates'),
    getJson('/metadata/entity-template-sets'), getJson('/metadata/fullstack/examples'), getJson('/metadata/departments'),
    getJson('/metadata/extensions'),
  ]);
  const groups = {};
  for (const d of dependencyIndex(meta).values()) (groups[d.group] ||= []).push(ext[d.id] ? `${d.id} [opts: ${ext[d.id].map((o) => o.id).join(', ')}]` : d.id);
  return {
    server: BASE_URL,
    bootVersions: (meta.bootVersion?.values || []).map((v) => plainVersion(v.id)),
    javaVersions: (meta.javaVersion?.values || []).map((v) => v.id),
    defaults: { groupId: meta.groupId?.default, bootVersion: plainVersion(meta.bootVersion?.default), javaVersion: meta.javaVersion?.default, packaging: meta.packaging?.default },
    dependencies: groups,
    wizards: { sql: dialects, openapi, events, soap },
    modules: modules.map((m) => `${m.moduleId} (${m.suffix}${m.hasMainClass ? ', main class' : ''})`),
    templateSets: sets.map((s) => `${s.setKey} (${s.kind})`),
    examples: examples.map((e) => `${e.id}: ${e.name}`),
    departments: departments.map((d) => d.id + (d.isDefault ? ' (default)' : '')),
  };
}

// ── examples ──────────────────────────────────────────────────────────────────────────────────────

async function cmdExamples() {
  const examples = await getJson('/metadata/fullstack/examples');
  out(examples.map((e) => ({
    id: e.id, name: e.name, description: e.description,
    entities: e.entities.map((x) => x.name), pages: (e.pages || []).length, scaffold: e.settings?.scaffold || [],
  })));
}

async function cmdExample(positional, flags) {
  const id = positional[0];
  if (!id) throw new CliError('mi example <id>   (ids: mi examples)');
  const examples = await getJson('/metadata/fullstack/examples');
  const ex = examples.find((e) => e.id === id);
  if (!ex) throw new CliError(`No example '${id}'. Examples: ${examples.map((e) => e.id).join(', ')}`);
  const req = applyFlags(requestFromExample(ex, typeof flags.artifact === 'string' ? flags.artifact : undefined), flags);
  await emit(req, flags);
}

async function emit(value, flags) {
  if (typeof flags.out === 'string') {
    await mkdir(dirname(resolve(flags.out)), { recursive: true });
    await writeFile(flags.out, JSON.stringify(value, null, 2) + '\n');
    return out({ savedTo: resolve(flags.out) });
  }
  out(value);
}

// ── wizards' helpers, imports, live databases ─────────────────────────────────────────────────────

async function cmdDetect(positional, flags) {
  const what = positional[0];
  const map = { paths: ['/starter-wizard.detect-paths', 'spec'], channels: ['/starter-wizard.detect-channels', 'spec'], services: ['/starter-wizard.detect-services', 'wsdl'] };
  if (!map[what]) throw new CliError('mi detect paths|channels|services --file <document>');
  const doc = await readInput(flags, 'file', { required: true });
  out(await sendJson('POST', map[what][0], { [map[what][1]]: doc }));
}

async function cmdImport(positional, flags) {
  const what = positional[0];
  if (!['ddl', 'select'].includes(what)) throw new CliError('mi import ddl|select --file <sql> [--dialect POSTGRESQL]');
  const sql = await readInput(flags, 'file', { required: true });
  const res = await sendJson('POST', `/metadata/fullstack/import-${what}`, { sql, ...(flags.dialect ? { dialect: flags.dialect } : {}) });
  await emit(flags['entities-only'] ? res.entities : res, flags);
}

/** The connection of a live-schema call: an admin's source by name, or a typed one from a file. */
async function connectionOf(flags) {
  if (typeof flags.source === 'string') return { source: flags.source };
  const text = await readInput(flags, 'conn');
  if (text === null) throw new CliError('Name a connection: --source <name> (mi live options lists them) or --conn <connection.json>');
  const conn = parseJson(text, flags.conn);
  // The password is the user's: from MENORA_DB_PASSWORD, never written to a file by this script.
  if (!conn.password && process.env.MENORA_DB_PASSWORD) conn.password = process.env.MENORA_DB_PASSWORD;
  return conn;
}

async function cmdLive(positional, flags) {
  const what = positional[0];
  if (what === 'options') return out(await getJson('/metadata/live-schema/options'));
  const paths = { schemas: '/metadata/live-schema/schemas', tables: '/metadata/live-schema/tables', ddl: '/metadata/live-schema/ddl', import: '/metadata/fullstack/import-live' };
  if (!paths[what]) throw new CliError('mi live options|schemas|tables|ddl|import  --source <name> | --conn <file>  [--schema S] [--tables a,b]');
  const body = { connection: await connectionOf(flags) };
  if (typeof flags.schema === 'string') body.schema = flags.schema;
  if (typeof flags.tables === 'string') body.tables = list(flags.tables);
  if (flags['no-qualify']) body.qualify = false;
  const res = await sendJson('POST', paths[what], body);
  if (what === 'ddl' && typeof flags.out === 'string') {
    await writeFile(flags.out, res.sql);
    return out({ savedTo: resolve(flags.out), dialect: res.dialect, tables: res.tables, views: res.views, warnings: res.warnings });
  }
  await emit(what === 'import' && flags['entities-only'] ? res.entities : res, flags);
}

// ── a fullstack model's tables: its DDL, or created on a schema source ──────────────────────────

async function cmdTables(positional, flags) {
  const what = positional[0];
  if (!['ddl', 'create'].includes(what)) {
    throw new CliError('mi tables ddl [--file model.json] [--dialect POSTGRESQL] [--out f.sql]\n'
      + 'mi tables create --source NAME --schema S [--file model.json] [--check]');
  }
  const req = await requestFrom(flags);
  if (!Array.isArray(req.entities)) throw new CliError('A fullstack model is needed (--file with entities)', EXIT.usage);
  if (what === 'ddl') {
    const query = typeof flags.dialect === 'string' ? `?dialect=${encodeURIComponent(flags.dialect)}` : '';
    const res = await sendJson('POST', `/starter-fullstack.ddl${query}`, req);
    if (typeof flags.out === 'string') {
      await writeFile(flags.out, res.sql);
      return out({ savedTo: resolve(flags.out), dialect: res.dialect, tables: res.tables, projectDialect: res.projectDialect });
    }
    if (flags.json) return out(res);
    process.stdout.write(res.sql);
    return;
  }
  if (typeof flags.source !== 'string' || typeof flags.schema !== 'string') {
    throw new CliError('mi tables create needs --source NAME (mi live options: the sources with createTables) and --schema S');
  }
  out(await sendJson('POST', '/starter-fullstack.create-tables',
    { request: req, source: flags.source, schema: flags.schema, check: Boolean(flags.check) }));
}

// ── a project's model, and updating it ───────────────────────────────────────────────────────────

async function readProjectModel(where) {
  const path = existsSync(where) && statSync(where).isDirectory() ? join(where, 'menora-model.json') : where;
  if (!existsSync(path)) throw new CliError(`No menora-model.json at ${resolve(path)} — was this project generated by the Menora Initializr?`);
  const doc = parseJson(await readFile(path, 'utf8'), path);
  return { path: resolve(path), doc, model: readModel(doc) };
}

async function cmdModel(positional, flags) {
  if (!positional[0]) throw new CliError('mi model <project-dir | menora-model.json> [--out request.json]');
  const { path, model } = await readProjectModel(positional[0]);
  if (typeof flags.out === 'string') return emit(model.request, flags);
  const r = model.request;
  out({
    path, format: model.format, kind: model.kind, artifactId: r.artifactId,
    dependencies: r.dependencies ?? '(the template set\'s defaults)',
    ...(r.modules ? { modules: r.modules } : {}),
    ...(r.entities ? { entities: r.entities.map((e) => e.name), pages: (r.pages || []).length, scaffold: r.opts?.scaffold || [] } : {}),
    wizards: ['sqlByDep', 'specByDep', 'wsdlByDep', 'asyncApiByDep'].filter((k) => r[k]).map((k) => `${k}: ${Object.keys(r[k]).join(', ')}`),
    request: r,
  });
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.error) throw new CliError(`git is not available: ${r.error.message}`);
  return { code: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

async function cmdUpdate(positional, flags) {
  const dir = positional[0];
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) throw new CliError('mi update <project-dir> [--target request.json] [flags that change it] [--apply]');
  const { doc, model } = await readProjectModel(dir);
  const fullstack = model.kind === 'fullstack';
  const path = fullstack ? '/starter-fullstack.patch' : '/starter.patch';
  let updateDir;
  let counts;
  if (typeof flags.use === 'string') {
    // An update fetched before (and reviewed): applied as it is, not asked for again — a new one
    // would carry a new migration timestamp.
    updateDir = resolve(flags.use);
    if (!existsSync(join(updateDir, 'UPDATE.md'))) throw new CliError(`${updateDir} is not an unpacked update (no UPDATE.md)`);
  } else {
    const targetText = await readInput(flags, 'target');
    const targetBase = targetText === null ? model.request : readModel(parseJson(targetText, flags.target)).request;
    const target = applyFlags(await withSetDefaults(targetBase, flags), flags);
    if (fullstack !== (kindOf(target) === 'fullstack')) throw new CliError('The target is not the same kind of project as the one in the folder');
    if (JSON.stringify(target) === JSON.stringify(model.request)) {
      throw new CliError('The target is the model the project already has: change it with --target <file> or flags (--deps, --add-deps, --db, --opts, --scaffold, --boot…)');
    }
    await checkRequest(target, kindOf(target), flags);

    const body = fullstack
      ? {
        base: model.request, target,
        ...(model.templatesHash ? { baseTemplatesHash: model.templatesHash } : {}),
        // The files the server kept from the project's download: the update starts from them.
        ...(typeof doc.generator?.snapshot === 'string' ? { baseSnapshot: doc.generator.snapshot } : {}),
        // Which version of the generator's own tables the project's database has.
        ...(Number.isInteger(doc.generator?.schemaVersion) ? { baseSchemaVersion: doc.generator.schemaVersion } : {}),
      }
      // A backend model file is sent whole: the server reads its generator.snapshot itself.
      : { base: doc.format ? doc : model.request, target };
    const { buf, headers } = await getBytes('POST', path, { json: body });
    counts = { added: +headers.get('x-update-added') || 0, changed: +headers.get('x-update-changed') || 0, deleted: +headers.get('x-update-deleted') || 0 };
    // snapshot: compared with the files the project was generated with (generator fixes included);
    // regenerated: with the old model generated again now (no snapshot kept for this project).
    counts.base = headers.get('x-update-base') || 'regenerated';

    updateDir = resolve(typeof flags.out === 'string' ? flags.out : join(tmpdir(), `menora-update-${target.artifactId || 'project'}-${Date.now()}`));
    if (!(await isEmptyDir(updateDir)) && !flags.force) throw new CliError(`${updateDir} is not empty (--force to write over it)`);
    const entries = readZip(buf);
    await extract(entries, updateDir, { strip: commonRoot(entries) });
  }

  const patchPath = join(updateDir, 'update.patch');
  const patch = existsSync(patchPath) ? await readFile(patchPath, 'utf8') : '';
  const patched = new Set([...patch.matchAll(/^diff --git a\/(.+?) b\//gm)].map((m) => m[1]));
  const filesDir = join(updateDir, 'files');
  const shipped = existsSync(filesDir) ? await walk(filesDir) : [];
  const notInPatch = shipped.filter((p) => !patched.has(p));
  const deletedTxt = join(updateDir, 'DELETED.txt');
  const deleted = existsSync(deletedTxt) ? (await readFile(deletedTxt, 'utf8')).split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')) : [];

  counts ||= { added: shipped.filter((p) => !existsSync(join(dir, p))).length, changed: shipped.filter((p) => existsSync(join(dir, p))).length, deleted: deleted.length };
  const report = {
    endpoint: `POST ${path}`, counts, updateDir, readme: join(updateDir, 'UPDATE.md'),
    patch: patch ? patchPath : null, patchedFiles: [...patched], copyWhole: notInPatch, deleted,
    ...(fullstack ? { migration: [...patched, ...shipped].find((p) => /__model_update\.sql$/.test(p)) || null } : {}),
  };
  if (!counts.added && !counts.changed && !counts.deleted) return out({ ...report, note: 'The two models generate the same project: nothing to apply.' });
  if (!flags.apply) {
    return out({ ...report, next: `Read ${report.readme}; then apply exactly this update with: mi update ${dir} --use ${updateDir} --apply (the project must be committed and clean)` });
  }
  out({ ...report, applied: await applyUpdate(resolve(dir), updateDir, patch ? patchPath : null, notInPatch, deleted) });
}

async function walk(root, rel = '') {
  const found = [];
  for (const e of await readdir(join(root, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) found.push(...await walk(root, p));
    else found.push(p);
  }
  return found;
}

/** git apply --3way in the project's repository, then the files the patch does not carry. */
async function applyUpdate(projectDir, updateDir, patchPath, notInPatch, deleted) {
  const top = git(['rev-parse', '--show-toplevel'], projectDir);
  if (top.code !== 0) {
    throw new CliError(`${projectDir} is not in a git repository. An update merges three ways against the project as it was generated:\n` +
      '  git init && git add -A && git commit -m "Generated"   — then run the update again.');
  }
  const dirty = git(['status', '--porcelain', '--', '.'], projectDir);
  if (dirty.stdout) throw new CliError(`The project has uncommitted changes; commit or stash them first:\n${dirty.stdout}`);
  const prefix = git(['rev-parse', '--show-prefix'], projectDir).stdout;
  const result = { git: null, conflicts: [], copied: [], leftAlone: [] };
  if (patchPath) {
    // A file git does not track (a git-ignored .env with local secrets, say) cannot be merged three
    // ways, and one such file makes git refuse the whole patch. Those are left out and left alone.
    const tracked = new Set(git(['ls-files', '-z'], projectDir).stdout.split('\0').filter(Boolean));
    const sections = splitPatch(await readFile(patchPath, 'utf8'));
    const kept = [];
    for (const s of sections) {
      if (s.isNew || tracked.has(s.path)) { kept.push(s.text); continue; }
      if (existsSync(join(projectDir, s.path))) {
        result.leftAlone.push({ path: s.path, why: `not tracked by git; the update ${s.isDeleted ? 'deletes' : 'changes'} it`, ...(s.isDeleted ? {} : { newVersion: join(updateDir, 'files', s.path) }) });
      }
    }
    if (kept.length) {
      const toApply = kept.length === sections.length ? patchPath : join(updateDir, 'update.tracked.patch');
      if (toApply !== patchPath) await writeFile(toApply, kept.join(''));
      const args = ['apply', '--3way', '--whitespace=nowarn', ...(prefix ? [`--directory=${prefix.replace(/\/$/, '')}`] : []), toApply];
      const r = git(args, top.stdout);
      result.git = { command: `git ${args.join(' ')}`, exitCode: r.code, output: [r.stdout, r.stderr].filter(Boolean).join('\n') };
      result.conflicts = git(['diff', '--name-only', '--diff-filter=U'], projectDir).stdout.split('\n').filter(Boolean);
      if (r.code !== 0 && !result.conflicts.length) {
        result.hint = 'git could not apply the patch (nothing was changed). If it says the repository lacks a blob, the project was ' +
          `not committed as generated: use git apply --reject (writes *.rej), or copy the files from ${join(updateDir, 'files')}.`;
        return result;
      }
    }
  }
  for (const rel of notInPatch) {
    const to = join(projectDir, rel);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(join(updateDir, 'files', rel), to);
    result.copied.push(rel);
  }
  // DELETED.txt names files the new model no longer generates; the tracked ones went with the patch.
  for (const rel of deleted) {
    if (existsSync(join(projectDir, rel)) && !result.leftAlone.some((l) => l.path === rel)) {
      result.leftAlone.push({ path: rel, why: 'the new model no longer generates it' });
    }
  }
  result.next = [
    result.conflicts.length ? 'Resolve the conflicts (git marks them in the files).' : 'Review with git diff HEAD (git apply --3way stages what it applied).',
    ...(result.leftAlone.length ? ['Decide about each file in leftAlone (ask the user before deleting one).'] : []),
    'Build and run the tests, then commit.',
  ].join(' ');
  return result;
}

/** A git patch cut into one section per file: its path and whether it adds or deletes the file. */
function splitPatch(patch) {
  const parts = patch.split(/^(?=diff --git )/m).filter((p) => p.startsWith('diff --git '));
  return parts.map((text) => {
    const header = text.slice(0, text.indexOf('\n@@') === -1 ? text.length : text.indexOf('\n@@'));
    return {
      text,
      path: /^diff --git a\/(.+?) b\//.exec(text)[1],
      isNew: /^new file mode/m.test(header),
      isDeleted: /^deleted file mode/m.test(header),
    };
  });
}

// ── team presets and team models (shared with everyone using the generator) ──────────────────────

async function cmdShared(positional, flags, kind) {
  const base = kind === 'presets' ? '/metadata/backend/presets' : '/metadata/fullstack/models';
  const [action, id] = positional;
  if (!action || action === 'list') return out(await getJson(base));
  if (action === 'get') {
    if (!id) throw new CliError(`mi ${kind} get <id> [--out request.json]`);
    const detail = await getJson(`${base}/${encodeURIComponent(id)}`);
    const request = readModel(detail.snapshot).request;
    if (typeof flags.out === 'string') return emit(request, flags);
    const { snapshot: _s, ...summaryFields } = detail;
    return out({ ...summaryFields, kind: kindOf(request), request });
  }
  if (action === 'save') {
    if (typeof flags.name !== 'string') throw new CliError(`mi ${kind} save --name <name> --file <request.json> [--description …] [--id <id> to replace]`);
    const req = await requestFrom(flags);
    if ((kindOf(req) === 'fullstack') !== (kind === 'models')) throw new CliError(kind === 'models' ? 'A team model is a fullstack request (with entities)' : 'A team preset is a backend request (no entities)');
    if (kind === 'models' && !req.dependencies) {
      const sets = await getJson('/metadata/entity-template-sets');
      req.dependencies = sets.find((s) => s.setKey === (req.backendTemplateSet || 'spring-jpa-crud'))?.defaultDeps || [];
    }
    const snapshot = kind === 'presets' ? presetSnapshotFromRequest(req) : editorSnapshotFromRequest(req);
    const body = { name: flags.name, ...(typeof flags.description === 'string' ? { description: flags.description } : {}), snapshot };
    return out(typeof flags.id === 'string' ? await sendJson('PUT', `${base}/${encodeURIComponent(flags.id)}`, body) : await sendJson('POST', base, body));
  }
  if (action === 'delete') {
    if (!id) throw new CliError(`mi ${kind} delete <id>`);
    await sendJson('DELETE', `${base}/${encodeURIComponent(id)}`);
    return out({ deleted: id });
  }
  throw new CliError(`mi ${kind} list | get <id> | save --name … | delete <id>`);
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────────

const HELP = `mi — the Menora Initializr from the command line (server: ${BASE_URL})

  health                                  is the generator up?
  meta                                    what it offers: versions, dependency ids, wizards, modules, sets, examples
  meta deps [text]                        dependencies (id, name, group, Boot range, sub-options), filtered
  meta <section> [--kind K] [--react 18]  raw catalog: ${Object.keys(META_PATHS).join(', ')}
  examples | example <id> [--artifact a] [--out f]   fullstack examples / one as a full request
  preview  [kind] [--file req.json] [flags] [--filter s | --show a,b | --json]
  generate [kind] [--file req.json] [flags] [--into dir | --zip f] [--force]
           kind: backend | multimodule | wizard | fullstack | frontend (default: from the request)
           flags: --group --artifact --name --description --package --boot --java --packaging --version
                  --department --deps a,b --add-deps a,b --db postgresql (one database in place of h2) --opts "dep=o1,o2;dep2=o3"
                  --scaffold a,b (replaces the list) --add-scaffold a,b --modules a,b
                  --no-check (skip the dependency/version check made before calling)
  detect paths|channels|services --file doc       what an OpenAPI / AsyncAPI / WSDL document holds
  import ddl|select --file x.sql [--dialect D] [--entities-only] [--out f]   SQL → fullstack entities
  live options | schemas | tables | ddl | import  --source NAME | --conn conn.json  [--schema S] [--tables a,b] [--out f]
  tables ddl [--file model] [flags] [--dialect D] [--out f.sql]     a fullstack model's CREATE TABLE script (its V1__init.sql)
  tables create --source NAME --schema S [--file model] [--check]   create them on a schema source that allows it
  model <project-dir> [--out request.json]        the request a project was generated from
  update <project-dir> [--target req.json] [flags] [--out dir]      fetch an update and say what it holds
  update <project-dir> --use <update-dir> --apply                   apply the update fetched (and reviewed) before
  presets list | get <id> [--out f] | save --name N --file req.json [--id ID] | delete <id>     team backend presets
  models  list | get <id> [--out f] | save --name N --file req.json [--id ID] | delete <id>     team fullstack models

Env: MENORA_INITIALIZR_URL (server), MENORA_USERINFO (who is calling, for the audit / access gate),
     MENORA_DB_PASSWORD (password of a typed live-schema connection).
Exit: 0 ok, 1 refused by the server (4xx), 2 bad usage or a request the server would refuse,
      3 server unreachable, 4 server error (5xx).`;

const COMMANDS = {
  health: async () => out(await getJson('/actuator/health')),
  meta: cmdMeta,
  examples: cmdExamples,
  example: cmdExample,
  preview: cmdPreview,
  generate: cmdGenerate,
  detect: cmdDetect,
  import: cmdImport,
  live: cmdLive,
  tables: cmdTables,
  model: cmdModel,
  update: cmdUpdate,
  presets: (p, f) => cmdShared(p, f, 'presets'),
  models: (p, f) => cmdShared(p, f, 'models'),
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') { process.stdout.write(HELP + '\n'); return; }
  const handler = COMMANDS[command];
  if (!handler) throw new CliError(`Unknown command '${command}'. Run: node ${basename(process.argv[1])} help`);
  const { flags, positional } = parseArgs(rest);
  await handler(positional, flags);
}

main().catch((e) => {
  if (e instanceof CliError) {
    process.stderr.write(e.message + '\n');
    if (e.body !== undefined) process.stderr.write((typeof e.body === 'string' ? e.body : JSON.stringify(e.body, null, 2)) + '\n');
    if (e.hint) process.stderr.write('hint: ' + e.hint + '\n');
    process.exit(e.code);
  }
  process.stderr.write((e.stack || String(e)) + '\n');
  process.exit(EXIT.server);
});
