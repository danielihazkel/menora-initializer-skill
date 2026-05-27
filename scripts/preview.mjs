#!/usr/bin/env node
// GET /starter.preview — returns a JSON tree + file list for a single-module project.
//
// Usage:
//   node preview.mjs --groupId com.demo --artifactId app --packageName com.demo.app \
//                    --bootVersion 3.2.1 --javaVersion 21 --deps web,jpa
//
// Common flags:
//   --type maven-project|gradle-project   (default: server-side)
//   --language java|kotlin|groovy
//   --bootVersion 3.2.1
//   --javaVersion 21
//   --packaging jar|war
//   --groupId / --artifactId / --name / --description / --packageName
//   --deps web,jpa,h2                     (csv)
//   --opts kafka=consumer-example,producer-example;jpa=hibernate
//
// Output: { files: [{path, content}], tree: [...] }

import { parseArgs, buildStarterUrl, readJson } from './_lib.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const url = buildStarterUrl('/starter.preview', flags);
const data = await readJson(url);
process.stdout.write(JSON.stringify(data, null, 2) + '\n');
