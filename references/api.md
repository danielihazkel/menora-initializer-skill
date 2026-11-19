# Menora Initializr — the REST API under `mi.mjs`

`mi.mjs` calls everything below; read this when a request needs a field the script has no flag
for, or to understand a refusal. Base URL: `MENORA_INITIALIZR_URL` (default `http://localhost:8080`).
Fullstack request properties are in `fullstack-model.md`; the generated projects in
`generated-projects.md`.

## Across every endpoint

- **Headers the server reads.** `userinfo` (the caller's login: the audit's user, `createdBy` of a
  team preset/model; required when the server runs with `menora.access.require-user-header` —
  otherwise 403 `{"code":"USERINFO_REQUIRED"}`). `mi.mjs` sends it from `MENORA_USERINFO`.
  `X-Preview-Intent: live` keeps a preview out of the audit (the web UI's background previews).
  There is no department header: `department` is a query parameter or a body field.
- **Error bodies.** `{error, detail, path?}`; `path` names the place in the request
  (`entities[1].fields[3].type`, `dependencies`, `bootVersion`). Wizard documents answer
  `{error: "Invalid OpenAPI spec" | "Invalid WSDL" | "Invalid AsyncAPI document", messages: [...]}`
  or `{error: "Invalid SQL", dep, statementIndex, snippet, detail}`. Malformed JSON:
  `{error: "Invalid request body"}`. An unknown dependency id surfaces as a **500**
  `"Unknown dependency 'x'"` on the JSON endpoints, and as a 400 with **no reason** on `/starter.zip`
  (`mi.mjs` checks ids against the catalog first, so neither is reached).
- **Limits.** Pasted documents: 5 MB in one request (`menora.wizard.max-documents-size`). Team
  presets/models: 1 MB snapshot, name ≤ 150, description ≤ 500, names unique ignoring case (409).
- **Versions.** Boot `3.2.1` (default) and `3.5.16`; Java `21` (default) and `17`; Maven + Java only
  (Gradle and Kotlin are refused). `/metadata/client` lists Boot as `3.2.1.RELEASE`: send `3.2.1`.
- **Compatibility rules** hold on every backend endpoint: a dependency another one REQUIRES is added
  (`security` adds `web`); two that CONFLICT are a 400 naming both (`web` + `webflux`).

## Discovery (GET)

| Path | Answer |
|---|---|
| `/actuator/health` | `{"status":"UP"}` |
| `/metadata/client` (`Accept: application/json`) | Initializr metadata: `dependencies.values[].values[]` `{id, name, description, versionRange}`, `bootVersion`, `javaVersion`, `packaging`, defaults |
| `/metadata/extensions` | `{depId: [{id, label, description}]}` — sub-options (`opts`) |
| `/metadata/compatibility?projectKind=BACKEND\|FRONTEND` | `[{sourceDepId, targetDepId, relationType: REQUIRES\|CONFLICTS\|RECOMMENDS, description}]` |
| `/metadata/starter-templates?projectKind=` | one-click bundles `{id, name, bootVersion, javaVersion, packaging, dependencies:[{depId, subOptions}]}` |
| `/metadata/module-templates` | `[{moduleId, suffix, packaging, hasMainClass, dependencyIds}]` (seeded: api, core, persistence) |
| `/metadata/sql-dialects` | `{depId: DIALECT}` — which dependencies the SQL wizard takes (`postgresql`, `h2`, `mssql`, `oracle`, `db2`, `mysql`) |
| `/metadata/openapi-capable-deps`, `/events-capable-deps`, `/soap-capable-deps` | `["web","webflux"]`, `["kafka"]`, `["web-services"]` |
| `/metadata/popular-deps?kind=BACKEND` | `[{depId, count}]`, last 90 days |
| `/metadata/departments` | `[{id, name, isDefault}]` |
| `/metadata/entity-template-sets` | `[{setKey, kind, defaultDeps, bootVersion, javaVersion, designSystem}]` |
| `/metadata/fullstack/schema` | the fullstack vocabulary: field types, page types, widget kinds, icons, limits, name rules |
| `/metadata/fullstack/examples` | `[{id, name, description, entities, pages, settings}]` |
| `/frontend/metadata?reactVersion=` | React generator: versions, package managers, `dependencies[].entries[]`, `colorPalettes` |

## Plain backend — `GET /starter.zip`, `GET /starter.preview`

Query: `groupId artifactId name description packageName version bootVersion javaVersion packaging
department`, `dependencies=a,b`, `opts-<depId>=o1,o2` per dependency. Zip: **no root folder**
(`baseDir=x` adds one). Preview: `{files:[{path, content}], tree}`; binary files read `"[binary file]"`.

## Multi-module — `GET /starter-multimodule.zip` / `.preview`

The plain parameters (no `version`, no `baseDir`) plus `modules=api,core,persistence` (required).
Zip root: `<artifactId>/` with the parent `pom.xml`, `menora-model.json` and one
`<artifactId>-<suffix>/` per module.

## Wizards — `POST /starter-wizard.zip` / `.preview` (JSON)

Body: the project fields (as above, `dependencies` an array), `opts: {dep: [ids]}`, `department`,
and per wizard a document map keyed by dependency id plus an options map with the same keys.
Zip root: `<artifactId>/`. **A wizard request is one module** — `modules` is not honoured here.

| Wizard | Document map | Options map → per-dependency object |
|---|---|---|
| SQL → JPA | `sqlByDep: {"postgresql": "CREATE TABLE …"}` (key: a database dependency) | `sqlOptions`: `subPackage` ("entity"), `tables: [{name, generateRepository}]` (unlisted = all, with repositories), `apiMode`: `NONE` \| `ENTITY_DIRECT` \| `INLINE_DTO` \| `MAPSTRUCT_DTO` (REST controllers over the entities), `flywayBaseline` (default true: the script becomes `V1__init.sql` when `flyway` is selected), `generateTests` (needs an apiMode) |
| OpenAPI | `specByDep: {"web": "openapi: 3.0.0 …"}` | `openApiOptions`: `mode` `CONTROLLERS` \| `CLIENT` \| `BOTH`, `apiStyle` `interfaces` (an `XxxApi` interface regenerated freely + an `XxxController implements` the team owns — **use this for anything that will be updated**) \| `classes`, `clientKind` `restTemplate` \| `restClient`, `copySpec` (keep the spec in `src/main/resources/openapi/`), `apiSubPackage` ("api"), `dtoSubPackage` ("dto"), `clientSubPackage` ("client"), `baseUrlProperty`. A generated client reads its credentials from `<base>.security.<scheme>.api-key \| token \| username \| password`; an OAuth2 client-credentials scheme also takes `client-id`, `client-secret` (then the client fetches and renews its own token), `scopes`, `token-url`, `client-authentication` (`basic` \| `post`) |
| SOAP | `wsdlByDep: {"web-services": "<definitions …>"}` (self-contained; imports are refused) | `soapOptions`: `mode` `ENDPOINTS` \| `CLIENT` \| `BOTH`, `contextPath` ("/ws"), `endpointSubPackage`, `clientSubPackage`, `payloadSubPackage`, `baseUrlProperty` |
| Events (AsyncAPI 2.x/3.x → Kafka) | `asyncApiByDep: {"kafka": "asyncapi: 3.0.0 …"}` | `eventOptions`: `channels: [{name, produce, consume}]` (absent = as the document's application does), `groupId`, `subPackage` ("events"), `payloadSubPackage` ("events.model"), `generateTests`, `schemaRegistry` (`confluent`: Avro through Confluent's schema registry; absent: the single-object encoding). Avro channels (`schemaFormat: application/vnd.apache.avro…`) become `.avsc` + avro-maven-plugin. A message's headers (traits merged), `correlationId` header and `bindings.kafka.key` (a UUID) are read: a `<Message>Headers` record, `send(key, payload, headers)`, `handle(key, payload, headers)` |

The server adds what a wizard needs (`data-jpa` for SQL, `web` for an API, `openapi`, `mapstruct`,
`kafka`, `web-services`). External `$ref`s / imports in a pasted document are refused.

Detect what a document holds before choosing options:
`POST /starter-wizard.detect-paths` `{spec}` → `["GET /pets", …]`;
`POST /starter-wizard.detect-channels` `{spec}` → `[{name, address, sends, receives, messages, problem, format: json|avro}]`;
`POST /starter-wizard.detect-services` `{wsdl}` → `["Service.Port: op1, op2"]`.

## Updating a project

`POST /starter.patch` `{base, target, baseCatalogHash?, baseSnapshot?}` — backend, wizard and
multi-module projects. Each side is a whole `menora-model.json` or its `request`; a side with
`modules` is multi-module; a whole model file's `generator.snapshot` is read as `baseSnapshot`.
`POST /starter-fullstack.patch` `{base, target, baseTemplatesHash?, baseSnapshot?, baseSchemaVersion?}`
— fullstack; each side a request. `baseSchemaVersion` is the model file's `generator.schemaVersion`
(the version of the generator's own `app_*` tables; the zip's `X-Schema-Version`): the migration
brings an older one up, and without it those tables' statements are written "To review". A refusal
names the side: `{error, side: "base"|"target", detail, path?}`.

**Snapshots.** Every generated zip carries `X-Snapshot` and its `menora-model.json` the same id as
`generator.snapshot` (SHA-256 of every other file). The server keeps the files of each download
(`menora.snapshots.retention-days`, 730 from last use). An update whose `baseSnapshot` it still has
starts from those files — `X-Update-Base: snapshot`, and the patch carries the generator's fixes
since as well as the model's change; otherwise `X-Update-Base: regenerated` (both sides generated
now). An update's own `X-Snapshot` (and the `generator.snapshot` of its `files/menora-model.json`)
names the project once the update is applied.

