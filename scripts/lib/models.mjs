// The shapes a project can be described in, and the one request each comes down to.
//
//  - a request: the body the generator takes (a /starter-wizard.zip body, plus `modules` for a
//    multi-module project; or a /starter-fullstack.zip body, which has `entities`)
//  - a project's menora-model.json: {format, kind?, request, generator} — or, for a fullstack
//    project generated from the web editor, the editor's own snapshot plus `generator`
//  - a team model (/metadata/fullstack/models) or team preset (/metadata/backend/presets):
//    the web editor's snapshots
//  - a fullstack example (/metadata/fullstack/examples): {entities, pages, settings}

export const BACKEND_MODEL = 'menora-backend-model/1';
export const FULLSTACK_REQUEST_MODEL = 'menora-fullstack-request/1';
export const FULLSTACK_EDITOR_MODEL = 'menora-fullstack-model/1';

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
const nonEmpty = (o) => isObject(o) && Object.keys(o).length > 0;

const WIZARD_DOCS = ['sqlByDep', 'specByDep', 'wsdlByDep', 'asyncApiByDep'];
/** The catalog's relational database dependencies (the SQL wizard's dialects). */
export const DATABASES = ['h2', 'postgresql', 'mssql', 'oracle', 'db2', 'mysql'];

/** backend | multimodule | wizard | fullstack — which endpoint a request belongs to. */
export function kindOf(request) {
  if (Array.isArray(request.entities)) return 'fullstack';
  if (WIZARD_DOCS.some((k) => nonEmpty(request[k]))) return 'wizard';
  if (strings(request.modules).length > 0) return 'multimodule';
  return 'backend';
}

/** True for the web editor's fullstack snapshot (team models, editor-made menora-model.json). */
const isEditorSnapshot = (o) => isObject(o) && isObject(o.meta) && Array.isArray(o.entities);
/** True for the web editor's backend snapshot (team presets). */
const isPresetSnapshot = (o) => isObject(o) && isObject(o.form) && Array.isArray(o.selected);

/**
 * Any of the shapes above → { request, kind, base } where `base` is what an update should send
 * as the "before" side and `hash` the generator's fingerprint of what made it.
 */
export function readModel(doc) {
  if (!isObject(doc)) throw new Error('not a JSON object');
  const generator = isObject(doc.generator) ? doc.generator : {};
  if (doc.format === BACKEND_MODEL || (isObject(doc.request) && !Array.isArray(doc.request.entities) && doc.format !== FULLSTACK_REQUEST_MODEL)) {
    const request = doc.request;
    return { format: doc.format || 'request', kind: kindOf(request), request, catalogHash: generator.catalogHash };
  }
  if (doc.format === FULLSTACK_REQUEST_MODEL) {
    return { format: doc.format, kind: 'fullstack', request: doc.request, templatesHash: generator.templatesHash };
  }
  if (isEditorSnapshot(doc)) {
    return { format: doc.format || FULLSTACK_EDITOR_MODEL, kind: 'fullstack', request: requestFromEditorSnapshot(doc), templatesHash: generator.templatesHash };
  }
  if (isPresetSnapshot(doc)) {
    const request = requestFromPresetSnapshot(doc);
    return { format: 'team-preset', kind: kindOf(request), request };
  }
  if (Array.isArray(doc.entities) && 'settings' in doc) {
    return { format: 'example', kind: 'fullstack', request: requestFromExample(doc) };
  }
  if (Array.isArray(doc.entities) || Array.isArray(doc.dependencies) || typeof doc.artifactId === 'string') {
    return { format: 'request', kind: kindOf(doc), request: doc };
  }
  throw new Error('not a project model: no request, no entities, no dependencies');
}

/** A fullstack example from /metadata/fullstack/examples as a full request. */
export function requestFromExample(ex, artifactId) {
  const s = isObject(ex.settings) ? ex.settings : {};
  const req = { artifactId: artifactId || ex.id || 'demo', name: ex.name, description: ex.description };
  for (const k of ['locale', 'dashboardTitle', 'dashboardOverview', 'backendTemplateSet', 'frontendTemplateSet', 'colorPalette']) {
    if (typeof s[k] === 'string' && s[k]) req[k] = s[k];
  }
  if (strings(s.scaffold).length) req.opts = { scaffold: strings(s.scaffold) };
  req.entities = ex.entities;
  if (Array.isArray(ex.pages) && ex.pages.length) req.pages = ex.pages;
  if (isObject(s.nav) && Array.isArray(ex.pages) && ex.pages.length) req.nav = s.nav;
  return req;
}

const META_KEYS = ['groupId', 'artifactId', 'name', 'description', 'version', 'packaging', 'packageName',
  'domainPackage', 'bootVersion', 'javaVersion', 'dashboardTitle', 'dashboardOverview', 'locale', 'department'];

