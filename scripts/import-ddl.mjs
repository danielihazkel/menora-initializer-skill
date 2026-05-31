#!/usr/bin/env node
// POST /metadata/fullstack/import-ddl — parses pasted CREATE TABLE DDL into the
// entities[] wire shape that fullstack-preview.mjs / fullstack-generate.mjs accept.
// Saves clicking entities field-by-field when you already have a schema.
//
// Usage:
//   node import-ddl.mjs --file schema.sql --dialect POSTGRESQL
//   cat schema.sql | node import-ddl.mjs
//
//   --dialect <name>   SqlDialect enum name (H2, POSTGRESQL, MYSQL, DB2). Default: H2.
//
// Output: entities[]  — the parsed array, ready to drop into a fullstack payload's
//         "entities" field. (The endpoint wraps it as { entities: [...] }; this
//         script unwraps and prints just the array.)

import { readFile } from 'node:fs/promises';
import { parseArgs, postJson, readStdin, fail } from './_lib.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const sql = flags.file && flags.file !== true
  ? await readFile(String(flags.file), 'utf8')
  : await readStdin();

if (!sql.trim()) {
  await fail('No SQL provided. Pass --file <path> or pipe DDL to stdin.');
}

const body = { sql };
if (flags.dialect && flags.dialect !== true) body.dialect = String(flags.dialect);

const data = await postJson('/metadata/fullstack/import-ddl', body);
process.stdout.write(JSON.stringify(data.entities ?? data, null, 2) + '\n');
