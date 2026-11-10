# Life Island app

The Life Island app is where you use your data. It is a Native Federation **host** (`apps/shell`) that shows the island and loads each area of life from its own **remote** (`apps/mfe-<area>`) at runtime. Every area is backed by its own service (`apps/svc-<area>`), which owns its schema and builds what it knows from the documents you upload and confirm.

| Area         | Remote        | Service         | Status                         |
| ------------ | ------------- | --------------- | ------------------------------ |
| 730 & taxes  | `mfe-tax730`  | `svc-tax730`    | Live                           |
| Home, Bills  | `mfe-home`    | `svc-home`      | Live                           |
| People & IDs | `mfe-people`  | `svc-people`    | Live                           |
| Cars         | `mfe-cars`    | `svc-cars`      | Live                           |
| Work         | `mfe-work`    | `svc-work`      | Live                           |
| Groceries    | planned       | `svc-groceries` | Service live, screen coming    |
| Studies      | `mfe-studies` | `svc-studies`   | Live                           |
| Health       | planned       | planned         | On the island as "coming soon" |

The list of areas, their order on the island and their routes live in `apps/shell/src/app/hub/modules.ts`.

## Running it

```sh
npm run infra:up              # Postgres, NATS, storage, gateway
npx nx serve svc-ingestion    # files for previews and the zip (port 3001)
npx nx serve svc-tax730       # the 730 service (port 3004)
npx nx serve mfe-tax730       # the 730 remote (port 4203), also usable on its own
npx nx serve svc-home         # properties, bills and works (port 3005)
npx nx serve mfe-home         # the Home and Bills remote (port 4204), also usable on its own
npx nx serve svc-people       # people, ID documents and their reviews (port 3006)
npx nx serve mfe-people       # the People & IDs remote (port 4205), also usable on its own
npx nx serve svc-cars         # cars, car documents, renewals and costs (port 3007)
npx nx serve mfe-cars         # the Cars remote (port 4206), also usable on its own
npx nx serve svc-work         # workplaces, career, feedback and platforms (port 3008)
npx nx serve mfe-work         # the Work remote (port 4207), also usable on its own
npx nx serve svc-settings     # settings, AI tool switches and costs (port 3009)
npx nx serve mfe-settings     # the Settings remote (port 4208), also usable on its own
npx nx serve svc-studies      # learning paths, courses, exams, platforms, study coach (port 3010)
npx nx serve mfe-studies      # the Studies remote (port 4209), also usable on its own
npx nx serve shell            # the island (port 4200)
```

Open http://localhost:4200. The dev servers proxy `/api/tax730` to port 3004 and `/api/home` to port 3005, `/api/people` to port 3006, `/api/cars` to port 3007 `/api/work` to port 3008 `/api/settings` to port 3009 and `/api/studies` to port 3010 (`proxy.conf.json` in each app). The remotes also run standalone at http://localhost:4203, http://localhost:4204, http://localhost:4205, http://localhost:4206, http://localhost:4207, http://localhost:4208 and http://localhost:4209.

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

| Endpoint (`/api/tax730/...`)              | Purpose                                                                                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `GET tax-years`                           | Totals per year and type, with how many expenses miss an invoice or a payment, the estimated deductions and the spending by month |
| `GET tax-years/:year`                     | The year's expenses with their documents, and the year's own documents                                                            |
| `POST/DELETE tax-years/:year/attachments` | File or remove a document of the whole year                                                                                       |
| `PATCH expenses/:id`                      | Edit the description or the note                                                                                                  |
| `POST/DELETE expenses/:id/attachments`    | File or remove an invoice, payment proof or other document                                                                        |
| `GET documents?search=&forExpense=`       | Your documents, ranked for an expense when `forExpense` is set                                                                    |
| `GET documents/:uploadId/preview`         | The original file, streamed from `svc-ingestion`                                                                                  |
| `GET exports/deductions.xlsx?year=`       | "Riepilogo detrazioni": a `Detrazioni YYYY` and a `Riepilogo YYYY` sheet per year                                                 |
| `GET tax-years/:year/export.zip`          | The folder for the commercialista                                                                                                 |

