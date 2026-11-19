# The fullstack request — every property

Body of `POST /starter-fullstack.zip` / `.preview`, and of each side of `.patch`. JSON names are
exact. Closed lists and limits (field types, page types, widget kinds, icons, max lengths…) are
served live by `mi.mjs meta fullstack-schema` — read them there rather than from memory. That
document lists *values*; this file gives the *shape*. The fastest way to a valid request is
`mi.mjs example <id>` and editing what it prints.

Error on any of these: HTTP 400 `{"error":"Invalid request","detail":"…","path":"entities[1].fields[3].type"}`.
`path` uses the request's own names (index without a dot); it is absent for a whole-request problem.

## Project

| Property | Values / default |
|---|---|
| `groupId` | default `com.menora` |
| `artifactId` | default `demo`; letters, digits, `_ . -`; names the zip's root folder |
| `name`, `description`, `version` | defaults: artifactId, "", `0.0.1-SNAPSHOT` |
| `packageName` | default `<groupId>.<artifactId>` |
| `domainPackage` | where the CRUD classes go; the base package or a sub-package |
| `bootVersion` | `3.2.1` (default) or `3.5.16` — anything else is a 400 (`mi.mjs meta client` lists them) |
| `javaVersion` | `21` (default) or `17` |
| `packaging` | `jar` / `war` |
| `dependencies` | **absent** → the backend set's defaults (`data-jpa, web, h2, validation, actuator, ldap-auth-rest`). **Present, even `[]`** → exactly that list (plus what the catalog's REQUIRES rules add). For a real database **replace** `h2` (adding beside it leaves H2 the primary datasource): `mi … --db postgresql --add-deps flyway`. `flyway` writes the schema as `V1__init.sql`. |
| `opts` | `{ "<depId>": ["sub-option", …], "scaffold": ["audit", "tests", …] }` — `scaffold` holds the options below |
| `backendTemplateSet` | `spring-jpa-crud` (default) or `spring-jpa-crud-lombok` |
| `frontendTemplateSet` | `react-tailwind-crud` (default) or `react-menora-digital-crud` (Menora's design system; pair with `locale: "he"` and the `rtl` option) |
| `colorPalette` | an id from `mi.mjs meta frontend` (`colorPalettes`); an unknown id silently falls back |
| `locale` | `en` / `he` |
| `dashboardTitle`, `dashboardOverview` | the classic dashboard's heading (no `pages`) |
| `department` | id from `mi.mjs meta departments` |
| `entities` | ≥ 1, below |
| `pages` | the frontend layout, below; absent = a dashboard plus one list page per entity |
| `nav` | `{style: "sidebar"\|"topbar", collapsibleGroups, userMenu, notifications, commandPalette}`; needs `pages`; `notifications` needs a workflow with an `assigneeField` |

### Scaffold options (`opts.scaffold`)

Per entity (each entity may override with `"opts": {"audit": false}`):
`audit` (createdAt/updatedAt + createdBy/updatedBy), `softDelete`, `csvExport`, `xlsxExport`,
`csvImport`, `bulkDelete`, `bulkUpdate`, `optimisticLocking` (`@Version`, 409 on a stale save),
`inlineEdit` (frontend), `savedViews`, `history` (change log + restore), `events` (outbox →
Kafka/webhooks/SSE), `tests` (an `<Entity>ApiTest` each + Vitest — **turn this on**).
Project only: `seedData`, `openapi`, `inverseCollections`, `rtl`. (`secured` is retired.)

## Entity

```json
{ "name": "Order", "tableName": "orders", "label": "Order", "labelPlural": "Orders",
  "fields": [ … ], "relations": [ … ],
  "listViews": ["table", "kanban"], "readOnly": false, "viewQuery": null,
  "opts": { "history": true },
  "formSections": [ { "title": "Basics", "fields": ["title", "customer"] } ],
  "access": { "read": "USER", "write": "ADMIN" },
  "uniqueKeys": [ { "fields": ["project", "title"] } ],
  "rules": [ { "when": "status == 'DONE'", "check": "not isEmpty(estimate)", "message": "Done needs an estimate", "field": "estimate" } ],
  "workflow": { … } }
```

- `name`: a Java identifier, not a keyword, not a reserved name (`names.reservedEntityNames` in the
  schema), unique ignoring case, not `<Other>Dto`/`Service`/`Controller`/`Repository`.
- `viewQuery`: a SELECT → read-only `@Subselect` view (no relations, no generated key, no FILE/IMAGE).
- `access`: `SIGNED_IN` < `USER` < `ADMIN`; default read USER, write ADMIN; write never more open
  than read. Anything but the default needs `ldap-auth`/`ldap-auth-rest` in the dependencies.
  Access is per entity and role, **not per row**: "only my own requests" cannot be expressed —
  say so to the user (a team adds it in the generated service). Everyone with write may edit any
  row; a workflow's transitions narrow *moves* by role, not edits.
- `uniqueKeys`: 2+ members, fields or many-to-one names; a 409 names them on a clash.
- `rules`: expressions over the entity's own fields (below); an empty value makes a rule hold.

## Field

```json
{ "name": "amount", "type": "MONEY", "currency": "ILS", "required": true,
  "label": "Amount", "help": "Including VAT", "min": 0, "max": 100000 }
```

| Property | Notes |
|---|---|
| `type` | STRING, TEXT, LONG, INTEGER, BOOLEAN, LOCAL_DATE, LOCAL_DATE_TIME, BIG_DECIMAL, UUID, ENUM, LOCAL_TIME, INSTANT, MONEY, MARKDOWN, FILE, IMAGE (aliases: DATE, DATETIME, DECIMAL, INT, BOOL, TIME, ATTACHMENT, PHOTO…) |
| `primaryKey`, `generated` | one PK field normally; `generated` only on a single LONG/INTEGER/UUID key. Several `primaryKey` = composite key. |
| `required`, `unique`, `readOnly` | FILE/IMAGE cannot be unique |
| `length` / `pattern` / `email` | STRING only |
| `min` / `max` | numeric types; whole numbers on LONG/INTEGER |
| `enumValues`, `enumLabels` | ENUM: `["OPEN","DONE"]`, `{"OPEN":"Open"}` |
| `defaultValue` | a string, checked against the type |
| `searchable`, `filterable` | default true |
| `column` | the DB column name |
| `currency` | MONEY: `[A-Z]{3}`, default ILS |
| `help` | ≤ 300 chars, shown under the input |
| `showWhen` | boolean expression: shown (and required) only while it holds; the backend clears it otherwise |
| `maxFiles` | FILE/IMAGE: the field holds several files, at most this many (1–50); not with `showWhen`, not in a unique key or a transition's `requires`. The DTO carries `[{id, name}]`; no list on an update keeps the files |
| `formula` | computed column, set by the backend on every save; not on ENUM/UUID/FILE/IMAGE, not required, no default |

Keys cannot be LOCAL_TIME, INSTANT, MONEY, MARKDOWN, FILE or IMAGE.

**Expressions** (`rules`, `showWhen`, `formula`): `and or not && || !`, `== != < <= > >=`, `+ - * /`,
numbers, `'text'`, `true/false`, field names, a linked row's field one step through a MANY_TO_ONE (`costCenter.budget`: not long text, files or UUIDs), and `isEmpty(x) today() now() daysBetween(a,b)
length(s) abs(n) round(n) date(…)`. ≤ 500 chars. `daysBetween(a, b)` is whole calendar days from a
to b, end not counted (negative when b is earlier) — `daysBetween(startsOn, endsOn) + 1` counts
both ends; there is no working-day or holiday function. An empty operand makes the result empty
(and a rule over it hold).

**Names the generator adds — do not use them as field names:** `<rel>Id`, `<rel>Label` (many-to-one),
`<rel>Ids`, `<rel>Labels` (many-to-many), `<rel>Count` (one-to-many), `<field>Name` (FILE/IMAGE),
`createdAt updatedAt createdBy updatedBy` (audit), `deleted` (softDelete), `version` (optimisticLocking).

## Relation

```json
{ "type": "MANY_TO_ONE", "fieldName": "customer", "targetEntity": "Customer", "required": true, "label": "Customer" }
```

| type | Means | Extra |
|---|---|---|
| `MANY_TO_ONE` | a foreign key column | `joinColumn`; not to a composite-key entity or a view |
| `MANY_TO_MANY` | a set through a join table; multi-pick in the form | `joinTable`, `inverseJoinColumn`; never required, never to itself |
| `ONE_TO_MANY` | the target's rows pointing here (read-only table in the details) | `mappedBy` = the child's many-to-one name (inferred when there is one); `composition: true` makes the child rows part of this form (child: writable, single generated key, required link back, no workflow/files/lists of its own; rules, `showWhen` and `formula` are fine — the parent's save checks each row and answers `lines[i].field`) |

`targetEntity` must be in the same request.

## Workflow (human tasks)

```json
"workflow": {
  "statusField": "status", "initial": "DRAFT",
  "assigneeField": "assignee", "dueField": "dueOn", "trackMoves": true,
  "transitions": [
    { "name": "submit",  "label": "Submit",  "from": ["DRAFT"],     "to": "SUBMITTED", "roles": ["USER"] },
    { "name": "approve", "label": "Approve", "from": ["SUBMITTED"], "to": "APPROVED",  "roles": ["ADMIN"],
      "requires": ["approvedAmount"], "notify": ["creator"] }
  ] }
```

- `statusField`: a filterable, non-key ENUM. `assigneeField`: a non-required STRING. `dueField`: a date.
- `initial` (optional): the state a new row starts in. Default: the status field's `defaultValue`,
  else its first enum value; when both are set they must agree. The status is not asked of the
  client — it changes only through transitions.
- Transitions 1–20; `name` `^[a-z][A-Za-z0-9]{0,39}$`; not from a state to itself.
- `roles` ⊆ ADMIN, USER (needs ldap-auth). `requires`: fields asked for during the move.
- `notify` ⊆ `assignee` (needs assigneeField), `creator` (needs audit), `ADMIN`, `USER` — e-mails,
  sent through the outbox (generated with it; the `events` option is not needed). Mail is **off**
  in the generated app until `app.events.mail.enabled: true` and `spring.mail.host` are set;
  addresses come from the LDAP REST service, `app.events.mail.users`, or `app.events.mail.domain`.
- The entity: writable, table-backed, single key. The backend adds `POST /api/x/{id}/transitions/{name}`,
  `/claim`, `/release`, `/assign`, `GET /api/me`, an `inbox` filter.

## Pages (`pages`)

Every page: `id` (`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`, unique), `type`, `title?`, `description?`,
`hidden?`, `group?` (nav section), `icon?` (from `navIcons`), `roles?` (ADMIN/USER; not on the
first page). A property that does not belong to the page's type is a 400. At least one visible page.

| type | Properties |
|---|---|
| `entity-list` | `entity`, `presetFilter{field:value}`, `columns[]`, `sort{field,dir}`, `view`, `pageSize`, `detail` (drawer/side/record), `hideActions[]` |
| `dashboard` | `widgets[]`, `dateRange`, `refreshSeconds`, `filters[]` (≤ 4) |
| `tabs` | `title`, `tabs[{title, page}]` (2–6, pages by id) |
| `master-detail` | `parent`, `child`, `via?`, `showParent?`, `columns`, `sort` |
| `record` | `entity`, `childTabs[]`, `headerStats[{child, agg?, field?, title?, via?}]`, `printable?` — always hidden, one per entity |
| `report` | `entity`, `presetFilter`, `chart` or `charts[]` (≤ 4) of `{groupBy, bucket?, agg?, field?, kind?, series?}` |
| `wizard` | `entity`, `steps[{title?, fields[]}]` (≤ 8) |
| `form` | `entity` (a form or a wizard per entity, not both) |
| `inbox` | `entity` (workflow with assignee), `queues[]` (mine/unassigned/open), `cardFields`, `presetFilter`, `sort` |
| `calendar` | `entity`, `dateField?`, `endField?`, `modes[]` |
| `board` | `entity`, `laneField?`, `lanes[]`, `cardFields[]` (1–4), `wipLimits{lane:n}`, `laneSize`, `presetFilter`, `sort` |
| `content` | `title`, `body` (Markdown, ≤ 8000) |
| `import` | `entity` (writable; one per entity) |
| `search` | `entities[]`, `perEntity`, `shellSearch` (one per layout) |
| `tree` | `entity` with a many-to-one to itself, `via?` |

**Widget** (dashboard): `{kind, entity, title, agg, field, groupBy, bucket, limit, span (1–4),
presetFilter, sortBy, dateField, compare, target, series, text, pages[], columns[], sort, drillTo,
entities[], trend}` — which apply depends on `kind` (kpi, bar, line, donut, stacked, recent, top,
progress, list, pivot, activity, funnel, gauge, timeInState, text, links). The examples show each
in use: `mi.mjs example approvals --pages`.

## Saved models and templates on the server

- `/metadata/fullstack/models` — team models: `{name, description?, snapshot}`; `snapshot` is the
  editor's model (`format: "menora-fullstack-model/1"`, `meta`, `entities`, `selectedDeps`,
  `scaffoldOpts`, `backendSet`, `frontendSet`, `pages?`, `nav?`). Open to everyone; deleting one
  deletes it for everyone.
- `/metadata/fullstack/templates?kind=page|widget` — shared page / widget definitions for the designer.