Answer: `<artifactId>-update.zip` with headers `X-Update-Added/Changed/Deleted`, holding
`<artifactId>-update/UPDATE.md`, `update.patch` (git format, for `git apply --3way` from the
project root), `DELETED.txt` (when files go), `files/<path>` (every added or changed file whole).
`menora-model.json`, `HELP.md` and binary files are only in `files/`, never in the patch. Without a
kept snapshot both sides are generated with today's templates, so the patch is the model's change
only (see Snapshots above). Identical
models: all counts 0, "nothing to apply". A fullstack project with `flyway` gets the schema change as
`backend/src/main/resources/db/migration/V<yyyyMMddHHmmss>__model_update.sql` — additions live,
drops / NOT NULL / type changes commented out under "To review".

## SQL → entities, and live databases

`POST /metadata/fullstack/import-ddl` and `/import-select` `{sql, dialect?}` → `{entities, note}`
(entities in the fullstack wire shape; `import-select` makes read-only view entities).

Live schema (a schema source an admin set up, or a typed connection while the server allows it):

| Call | Body → answer |
|---|---|
| `GET /metadata/live-schema/options` | `{sources:[{name, dialect, defaultSchema}], typedConnections, drivers, defaultPorts, maxTables}` |
| `POST /metadata/live-schema/schemas` | `{connection}` → `{schemas, defaultSchema}` |
| `POST /metadata/live-schema/tables` | `{connection, schema}` → `{tables:[{name, kind: TABLE\|VIEW}], truncated}` |
| `POST /metadata/live-schema/ddl` | `{connection, schema, tables, qualify?}` → `{dialect, sql, tables, views, warnings}` — the script to give the SQL wizard |
| `POST /metadata/fullstack/import-live` | same body → `{entities, note}` |

