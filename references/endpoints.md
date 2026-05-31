# Menora Initializr — Endpoint Reference

Base URL: `http://localhost:8080` (override with `MENORA_INITIALIZR_URL`).

All endpoints below are the same ones the React UI calls. They are unauthenticated.

---

## Metadata (GET)

### `GET /metadata/client`
Spring Initializr standard endpoint. **Must send `Accept: application/json`** or you get HAL.

Response (abbreviated):
```json
{
  "dependencies": { "type": "hierarchical-multi-select", "values": [
    { "name": "Web", "values": [
      { "id": "web", "name": "Spring Web", "description": "...", "versionRange": "[3.2.0,4.0.0)" }
    ] }
  ] },
  "type":         { "type": "action", "default": "maven-project", "values": [...] },
  "packaging":    { "type": "single-select", "default": "jar", "values": [...] },
  "javaVersion":  { "default": "21", "values": [...] },
  "language":     { "default": "java", "values": [...] },
  "bootVersion":  { "default": "3.2.1", "values": [...] },
  "groupId":      { "default": "com.menora" },
  "artifactId":   { "default": "demo" },
  "version":      { "default": "0.0.1-SNAPSHOT" },
  "name":         { "default": "demo" },
  "description":  { "default": "..." },
  "packageName":  { "default": "com.menora.demo" }
}
```

### `GET /metadata/extensions`
Sub-options per dependency. Source: `ExtensionMetadataController.java:52`.
```json
{
  "kafka": [
    { "id": "consumer-example", "label": "Consumer example", "description": "..." },
    { "id": "producer-example", "label": "Producer example", "description": "..." }
  ]
}
```

### `GET /metadata/compatibility`
Compatibility rules between dependencies. Source: `ExtensionMetadataController.java:89`.
Optional query param `?projectKind=BACKEND|FRONTEND` filters rows; omit it to get every row.
```json
[
  { "sourceDepId": "data-jpa", "targetDepId": "h2", "relationType": "REQUIRES",
    "description": "...", "projectKind": "BACKEND" }
]
```
`relationType` values are exactly `REQUIRES`, `CONFLICTS`, `RECOMMENDS` (enum `DependencyCompatibilityEntity.RelationType`). Each row also carries its own `projectKind`.

### `GET /metadata/starter-templates`
Preset bundles (one-click recipes). Source: `ExtensionMetadataController.java:103`.
Optional query param `?projectKind=BACKEND|FRONTEND` filters by kind.
```json
[
  { "id": "rest-api", "name": "REST API", "description": "...", "icon": "...", "color": "...",
    "bootVersion": "3.2.1", "javaVersion": "21", "packaging": "jar",
    "dependencies": [{ "depId": "web", "subOptions": [] }] }
]
```

### `GET /metadata/sql-dialects`
Map of dependency id → SQL dialect (which deps the SQL wizard can target).
Source: `ExtensionMetadataController.java:143`.
```json
{ "h2": "H2", "postgresql": "POSTGRESQL", "mysql": "MYSQL", "db2": "DB2" }
```

### `GET /metadata/openapi-capable-deps`
List of dep ids that can drive the OpenAPI wizard (typically `web`, `webflux`).
Source: `ExtensionMetadataController.java:116`.

### `GET /metadata/soap-capable-deps`
List of dep ids that can drive the SOAP wizard (typically `web-services`).
Source: `ExtensionMetadataController.java:163`.

### `GET /metadata/entity-template-sets`
The backend + frontend template sets the **fullstack** generator can target.
Source: `ExtensionMetadataController.java:195`.
```json
[
  { "setKey": "spring-jpa-crud", "name": "...", "description": "...", "kind": "BACKEND",
    "defaultDeps": ["web", "data-jpa", "h2"], "designSystem": null,
    "bootVersion": "3.2.1", "javaVersion": "21", "defaultPaletteId": null },
  { "setKey": "react-tailwind-crud", "name": "...", "kind": "FRONTEND_REACT", "defaultDeps": [] }
]
```

