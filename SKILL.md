---
name: menora-initializr
description: Use when the user asks to generate, preview, or scaffold a Spring Boot project against the Menora Initializr backend, or to drive its SQL / OpenAPI / SOAP wizards. Triggers on phrases like "spring boot starter", "starter.zip", "preview project", "OpenAPI scaffold", "SQL wizard", "WSDL", or any reference to localhost:8080's /metadata, /starter, or /starter-wizard endpoints.
---

# Menora Initializr — REST client

The internal project generator at `backend/`. This skill drives the same REST surface the React UI uses — discovery (`/metadata/*`, `/frontend/metadata`), single-module backend generation (`/starter.zip`, `/starter.preview`), React frontend generation (`/frontend/starter.*`), fullstack generation from entity definitions (`/starter-fullstack.*`), and wizards that turn SQL DDL → JPA, OpenAPI specs → controllers/clients, and WSDL → SOAP code.

## Setup

1. The backend is an external service the user runs. Its URL comes from `MENORA_INITIALIZR_URL` (default `http://localhost:8080`). Every script reads this env var via `_lib.mjs:BASE_URL`.
2. Before running any script, sanity-check the URL:
   ```
   curl "$MENORA_INITIALIZR_URL/actuator/health"
   ```
   Expect `{"status":"UP"}`. If you get connection refused or a non-UP response, **ask the user** for the correct URL or to start the backend on their end. Do NOT attempt to build or start the backend yourself — no `mvn`, no `java -jar`.
3. Node ≥ 18 required (built-in `fetch`). No npm install needed.

## Do NOT use /agent/*

The backend has `/agent/manifest` and `/agent/scaffold` endpoints designed for one-shot AI use. **Do not call them.** This skill exists precisely to drive the standard, UI-mirroring REST surface so the agent works the same way the UI does — finer control, predictable shapes, the same error paths users hit.

## Scripts

All scripts live next to this file under `scripts/`. Invoke with absolute or repo-relative paths, e.g. `node .claude/skills/menora-initializr/scripts/metadata.mjs`. They print JSON to stdout; pipe through `jq` or parse directly.

### Discovery — `metadata.mjs`
```
node scripts/metadata.mjs --section <name>
node scripts/metadata.mjs --section compatibility --projectKind FRONTEND
node scripts/metadata.mjs --section frontend --reactVersion 18
```
`--section`: `client | extensions | compatibility | starter-templates | sql-dialects | openapi-capable-deps | soap-capable-deps | frontend | entity-template-sets | all` (default `all`).

- `client` — the standard Initializr metadata: deps, boot/java versions, packaging, types.
- `extensions` — sub-options per dependency.
- `sql-dialects` / `openapi-capable-deps` / `soap-capable-deps` — which deps each wizard can target.
- `frontend` — the React generator catalog: react/node versions, package managers, FE deps, color palettes (accepts `--reactVersion`). Catalog shape is `dependencies[].entries[]`, not the `dependencies.values[].values[]` of `client`.
- `entity-template-sets` — backend + frontend template sets the **fullstack** generator targets.
- `--projectKind BACKEND|FRONTEND` filters `compatibility` and `starter-templates`.
- `all` covers only the seven backend discovery sections — `frontend` and `entity-template-sets` are fetched only when named.

### Plain generation — `preview.mjs` / `generate.mjs`
```
node scripts/preview.mjs  --type maven-project --language java --packaging jar \
                          --groupId com.demo --artifactId app --packageName com.demo.app \
                          --bootVersion 3.2.1 --javaVersion 21 --deps web,data-jpa
node scripts/generate.mjs --type maven-project --language java --packaging jar \
                          --groupId com.demo --artifactId app --packageName com.demo.app \
                          --bootVersion 3.2.1 --javaVersion 21 --deps web --out ./out/app.zip
```
Required flags: `--type` (`maven-project` / `gradle-project`), `--language` (`java` / `kotlin` / `groovy`), `--packaging` (`jar` / `war`). The framework's metadata exposes defaults for these, but `/starter.zip` and `/starter.preview` reject the request (NPE / `Unrecognized language id 'null'`) if they aren't on the URL.
Other flags: `--bootVersion`, `--javaVersion`, `--groupId`, `--artifactId`, `--name`, `--description`, `--packageName`, `--deps a,b,c`, `--opts dep=opt1,opt2;dep2=opt3`.

`generate.mjs` adds `--out <path>` (default `./<artifactId>.zip`).

`preview.mjs` returns `{ files: [{path, content}], tree: [...] }`.
`generate.mjs` saves a ZIP and prints `{ savedTo, sizeBytes }`.

