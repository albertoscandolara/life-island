# Life Island app

The Life Island app is where you use your data. It is a Native Federation **host** (`apps/shell`) that shows the island and loads each area of life from its own **remote** (`apps/mfe-<area>`) at runtime. Every area is backed by its own service (`apps/svc-<area>`), which owns its schema and builds what it knows from the documents you upload and confirm.

| Area                  | Remote       | Service         | Status                         |
| --------------------- | ------------ | --------------- | ------------------------------ |
| 730 & taxes           | `mfe-tax730` | `svc-tax730`    | Live                           |
| Home, Bills           | `mfe-home`   | `svc-home`      | Live                           |
| Groceries             | planned      | `svc-groceries` | Service live, screen coming    |
| Health, Work, Studies | planned      | planned         | On the island as "coming soon" |

The list of areas, their order on the island and their routes live in `apps/shell/src/app/hub/modules.ts`.

## Running it

```sh
npm run infra:up              # Postgres, NATS, storage, gateway
npx nx serve svc-ingestion    # files for previews and the zip (port 3001)
npx nx serve svc-tax730       # the 730 service (port 3004)
npx nx serve mfe-tax730       # the 730 remote (port 4203), also usable on its own
npx nx serve svc-home         # properties, bills and works (port 3005)
npx nx serve mfe-home         # the Home and Bills remote (port 4204), also usable on its own
npx nx serve shell            # the island (port 4200)
```

Open http://localhost:4200. The dev servers proxy `/api/tax730` to port 3004 and `/api/home` to port 3005 (`proxy.conf.json` in each app). The remotes also run standalone at http://localhost:4203 and http://localhost:4204.

## Native Federation

- `apps/shell/public/federation.manifest.json` maps each remote's name to its `remoteEntry.json`. Swap this file per environment and a remote redeploys without rebuilding the shell.
- `apps/mfe-tax730/federation.config.mjs` exposes `./routes` (`TAX730_ROUTES`). The shell mounts it at `/taxes/730` in `app.routes.ts`. If a remote cannot be loaded the shell shows a "not reachable" page instead of failing.
- Angular, RxJS and `@life-island/design-system` are shared singletons. The shell provides `HttpClient`, which the remotes use.
- Each app's `build`/`serve` target runs the Native Federation builder, which wraps the Angular one (`esbuild` and `serve-original`).

To add an area: create `apps/mfe-<area>` (copy `mfe-tax730`, tag it `scope:<area>`), expose its routes, add it to the manifest and to `modules.ts` with a `path`, and give it a `[data-character]` accent.

## The 3D island

`apps/shell/src/app/island/` draws a low-poly island with three.js: a zone per area with its own landmark, palms and a peak, all built from primitives (nothing to download).

- Hover a zone or its label to highlight it and pause the drift; drag to turn the island; click to fly the camera in, then the router opens the area. Labels are real buttons, so it works by keyboard too.
- Colours come from design-system tokens (`--island-*` in `island-view.css`), resolved at runtime and repainted when the theme changes.
- three.js loads lazily with `@defer (on idle)`. With `prefers-reduced-motion`, or without WebGL, the hub shows only the area cards under the island, which always open every area.

## The 730 area

`svc-tax730` keeps everything that goes into one year's 730:

| Table                | What it holds                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `tax730.expenses`    | Confirmed deductible expenses (`tax730.expense@1`), plus your description and note                                         |
| `tax730.attachments` | Documents filed for the 730: an expense's `INVOICE`, `PAYMENT` proof or `OTHER`, or a year's `CERTIFICATION` (e.g. the CU) |
| `tax730.documents`   | A copy of your uploaded documents, kept from `upload.completed/updated/deleted` events, so the area can show and file them |

A confirmed expense files the document it was read from as its invoice. You file payment proofs yourself from the 730 screen: the picker ranks your documents by same amount, the supplier's name, a date within 90 days and payment words, and shows why. A year counts as "the year the expenses were paid": expenses of 2025 go in the 730/2026.

| Endpoint (`/api/tax730/...`)              | Purpose                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `GET tax-years`                           | Totals per year and type, with how many expenses miss an invoice or a payment |
| `GET tax-years/:year`                     | The year's expenses with their documents, and the year's own documents        |
| `POST/DELETE tax-years/:year/attachments` | File or remove a document of the whole year                                   |
| `PATCH expenses/:id`                      | Edit the description or the note                                              |
| `POST/DELETE expenses/:id/attachments`    | File or remove an invoice, payment proof or other document                    |
| `GET documents?search=&forExpense=`       | Your documents, ranked for an expense when `forExpense` is set                |
| `GET documents/:uploadId/preview`         | The original file, streamed from `svc-ingestion`                              |
| `GET exports/deductions.xlsx?year=`       | "Riepilogo detrazioni": one `Detrazioni YYYY` sheet per year                  |
| `GET tax-years/:year/export.zip`          | The folder for the commercialista                                             |

The Excel follows the commercialista's summary: Data, Fattura, Fornitore, Descrizione, Tipologia, Importo, Fattura (ok/ko), Dettaglio bonifico (ok/ko), Note, and a `SUM` row.