/** Mirrors the web editor's requestFromSnapshot (ui/src/components/fullstack/snapshot.ts). */
export function requestFromEditorSnapshot(s) {
  const req = {};
  for (const k of META_KEYS) if (typeof s.meta[k] === 'string' && s.meta[k] !== '') req[k] = s.meta[k];
  req.backendTemplateSet = s.backendSet || 'spring-jpa-crud';
  req.frontendTemplateSet = s.frontendSet || 'react-tailwind-crud';
  req.dependencies = strings(s.selectedDeps);
  if (strings(s.scaffoldOpts).length) req.opts = { scaffold: strings(s.scaffoldOpts) };
  if (s.colorPalette) req.colorPalette = s.colorPalette;
  req.entities = s.entities.map(({ uid: _u, sourceSql: _s, fields, relations, ...rest }) => ({
    ...rest,
    fields: (fields || []).map(({ uid: _f, ...f }) => f),
    ...(relations ? { relations: relations.map(({ uid: _r, ...r }) => r) } : {}),
  }));
  const pages = Array.isArray(s.pages) ? s.pages : [];
  if (pages.length) {
    req.pages = pages.map(({ idLocked: _l, ...p }) => p);
    if (isObject(s.nav)) req.nav = s.nav;
  }
  return req;
}

/** Mirrors the web editor's requestOfSnapshot (ui/src/components/backend/backendModel.ts). */
export function requestFromPresetSnapshot(s) {
  const f = isObject(s.form) ? s.form : {};
  const selected = strings(s.selected);
  const req = {};
  for (const k of ['groupId', 'artifactId', 'name', 'description', 'packageName', 'bootVersion', 'javaVersion', 'packaging', 'department']) {
    if (typeof f[k] === 'string' && f[k] !== '') req[k] = f[k];
  }
  req.dependencies = selected;
  const opts = {};
  for (const [dep, ids] of Object.entries(isObject(s.selectedOptions) ? s.selectedOptions : {})) {
    if (selected.includes(dep) && strings(ids).length) opts[dep] = strings(ids);
  }
  if (Object.keys(opts).length) req.opts = opts;
  const wizards = [
    ['sqlByDep', 'sql', 'sqlByDep', 'sqlOptions'],
    ['openApiByDep', 'spec', 'specByDep', 'openApiOptions'],
    ['soapByDep', 'wsdl', 'wsdlByDep', 'soapOptions'],
    ['eventsByDep', 'spec', 'asyncApiByDep', 'eventOptions'],
  ];
  let wizard = false;
  for (const [from, textKey, docsKey, optsKey] of wizards) {
    for (const [dep, entry] of Object.entries(isObject(s[from]) ? s[from] : {})) {
      if (!selected.includes(dep) || !isObject(entry) || typeof entry[textKey] !== 'string' || !entry[textKey].trim()) continue;
      const { [textKey]: text, ...options } = entry;
      (req[docsKey] ||= {})[dep] = text;
      (req[optsKey] ||= {})[dep] = options;
      wizard = true;
    }
  }
  if (!wizard && s.multiModuleEnabled === true && strings(s.selectedModules).length) req.modules = strings(s.selectedModules);
  return req;
}

/** A request as the web editor's backend snapshot, for saving a team preset. */
export function presetSnapshotFromRequest(req) {
  const form = {
    groupId: req.groupId || 'com.menora', artifactId: req.artifactId || 'demo', name: req.name || req.artifactId || 'demo',
    description: req.description || '', packageName: req.packageName || `${req.groupId || 'com.menora'}.${req.artifactId || 'demo'}`,
    bootVersion: req.bootVersion || '', language: 'java', type: 'maven-project', packaging: req.packaging || 'jar',
    javaVersion: req.javaVersion || '21', department: req.department || '',
  };
  const snap = { form, selected: strings(req.dependencies), selectedOptions: {}, sqlByDep: {}, openApiByDep: {}, soapByDep: {} };
  for (const [dep, ids] of Object.entries(isObject(req.opts) ? req.opts : {})) snap.selectedOptions[dep] = strings(ids);
  const back = [['sqlByDep', 'sqlOptions', 'sqlByDep', 'sql'], ['specByDep', 'openApiOptions', 'openApiByDep', 'spec'],
    ['wsdlByDep', 'soapOptions', 'soapByDep', 'wsdl'], ['asyncApiByDep', 'eventOptions', 'eventsByDep', 'spec']];
  for (const [docsKey, optsKey, to, textKey] of back) {
    for (const [dep, text] of Object.entries(isObject(req[docsKey]) ? req[docsKey] : {})) {
      const o = isObject(req[optsKey]) && isObject(req[optsKey][dep]) ? req[optsKey][dep] : {};
      (snap[to] ||= {})[dep] = { [textKey]: text, ...o };
    }
  }
  snap.multiModuleEnabled = strings(req.modules).length > 0;
  snap.selectedModules = strings(req.modules);
  return snap;
}