### Frontend generation — `frontend-preview.mjs` / `frontend-generate.mjs`
```
node scripts/frontend-preview.mjs  --projectName demo --deps router,state-zustand \
                                   --reactVersion 18 --colorPalette ocean
node scripts/frontend-generate.mjs --projectName demo --deps router,state-zustand \
                                   --out ./out/demo.zip
```
React / TS / Vite / FSD projects. All flags are optional (the backend fills defaults). Flags: `--projectName` (default `demo`), `--description`, `--scope`, `--appTitle`, `--reactVersion`, `--nodeVersion`, `--packageManager`, `--basePath` (default `/`), `--deps a,b,c`, `--colorPalette`, `--apiBaseUrl`, `--backendArtifactId`, `--opts dep=opt1,opt2;dep2=opt3`. `frontend-generate.mjs` adds `--out` (default `./<projectName>.zip`). Discover valid deps / versions / palettes with `metadata.mjs --section frontend`.

### Fullstack generation — `fullstack-preview.mjs` / `fullstack-generate.mjs`
```
node scripts/fullstack-preview.mjs  --file payload.json
node scripts/fullstack-generate.mjs --file payload.json --out ./out/app.zip
# or pipe JSON to stdin
```
Spring Boot backend **+** React frontend generated from a list of entities, in one ZIP (`backend/`, `frontend/`, root `README.md`). Body is `FullstackStarterRequest` — project metadata (same fields as the wizard) plus `backendTemplateSet` (default `spring-jpa-crud`), `frontendTemplateSet` (default `react-tailwind-crud`), and `entities[]`:
```json
{
  "groupId": "com.demo", "artifactId": "app", "packageName": "com.demo.app",
  "type": "maven-project", "language": "java", "packaging": "jar",
  "bootVersion": "3.2.1", "javaVersion": "21",
  "dependencies": ["web", "data-jpa", "h2"],
  "entities": [{
    "name": "Product", "tableName": "products",
    "fields": [
      { "name": "id", "type": "LONG", "primaryKey": true, "generated": true },
      { "name": "name", "type": "STRING", "required": true, "length": 255 }
    ]
  }]
}
```
Each entity needs ≥1 field and **exactly one** `primaryKey`. Field `type` accepts canonical (`"STRING"`, `"LOCAL_DATE"`) or Java-style (`"String"`, `"LocalDate"`) names. Omit `dependencies` entirely to inherit the backend set's default deps. Discover template sets with `metadata.mjs --section entity-template-sets`.

### DDL → entities — `import-ddl.mjs`
```
node scripts/import-ddl.mjs --file schema.sql --dialect POSTGRESQL
cat schema.sql | node scripts/import-ddl.mjs
```
Turns pasted `CREATE TABLE` DDL into the `entities[]` array a fullstack payload expects — paste the output straight into `"entities"`. `--dialect` is one of `H2` (default), `POSTGRESQL`, `MYSQL`, `DB2`. Prints just the array.

### Wizards — `wizard-preview.mjs` / `wizard-generate.mjs`
```
node scripts/wizard-preview.mjs  --file payload.json
node scripts/wizard-generate.mjs --file payload.json --out ./out/app.zip
# or pipe JSON to stdin:
cat payload.json | node scripts/wizard-preview.mjs
```

The JSON body (`WizardStarterRequest`):
```json
{
  "groupId": "com.demo", "artifactId": "app", "packageName": "com.demo.app",
  "name": "app", "description": "Demo",
  "type": "maven-project", "language": "java", "packaging": "jar",
  "bootVersion": "3.2.1", "javaVersion": "21",
  "dependencies": ["web", "data-jpa"],
  "opts": { "kafka": ["consumer-example"], "data-jpa": ["hibernate"] },

  "sqlByDep":   { "h2": "CREATE TABLE users(id BIGINT PRIMARY KEY, name VARCHAR(255));" },
  "sqlOptions": { "h2": { "subPackage": "sql", "tables": [{ "name": "users", "generateRepository": true }] } },

  "specByDep":      { "web": "openapi: 3.0.0\ninfo: { title: API, version: 1.0 }\npaths: ..." },
  "openApiOptions": { "web": { "apiSubPackage": "api", "dtoSubPackage": "dto", "clientSubPackage": "client", "mode": "CONTROLLERS", "baseUrlProperty": "openapi.client.base-url" } },

  "wsdlByDep":   { "web-services": "<?xml ...?>" },
  "soapOptions": { "web-services": { "endpointSubPackage": "endpoint", "clientSubPackage": "client", "payloadSubPackage": "generated", "mode": "ENDPOINTS", "baseUrlProperty": "soap.client.base-url", "contextPath": "/ws" } }
}
```
Any of `sqlByDep` / `specByDep` / `wsdlByDep` may be absent. With none of them present, the wizard endpoint behaves like `/starter.preview` / `/starter.zip`.

