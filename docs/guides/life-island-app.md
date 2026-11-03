# Life Island app

The Life Island app is where you use your data. It is a Native Federation **host** (`apps/shell`) that shows the island and loads each area of life from its own **remote** (`apps/mfe-<area>`) at runtime. Every area is backed by its own service (`apps/svc-<area>`), which owns its schema and builds what it knows from the documents you upload and confirm.

| Area                                | Remote       | Service         | Status                         |
| ----------------------------------- | ------------ | --------------- | ------------------------------ |
| 730 & taxes                         | `mfe-tax730` | `svc-tax730`    | Live                           |
| Groceries                           | planned      | `svc-groceries` | Service live, screen coming    |
| Health, Work, Bills & home, Studies | planned      | planned         | On the island as "coming soon" |

The list of areas, their order on the island and their routes live in `apps/shell/src/app/hub/modules.ts`.

## Running it

```sh
npm run infra:up              # Postgres, NATS, storage, gateway
npx nx serve svc-ingestion    # files for previews and the zip (port 3001)
npx nx serve svc-tax730       # the 730 service (port 3004)
npx nx serve mfe-tax730       # the 730 remote (port 4203), also usable on its own
npx nx serve shell            # the island (port 4200)
```

Open http://localhost:4200. The dev servers proxy `/api/tax730` to port 3004 (`proxy.conf.json` in each app). The remote also runs standalone at http://localhost:4203.

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