The zip is named `YYYY-MM-DD - Documentazione 730 <filing year> per commercialista.zip` and holds one folder, `730 <filing year> - redditi <year>/`, with:

```
Riepilogo detrazioni 2025.xlsx
Certificazione unica.pdf
2025-06-27 - Notaio Chiliberti - Atto notarile prima casa/
    2025-06-27 - Notaio Chiliberti - Atto notarile prima casa - Dettaglio bonifico.pdf
    2025-07-16 - Notaio Chiliberti - Atto notarile prima casa - Fattura.pdf
DOCUMENTI MANCANTI.txt     (only when something is missing)
```

Each expense folder is "date - invoice no. - supplier - description"; each file starts with its own document's date. Files are read from `svc-ingestion`'s API (`INGESTION_URL`), never from its storage.

## Home and Bills

Two zones of the island, one area: **Home** (Bronto, `/home`) keeps your properties and the works done on them; **Bills** (Stego, `/home/bills`) is the dashboard of their electricity, gas and water. Both are served by `mfe-home` and `svc-home`, because they share the properties. The bar at the top of both switches view and home: **All homes** (together), one home, or **Side by side** on Bills. The choice lives in the URL (`?property=<id>&split=1`).

| Table                 | What it holds                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `home.properties`     | Your homes (Via Ponzilovo and Via dei Bandi to start), with the words and supply codes that recognise their bills and a fixed chart colour |
| `home.documents`      | A copy of your documents and their confirmed categories and fields, kept from `upload.*` events                                            |
| `home.category_tree`  | The category hierarchy, kept from `category.changed`, so a subcategory of `GAS_BILL` still counts as gas                                   |
| `home.bill_overrides` | Your corrections: another home, another utility, or "not a bill"                                                                           |
| `home.works`          | Renovations, repairs, maintenance and improvements: where, who, when, estimate and final cost                                              |
| `home.work_documents` | Documents filed with a work (invoices, quotes, photos), by id                                                                              |

**Bills are read, not stored.** A bill is a document whose confirmed categories include `ELECTRICITY_BILL`, `GAS_BILL` or `WATER_BILL` (or a subcategory, or a plain `BILL` that prints a consumption). Amount, period, dates, consumption and provider come from its template fields, so fixing a field in the documents app fixes the dashboard. A bill without an amount is left out. Its home is, in order: the one you picked; the one whose POD/PDR/customer code it prints; the one whose words (e.g. `ponzilovo`) appear in its supply address; the one whose category the document has; the one whose words appear in another address or the title. The address a bill is mailed to (customer, billing, residence) never counts: the bills of one home are often sent to another. Two homes matching equally leave it unassigned, and the dashboard asks you to assign it.

**Every home is a property category.** At startup, and when you add a home, svc-home links each home without categories to a `PROPERTY` category of the documents app: one whose title or id names the home (`Via Ponzilovo`, `VIA_PONZILOVO`), or a new one created through svc-ingestion's `POST /categories` with a description that tells the AI to assign it by the supply address. So the review inbox offers every home under "Property / location" and the parser can assign it. Turn it off with `HOME_LINK_PROPERTY_CATEGORIES=false`.

The Bills dashboard: one row of filters (period presets or any months, utilities, month/quarter/year, and whether a bill counts over the months it covers or in the month it was issued) scopes everything under it: the total against the period before, a tile per utility with cost, use, cost per unit and trend, cost over time (stacked by utility, or the homes side by side plus one chart per home on a shared scale), year over year (January to December, a line per year, cost or use), use per utility in its own unit, the split by utility, home and provider, totals grouped any way, and the bills themselves with their corrections. Every chart has a table view or a table beside it.

Chart colours follow the entity, never its rank: electricity, gas and water and the first three homes have fixed hues (`--viz-*` tokens, checked for colour-blind separation in both themes); a fourth home shares the "other" grey.

The Home view shows your homes as small 3D houses (three.js, loaded with `@defer`) with roofs in each home's colour; click one to look at it. Beside them, what the works add up to; under them, a card per home with its bills of the last 12 months, and the works on a timeline, year by year, with status, cost against the estimate and their documents.

| Endpoint (`/api/home/...`)                                           | Purpose                                                                |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `GET/POST /properties`, `PATCH/DELETE /properties/:id`               | Your homes                                                             |
| `GET /bills?property=&utility=&from=&to=`                            | Bills as read now (`property=unassigned` for the ones to assign)       |
| `PATCH /bills/:uploadId`                                             | `{propertyId}`, `{automaticProperty: true}`, `{utility}`, `{excluded}` |
| `GET/POST /works`, `PATCH/DELETE /works/:id`                         | Works, filtered by `property` and `status`                             |
| `POST /works/:id/documents`, `DELETE /works/:id/documents/:uploadId` | File or remove a document                                              |
| `GET /documents?search=`, `GET /documents/:uploadId/preview`         | Documents to file, and their original file (from svc-ingestion)        |

A database created before this area existed needs its schema and role: `npm run db:upgrade` (idempotent). svc-ingestion's migration `0009` adds the `ELECTRICITY_BILL` and `GAS_BILL` categories, with POD/PDR, supply address and consumption fields, unless you already have categories with those ids or titles.
