#!/usr/bin/env node
// Fetch one or all metadata sections from the Menora Initializr backend.
//
// Usage:
//   node metadata.mjs                                    # --section all
//   node metadata.mjs --section client
//   node metadata.mjs --section frontend --reactVersion 18
//   node metadata.mjs --section compatibility --projectKind FRONTEND
//
// Sections (backend discovery — included in `all`):
//   client | extensions | compatibility | starter-templates
//   sql-dialects | openapi-capable-deps | soap-capable-deps
// Sections (fetched only when named explicitly, NOT in `all`):
//   frontend            → /frontend/metadata          (accepts --reactVersion)
//   entity-template-sets → /metadata/entity-template-sets (fullstack template sets)
//
// Params:
//   --projectKind BACKEND|FRONTEND   filters `compatibility` and `starter-templates`
//   --reactVersion <id>              scopes the `frontend` dependency catalog

import { parseArgs, readJson, fail } from './_lib.mjs';

// Sections that make up `--section all` (the standard backend discovery surface).
const ALL_SECTIONS = {
  client: '/metadata/client',
  extensions: '/metadata/extensions',
  compatibility: '/metadata/compatibility',
  'starter-templates': '/metadata/starter-templates',
  'sql-dialects': '/metadata/sql-dialects',
  'openapi-capable-deps': '/metadata/openapi-capable-deps',
  'soap-capable-deps': '/metadata/soap-capable-deps',
};

// Extra sections — reachable by name but kept out of `all` to avoid bloating it.
const EXTRA_SECTIONS = {
  frontend: '/frontend/metadata',
  'entity-template-sets': '/metadata/entity-template-sets',
};

const SECTIONS = { ...ALL_SECTIONS, ...EXTRA_SECTIONS };

// Appends the query params a given section understands, from CLI flags.
function withParams(path, section, flags) {
  const qs = new URLSearchParams();
  if ((section === 'compatibility' || section === 'starter-templates')
      && flags.projectKind && flags.projectKind !== true) {
    qs.set('projectKind', String(flags.projectKind));
  }
  if (section === 'frontend' && flags.reactVersion && flags.reactVersion !== true) {
    qs.set('reactVersion', String(flags.reactVersion));
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

const { flags } = parseArgs(process.argv.slice(2));
const section = flags.section || 'all';

if (section === 'all') {
  const keys = Object.keys(ALL_SECTIONS);
  const results = await Promise.all(
    keys.map((k) => readJson(withParams(ALL_SECTIONS[k], k, flags))),
  );
  const out = {};
  keys.forEach((k, i) => { out[k] = results[i]; });
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
} else if (SECTIONS[section]) {
  const data = await readJson(withParams(SECTIONS[section], section, flags));
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
} else {
  await fail(`Unknown --section "${section}". Valid: ${Object.keys(SECTIONS).join(', ')}, all`);
}
