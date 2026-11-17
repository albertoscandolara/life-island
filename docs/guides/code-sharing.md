# Code sharing

Every area is its own remote and its own service, so the easy thing is to copy what the last area did. These rules keep the copies from multiplying: the island stays consistent, a fix lands once, and a new area is mostly composition. Visual rules are in [Design guidelines](design-guidelines.md).

## The rule of two

The second time the same component, style block, formatter, helper or endpoint shape is needed, it moves to a library in the same pull request, and the first copy is replaced by it. A third copy is never written. Before writing anything generic in an area, search the libraries below.

## Where shared code lives

| Library              | Holds                                                                                                                                                                                                                                                                                                                                                        | Tags           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| `libs/design-system` | Tokens (primitives, semantic, character themes), global classes (`.ui-*`, the `.li-*` layout of `records.css`), every presentational component (`ui-button`, `ui-card`, `ui-table`, `ui-alert`, `ui-dialog`, `ui-page-header`, AI and Guide components) and the charts (`ui-column-chart`, `ui-line-chart`, `ui-sparkline`, `ui-segmented-bar`, `niceScale`) | `scope:shared` |
| `libs/records-ui`    | The parts of an area page: `li-tabs`, `li-bars`, `li-due`, `li-record-dialog` and `RecordEditor` for a form generated from fields, the formatters (`euro`, `dateText`, `daysText`, `monthText`, `duration`, `percent`, `errorText`, `numberOrNull`), and `RecordsApi`, the base of an area's client                                                          | `scope:shared` |
| `libs/entities-ui`   | `<li-entity-link>` and the entity directory                                                                                                                                                                                                                                                                                                                  | `scope:shared` |
| `libs/settings-ui`   | `<li-ai-tool>`, `<li-ai-tool-info>`, `SettingsApi`, browser settings (hidden areas, theme)                                                                                                                                                                                                                                                                   | `scope:shared` |
| `libs/contracts`     | Zod schemas and DTOs of every API and event, the area endpoint shapes (`DeadlineDto`, `LifeAttentionDto`, `EntityRefDto`), `AI_TOOLS`, and pure domain arithmetic both ends use (tax brackets, deduction rules, dates)                                                                                                                                       | `scope:shared` |
| `libs/be-common`     | Database factory, outbox and relay, NATS, consumer helper, `record-loader`, storage, env, AI tool switches and usage                                                                                                                                                                                                                                         | `scope:shared` |
| `libs/be-nest`       | `AiAssistant` (one AI tool's model calls, switches, budget and errors), `EventsRuntime`, `RecordCollections` (CRUD of an area's records), validation pipes                                                                                                                                                                                                   | `scope:shared` |

A library may import only libraries below it in this order: `contracts` → `design-system` → `records-ui`, `entities-ui`, `settings-ui`; `contracts` → `be-common` → `be-nest`. Front-end libraries never import back-end ones.

## What every area does the same way

**Front end**

- Page parts from `records-ui` and the design system: tabs with `<li-tabs>`, tiles and lists with the `.li-*` classes, charts from the design system, dialogs with `<ui-dialog>` or `<li-record-dialog>`.
- No area-wide `blocks.css` or `kit.css` that re-declares `.tile`, `.table`, `.chip` or `.tabs`: use `.li-*` from `records.css`. An area stylesheet holds only what is the area's own.
- Numbers, dates and errors through the `records-ui` formatters. An area's `labels.ts` keeps only its own vocabulary (a field's label, a kind's icon) and re-exports the shared formatters when its templates need them.
- The API client extends `RecordsApi` and calls only its own service through the gateway.

**Back end**

- Every area answers the same endpoints with the same shapes from `libs/contracts`: `GET /deadlines` (`DeadlineDto[]`, for the Agenda), `GET /attention` (`LifeAttentionDto`, for the hub badge and the area's tabs) and, when it owns entities, `GET /entities` (`EntityRefDto[]`).
- Every model call goes through `AiAssistant` (`libs/be-nest`), registered in `AI_TOOLS` (`docs/guides/ai-tools.md`). No service creates its own `Anthropic` client.
- Records an area keeps by hand go through `RecordCollections`; events through `EventsRuntime` and the outbox.
- Text written into a response (an insight, an advice line) formats money and dates with one shared helper, not a local `money()` or `euroText()`.

## Known duplication to remove

Found in the review of November 2026. Each line is removed when its area is next touched, or in its own small pull request.

| Where                                                                                                                                                       | Duplicate of                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `mfe-work/.../blocks.css`, `mfe-studies/.../blocks.css`, `mfe-home/.../shared/kit.css`, tile and table rules in `mfe-cars`, `mfe-people`, `mfe-tax730`      | `.li-*` in `design-system/styles/records.css`     |
| `mfe-work/.../labels.ts` (`euro`, `duration`, `pct`), `mfe-home/.../shared/format.ts`, `mfe-tax730/.../dashboard/format.ts`                                 | `records-ui` formatters                           |
| Hand-drawn CSS bar charts in `mfe-tax730` (month chart, year comparison, trend), `mfe-money`, `mfe-subscriptions`, `mfe-travel`, `mfe-fitness`, `mfe-goals` | design-system charts and `li-bars`                |
| `svc-work` career advisor, `svc-studies` study coach and resource scout, `svc-cars` quote advisor (own `Anthropic` clients)                                 | `AiAssistant` in `libs/be-nest`                   |
| `money()` / `euroText()` in `svc-work` (five files) and `svc-dreams`                                                                                        | one shared text formatter in `libs/contracts`     |
| `/attention` missing in Cars, Home, Work, Taxes and Groceries                                                                                               | `LifeAttentionDto`, as the other areas publish it |

Done so far: the column, line, sparkline and segmented-bar charts (copied in Home and Work) are in the design system; Studies takes its formatters from `records-ui`; chart colours of a kind or topic come from the shared `--viz-1…6` palette.
