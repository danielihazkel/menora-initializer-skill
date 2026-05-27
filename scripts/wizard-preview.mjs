#!/usr/bin/env node
// POST /starter-wizard.preview — JSON-body sibling of /starter.preview that
// also accepts SQL DDL, OpenAPI specs, and WSDLs to drive the wizards.
//
// Usage:
//   node wizard-preview.mjs --file payload.json
//   cat payload.json | node wizard-preview.mjs
//
// Body shape (WizardStarterRequest):
//   {
//     groupId, artifactId, packageName, name, description,
//     type, language, bootVersion, javaVersion, packaging,
//     dependencies: string[],
//     opts: { [depId]: string[] },
//     sqlByDep:   { [depId]: "<DDL>" },
//     sqlOptions: { [depId]: { subPackage, tables: [{name, generateRepository}] } },
//     specByDep:      { [depId]: "<openapi yaml/json>" },
//     openApiOptions: { [depId]: { apiSubPackage, dtoSubPackage, clientSubPackage, mode, baseUrlProperty } },
//     wsdlByDep:   { [depId]: "<wsdl xml>" },
//     soapOptions: { [depId]: { endpointSubPackage, clientSubPackage, payloadSubPackage, mode, baseUrlProperty, contextPath } }
//   }
//
// Output: { files: [{path, content}], tree: [...] }

import { readFile } from 'node:fs/promises';
import { parseArgs, postJson, readStdin, fail } from './_lib.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const raw = flags.file && flags.file !== true
  ? await readFile(String(flags.file), 'utf8')
  : await readStdin();

if (!raw.trim()) {
  await fail('No JSON body provided. Pass --file <path> or pipe JSON to stdin.');
}

let body;
try {
  body = JSON.parse(raw);
} catch (e) {
  await fail('Invalid JSON: ' + e.message);
}

const data = await postJson('/starter-wizard.preview', body);
process.stdout.write(JSON.stringify(data, null, 2) + '\n');