### `GET /frontend/metadata`
Discovery for the React frontend generator. Optional `?reactVersion=<id>` scopes the
dependency catalog (design systems that pin React 18 drop out for React 19). Source:
`FrontendStarterController.java:222`.
```json
{
  "defaults": { "projectName": "...", "reactVersion": "...", "nodeVersion": "...", "packageManager": "..." },
  "reactVersions": [...], "nodeVersions": [...], "packageManagers": [...], "pinned": {...},
  "dependencies": [ { "name": "Routing", "entries": [ { "id": "router", "name": "...", "subOptions": [...] } ] } ],
  "colorPalettes": [ { "id": "ocean", "name": "...", "primary": "#...", "isDefault": true } ]
}
```
Note: the FE catalog shape is `dependencies[].entries[]` (group → entries), **not** the
`dependencies.values[].values[]` shape of `/metadata/client`.

---

## Project generation (GET)

### `GET /starter.zip`
Spring Initializr standard. Returns a ZIP. Query params:

| param | example | notes |
|---|---|---|
| `type` | `maven-project` | also `gradle-project` |
| `language` | `java` | `java` / `kotlin` / `groovy` |
| `bootVersion` | `3.2.1` | from `/metadata/client` |
| `javaVersion` | `21` | |
| `packaging` | `jar` | `jar` / `war` |
| `groupId` | `com.demo` | |
| `artifactId` | `app` | |
| `name` | `app` | |
| `description` | `Demo` | |
| `packageName` | `com.demo.app` | |
| `dependencies` | `web,jpa,h2` | csv |
| `opts-{depId}` | `opts-kafka=consumer-example,producer-example` | repeat per dep with sub-options |

### `GET /starter.preview`
Same params as `/starter.zip`; returns JSON. Source: `ProjectPreviewController.java:41`.
```json
{
  "files": [{ "path": "pom.xml", "content": "..." }],
  "tree":  [{ "name": "src", "path": "src", "type": "directory", "children": [...] }]
}
```

---

## Frontend generation (GET)

React / TS / Vite / FSD projects. Source: `FrontendStarterController.java:72,110`. Discover
valid deps, versions, and palettes via `GET /frontend/metadata` (above).

### `GET /frontend/starter.zip` / `GET /frontend/starter.preview`
`.zip` returns the archive; `.preview` returns the same `{ files, tree }` shape as
`/starter.preview`. Query params (all optional — the backend supplies defaults):

| param | example | notes |
|---|---|---|
| `projectName` | `demo` | default `demo`; also the zip filename |
| `description` | `Demo` | |
| `scope` | `@acme` | npm scope |
| `appTitle` | `Demo App` | |
| `reactVersion` | `18` | from `/frontend/metadata` |
| `nodeVersion` | `20` | |
| `packageManager` | `npm` | `npm` / `pnpm` / `yarn` |
| `basePath` | `/` | default `/` |
| `dependencies` | `router,state-zustand` | csv |
| `colorPalette` | `ocean` | id from `/frontend/metadata` |
| `apiBaseUrl` | `http://localhost:8080` | |
| `backendArtifactId` | `app` | |
| `opts-{depId}` | `opts-design-mui=icons` | repeat per dep with sub-options |

---

## Wizards (POST `application/json`)

Body for `.preview` and `.zip` is `WizardStarterRequest`. Source: `WizardStarterController.java:87,109`.

```ts
{
  groupId?: string, artifactId?: string, name?: string, description?: string,
  packageName?: string, type?: string, language?: string, bootVersion?: string,
  packaging?: string, javaVersion?: string, version?: string,
  configurationFileFormat?: string,
  dependencies?: string[],
  opts?: { [depId: string]: string[] },           // sub-options per dep (JSON shape — not "opts-..." like the URL form)

  sqlByDep?:   { [depId: string]: string },        // raw DDL per dep
  sqlOptions?: { [depId: string]: {
    subPackage?: string,
    tables?: { name: string, generateRepository?: boolean }[]
  } },

  specByDep?:      { [depId: string]: string },    // raw OpenAPI spec per dep
  openApiOptions?: { [depId: string]: {
    apiSubPackage?: string, dtoSubPackage?: string, clientSubPackage?: string,
    mode?: "CONTROLLERS"|"CLIENT"|"BOTH",
    baseUrlProperty?: string
  } },

  wsdlByDep?:   { [depId: string]: string },       // raw WSDL per dep
  soapOptions?: { [depId: string]: {
    endpointSubPackage?: string, clientSubPackage?: string, payloadSubPackage?: string,
    mode?: "ENDPOINTS"|"CLIENT"|"BOTH",
    baseUrlProperty?: string, contextPath?: string
  } }
}
```

