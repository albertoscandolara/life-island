# AI tools and Settings

Every feature of Life Island that calls an AI model is an **AI tool**. All of them follow one pattern, so that:

- **Settings → AI tools** (Archie's module, `/settings/ai-tools`) lists every tool, grouped by module. For each one it shows the cost of one use, what it has cost so far, its on/off switch, and the request it sends.
- The same control (cost, switch, info) sits next to the tool, where you use it.
- Every tool looks the same: a quiet violet container, the sparkle mark, and the same titles and states.
- A tool that is off, or that has no API key, keeps working with Life Island's own rules, and says so.

**Every new AI tool follows this guide.** For a new module, this is part of the [new feature checklist](../architecture.md#new-feature-checklist).

## How it fits together

```
libs/contracts  AI_TOOLS, APP_SETTINGS, prices      ← the registry (one entry per tool)
      │
svc-settings  (schema settings, port 3009, /api/settings)
      │  stores the switches and app settings   → publishes settings.changed@1
      │  receives ai.tool_described@1 (request)  ← each service at startup
      │  receives ai.tool_used@1 (tokens)        ← each service on every use
      ▼
svc-work, svc-parse-worker, …  keep a settings_replica table (updated by settings.changed@1)
      │  and check isAiToolEnabled() before every model call
      ▼
libs/settings-ui  <li-ai-tool>, <li-ai-tool-info>, SettingsApi   (one GET /api/settings/overview per page)
libs/design-system  <ui-ai-panel>, <ui-ai-badge>, <ui-ai-status>, the --ai-* tokens
```

- svc-settings owns the values. A service never calls svc-settings over HTTP; it reads its own replica (principle 1). This is also how settings reach the parse worker, which has no HTTP.
- `ai.enabled` is the master switch. A tool calls the model only when `ai.enabled` and `ai-tool.<id>` are both on and its service has an API key.
- Costs come from the Claude API list prices in `MODEL_PRICES` (thinking is billed as output; web search costs $0.01 per search). Until a tool has been used, its cost per use is an estimate from the registry's typical tokens. After that, it is the average of its real uses.

## Adding an AI tool

1. **Register it** in `AI_TOOLS` (`libs/contracts/src/lib/settings.ts`).
   - Give it an id of the form `<module>.<tool>`, a name, and a description.
   - Give it the `unit` of one use, its `trigger`, and `where` it lives.
   - Say what happens `whenOff`.
   - List one `step` per model call, each with its default model, effort, `maxTokens`, server tools, and a typical `estimate`.
   - If the module is new, add it to `AI_TOOL_MODULES`.

   The contracts tests check that the entry is complete.

2. **Gate it.** The service needs a `settings_replica` table: copy the migration from `apps/svc-work/drizzle/0003_settings_replica.sql`. It also needs a consumer of `SETTING_CHANGED_EVENT` with `settingChangedHandler(schema)`; see `apps/svc-work/src/app/app.module.ts`. Before calling the model, check `await isAiToolEnabled(db, schema, toolId)` (from `@life-island/be-common`). When it is off, use the fallback from `whenOff`, or answer 503 with a message that names Settings → AI tools.
3. **Describe it at startup** with `describeAiTools(pool, schema, service, [...])`. Pass, per step: the model, effort, thinking, max tokens, tools, the system prompt word for word, and the user message template. That is what the info dialog shows. See `describeWorkTools` in `apps/svc-work/src/app/work/career-advisor.ts`.
4. **Record every use** with `recordAiToolUse(...)` and `stepUsage(stepId, message, latencyMs)` for each model call. Record a failure too, with `outcome: 'error'`.
5. **Expose whether it is on** in the module's DTO (for example `aiFeedback` and `aiMarketCheck` in `WorkOverviewDto`), so the page can say what the user will get.
6. **Show it** with the components below.

## What you can change in Settings

- **Model per tool.** Each tool can run on any model in `aiToolModelChoices(tool)`. Haiku is left out for a tool that searches the web. The choice is stored as `ai-model.<toolId>` and applies to every step of the tool. Read it with `aiToolModel(db, schema, toolId)` before each call, and fall back to the service's env model. The page shows the estimated cost per use on each model.
- **Monthly budget.** `ai.monthly-budget-usd` and `ai.budget-stop`. svc-settings adds up the recorded uses per calendar month, in `SETTINGS_TIMEZONE`, which defaults to Europe/Rome. Settings warns at 80%. When the stop is on and the budget is reached, svc-settings publishes `ai.budget-reached = true`. `isAiToolEnabled` reads that flag, so every tool goes offline until the next month, or until you raise the budget. svc-settings checks after each use, after each budget change, at startup and every hour. No one sets `ai.budget-reached` by hand.
- **Reset and backup.** `DELETE /api/settings/settings/:key` puts any key back to its default. Replicas receive `null`, which reads as "not set". `GET /api/settings/settings` returns everything you set. `PUT /api/settings/settings` with `{ values }` sets many keys at once, all or nothing. App settings saves these values, plus the browser settings, to a `life-island-settings` JSON file and loads them back.
- **Links.** The badge of `<li-ai-tool>` links to `/settings/ai-tools?tool=<id>`, which scrolls to the tool and highlights it. Pass `[settingsLink]="false"` on the Settings page itself.

## The visual language

Violet (`--ai-accent`, `--ai-text`, `--ai-soft`, `--ai-border`) is reserved for AI. No module accent uses it, so AI reads as AI everywhere. Keep it to the components below. Do not add gradients or new colours.

| Component                              | Where                                                                                                                               | Notes                                                                                                                                                                                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<ui-ai-panel heading kind state>`     | Around a tool you start (`kind="tool"`, eyebrow "AI tool") and around what a model wrote (`kind="result"`, eyebrow "Written by AI") | The body keeps the tool's own layout. `[state]="'working'"` shows a thin progress line. `[offline]="true"` drops the violet when Life Island's own rules wrote the result, and the eyebrow then says so. `eyebrow` overrides the default text. |
| `<li-ai-tool uiAiPanelActions toolId>` | In the panel's header, or next to a button (`compact`)                                                                              | Shows the cost per use or why the tool is off, plus the switch and the info button (the request: model, reasoning, prompts, latest uses).                                                                                                      |
| `<ui-ai-status state>`                 | Next to the action while it runs, or after it                                                                                       | Shows the states `working`, `done`, `warning`, `error` and `off`, each with a short text you write: "Reading your career…", "Done", "Claude was unreachable".                                                                                  |
| `<ui-ai-badge label muted>`            | Inline: a value or a banner that AI produced                                                                                        | "AI" by default.                                                                                                                                                                                                                               |
| `sparkles` icon                        | On a button that starts a model call                                                                                                | For example "Parse now" and "Reclassify".                                                                                                                                                                                                      |

Titles: the panel heading names the tool in the user's words ("Career feedback", "Market check", "Document reading", "Suggested categories"). The eyebrow says what the panel is, so headings never repeat "AI".

## App settings

Settings → App settings shows every setting in `APP_SETTINGS`, and a search box filters both pages.

A setting has a `type`:

- `boolean`
- `choice`
- `number`, with `min`, `max` and a `unit`
- `time`, as `HH:MM`
- `modules`, a list of island areas

**Browser settings.** A `browser` setting is kept by this browser in localStorage, as `life-island.setting.<key>`, through `BrowserSettings` in libs/settings-ui. The theme is the exception: `UiThemeService` keeps it. Browser settings include:

- the island view (3D or cards only)
- the start page (the island, or the last area used)
- the areas you turned off

**Server settings.** A `server` setting is stored by svc-settings and reaches services through their replica. Services read it with `readBooleanSetting`, `readNumberSettings` or `readSettings`.

| Setting                                                  | Read by                                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Reminder windows `people.warn-days.*`                    | svc-people (it has a replica for them)                                             |
| Reminder windows `cars.warn-days.*`                      | svc-cars                                                                           |
| Weekly goal and reminders `studies.*`                    | svc-studies                                                                        |
| Daily reading switch, time and startup run `documents.*` | the parse worker, which checks them every 15 seconds, so a change needs no restart |

To add a server setting:

1. Add it to `APP_SETTINGS`.
2. Read it from the replica of the service that uses it, with a fallback for when the replica cannot be read.