/** A fullstack request as the web editor's snapshot, for saving a team model the editor can open. */
export function editorSnapshotFromRequest(req) {
  const meta = {};
  for (const k of META_KEYS) if (typeof req[k] === 'string') meta[k] = req[k];
  return {
    format: FULLSTACK_EDITOR_MODEL,
    exportedAt: new Date().toISOString(),
    meta,
    entities: req.entities || [],
    selectedDeps: strings(req.dependencies),
    scaffoldOpts: strings(isObject(req.opts) ? req.opts.scaffold : []),
    backendSet: req.backendTemplateSet || 'spring-jpa-crud',
    frontendSet: req.frontendTemplateSet || 'react-tailwind-crud',
    ...(req.colorPalette ? { colorPalette: req.colorPalette } : {}),
    ...(Array.isArray(req.pages) ? { pages: req.pages } : {}),
    ...(isObject(req.nav) ? { nav: req.nav } : {}),
  };
}

/** Builds a request from command-line flags, on top of an optional base request. */
export function applyFlags(base, f) {
  const req = { ...base };
  const map = { group: 'groupId', artifact: 'artifactId', name: 'name', description: 'description', package: 'packageName',
    boot: 'bootVersion', java: 'javaVersion', packaging: 'packaging', department: 'department', version: 'version' };
  for (const [flag, key] of Object.entries(map)) if (typeof f[flag] === 'string') req[key] = f[flag];
  if (typeof f.deps === 'string') req.dependencies = f.deps.split(',').map((s) => s.trim()).filter(Boolean);
  if (typeof f['add-deps'] === 'string') {
    req.dependencies = [...new Set([...strings(req.dependencies), ...f['add-deps'].split(',').map((s) => s.trim()).filter(Boolean)])];
  }
  if (typeof f.db === 'string') {
    // One database: the named one replaces whichever the list had (h2 in the fullstack defaults).
    req.dependencies = [...strings(req.dependencies).filter((d) => !DATABASES.includes(d)), f.db];
  }
  if (typeof f.modules === 'string') req.modules = f.modules.split(',').map((s) => s.trim()).filter(Boolean);
  if (typeof f.opts === 'string') {
    const opts = { ...(isObject(req.opts) ? req.opts : {}) };
    for (const seg of f.opts.split(';')) {
      const eq = seg.indexOf('=');
      if (eq > 0) opts[seg.slice(0, eq).trim()] = seg.slice(eq + 1).split(',').map((s) => s.trim()).filter(Boolean);
    }
    req.opts = opts;
  }
  if (typeof f.scaffold === 'string') {
    req.opts = { ...(isObject(req.opts) ? req.opts : {}), scaffold: f.scaffold.split(',').map((s) => s.trim()).filter(Boolean) };
  }
  if (typeof f['add-scaffold'] === 'string') {
    const opts = isObject(req.opts) ? req.opts : {};
    const added = f['add-scaffold'].split(',').map((s) => s.trim()).filter(Boolean);
    req.opts = { ...opts, scaffold: [...new Set([...strings(opts.scaffold), ...added])] };
  }
  return req;
}

/** The query string of the GET endpoints (plain and multi-module) for a request. */
export function queryOf(req) {
  const q = {};
  for (const k of ['groupId', 'artifactId', 'name', 'description', 'packageName', 'bootVersion', 'javaVersion', 'packaging', 'version', 'department']) {
    if (typeof req[k] === 'string' && req[k] !== '') q[k] = req[k];
  }
  if (strings(req.dependencies).length) q.dependencies = strings(req.dependencies).join(',');
  for (const [dep, ids] of Object.entries(isObject(req.opts) ? req.opts : {})) {
    if (strings(ids).length) q[`opts-${dep}`] = strings(ids).join(',');
  }
  if (strings(req.modules).length) q.modules = strings(req.modules).join(',');
  return q;
}

const FRONTEND_KEYS = ['projectName', 'description', 'scope', 'appTitle', 'reactVersion', 'nodeVersion', 'packageManager',
  'basePath', 'colorPalette', 'apiBaseUrl', 'backendArtifactId', 'department'];

/** The query string of /frontend/starter.* for a frontend request (flags or JSON). */
export function frontendQueryOf(req, f = {}) {
  const q = {};
  for (const k of FRONTEND_KEYS) {
    const v = typeof f[k] === 'string' ? f[k] : req[k];
    if (typeof v === 'string' && v !== '') q[k] = v;
  }
  const deps = typeof f.deps === 'string' ? f.deps.split(',') : strings(req.dependencies);
  if (deps.length) q.dependencies = deps.map((s) => s.trim()).filter(Boolean).join(',');
  const opts = { ...(isObject(req.opts) ? req.opts : {}) };
  if (typeof f.opts === 'string') {
    for (const seg of f.opts.split(';')) {
      const eq = seg.indexOf('=');
      if (eq > 0) opts[seg.slice(0, eq).trim()] = seg.slice(eq + 1).split(',');
    }
  }
  for (const [dep, ids] of Object.entries(opts)) if (strings(ids).length) q[`opts-${dep}`] = strings(ids).map((s) => s.trim()).join(',');
  return q;
}
