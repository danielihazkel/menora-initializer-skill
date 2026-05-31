#!/usr/bin/env node
// POST /starter-fullstack.preview — previews a fullstack scaffold (Spring Boot
// backend + React frontend) generated for a list of user-defined entities.
//
// Usage:
//   node fullstack-preview.mjs --file payload.json
//   cat payload.json | node fullstack-preview.mjs
//
// Body shape (FullstackStarterRequest):
//   {
//     groupId, artifactId, packageName, name, description,
//     type, language, bootVersion, javaVersion, packaging,
//     dependencies: string[],
//     opts: { [depId]: string[] },
//     backendTemplateSet:  "spring-jpa-crud",      // default if omitted
//     frontendTemplateSet: "react-tailwind-crud",  // default if omitted
//     entities: [{
//       name, tableName,
//       fields: [{ name, type, primaryKey, generated, required, unique, length, enumValues }]
//     }]
//   }
//   field.type accepts "STRING"/"String", "LOCAL_DATE"/"LocalDate", etc.
//
// Discover template sets with: node metadata.mjs --section entity-template-sets
// Turn DDL into the entities[] array with: node import-ddl.mjs --file schema.sql
//
// Output: { files: [{path, content}], tree: [...] }  (paths span backend/ + frontend/)

import { parseArgs, postJson, resolveBody } from './_lib.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const body = await resolveBody(flags);

const data = await postJson('/starter-fullstack.preview', body);
process.stdout.write(JSON.stringify(data, null, 2) + '\n');