`connection` is `{source: "<name>"}` or `{dialect: POSTGRESQL|MSSQL|ORACLE|DB2, host, port,
database, library (DB2), user, password, trustServerCertificate}`. The password is used for that
call only. Refusals: 403 Not allowed / Host not allowed, 404 Unknown source, 400 Could not connect,
429 Busy. At most 300 tables in one read.

## Shared with the team (everyone sees and can change these)

| Path | Body |
|---|---|
| `/metadata/backend/presets` GET, POST; `/{id}` GET, PUT, DELETE | `{name, description?, snapshot}` — `snapshot` is the web Backend tab's state (`form`, `selected`, `selectedOptions`, wizard entries, `multiModuleEnabled`, `selectedModules`) |
| `/metadata/fullstack/models` same verbs | `{name, description?, snapshot}` — the web Fullstack editor's model (`format: "menora-fullstack-model/1"`, `meta`, `entities`, `selectedDeps`, `scaffoldOpts`, `backendSet`, `frontendSet`, `pages`, `nav`) |
| `/metadata/fullstack/templates?kind=page\|widget` same verbs | `{kind, name, description?, content}` — one page or widget definition for the layout designer |

No ownership is enforced: a PUT or DELETE changes it for everyone.

## React frontend — `GET /frontend/starter.zip` / `.preview`

Query: `projectName` (zip name), `description`, `scope`, `appTitle`, `reactVersion`, `nodeVersion`,
`packageManager` (npm/pnpm/yarn), `basePath`, `dependencies=router,state-zustand`, `colorPalette`,
`apiBaseUrl`, `backendArtifactId`, `opts-<dep>=…`. Discover with `/frontend/metadata`.