The Excel follows the commercialista's summary: Data, Fattura, Fornitore, Descrizione, Importo, Fattura (ok/ko), Dettaglio bonifico (ok/ko), Note, then Tipologia, and a `SUM` row. `Riepilogo YYYY` puts each kind of expense against its rule: 730 row, spent, paid in cash (left out), cap, franchigia, eligible, rate, instalments and the estimated deduction, then the instalments of earlier years' home bonuses and the estimated total.

### Deduction estimate

`tax730DeductionRules(year)` in `libs/contracts` (`tax730-deductions.ts`) lists, for expenses paid in a given year, each kind's 730 row, rate (and the lower rate off your main home), cap and what it applies to (the year, each person, each home), franchigia, number of yearly instalments and whether cash counts. `svc-tax730` (`deductions/deduction-estimate.ts`) applies them to a year's expenses:

- health (medical, medicines, devices) shares one €129.11 franchigia, has no cap, and leaves out doctors paid in cash (medicines may be cash);
- per-person caps (school €800, children's sport €210) count each beneficiary's codice fiscale separately;
- home bonuses (renovation, energy efficiency, furniture) are spread over 10 years, and each year's 730 also gets the instalments of the nine years before.

**Income and capienza.** The year's Certificazioni Uniche (category `CERTIFICAZIONE_UNICA`, ingestion migration `0019`, read from `tax730.documents` by their `income_year` field) give the income, the IRPEF withheld and the net tax (punto 375) of the year (`deductions/income.ts`). Deductions can only reduce the tax you owe, so the tax back is capped at the net tax of every CU together, and what does not fit is shown as lost (it is never carried over). One CU per employer counts: a later one replaces the earlier (a corrected CU, or a copy). With more than one CU the page warns that the 730 adds the incomes up. Without a CU, the estimate is not capped and the page asks for one.

It is a planning estimate: home bonuses at the main-home rate, and the income limits (above €75,000, with the yearly ceiling on expenses other than health, and above €120,000) are explained, with your income from the CU, not applied. The page also explains the 730 itself (who files it, the yearly calendar, what goes in it, what you get back, the documents to keep) with its sources.

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

**Bills are read, not stored.** A bill is a document whose confirmed categories include `ELECTRICITY_BILL`, `GAS_BILL` or `WATER_BILL` (or a subcategory, or a plain `BILL` that prints a consumption). Amount, period, dates, consumption and provider come from its template fields, so fixing a field in the documents app fixes the dashboard. A bill without an amount is left out. Its home is, in order: the one you picked; the one whose POD/PDR it prints; the one whose words (e.g. `ponzilovo`) appear in its supply address; the one whose category the document has; the one whose words appear in another address or the title. The address a bill is mailed to (customer, billing, residence) never counts: the bills of one home are often sent to another. Two homes matching equally leave it unassigned, and the dashboard asks you to assign it. When you assign a bill by hand, its supply point moves to that home, and every bill of it follows.

**Supply points and supply contracts.** The POD (electricity) and PDR (gas) name the meter: they belong to the home and never change with the supplier, so they are what a home's supply codes hold. The customer code (codice cliente) is given by the supplier to one supply contract: electricity and gas are separate contracts with separate codes, even with one supplier; an offer change with the same supplier keeps the code; a new supplier, a subentro after the meter was closed, or a voltura to another holder start a new contract with a new code. So the house review never proposes a customer code, a bill put on a home by hand never teaches it one, and the bill sync takes out of the homes any customer code an older review left there. `GET /supply-points` lists each supply point's contracts, newest first: the one billed last is `ACTIVE`, the earlier ones `ENDED`, each with the days it was billed for.

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

## People & IDs

Para's zone (`/people`, `mfe-people` and `svc-people`) keeps the identity documents of everyone at home: identity cards, passports, health cards (tessera sanitaria / codice fiscale) and driving licences.

**ID documents are read, not stored.** An ID document is a document whose categories are, or sit under, `ID_DOCUMENT`, `IDENTITY_CARD`, `PASSPORT`, `HEALTH_CARD` or `DRIVING_LICENCE` (svc-ingestion's migration `0010`). Every one of those templates uses the same keys for the holder (`last_name`, `first_name`, `tax_code`, `birth_date`, `birth_place`, `sex`, `citizenship`, `residence_address`) and the document (`document_number`, `issuer`, `issue_date`, `expiry_date`), so their data lines up into one person. Fixing a field in the documents app fixes it here.

**Nothing changes a person on its own.** A new ID document waits under **To review**:

- It is matched to a person by tax code, else by last name, first name and birth date (a passport or a licence prints no tax code). A different tax code is always another person. No match: **A new person** with everything it prints.
- Against a matched person it lists only what is new or different, with a suggestion: take a new value; **check** a different name, tax code, birth date, birth place or sex (those never change: it is a misread or someone else); take a different residence or citizenship, unless the document is expired or older than one you already have, then keep yours.
- You pick the person and tick the values to take. **Approve** writes them and files the document; **Not an ID document of anyone** sets it aside (you can review it again). Every decision is kept in `people.reviews` with what each field was before, so a person's data has its history.

**Versions.** The approved documents of a person form one series per type, numbered from the oldest (by issue date, else expiry date): the newest is **Current** (or **Expired** once past its date), the older ones **Replaced by a newer one**, and none is ever deleted. You can mark a version **Lost**, **Stolen** or **Withdrawn**.

**Editing, removing and merging people.** **Edit** corrects a person by hand. Their **Residence** can be one of your houses from Home or an address you type: a picked house shows as a link to its page in Home (`/home?property=<id>`), with its address kept as text. A typed address, or a different residence you take from a document, unlinks the house. svc-people reads the houses from svc-home's API (`HOME_URL`); when Home is not running, Residence is simply typed. **Remove** deletes a person and sends their ID documents back to review. **Merge a duplicate** moves a duplicate's documents to the person you are on, who keeps their details and takes only the missing ones; two different tax codes are never merged.

**Expiry warnings** cover the latest version of each series only: **expired**, or **expiring** within 180 days for a passport (many countries want six months left), 90 for an identity card and a driving licence, 60 for a health card (`EXPIRY_WARNING_DAYS` in `libs/contracts`). They sit at the top of the page, on the person and on the version. A document you marked lost, stolen or withdrawn, or one with no expiry date, never warns. A driving licence category whose own expiry date (field 11, read into `category_expiries`) comes before the licence's warns by itself. The island hub shows the counts on the People card (`GET /attention`).

**Checks and details.** The tax code is checked against the person: its check character, then the last name, first name, birth date and sex it encodes (the birth place is a cadastral code and is not checked). A mismatch shows on the person and on a document waiting for review. Each version shows what only its type prints: CIE or paper, the CAN, height, "not valid for travel", passport type, the European health card (TEAM) on a health card's back, and a licence's categories and restriction codes explained (`LICENCE_CATEGORY_LABELS`, `RESTRICTION_CODE_LABELS` in `libs/contracts`). Tax codes and document numbers stay hidden until **Show numbers**.

**Who has what** is the grid of everyone against the four document types. **Household** relates people (partner, parent, child, sibling) and records who a person is a fiscal dependent of, for the 730. A minor gets the rules that apply (shorter validity, parents' consent, travelling under 14) and a note before turning 18.

The Cars area shows the driving licence of a car's holder and owner, read from `GET /people`.

| Endpoint (`/api/people/...`)                                        | Purpose                                                                                            |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /overview`                                                     | People with their series and warnings, documents to review, rejected ones                          |
| `POST /reviews/:uploadId/approve`                                   | `{personId, accept: [fields]}`; `personId: null` adds a new person (409 on a tax code someone has) |
| `POST /reviews/:uploadId/reject`, `POST /reviews/:uploadId/reopen`  | Not anyone's ID document, and back to review                                                       |
| `PATCH /documents/:uploadId`                                        | `{status: 'lost' \| 'stolen' \| 'withdrawn' \| null}`                                              |
| `PATCH /people/:id`                                                 | Correct a person by hand; `residencePropertyId` links Residence to a house; `taxDependentOf`       |
| `DELETE /people/:id`, `POST /people/:id/merge`                      | Remove a person (documents back to review); merge `{from}`, a duplicate, into this person          |
| `GET /attention`                                                    | Counts of expired, expiring and to review, for the island hub                                      |
| `POST /people/:id/relations`, `DELETE /people/:id/relations/:other` | `{personId, kind}`: what the other person is to this one                                           |
| `GET /houses`                                                       | The houses of Home, for Residence (`available: false` when svc-home cannot be reached)             |
| `GET /documents/:uploadId/preview`                                  | The original file (from svc-ingestion)                                                             |

A database created before this area existed needs its schema and role: `npm run db:upgrade` (idempotent, `infra/postgres/upgrades/002-people-schema.sql`).

## Cars

Velo's zone (`/cars`, `mfe-cars` and `svc-cars`) keeps every car you have, as its registration certificate (carta di circolazione, the "libretto") describes it, with the documents that keep it on the road: insurance (RCA), road tax (bollo), revisione, and running costs from fuel to the mechanic. The model and every printed code (A, B, C.1, D.1, E, F.1, J, K, P.1, V.7… from EU Directive 1999/37/EC) are documented in the life-island-docs `cars/` folder; the same codes, with their meaning, are in `REGISTRATION_CODES` in `libs/contracts`.

**Car documents are read, not stored.** A car document is a document whose categories are, or sit under, `CAR_DOCUMENT`: `VEHICLE_REGISTRATION`, `CAR_INSURANCE`, `ROAD_TAX`, `VEHICLE_INSPECTION` or `VEHICLE_EXPENSE` (svc-ingestion's migration `0013`). Every template carries the car reference (`registration_number`, `vin`); the registration certificate also carries the car data, under keys that map to the model's English names (`engine_capacity_cc` is `engine.capacityCc`, code P.1). Numbers printed the Italian way (`1.242`, `119,5`) are read as numbers.

**Nothing changes a car on its own.** A new car document waits under **To review**:

- It is matched to a car by VIN, else by plate. A different VIN is always another car. No match: **A new car** is suggested, with everything its registration certificate prints.
- Against a matched car a registration certificate lists only what is new or different, each with its code and meaning, and a suggestion: take a new value; **check** a different make, VIN or first registration (those never change); take a different value from a newer certificate, keep yours from an older one. The other documents only file under the car.
- A receipt without a plate can only be filed under a car you pick. A plate you do not have may be a misread: you can still file it under one of your cars.
- **Approve** files the document (and creates the car if it is new); **Not a document of any car** sets it aside (you can review it again). Every decision is kept in `cars.reviews` with what each field was before.

**Versions.** The approved documents of each type form one series per car, numbered from the oldest: the newest is **Current** (or **Expired** once past its date), the older ones **Replaced by a newer one**. You can mark a version **Cancelled** (a policy you withdrew, for example). Expenses are not versioned: they are costs.

**One record, several documents.** An insurer sends one insurance as separate files (the policy, the certificate, the receipt of the premium), and you load each one on its own. Documents of the same car and type that print the same number (spaces and dashes aside) are one version: its dates, insurer and premium are read from all of them, the policy first. The review says when a document joins a record you have. On the version, each document shows what it is (**Policy**, **Certificate**, **Receipt**: read as `document_kind`, else guessed from its name); **Detach** takes one out into a version of its own, and **Attach another document…** puts in one whose number was misread or missing. Cancelling a version cancels all its documents. A payment counts once: the receipts of a record when it has any, else each distinct payment date and amount it prints, so the policy and the receipt of one premium are one cost, and two instalment receipts are two.

**Renewals** are worked out from the latest version of each series:

| Item         | Due                                                                                                   | Warns   |
| ------------ | ----------------------------------------------------------------------------------------------------- | ------- |
| Insurance    | The policy end (or the paid instalment's end); covered for 15 more days (art. 170-bis Cod. Ass.)      | 30 days |
| Road tax     | The end of the month after its expiry month; an exempt car never warns                                | 30 days |
| Revisione    | Within the month 4 years after first registration (B), then every 2 years from the last one (art. 80) | 60 days |
| Service      | The next service date or odometer reading on the last service receipt                                 | 30 days |
| Registration | A temporary registration's end (H)                                                                    | 30 days |

Levels are **ok**, **expiring**, **grace** (insurance past its end, still covered), **expired** and **missing** (no insurance or road tax on file, or a revisione that should have happened). Warnings of active cars sit at the top of the page and on the car.

**3D models.** As in Houses, the top of the page shows your cars in 3D, side by side: each is a little drawn car in its colour (read from the certificate's colour, Italian or English), until you load your own model on the car's **3D model** card. A single `.glb`, a `.gltf` with embedded buffers or an `.obj`, up to 50 MB, kept in svc-cars' own bucket (`CARS_S3_BUCKET`, default `cars-models`; uploads need the `S3_*` settings). Click a car, in 3D or on its label, to look at it.

**Costs.** Insurance, road tax, revisione and every expense (fuel, service, repair, tyres, parking, tolls, washing, fines…) are listed per car, newest first, with totals per year and kind; fuel shows its litres, and the last odometer reading is the car's.

| Endpoint (`/api/cars/...`)                                         | Purpose                                                                                         |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `GET /overview`                                                    | Cars with their series, renewals, costs and warnings, documents to review, rejected ones        |
| `POST /vehicles`                                                   | Add a car by hand: `{registrationNumber, label?}` (409 on a plate you have)                     |
| `PATCH /vehicles/:id`, `DELETE /vehicles/:id`                      | Correct a car (`label`, `status`, `values`); remove it (its documents go back to review)        |
| `POST /reviews/:uploadId/approve`                                  | `{vehicleId, accept: [fields], label?}`; `vehicleId: null` adds a new car (422 without a plate) |
| `POST /reviews/:uploadId/reject`, `POST /reviews/:uploadId/reopen` | Not a document of any car, and back to review                                                   |
| `PATCH /documents/:uploadId`                                       | `{status: 'cancelled' \| null}`, for every document of its version                              |
| `PUT /documents/:uploadId/group`                                   | `{attachTo: uploadId}` puts it in that document's version (same car and type); `null` detaches  |
| `PUT /vehicles/:id/model?filename=`, `GET`, `DELETE`               | The car's 3D model: the file is the request body; it replaces the one the car had               |
| `GET /documents/:uploadId/preview`                                 | The original file (from svc-ingestion)                                                          |

A database created before this area existed needs its schema and role: `npm run db:upgrade` (idempotent, `infra/postgres/upgrades/003-cars-schema.sql`).

## Work

Pachy's zone (`/work`, `mfe-work` and `svc-work`) keeps every **workplace** you have had as an entity, built from the work documents you upload: payslips (cedolini), evaluations and employment contracts. The model follows the life-island-docs `entities/` (workplace, employment, organization) and `payslips/` folders; the fields are `WORKPLACE_FIELD_DEFINITIONS` in `libs/contracts`.

**Documents.** The ingestion migration `0014` adds the payslip fields to the `PAYSLIP` template (employer tax code, employee code, hire date, level, monthly salary, base minimum, superminimum, seniority increments, gross, deductions, net…) and two new categories, `PERFORMANCE_REVIEW` (Evaluation) and `EMPLOYMENT_CONTRACT`. The fake parser reads the header of a LUL payslip (the Italian Libro Unico layout) offline, so the flow works without an API key.

**Review.** As in People and Cars, a document confirmed in Documents reaches svc-work and waits in the **Review** tab. svc-work finds its workplace by the employer's tax code, then by its name, and proposes changes field by field: accept the suggestion, keep the current value, or check it. A payslip older than the workplace's latest one does not overwrite newer data (it is marked outdated). **Approve** files it (and creates the workplace when it is new); **Not about my work** sets it aside. Every decision is kept in `work.reviews`.

**Copies.** Uploading the very same file again is stopped in Documents (same SHA-256, whatever its name). A copy with different bytes (downloaded again, re-exported, renamed) is parsed, then recognized in Work by what it is: a payslip by its workplace, month and kind, a CU by its workplace and year. **Review** flags it ("you already have the payslip for Dec 2024") so you can set it aside, and even if you approve it the statistics count it once (the first approved).

**Payslip kind.** Migration `0019` adds `payslip_kind` to `PAYSLIP`: `regular`, or a payslip that pays only an extra month, `thirteenth` (tredicesima), `fourteenth` (quattordicesima) or `other` (a bonus, arrears, a settlement). An extra payslip has the same month as the regular one but is not a copy of it: it counts in the year's gross and net (and in the "Of which extra pay" column), and stays out of the month-by-month chart and the salary changes. Payslips parsed before get the kind with **Parse again**.

**Overview.** What needs both payslips and evaluations: current pay and growth, the latest evaluation and the share of the year's gross its bonus made, a year-by-year table of pay next to scores and bonus, and a timeline, newest first, of what your documents show: hired and left, promotions, salary rises and cuts, seniority increments, evaluations, signed contracts, plus events you add by hand (awards, courses, certifications, projects).

**Payslips.** Current pay, growth, time since the last rise, take-home share and time off left; gross and net per month on a chart, and totals per year with the extra pay. Each **Certificazione Unica** (`CERTIFICAZIONE_UNICA`, from `0019`, filed under its workplace like a payslip) stands next to the payslips of its workplace and year: income against their taxable income, IRPEF withheld against their income tax, with the difference and the months without a payslip, so a missing or different payslip shows.

**Performance reviews.** Migration `0018` adds the score fields to `PERFORMANCE_REVIEW` (cycle, role, team, total and highest score, section and criteria scores as `Name: score` lines, bonus conversion and target, comments; evaluations parsed earlier get them with **Parse again**). The tab shows the latest score and its change, the score of each period stacked by section, the bonus target against what was paid per year, each criterion across periods (strongest, weakest, improving, dropping), a year table and every evaluation with its comments. A later form about the same period replaces the earlier one.

**Evaluation rules.** How an employer scores and pays is a document of its own, `EVALUATION_RULES` (also from `0018`): sections and their highest score, what each mark means, the score-to-bonus table, when each period is paid and who is eligible. Each rules document is filed under its workplace like any work document, so every company keeps its own, and a new version replaces the old one from its `effective_from` date (older versions stay listed). Each evaluation is read against the version in force on its date: the tab explains the marks, links the original file and says how many points the next bonus band needs. Nothing about one company's rules is in the code.

**Feedback.** **Give me a feedback** (or **Ask**, with a question of yours) sends a summary of your career (workplaces, events, pay, evaluations with their trends and each employer's rules; never tax codes, employee codes or addresses) to Claude (`ANTHROPIC_API_KEY`, model `WORK_FEEDBACK_MODEL`) and keeps the answer: a summary, strengths, watch-outs and suggestions. Without a key, an offline set of rules answers instead, and says so.

**Hiring platforms.** The platforms you signed up to (LinkedIn, Indeed, InfoJobs… or any other), with your profile link, the account you use, notes, a status and when you last updated your profile; one older than 180 days is flagged. Only `http(s)` links open.

| Endpoint (`/api/work/...`)                                            | Purpose                                                                                   |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `GET /overview`                                                       | Workplaces, timeline, stats, CUs, documents to review, rejected ones, platforms, feedback |
| `POST /workplaces`, `PATCH /workplaces/:id`, `DELETE /workplaces/:id` | Add a workplace by hand, correct it, remove it (its documents go back to review)          |
| `POST /reviews/:uploadId/approve`                                     | `{workplaceId, accept: [fields], label?}`; `workplaceId: null` adds a new workplace       |
| `POST /reviews/:uploadId/reject`, `POST /reviews/:uploadId/reopen`    | Not about my work, and back to review                                                     |
| `POST /events`, `DELETE /events/:id`                                  | A career event you add by hand                                                            |
| `POST /platforms`, `PUT /platforms/:id`, `DELETE /platforms/:id`      | Hiring platforms                                                                          |
| `POST /feedback`, `DELETE /feedback/:id`                              | Ask for career feedback (optional `question`), forget one                                 |
| `GET /documents/:uploadId/preview`                                    | The original file (from svc-ingestion)                                                    |

A database created before this area existed gets its schema and role from svc-work itself at startup, with the local defaults; `npm run db:upgrade` does the same (`infra/postgres/upgrades/004-work-schema.sql`).

## Studies

Iggy's zone (`/studies`, `mfe-studies` and `svc-studies`) is where you grow: it reads no documents, everything in it is what you record.

- **This week.** Your study time against the weekly goal (Settings → App settings → Studies), the streak of weeks at goal, your pace over the last 8 weeks, the hours so far and what you spent this year (courses, exams and subscription renewals). **Needs you** lists the reminders: a subscription about to renew, an exam ahead or missed, a certification expiring, a path behind its target date, and a nudge after some days with no study time. Each window is in Settings → Reminders (`studies.warn-days.*`, `studies.idle-days`), and the island's badge counts the dated ones (`GET /attention`). You log a session here, on a path step, a course or a topic; a chart shows the last 12 weeks by topic against the goal.
- **Learning paths.** `LEARNING_PATHS` in `libs/contracts` (`studies-paths.ts`): AI coding and tools, Beyond Angular, Docker, Kubernetes and infrastructure, Becoming a team leader, 3D for the web and Blender, all at beginner level. A path has stages, a stage has steps (learn, build, practice) with hours, what you will be able to do, and resources that link only to official docs, the authors' sites or well-known courses. You follow, pause or stop a path and set a target date; each step is Not started, Studying or Done, with your notes, and from the time you log Studies projects when you finish. The paths are code: a new resource or path is a pull request.
- **Courses and exams.** Courses on any platform, tied to a path step if you like, with progress, length, cost and the certificate link; exams and certifications with their date, cost and expiry (presets for KCNA, CKAD and others).
- **Training platforms.** Like Work's hiring platforms: Anthropic Academy, Udemy, Coursera, DeepLearning.AI, KodeKloud, Three.js Journey and more, filtered by topic and added in one click. A subscription keeps its price, period and renewal date, so you see its yearly cost and get a warning before it renews.
- **Study coach.** The AI tool `studies.study-coach` (Settings → AI tools) plans your week from the paths you follow, the steps in progress, your weeks against the goal, courses and exams, or answers your question. Off, or without `ANTHROPIC_API_KEY`, Life Island's own rules plan it: an exam within a month first, then the steps you are studying, then the next step of each path, within your hours.

| Endpoint                                                                                       | What it does                                                                           |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET /overview`                                                                                | Platforms, paths with your progress, courses, exams, sessions, stats, reminders, plans |
| `GET /attention`                                                                               | The island badge: reminders past and within their window                               |
| `POST /platforms`, `PUT /platforms/:id`, `POST /platforms/:id/opened`, `DELETE /platforms/:id` | Training platforms                                                                     |
| `POST /courses`, `PUT /courses/:id`, `DELETE /courses/:id`                                     | Courses                                                                                |
| `POST /certifications`, `PUT /certifications/:id`, `DELETE /certifications/:id`                | Exams and certifications                                                               |
| `POST /sessions`, `DELETE /sessions/:id`                                                       | Study time; a session on a step starts it and follows its path                         |
| `PUT /paths/:pathId`, `PUT /steps/:stepId`                                                     | Follow, pause or stop a path (`status: null`), its target; a step's status and notes   |
| `POST /plans`, `DELETE /plans/:id`                                                             | The study coach (optional `question` and `hours`)                                      |

A database created before this area existed gets its schema and role from svc-studies itself at startup, with the local defaults; `npm run db:upgrade` does the same (`infra/postgres/upgrades/006-studies-schema.sql`).