OpenAPI `mode`: `CONTROLLERS` (server stubs), `CLIENT` (HTTP client), or `BOTH`.
SOAP `mode`: `ENDPOINTS`, `CLIENT`, or `BOTH`.

> Note the difference: the URL form uses repeated `opts-{depId}=v1,v2` query params; the JSON form uses an `opts: { depId: [...] }` object.

### Detection helpers — `detect.mjs`
```
node scripts/detect.mjs --type paths    --file openapi.yaml
node scripts/detect.mjs --type services --file service.wsdl
```
Returns `string[]` — endpoint paths (OpenAPI) or service names (WSDL). Use to confirm the input parses cleanly before composing a full wizard payload.

## Workflow recipes

### "What dependencies are available?"
```
node scripts/metadata.mjs --section client
```
Result: `dependencies.values[].values[]` — each leaf `{ id, name, description, versionRange? }`. The JPA dep id is `data-jpa`, not `jpa`.

### "Show me a Spring Boot project with web + data-jpa + h2"
```
node scripts/preview.mjs --type maven-project --language java --packaging jar \
                         --groupId com.demo --artifactId app --packageName com.demo.app \
                         --bootVersion 3.2.1 --javaVersion 21 --deps web,data-jpa,h2
```

### "Generate it and save to disk"
```
node scripts/generate.mjs --type maven-project --language java --packaging jar \
                          --groupId com.demo --artifactId app --packageName com.demo.app \
                          --bootVersion 3.2.1 --javaVersion 21 --deps web,data-jpa,h2 \
                          --out ./out/app.zip
```

### "Generate JPA entities from this DDL"
1. Confirm the dep can drive the SQL wizard:
   ```
   node scripts/metadata.mjs --section sql-dialects
   ```
2. Write a wizard payload with `sqlByDep` + `sqlOptions` (template above) to `payload.json`.
3. Preview, then generate:
   ```
   node scripts/wizard-preview.mjs  --file payload.json
   node scripts/wizard-generate.mjs --file payload.json --out ./out/app.zip
   ```

### "Generate controllers from this OpenAPI spec"
1. Sanity-check the spec parses:
   ```
   node scripts/detect.mjs --type paths --file api.yaml
   ```
2. Build a payload with `specByDep` (raw spec text keyed by dep id like `web`) and `openApiOptions`. Then `wizard-preview.mjs`, then `wizard-generate.mjs`.

### "Generate SOAP endpoints from this WSDL"
Same flow as OpenAPI but use `--type services` for detect and `wsdlByDep` / `soapOptions` in the payload.

### "Scaffold a React frontend"
1. See what's available:
   ```
   node scripts/metadata.mjs --section frontend
   ```
2. Preview, then generate:
   ```
   node scripts/frontend-preview.mjs  --projectName demo --deps router,state-zustand
   node scripts/frontend-generate.mjs --projectName demo --deps router,state-zustand --out ./out/demo.zip
   ```

### "Generate a fullstack CRUD app from entities"
1. List the template sets you can target:
   ```
   node scripts/metadata.mjs --section entity-template-sets
   ```
2. Write a `FullstackStarterRequest` (template above) with `entities[]` to `payload.json`.
3. Preview, then generate:
   ```
   node scripts/fullstack-preview.mjs  --file payload.json
   node scripts/fullstack-generate.mjs --file payload.json --out ./out/app.zip
   ```

### "Turn this DDL into a fullstack app"
1. Convert the schema to entities:
   ```
   node scripts/import-ddl.mjs --file schema.sql --dialect POSTGRESQL > entities.json
   ```
2. Drop that array into a payload's `entities` field, then run the fullstack flow above.

## Errors

- `400 Invalid OpenAPI spec` — body has `messages` array; show those to the user.
- `400 Invalid SQL` — body has `dep`, `statementIndex`, `snippet`, `detail`. Pinpoints the offending dep + line.
- `400 Invalid WSDL` — body has `messages`.
- `400 Invalid request` (fullstack) — body has `detail`, e.g. "At least one entity is required", unknown field type, or multiple primary keys. Show `detail` to the user.
- Connection refused / network error → backend not reachable at `$MENORA_INITIALIZR_URL`. Ask the user for the correct URL or to start the backend. Do not try to start it yourself.

## References

Full endpoint reference (paths, request shapes, response shapes, source `file:line`) is in `references/endpoints.md` next to this file.

A black-box smoke suite for these scripts lives in `tests/` (run `node --test tests/run.test.mjs` with the backend up). See `tests/README.md` for coverage.