### `POST /starter-wizard.preview`
Returns the same shape as `/starter.preview` (`{ files, tree }`).

### `POST /starter-wizard.zip`
Returns `application/octet-stream`.

### `POST /starter-wizard.detect-paths`
Body: `{ "spec": "<openapi yaml/json>" }`. Returns `string[]` (endpoint paths).
Source: `WizardStarterController.java:139`.

### `POST /starter-wizard.detect-services`
Body: `{ "wsdl": "<wsdl xml>" }`. Returns `string[]` (service names).
Source: `WizardStarterController.java:145`.

### Error responses (HTTP 400)
- Invalid OpenAPI: `{ "error": "Invalid OpenAPI spec", "messages": [...] }`
- Invalid WSDL:    `{ "error": "Invalid WSDL",          "messages": [...] }`
- Invalid SQL:     `{ "error": "Invalid SQL", "dep": "h2", "statementIndex": 0, "snippet": "...", "detail": "..." }`

---

## Fullstack generation (POST `application/json`)

Generates a Spring Boot backend **and** a React frontend for a list of user-defined
entities, in one ZIP (`backend/`, `frontend/`, root `README.md`). Source:
`FullstackStarterController.java:92,132`.

Body `FullstackStarterRequest`:
```ts
{
  groupId?, artifactId?, name?, description?, packageName?,
  type?, language?, bootVersion?, packaging?, javaVersion?, version?,
  configurationFileFormat?,
  dependencies?: string[],                 // omit entirely → backend set's default deps are used
  opts?: { [depId: string]: string[] },
  backendTemplateSet?:  string,            // default "spring-jpa-crud"
  frontendTemplateSet?: string,            // default "react-tailwind-crud"
  entities: [{                             // ≥1 required; each needs exactly one primaryKey field
    name: string, tableName?: string,
    fields: [{
      name: string,
      type: string,                        // "STRING"/"String", "LONG", "LOCAL_DATE"/"LocalDate", "ENUM", ...
      primaryKey?: boolean, generated?: boolean, required?: boolean, unique?: boolean,
      length?: number,                     // STRING only
      enumValues?: string[]                // ENUM only (and required for ENUM)
    }]
  }]
}
```
Discover template sets via `GET /metadata/entity-template-sets`.

### `POST /starter-fullstack.preview`
Returns `{ files, tree }` — file paths span `backend/` and `frontend/`.

### `POST /starter-fullstack.zip`
Returns `application/octet-stream`.

### `POST /metadata/fullstack/import-ddl`
Parses pasted `CREATE TABLE` DDL into the exact `entities[]` wire shape above, so you can
pre-fill a fullstack payload from an existing schema. Source: `ExtensionMetadataController.java:228`.
Body `{ "sql": "<DDL>", "dialect"?: "H2"|"POSTGRESQL"|"MYSQL"|"DB2" }` (dialect defaults to `H2`).
Returns `{ "entities": [...] }`. Bad SQL → the same `Invalid SQL` 400 shape as the SQL wizard.

### Error responses (HTTP 400)
- Validation: `{ "error": "Invalid request", "detail": "..." }` (e.g. "At least one entity is required", unknown field type, multiple primary keys).

---

## Endpoints to AVOID

The backend has agentic endpoints intended for AI consumers that bypass the standard flow:

- `GET  /agent/manifest`  — `AgentDiscoveryController.java`
- `POST /agent/scaffold`  — `AgentScaffoldController.java`

This skill exists to mirror the UI's REST surface; do **not** call `/agent/*` from these scripts.
