# Life Island app

The Life Island app is where you use your data. It is a Native Federation **host** (`apps/shell`) that shows the island and loads each area of life from its own **remote** (`apps/mfe-<area>`) at runtime. Every area is backed by its own service (`apps/svc-<area>`), which owns its schema and builds what it knows from the documents you upload and confirm.

| Area                      | Remote              | Service             | Status |
| ------------------------- | ------------------- | ------------------- | ------ |
| 730 & taxes               | `mfe-tax730`        | `svc-tax730`        | Live   |
| Home, Bills               | `mfe-home`          | `svc-home`          | Live   |
| People & IDs              | `mfe-people`        | `svc-people`        | Live   |
| Cars                      | `mfe-cars`          | `svc-cars`          | Live   |
| Work                      | `mfe-work`          | `svc-work`          | Live   |
| Groceries                 | `mfe-groceries`     | `svc-groceries`     | Live   |
| Studies                   | `mfe-studies`       | `svc-studies`       | Live   |
| Agenda                    | `mfe-agenda`        | `svc-agenda`        | Live   |
| Money                     | `mfe-money`         | `svc-money`         | Live   |
| Health                    | `mfe-health`        | `svc-health`        | Live   |
| Contracts & subscriptions | `mfe-subscriptions` | `svc-subscriptions` | Live   |
| Travel                    | `mfe-travel`        | `svc-travel`        | Live   |
| Fitness                   | `mfe-fitness`       | `svc-fitness`       | Live   |
| Dreams                    | `mfe-dreams`        | `svc-dreams`        | Live   |

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
npx nx serve svc-agenda       # every date of every area, reminders, week brief (port 3011)
npx nx serve mfe-agenda       # the Agenda remote (port 4210)
npx nx serve svc-money        # accounts, movements, budgets (port 3012); mfe-money on 4211
npx nx serve svc-health       # check-ups, visits, medicines, results (port 3014); mfe-health on 4213
npx nx serve svc-subscriptions # contracts and renewals (port 3015); mfe-subscriptions on 4214
npx nx serve svc-travel       # trips (port 3017); mfe-travel on 4216
npx nx serve svc-fitness      # workouts, body, events (port 3018); mfe-fitness on 4217
npx nx serve svc-dreams       # dreams, questions, small steps, check-ins (port 3019); mfe-dreams on 4218
npx nx serve svc-groceries    # receipts and the shopping list (port 3003); mfe-groceries on 4202
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

`apps/shell/src/app/island/` draws the island with three.js: a sandy shore with bays and headlands (`coastline` in `island-props.ts`), shallow water and foam, a mountain with a waterfall, a wood of palms, trees, bushes and flowers, boats at sea and clouds, and a zone per area with its own landmark on a plinth. Shadows fall from the sun at the top-left; at night (dark theme) the windows light up and the clouds stay moonlit (they are never fogged). The sea reaches past the fog, and the canvas fades into the page only near its edges, so the island and its clouds keep the middle of the frame; on narrow screens the view widens (`islandFov`) so the whole island fits across.

- **The models are made in Blender.** `tools/island-models/build_island_kit.py` models every landmark, prop and the peak and exports one glTF binary, `apps/shell/public/island/island-kit.glb` (about 850 KB, loaded after the first frame). Run it with Blender's Python module (`pip install bpy`) or `blender --background --python …` after changing a model, and commit the `.glb`.
- **The kit follows the theme.** Its materials named after a palette slot (`tint`, `foam`, `sand`, `grass`, `rock`, `trunk`, `leaves`, `water`, `window`) are repainted from the design system's tokens (`--island-*` in `island-view.css`); `tint` takes the zone's character accent. Other materials (gold, flowers, tyres) keep their colour.
- **The areas' models too.** `tools/scene-models/build_area_kits.py` (sharing `kit.py` with the island) models the Cars garage (a parking spot and a car per shape: hatchback, saloon, estate, SUV, people carrier, coupé, van, motorbike, from the registration's J, J.1 and J.2), the Houses of Home (a lot and a building per property type) and the Dreams stone. Each kit lives in its area's `public/` folder and loads next to the area's code (`new URL(…, import.meta.url)`).
- **It always works.** The island first stands in primitives and swaps in the models once the kit has loaded; if it never loads, the primitives stay.
- **Where the scenery goes** is pure and seeded (`islandProps`), tested so that nothing stands on a zone and nothing at sea or in the sky is in front of the island.

- Labels never pile up: a label whose zone faces away, or that would cover a nearer one, hides until you hover or focus its zone (`visibleLabels` in `island-layout.ts`); long names have a short `islandName`, and below 480 px only the emblem shows.
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

A confirmed expense files the document it was read from as its invoice (or as its payment proof, when it was read from a transfer receipt). You file payment proofs yourself from the 730 screen: the picker ranks your documents by same amount, the supplier's name, a date within 90 days and payment words, and shows why. A year counts as "the year the expenses were paid": expenses of 2025 go in the 730/2026.

**Invoices and payments are paired, so each expense counts once.** Every approved document becomes an expense, so an invoice and the bank receipts of its transfers would count two or three times. `expense-pairing.ts` pairs them when the dossier is read: the "ricevuta" and "dettaglio" of one transfer (same year, amount, a few days apart, the same supplier named) become one payment, and an invoice takes the payments of its year, within 180 days, that name its supplier and add up to it (one or several, within 1% and at most 10 € for fees). Only the invoice (or the first receipt of a transfer with no invoice) is counted; the others show under it as "Same expense, counted once" with their documents. Automatic pairs are flagged to review: you confirm them, split one ("Not the same", stored as `pairing = SEPARATE`), or remove an expense that should not be there: its documents stay in your archive, ready to file with the right expense. Your decision always wins over the guess.

**Who was paid, not the bank.** A transfer receipt is issued by the bank, so an expense read from one would show "Banca Widiba" as its issuer. The dossier shows instead the supplier: the issuer of another expense of its group, or of a document filed with it as invoice (its `issuer` field). Every field read from a document can be corrected from the expense's Edit form.

| Endpoint (`/api/tax730/...`)              | Purpose                                                                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `GET tax-years`                           | Totals per year and type, with how many expenses miss an invoice or a payment, the estimated deductions and the spending by month         |
| `GET tax-years/:year`                     | The year's expenses with their documents, and the year's own documents                                                                    |
| `POST/DELETE tax-years/:year/attachments` | File or remove a document of the whole year                                                                                               |
| `PATCH expenses/:id`                      | Correct any field: issuer, invoice no., date (within its tax year), amount, type, 730 row, paid traceably, beneficiary, description, note |
| `DELETE expenses/:id`                     | Remove an expense from the 730; its documents stay, free to file with another expense                                                     |
| `POST/DELETE expenses/:id/attachments`    | File or remove an invoice, payment proof or other document                                                                                |
| `PUT expenses/:id/pairing`                | Pair with another expense (`{ pairedWith }`) or keep it apart (`{ pairedWith: null }`)                                                    |
| `DELETE expenses/:id/pairing`             | Forget your decision: the expense is paired automatically again                                                                           |
| `POST expenses/:id/pairing/confirm`       | Confirm the payments paired automatically with this expense                                                                               |
| `GET documents?search=&forExpense=`       | Your documents, ranked for an expense when `forExpense` is set                                                                            |
| `GET documents/:uploadId/preview`         | The original file, streamed from `svc-ingestion`                                                                                          |
| `GET exports/deductions.xlsx?year=`       | "Riepilogo detrazioni": a `Detrazioni YYYY` and a `Riepilogo YYYY` sheet per year                                                         |
| `GET tax-years/:year/export.zip`          | The folder for the commercialista                                                                                                         |

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

### Your tax, explained

The 730 page has two views of a year (`?view=` in the URL): **Your tax, explained** (the default) and **Expenses and documents**. What the 730 is, the rates and caps of each expense and the glossary are in the page's **Guide** (`?guide=basics|rates|glossary`), see [Guides](#guides-reading-matter-on-demand). The explanations are drawn in the browser from the year's return (`taxReturn` of `GET tax-years`): the filed figures when a return is uploaded, the forecast otherwise, and a Filed/Forecast switch when both exist. `apps/mfe-tax730/src/app/explain/explain.ts` holds the arithmetic (unit-tested), the cards only draw it:

- **How your tax is calculated**: income, deductible charges, taxable income, the gross tax bracket by bracket (`irpefByBracket` in `libs/contracts`, on the brackets of `irpefBrackets`, five until 2021), the credits, net tax, withholdings and advances, down to the result, each step in plain words, then a waterfall from the gross tax to the result.
- **Credit or debit**: what the result means with a 730 (July payslip) or with Redditi PF, and the F24s of the year: the credit pays the balance and the next advances first, then what you still pay and the credit left to carry over or claim back.
- **Where each €100 goes**: IRPEF paid, tax cancelled by credits, what stays; effective rate against the top bracket; the credits by kind against the gross tax, with what did not fit (incapienza) and is lost.
- **What would it be worth?**: an amount of health, other 19%, renovation or pension fund spending against the year's figures: what it saves this year, over the instalments, and what would be lost.
- **Your tax over the years**: gross tax split into paid, cancelled and lost per year with the effective rate, the result of each return on a credit/debit axis, and the table. Forecast years are striped.

IRPEF only: the surtaxes and flat-rate (forfettario) income in quadro LM are named but not computed.

## Home and Bills

Two zones of the island, one area: **Home** (Bronto, `/home`) keeps your properties and the works done on them; **Bills** (Stego, `/home/bills`) is the dashboard of their electricity, gas, water and internet. Both are served by `mfe-home` and `svc-home`, because they share the properties. The bar at the top of both switches view and home: **All homes** (together), one home, or **Side by side** on Bills. The choice lives in the URL (`?property=<id>&split=1`).

| Table                 | What it holds                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `home.properties`     | Your homes (Via Ponzilovo and Via dei Bandi to start), with the words and supply codes that recognise their bills and a fixed chart colour |
| `home.documents`      | A copy of your documents and their confirmed categories and fields, kept from `upload.*` events                                            |
| `home.category_tree`  | The category hierarchy, kept from `category.changed`, so a subcategory of `GAS_BILL` still counts as gas                                   |
| `home.bill_overrides` | Your corrections: another home, another utility, or "not a bill"                                                                           |
| `home.works`          | Renovations, repairs, maintenance and improvements: where, who, when, estimate and final cost                                              |
| `home.work_documents` | Documents filed with a work (invoices, quotes, photos), by id                                                                              |

**Bills are read, not stored.** A bill is a document whose confirmed categories include `ELECTRICITY_BILL`, `GAS_BILL`, `WATER_BILL` or `INTERNET_BILL` (or a subcategory, or a plain `BILL` that prints a consumption, or one whose category id or fields say internet: `TELECOM_BILL`, a `migration_code`). Amount, period, dates, consumption and provider come from its template fields, so fixing a field in the documents app fixes the dashboard. A bill without an amount is left out. Its home is, in order: the one you picked; the one whose POD/PDR it prints; the one whose words (e.g. `ponzilovo`) appear in its supply address; the one whose category the document has; the one whose words appear in another address or the title. The address a bill is mailed to (customer, billing, residence) never counts: the bills of one home are often sent to another. Two homes matching equally leave it unassigned, and the dashboard asks you to assign it. When you assign a bill by hand, its supply point moves to that home, and every bill of it follows.

**Supply points and supply contracts.** The POD (electricity) and PDR (gas) name the meter: they belong to the home and never change with the supplier, so they are what a home's supply codes hold. The customer code (codice cliente) is given by the supplier to one supply contract: electricity and gas are separate contracts with separate codes, even with one supplier; an offer change with the same supplier keeps the code; a new supplier, a subentro after the meter was closed, or a voltura to another holder start a new contract with a new code. So the house review never proposes a customer code, a bill put on a home by hand never teaches it one, and the bill sync takes out of the homes any customer code an older review left there. `GET /supply-points` lists each supply point's contracts, newest first: the one billed last is `ACTIVE`, the earlier ones `ENDED`, each with the days it was billed for.

**Every home is a property category.** At startup, and when you add a home, svc-home links each home to a `PROPERTY` category of the documents app: one whose title or id names the home (`Via Ponzilovo`, `VIA_PONZILOVO`) or its address, or a new one named by the home's address (`Via dei Bandi, 10`) created through svc-ingestion's `POST /categories` with a description that tells the AI to assign it by the supply address. So the review inbox offers every home under "Property / location" and the parser can assign it. At startup it also tidies that dimension through svc-ingestion's API: categories that are one home merge into the one with its full address (`Via Ponzilovo` into `Via Ponzilovo 9`, its documents follow), a street-only name gets the street number, and a car filed as a place (`Fiat Punto EJ560PZ`, by its plate) moves to Subject. A category that names two homes is left alone. The parser no longer proposes a property for a car or for a street that already has one. Turn it off with `HOME_LINK_PROPERTY_CATEGORIES=false`.

**Internet is a bill like the others, with no meter.** An internet bill (`INTERNET_BILL`) is a flat fee for a line: its supply point is the line (its phone number, else its migration code, so a new provider that keeps the number is a new contract on the same line), its contract is the provider × customer code on that line with the offer and the day it started (`Internet 200 dal 18/06/2020`), and its due date, payable and bank matching work as for electricity. It counts in the month its fee pays for (the _periodo abbonamento_, usually the month after the traffic it bills), and its fee (`subscription_fee`) is kept apart from the extras (calls, options, router installments, late fees). It has no consumption, so it is left out of the use charts and the use columns.

**One price for every bill.** What you pay for what you get is read the same way for every utility: € per kWh, Smc or m³ (amount over consumption, so a cold winter is not a price rise) and the monthly fee of internet (`billUnitPrice`, libs/contracts). `GET /supply-points` gives each contract its latest `price`, its unit and its last `priceChange`: a fee that changed from one bill to the next, or a price per unit that moved by 15% or more against the median of the three bills before. A rise in the last 60 days on the contract a supply point is billed under now is an item of Home's `GET /attention` (`price-rise`), so the Agenda and the island badge show it: a supplier that changes its terms lets you leave without penalties.

The Bills dashboard, by priority like a car's page: one row of filters (period presets or any months, utilities, month/quarter/year, and whether a bill counts over the months it covers or in the month it was issued) scopes everything under it. At the top, the total against the period before and the homes in 3D, beside **What's next**: one line per utility, most urgent first (a bill past its due date and not paid, a bill to pay, months with no internet bill, a price up 10% or more on a year ago), plus the bills with no home; each opens its card. Then a tile per utility, a bar of sections, and one card per utility (`home-bill-utility-card`): its next step with its button (open the bill, load the missing bills, compare offers on ARERA's Portale Offerte), what it cost, used and costs per unit in the period, the offer each supply point is on with its supplier and since when, its price and its use over time (for internet the fee and the extras on top), an **About it** box with the rules (how often, the price, changing supplier, how long to keep the bills, if late) and its latest bills. Then Spending (cost over time, stacked by utility or the homes side by side plus one chart per home on a shared scale; the split by utility, home and provider), Over the years (year over year, totals grouped any way) and every bill with its corrections. Providers are companies: a bill counts under the company it is filed under, so "Wind Tre S.p.A.", "WINDTRE" and "Wind Tre S.p.A. con Socio Unico" are one provider. Every chart has a table view or a table beside it.

Chart colours follow the entity, never its rank: electricity, gas, water, internet and the first three homes have fixed hues (`--viz-*` tokens, checked for colour-blind separation in both themes); a fourth home shares the "other" grey.

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

Velo's zone (`/cars`, `mfe-cars` and `svc-cars`) keeps every car you have, as its registration certificate (carta di circolazione, the "libretto") describes it, with the documents that keep it on the road: insurance (RCA), road tax (bollo), revisione, the CNG cylinders of a methane car, and running costs from fuel to the mechanic; and who owns it, from its certificato di proprietà and every change of owner. The model and every printed code (A, B, C.1, D.1, E, F.1, J, K, P.1, V.7… from EU Directive 1999/37/EC) are documented in the life-island-docs `cars/` folder; the same codes, with their meaning, are in `REGISTRATION_CODES` in `libs/contracts`.

**Car documents are read, not stored.** A car document is a document whose categories are, or sit under, `CAR_DOCUMENT`: `VEHICLE_REGISTRATION`, `CAR_INSURANCE`, `ROAD_TAX`, `VEHICLE_INSPECTION` or `VEHICLE_EXPENSE` (svc-ingestion's migration `0013`), `CNG_CYLINDER_INSPECTION` (migration `0032`) or `VEHICLE_OWNERSHIP` (migration `0034`). Every template carries the car reference (`registration_number`, `vin`); the registration certificate also carries the car data, under keys that map to the model's English names (`engine_capacity_cc` is `engine.capacityCc`, code P.1). Numbers printed the Italian way (`1.242`, `119,5`) are read as numbers.

**One page, by priority.** A car's page reads top down by what needs you: the car (status, km) beside **What's next**, every renewal of the car most urgent first (late, grace, suspended, due soon, missing, in order), each opening the card it is about; a bar of sections kept in view (Documents, To keep, Fines and costs, Insurance, Car details); then **Documents**, one card per kind; **Documents to keep**; fines, costs, km and tyres; insurance history and quotes; and the carta di circolazione with every code and the 3D model last, for reference.

**Every car document looks the same.** Insurance, bollo, revisione, CNG cylinders, the carta di circolazione and the ownership each have one card (`cars-doc-card`) in the same order: the next step (its date with the verb that fits: renew, pay, book, requalify; days left; what to do when due or late; the button to load the new one), what the latest one says (the facts read from it, `CarDocumentVersionDto.facts`), the kind's own content (the cylinders of a methane car, the history of owners), an **About it** box in the guide's blue (how often, which date counts, where to keep it and for how long, what happens if late, and the rules it comes from: `CAR_DOCUMENT_GUIDES` in `libs/contracts`), and every version with attach, detach and cancel. Each kind has one icon, on its card and in **What's next**: shield (insurance), receipt (bollo), clipboard (revisione), flame (CNG cylinders), car (carta di circolazione), user (ownership).

**Bollo and revisione as printed** (migration `0033`). A tobacconist's bollo receipt prints the last month it covers before its months (`APR 2020 12 mesi`), the tax, interest, penalty and fee apart, the payer's codice fiscale and the payment date; the reading keeps all of them, and shows a penalty or interest only when there is one (it was paid late). A Certificato di revisione prints numbered boxes: (3) date, (4) km, (5) category, (6) deficiencies, (7) outcome (REGOLARE, RIPETERE, SOSPESO), (8) the next one by, and its codice antifalsificazione, kept as its number.

**Nothing changes a car on its own.** A new car document waits under **To review**:

- It is matched to a car by VIN, else by plate. A different VIN is always another car. No match: **A new car** is suggested, with everything its registration certificate prints.
- Against a matched car a registration certificate lists only what is new or different, each with its code and meaning, and a suggestion: take a new value; **check** a different make, VIN or first registration (those never change); take a different value from a newer certificate, keep yours from an older one. The other documents only file under the car.
- A receipt without a plate can only be filed under a car you pick. A plate you do not have may be a misread: you can still file it under one of your cars.
- **Approve** files the document (and creates the car if it is new); **Not a document of any car** sets it aside (you can review it again). Every decision is kept in `cars.reviews` with what each field was before.

**Versions.** The approved documents of each type form one series per car, numbered from the oldest: the newest is **Current** (or **Expired** once past its date), the older ones **Replaced by a newer one**. You can mark a version **Cancelled** (a policy you withdrew, for example). Expenses are not versioned: they are costs.

**One record, several documents.** An insurer sends one insurance as separate files (the policy, the certificate, the receipt of the premium), and you load each one on its own. Documents of the same car and type that print the same number (spaces and dashes aside) are one version: its dates, insurer and premium are read from all of them, the policy first. The review says when a document joins a record you have. On the version, each document shows what it is (**Policy**, **Certificate**, **Receipt**: read as `document_kind`, else guessed from its name); **Detach** takes one out into a version of its own, and **Attach another document…** puts in one whose number was misread or missing. Cancelling a version cancels all its documents. A payment counts once: the receipts of a record when it has any, else each distinct payment date and amount it prints, so the policy and the receipt of one premium are one cost, and two instalment receipts are two.

**Renewals** are worked out from the latest version of each series:

| Item          | Due                                                                                                   | Warns   |
| ------------- | ----------------------------------------------------------------------------------------------------- | ------- |
| Insurance     | The policy end (or the paid instalment's end); covered for 15 more days (art. 170-bis Cod. Ass.)      | 30 days |
| Road tax      | The end of the month after its expiry month; an exempt car never warns                                | 30 days |
| Revisione     | Within the month 4 years after first registration (B), then every 2 years from the last one (art. 80) | 60 days |
| CNG cylinders | The due month on the latest cylinder label; see **CNG cylinders** below                               | 60 days |
| Service       | The next service date or odometer reading on the last service receipt                                 | 30 days |
| Registration  | A temporary registration's end (H)                                                                    | 30 days |

Levels are **ok**, **expiring**, **grace** (insurance past its end, still covered), **expired**, **missing** (no insurance or road tax on file, or a revisione that should have happened) and **suspended** (the insurance of a laid-up car). Warnings of active cars sit at the top of the page and on the car.

**CNG cylinders.** Every car whose fuel (P.3) is CNG (`cng`, `petrol_cng`), and any car with a cylinder label on file, has a **CNG cylinders** card (`VehicleDto.cng`, worked out by `car-cng.ts`) and a `cng_cylinders` renewal, which reaches the Agenda with the new label as its proof. Its cylinders have to be requalified (the "revisione delle bombole") by a workshop of the Fondo Bombole Metano, apart from the car's revisione:

| Cylinders                               | Requalified                                                         | Rule                                   |
| --------------------------------------- | ------------------------------------------------------------------- | -------------------------------------- |
| UNECE R110, CNG-1 to CNG-3              | Every 4 years; the first check is visual                            | DM 13 maggio 2022 n. 144, art. 2 c. 2  |
| UNECE R110, CNG-4 on M1 and N1 vehicles | Every 4 years, unless the maker says otherwise (2 before July 2022) | DM 144/2022, art. 2 c. 3               |
| National approval (DGM)                 | Every 5 years                                                       | The earlier rules, kept by art. 2 c. 1 |
| Any R110 cylinder                       | Replaced at the end of life its maker marks, at most 20 years       | DM 144/2022                            |

The workshop applies a label (cartellino) on the car with, per cylinder, its litres, maker, serial number and due month (scadenza). The due date is the last day of the earliest month printed on the latest label; without one, 4 years (5 for national cylinders) after the month applied; with no label at all, an estimate of 4 years after first registration (B), and **missing** once that is past. An end of life (printed, or 20 years from a printed manufacture month) earlier than that wins. Serial numbers that change from one label to the next show as **Cylinders exchanged**. The template reads up to four cylinders (`cylinder_1_…` to `cylinder_4_…`). The rules, with their sources, are the **CNG cylinders** topic of the Cars guide (`?guide=cng`).

**Ownership.** The carta di circolazione says who may drive the car; who owns it is recorded at the PRA (ACI), and proved by the certificato di proprietà (paper until October 2015, digital since: a receipt with an access code, the ID CDPD). `VEHICLE_OWNERSHIP` (migration `0034`) reads it, and the papers of a change of owner (passaggio di proprietà): the PRA's receipt (attestazione di presentazione formalità) and the sale (atto di vendita). Each is matched to the car by plate or VIN like any car document, and the AI tells its kind (`document_kind`: `certificate`, `transfer`, `sale`, `other`). Its card sits beside the libretto (`VehicleDto.ownership`, worked out by `car-ownership.ts`):

- The owners and the day they became owners (the sale, else the certificate's date), the owners before them as the certificate counts them, the certificate's number and access code (handed to the buyer when you sell), and any lien (fermo amministrativo, ipoteca) as a warning to clear before a sale.
- **History of owners**, from the first registration (B): every document that records a sale or names other owners than the one before is a change of owner; a certificate reissued to the same owner (a lien cancelled) is not.
- When the libretto's holder (C.1) is not among the owners (names compared whatever their order, case and accents), it says the carta di circolazione has to follow, with a link to its card.
- It has nothing to renew, so a car without one is not a step to take: since 2020 the Documento Unico holds the ownership too (it stays a `VEHICLE_REGISTRATION`).
- What a change of owner cost (the IPT and fees) counts among the costs as **Change of owner**.

**Laid up.** A car parked and unused, its insurance suspended until you drive it again, has the status **Laid up, insurance suspended**. Its insurance stops warning and becomes a standing **Do not use** warning (with the RCA suspended it can be neither driven nor parked on a public road); its bollo is still owed and still warns (and reaches the Agenda), and so do its fines. Its revisione and service stop warning until it is back in use.

**Documents to keep.** Each car's **Documents to keep** card (`archive` in `VehicleDto`, worked out by `car-archive.ts`) says what goes in the car, what stays at home and until when, and what can go:

| Folder (in the downloads) | Kept                                                                                                                                                                                                          | In the car                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 00 - Libretto             | The latest carta di circolazione; older ones can go                                                                                                                                                           | The original (art. 180 CdS); the scan is not printed           |
| 01 - Proprietà            | Every certificato di proprietà and the papers of every change of owner, as long as you have the car: the latest proves who owns it, the older ones from which day fines and bollo were no longer the seller's | Never: left in a stolen car, it makes a fraudulent sale easier |
| 02 - Assicurazione        | The policy in force (also in its 15 days of grace), or the latest one; a laid-up car's suspended policy (it is needed to reactivate it); older policies can go, unless a claim on them is still open          | The certificate of the policy in force (a printout is fine)    |
| 03 - Bollo                | Every receipt until the Regione can no longer claim it: 31 December of the 3rd year after the year it was due (5th in Piemonte); the latest always. A notice about a year restarts its 3 years                | Never                                                          |
| 04 - Revisione            | The latest; older ones only for the km history                                                                                                                                                                | No: the outcome is on the libretto and on record               |
| 05 - Bombole metano       | The latest cylinder label, until the next requalification; older ones can go                                                                                                                                  | No: the label is fixed on the car, so it is only checked       |
| 06 - Manutenzione         | Every service, repair, tyre and body work receipt, as long as you have the car                                                                                                                                | No                                                             |
| 07 - Multe                | An unpaid fine; a paid one until 5 years from the violation (art. 28 L. 689/1981)                                                                                                                             | No                                                             |
| 08 - Altre spese          | Accessories and other purchases for the 2-year legal warranty; fuel, tolls, parking and washing can go                                                                                                        | No                                                             |

The originals that cannot be printed (libretto and the driver's licence, art. 180 CdS) head the in-car list; a car with CNG cylinders adds its label, to check that it is on the car. Three downloads, in Italian like the 730's: **Files for the car** (`in-car.zip`, every file the law wants in the car that can be printed, exactly as it was loaded), **Excel summary** (`documents.xlsx`, "Riepilogo documenti": every document as an Excel table with a green ✓ or red ✗ for in the car and to keep, until when and why, and an **In auto** checklist sheet) and **Archive** (`archive.zip`, everything worth keeping, one folder per kind, with the summary). Claims (sinistri) have no document type yet: keep their papers until the claim is closed.

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
| `GET /vehicles/:id/exports/in-car.zip`                             | The files to keep in the car, as they were loaded                                               |
| `GET /vehicles/:id/exports/documents.xlsx`                         | "Riepilogo documenti": every document, in the car or not, kept until when and why               |
| `GET /vehicles/:id/exports/archive.zip`                            | Every document worth keeping, one folder per kind, with the summary                             |

A database created before this area existed needs its schema and role: `npm run db:upgrade` (idempotent, `infra/postgres/upgrades/003-cars-schema.sql`).

## Work

Pachy's zone (`/work`, `mfe-work` and `svc-work`) keeps every **workplace** you have had as an entity, built from the work documents you upload: payslips (cedolini), evaluations and employment contracts. The model follows the life-island-docs `entities/` (workplace, employment, organization) and `payslips/` folders; the fields are `WORKPLACE_FIELD_DEFINITIONS` in `libs/contracts`.

**Documents.** The ingestion migration `0014` adds the payslip fields to the `PAYSLIP` template (employer tax code, employee code, hire date, level, monthly salary, base minimum, superminimum, seniority increments, gross, deductions, net…) and two new categories, `PERFORMANCE_REVIEW` (Evaluation) and `EMPLOYMENT_CONTRACT`. The fake parser reads the header of a LUL payslip (the Italian Libro Unico layout) offline, so the flow works without an API key.

**Review.** As in People and Cars, a document confirmed in Documents reaches svc-work and waits in the **Review** tab. svc-work finds its workplace by the employer's tax code, then by its name, and proposes changes field by field: accept the suggestion, keep the current value, or check it. A payslip older than the workplace's latest one does not overwrite newer data (it is marked outdated). **Approve** files it (and creates the workplace when it is new); **Not about my work** sets it aside. Every decision is kept in `work.reviews`.

**Copies.** Uploading the very same file again is stopped in Documents (same SHA-256, whatever its name). A copy with different bytes (downloaded again, re-exported, renamed) is parsed, then recognized in Work by what it is: a payslip by its workplace, month and kind, a CU by its workplace and year. **Review** flags it ("you already have the payslip for Dec 2024") so you can set it aside, and even if you approve it the statistics count it once (the first approved).

**Payslip kind.** Migration `0019` adds `payslip_kind` to `PAYSLIP`: `regular`, or a payslip that pays only an extra month, `thirteenth` (tredicesima), `fourteenth` (quattordicesima) or `other` (a bonus, arrears, a settlement). An extra payslip has the same month as the regular one but is not a copy of it: it counts in the year's gross and net (and in the "Of which extra pay" column), and stays out of the month-by-month chart and the salary changes. Payslips parsed before get the kind with **Parse again**.

**The page, by priority** (like Cars and Bills). **Overview** shows your current job (role, level, how long you have been there, monthly salary, the latest payslip to open or download) beside **What's next** (`next-steps.ts`: documents to review, a payslip missing, a payslip that did not add up, a CU that differs from the payslips, the pension fund's notice, statements and room before 31 December, then the ideas: a talk about a rise after 24 months, time off left in the last months of the year, stale hiring profiles and applications), each step opening the place where it is done. Three tiles sit above the tabs (latest net against the month before, gross this year against the same months of last year, time since the last rise), each opening its tab. Seven tabs follow, one question each: **Overview** (the job and What's next), **Payslips** (the grid, the CU, the CCNL check, why your net changed), **Pay and taxes**, **Career** (workplaces, timeline, evaluations), **TFR and pension**, **Job search** (tools, applications, feedback, platforms) and **To review**. An old link to a tab (`?tab=analysis`) or a block (`#work-pension`) opens the tab the block lives in (`VIEW_OF`) and scrolls to it. In Career, **workplaces** are compact cards (level, time there, how many payslips and other documents), and the job card links to them; **Details** opens a workplace in a dialog, with its values, its contracts, evaluations and CUs to open or download, **Edit** and **Remove** (`?workplace=<id>` opens it from anywhere on the island).

**What needs you, on the island.** svc-work's `GET /attention` lists, besides each document to review, the payslips missing in the last 12 months (one `payslip-missing` item, the months named) and each CU of the last two years that differs from the payslips (`cu-differs`), both opening Payslips (`payslip-attention.ts`, from the same `payslipYears` of `libs/contracts` the page draws). A year with no document between two that have some counts as missing, not as a year you did not work.

**Guide.** The explanations live in the page's **Guide** (`?guide=payslip|cu|tfr|pension|reviews`, `work-guide.ts`): a payslip line by line, the CU and what to do when it differs, the TFR (how it is set aside, revalued, advanced and taxed), the pension fund, and how your evaluation marks work with tips for the review meeting. The sections keep one line and a link to the topic.

**Payslips, month by month.** `payslipYears` (`libs/contracts`, `work-payslips.ts`) lays each year out as twelve slips: net and gross, **Received** when Money matched it in the bank, what to check (a value not read, a CCNL check that failed), the original file to **Open** or **Download**, the tredicesima and other extra payslips on their month, and **Load it** (the documents app, set for that month) for a month a job owed and you do not have: from the hire date or first payslip to the end date, or to the month due now (the month before from the 15th). Welfare a payslip credits outside its net (a premio di risultato converted to welfare, meal vouchers, flexible benefits: its `welfare_credits`) shows on its month in the info tone, never as pay, with the evaluation it most likely rewards (the latest one before it, within 180 days), and the year's welfare beside its gross and net. Beside the year, its **Certificazione Unica** against the payslips. **All of 2026** downloads the year's payslips and CU in one zip, named so they sort by month (`2026-10 - Cedolino - Acme.pdf`).

**Overview.** What needs both payslips and evaluations: current pay and growth, the latest evaluation and the share of the year's gross its bonus made, a year-by-year table of pay next to scores and bonus, and a timeline, newest first, of what your documents show: hired and left, promotions, salary rises and cuts, seniority increments, evaluations, signed contracts, plus events you add by hand (awards, courses, certifications, projects).

**Payslips.** Current pay, growth, time since the last rise, take-home share and time off left; gross and net per month on a chart, and totals per year with the extra pay. Each **Certificazione Unica** (`CERTIFICAZIONE_UNICA`, from `0019`, filed under its workplace like a payslip) stands next to the payslips of its workplace and year: income against their taxable income, IRPEF withheld against their income tax, with the difference and the months without a payslip, so a missing or different payslip shows.

**Performance reviews.** Migration `0018` adds the score fields to `PERFORMANCE_REVIEW` (cycle, role, team, total and highest score, section and criteria scores as `Name: score` lines, bonus conversion and target, comments; evaluations parsed earlier get them with **Parse again**). The tab shows the latest score and its change, the score of each period stacked by section, the bonus target against what was paid per year, each criterion across periods (strongest, weakest, improving, dropping), a year table and every evaluation with its comments. A later form about the same period replaces the earlier one.

**Evaluation rules.** How an employer scores and pays is a document of its own, `EVALUATION_RULES` (also from `0018`): sections and their highest score, what each mark means, the score-to-bonus table, when each period is paid and who is eligible. Each rules document is filed under its workplace like any work document, so every company keeps its own, and a new version replaces the old one from its `effective_from` date (older versions stay listed). Each evaluation is read against the version in force on its date: the tab explains the marks, links the original file and says how many points the next bonus band needs. Nothing about one company's rules is in the code.

**Feedback.** **Give me a feedback** (or **Ask**, with a question of yours) sends a summary of your career (workplaces, events, pay, evaluations with their trends and each employer's rules; never tax codes, employee codes or addresses) to Claude (`ANTHROPIC_API_KEY`, model `WORK_FEEDBACK_MODEL`) and keeps the answer: a summary, strengths, watch-outs and suggestions. Without a key, an offline set of rules answers instead, and says so.

**Pension fund.** The **Pension fund** tab follows your fondo pensione (previdenza complementare), next to the **TFR** tab and its company-or-fund comparison. Its Guide topic explains in plain words how a fund works (who pays in, the deduction, CU and 730, investment lines, taking money out early, retirement, what changed in 2026); the section keeps the tools: your funds (`work.pension_funds`, with the day you first joined, which sets the 15% to 9% tax at the end), what each year's payslips paid in (yours, the employer's, the TFR) plus your own transfers (`work.pension_payments`) against the yearly deduction limit (`pensionDeductionLimit`: €5,164.57, €5,300 from 2026), the estimated IRPEF saved, the room left this year with what a transfer before 31 December would save, rigo E27 of the next 730 (column 1 the CU's punto 412, column 2 punto 413 plus your transfers), and the "contributi non dedotti" notice due by 31 December of the following year (`work.pension_notices`). The value of your position comes from the fund's statements (`work.pension_statements`): typed in, or read from a document filed as `PENSION_FUND_STATEMENT` (svc-ingestion `0027`, which also adds punti 412 and 413 to the CU) and confirmed in the tab, once per document (`source_upload_id`), or set aside (`work.pension_dismissed_documents`). svc-work answers `GET /deadlines` with the top-up day and the pending notices, so they show in the Agenda. The Payslips tab shows each year's pension fund total and the CU's deducted amount; the 730 shows rigo E27 from the CUs and links back here.

**Hiring platforms.** The platforms you signed up to (LinkedIn, Indeed, InfoJobs… or any other), with your profile link, the account you use, notes, a status and when you last updated your profile; one older than 180 days is flagged. Only `http(s)` links open.

| Endpoint (`/api/work/...`)                                                   | Purpose                                                                                        |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `GET /overview`                                                              | Workplaces, timeline, stats, CUs, documents to review, rejected ones, platforms, feedback      |
| `POST /workplaces`, `PATCH /workplaces/:id`, `DELETE /workplaces/:id`        | Add a workplace by hand, correct it, remove it (its documents go back to review)               |
| `POST /reviews/:uploadId/approve`                                            | `{workplaceId, accept: [fields], label?}`; `workplaceId: null` adds a new workplace            |
| `POST /reviews/:uploadId/reject`, `POST /reviews/:uploadId/reopen`           | Not about my work, and back to review                                                          |
| `POST /events`, `DELETE /events/:id`                                         | A career event you add by hand                                                                 |
| `POST /platforms`, `PUT /platforms/:id`, `DELETE /platforms/:id`             | Hiring platforms                                                                               |
| `POST /feedback`, `DELETE /feedback/:id`                                     | Ask for career feedback (optional `question`), forget one                                      |
| `GET /documents/:uploadId/preview`                                           | The original file (from svc-ingestion)                                                         |
| `GET /documents/:uploadId/download`                                          | The original file as a download, named by month and kind (`2026-10 - Cedolino - Acme.pdf`)     |
| `GET /payslips/:year/archive.zip`                                            | Every payslip paid in the year and the CU of that year's income, zipped                        |
| `POST /pension/funds`, `PUT /pension/funds/:id`, `DELETE /pension/funds/:id` | Your pension funds (deleting one removes its statements and transfers)                         |
| `POST /pension/statements`, `DELETE /pension/statements/:id`                 | The value of your position on a date                                                           |
| `POST /pension/payments`, `DELETE /pension/payments/:id`                     | Transfers you made to a fund yourself                                                          |
| `PUT /pension/notices/:year`                                                 | `{sentAt}`: the day you told the fund what you did not deduct (null clears it)                 |
| `POST /pension/documents/:uploadId/confirm`, `.../dismiss`                   | Take a statement document's figures (`{fundId}`, null adds the fund it names), or set it aside |
| `GET /deadlines`                                                             | The pension fund's dates, for the Agenda                                                       |

A database created before this area existed gets its schema and role from svc-work itself at startup, with the local defaults; `npm run db:upgrade` does the same (`infra/postgres/upgrades/004-work-schema.sql`).

## Studies

Iggy's zone (`/studies`, `mfe-studies` and `svc-studies`) is where you grow: it reads no documents, everything in it is what you record.

- **Page by priority.** Like Cars, Bills and Work: the Guide (paths, the resource scout, the study coach, studying well), **Needs you** (`<li-needs-you module="studies">`: a subscription about to renew, an exam or a certification ahead, from `GET /deadlines`; what the resource scout found for a path, a path behind its target date and a nudge after some days with no study time, from `GET /attention` `items`, each with the button that opens it), then four tiles: this week against the weekly goal (Settings → App settings → Studies), steps done this month against last month, paths on track against their target dates, and proof of skill (courses completed and certifications passed). The tabs are **Overview**, **Paths** and **Courses and exams**; old links to `?tab=coach` and `?tab=platforms` open the block they became.
- **Overview.** **Up next** shows the next step of every path you follow (the one you are studying first) and every course in progress, with the resource to open first (one you pinned, else the path's own, else the scout's newest). **Study now** times the session in the browser (kept across a reload) and logs it on the step or course when you stop, rounded to five minutes, then asks whether the step is done; the +25/+50/+90 chips log time you did not time, and **Log other time** opens the full form (a day, a topic, a note). Then **Your week** (the study coach), your weeks against the goal by topic (`ui-column-chart`, the goal as a line) and the latest sessions.
- **Learning paths.** `LEARNING_PATHS` in `libs/contracts` (`studies-paths.ts`): AI coding and tools, Beyond Angular, Docker, Kubernetes and infrastructure, Becoming a team leader, 3D for the web and Blender, all at beginner level. A path has stages, a stage has steps (learn, build, practice) with hours, what you will be able to do, and resources that link only to official docs, the authors' sites or well-known courses. You follow, pause or stop a path and set a target date; each step is Not started, Studying or Done, with your notes, and from the time you log Studies projects when you finish. The paths are code: a new resource or path is a pull request.
- **Courses and exams.** Courses on any platform, tied to a path step if you like, with progress, length, cost and the certificate link; exams and certifications with their date, cost and expiry (presets for KCNA, CKAD and others).
- **Training platforms** (in Courses and exams, with what you spent this year). Like Work's hiring platforms: Anthropic Academy, Udemy, Coursera, DeepLearning.AI, KodeKloud, Three.js Journey and more, filtered by topic and added in one click. A subscription keeps its price, period and renewal date, so you see its yearly cost and get a warning before it renews.
- **Resource scout.** In a fast-moving field a two-year-old video teaches things that are no longer true, so the AI tool `studies.resource-scout` keeps the resources of one path current. You pick the path in Settings (App settings → Studies, next to the tool in AI tools, or "Keep this path current" on the path itself). It is one path at a time because every scan searches the web: picking another path stops the first. It scans when you pick the path, then every 2 months for AI, frameworks and infrastructure and every 6 for the others (`studies.scout-cadence` changes it), or when you press Refresh now. A scan covers the stage with your next step and the one after. For each step it suggests fresh resources (official docs and release notes first, recent material for a fast-moving step, a classic for an evergreen one), with their kind, date, price and why. You pin what you keep and dismiss the rest; a dismissed link never comes back, and unpinned suggestions are replaced at the next scan. It also re-checks what you pinned and flags anything outdated (you keep it or remove it), marks each step fast-moving or evergreen, and may propose a step to add or retire, which changes the path only when you accept. Accepted changes live in svc-studies (`outline_changes`), on top of `LEARNING_PATHS`: the overview sends the paths as you study them in `catalogue`. Links that answer 404 or 410 are dropped before you see them. Off, or without `ANTHROPIC_API_KEY`, nothing is scanned: each step keeps its hand-picked resources and what you pinned.
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
| `POST /scout/scans`                                                                            | Refresh now: the resource scout scans the path under watch in the background (202)     |
| `PUT /scout/resources/:id`, `PUT /scout/changes/:id`                                           | Pin or dismiss a resource it found; accept or decline an outline change                |

A database created before this area existed gets its schema and role from svc-studies itself at startup, with the local defaults; `npm run db:upgrade` does the same (`infra/postgres/upgrades/006-studies-schema.sql`).

## Dreams

Ovi's zone (`/dreams`, `mfe-dreams` and `svc-dreams`) is for something you would love to reach but that takes you out of your comfort zone: a new job, a trip, a sport, something to create. It is built for small, pondered steps, and it never decides for you.

- **The dream.** You write it in your own words: why it matters, where you are today, what scares you, and what you cannot put at risk (income, time, people). You pick a pace (gentle, steady, bolder) and can rest a dream, mark it reached or let it go at any time. The page opens on a sky with the dream's path in 3D: one lit stone per step taken, a pulsing one for the next step, faint ones ahead, and the dream as a light at the end. The same facts are written beside it, and the scene stops for "reduce motion".
- **Questions first.** Before any step, the AI tool `dreams.questions` asks three to five questions about what it still does not know. Answered questions stay when you ask again. Off, or without `ANTHROPIC_API_KEY`, the questions come from Life Island's own list for the dream's area.
- **Small steps.** The AI tool `dreams.steps` suggests two to four steps: think, explore, prepare, try. Each says what it costs you (minutes, euro, energy), how far out of the comfort zone it goes, how to undo it, and a smaller version for a day it feels too much. Nothing happens until you pick one ("I'll do this one", "Take the smaller one", "Not for me"). Bigger moves, such as resigning, moving or a large purchase, are never steps: they are listed under "Not yet" with what should be true first (for example six months of safety net). Off, Life Island's own ladder for the area suggests them.
- **Check-ins and the pace.** After a step you say how it felt (too much … energising) and what you want next (smaller, the same, a bit further). `dreamReach` in `libs/contracts` (dreams.ts) turns the pace and the latest check-ins into how far the next steps may reach: "smaller" or a step that felt like too much brings it down, "a bit further" after a step that went well lets it up by one, and two heavy check-ins in a row make the next round tiny and short, with a gentle note that resting is fine and that talking to someone helps. The service also pulls any model step back within that reach.
- **Safety net, from the other areas.** A dream can be about any area of life, so you tick which areas it may read (Money, Work, Studies, Fitness, Travel; each new dream offers the usual ones for its area). svc-dreams reads their `GET /overview` over HTTP (`DREAMS_SOURCES`, the local ports when unset) and keeps a few facts each: your balance and usual month, so the months your savings cover, time at your job and since the last rise, the paths you follow, your active minutes. These lines are exactly what the small steps tool sends, and no names of companies, people or places are. An area that is not running is shown as not reachable, and the dream works without it.
- **How you will know, and by when.** A dream can say how you will know it is reached, and a date you hope for. The date shows in the Agenda as a wish ("moving it is fine"), never as late.
- **Habits.** The _Habits_ view holds what you repeat a few days a week, for a dream or just for you: a tick a day for the last week, this week against the target, the streak (weeks in a row at target) and the last thirteen weeks as a calendar. The habits of a dream, with how this week went, are part of what the small steps tool reads.
- **Your week.** The _Your week_ view is five minutes on Sunday about every dream at once: a mood, what went well, where you got stuck, what comes next, and the weeks before. A check-in is about one step; this is about the whole week.
- **Agenda and badge.** A chosen step with a date, and the date you hope to reach a dream, show in the Agenda. The island badge counts the steps waiting for their check-in, and a dream taking steps whose chosen step has waited two weeks ("Get it moving again": a smaller step, or a rest, is fine). A dream is never "late".
- **Goals & habits lived here before.** It was its own area (Rex, `svc-goals`) until November 2026, when it was merged into Dreams: a goal was a dream with steps. `infra/postgres/upgrades/017-goals-into-dreams.sql` moves every goal (as a dream with the same id: active ones with steps are "taking steps", reached ones reached, dropped ones let go; `measure` and `targetDate` come along), its steps (open ones chosen; done ones keep their day and do not ask for a check-in), the habits with their ticks and the weekly reviews. It runs once (`goals.moved_to_dreams` marks it done), with `npm run db:upgrade` or, on your machine, by svc-dreams at its start once its habits tables exist. The goals schema is kept as it was and its role can no longer sign in; drop them by hand when you have checked the move. The goals coach is gone: the small steps tool does its job.

| Endpoint (`/api/dreams/...`)                             | What it does                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /overview`                                          | Dreams with questions, steps, check-ins, the last guidance and the pace now       |
| `GET /deadlines`, `GET /attention`                       | Dated chosen steps and hoped-for dates; check-ins to write and stuck dreams       |
| `POST /dreams`, `PUT /dreams/:id`, `DELETE /dreams/:id`  | A dream (its fields, pace, status and `contextAreas`)                             |
| `POST /dreams/:id/questions`, `PUT /questions/:id`       | Ask (or ask again, keeping answers); answer a question                            |
| `POST /dreams/:id/suggestions`                           | The next small steps (optional `note`); earlier unpicked suggestions are replaced |
| `POST /steps`, `PUT /steps/:id`, `PUT /steps/:id/status` | Your own step, an edit; choose, set aside or bring back a step                    |
| `POST /check-ins`, `DELETE /check-ins/:id`               | How a step went (`outcome` done or skipped), or how the dream feels today         |
| `GET /dreams/:id/context`                                | What the shared areas say now, exactly as the small steps tool reads it           |
| `POST /habits`, `PUT /habits/:id`, `DELETE /habits/:id`  | A habit (`title`, `perWeek`, an optional `dreamId`, `active`)                     |
| `PUT /habits/:id/checks`                                 | Tick or untick a habit for a day (`date`, `done`)                                 |
| `PUT /weekly-reviews`                                    | The review of a week (`weekStart`, `mood`, `wins`, `stuck`, `next`); replaces it  |

A database created before this area existed gets its schema and role from svc-dreams itself at startup, with the local defaults; `npm run db:upgrade` does the same (`infra/postgres/upgrades/015-dreams-schema.sql`).

## The new areas: one way of working

Agenda, Money, Health, Contracts & subscriptions, Travel, Fitness and the Groceries page all follow the same pattern, so once you know one you know them all.

- **One page, a few tabs.** Each page opens with a header and a row of tiles that say what matters now (what is late, this week's total, the next step), then tabs for the details. Everything you type goes through the same dialog (`li-record-dialog`), with the same Save and Remove buttons.
- **Its own AI tool, with an offline fallback.** Every area has one AI tool (registered in `AI_TOOLS`, with its Settings switch, request and costs in Settings → AI tools). The panel says what is sent to Claude and what is not. With AI turned off, or without a key, the same button gives an answer from Life Island's own rules, marked "offline". The last ten answers are kept.
- **Dates go to the Agenda.** Every area with dates answers `GET /deadlines?from&to` with `DeadlineDto` items (libs/contracts `agenda.ts`), and svc-agenda reads them all (`AGENDA_SOURCES`, see `apps/svc-agenda/src/app/config.ts`). An area that is down shows as "not reachable" on the Agenda; the rest still shows. Marking a date as done in the Agenda never changes the area's own data. A deadline paid on its own carries `autoPaid: true` and the Agenda lists it as handled ("Paid automatically"), never late nor in "Coming up": a utility bill whose supply contract is paid by direct debit (your choice in Houses → supply points, else what its bills print in `payment_method`, which svc-ingestion `0028` adds to the bill templates, else what the contract's latest bill printed), a subscription renewal marked "Charged automatically", and Money's recurring charges.
- **What waits with no date goes to the Agenda too.** A document to approve (Cars, People, Work), a house suggestion (Houses), expenses paired with payments to confirm (730), a step waiting for its check-in or a stuck dream (Dreams), a past event with no result (Fitness), a subscription you never use (Contracts & subscriptions) and an item running out (Groceries) are listed in each area's `GET /attention` `items` (`LifeAttentionItemDto`). svc-agenda reads them from the same `AGENDA_SOURCES` (Groceries included) and shows them on the _Now_ tab under "Waiting for you", oldest first, each with a button to where it is handled; it leaves the list once handled there. The week brief gets them after the dates.

- **Every area page opens with "Needs you".** Under the header, the same block in every area lists what it needs from you now: late dates, the ones due within a week, and what waits with no date, most urgent first, at most five. Each line has its button (open it, review it, or mark the date done, which marks it in the Agenda too). It comes from svc-agenda (`GET /needs?module=`), so it always matches the Agenda and the island's badge.
- **The Agenda can email it to you.** An email digest of what is overdue, coming and waiting, every day, week or month, to a person of People at the email on their page (People → Edit → Email). How often and to whom are set in Settings → Email digest; the Agenda's **Email & calendar** tab shows what is in the way, a preview and a test. See [Email digest](email-digest.md). The same tab makes a private calendar link, so every date shows in Google, Apple or Outlook calendar: see [Calendar link](calendar-feed.md).
- **Payments are matched once, in Money.** An area with things to pay publishes `GET /payables`; Money pairs them with your bank movements on its **To match** tab and, once you confirm, tells the area (`money.payment_linked@1`). Houses marks the bill paid, Cars shows each cost paid and marks a fine paid, Work shows each pay received, Groceries each receipt (and an Amazon or other online order), the 730 marks the expense paid traceably, and Contracts & subscriptions shows the last charge and flags a price rise. See [Money matching](money-matching.md).
- **What each expense bought, in Money.** Receipts, order screenshots and photos go through the documents app like every file: the parse worker reads them as a _Receipt or order_ (`grocery.receipt@1`, Groceries loads it once you confirm it). Money pairs a card one with its bank movement on **To match** and fills the movement's category, its note (what was bought, searchable in Movements) and its parts in other categories (`splits`: placemats in Shopping, ibuprofen in Health, the rest in Groceries) from the receipt's lines. A receipt that says cash shows under **Paid in cash**, to add to your cash account in one click. Any movement's note, parts and channel (online or in a shop; else guessed from the shop the bank names) can be changed by hand (**What it bought**). The Overview's **How much do you buy online?** splits purchases by channel, month by month.
- **Groceries keeps only groceries.** A _Receipt or order_ is proof of a purchase of goods you can hold: software, AI or cloud credits, subscriptions, top-ups, tickets and bookings go to the general target instead. In Groceries, **Latest receipts** opens each receipt (its lines, the shop, a name of your own, **Open the document**) and **Not groceries** removes one that landed there anyway: it leaves the spending and **What you buy**, and its document stays in Documents. Lines that are not something you buy (VAT, shopping bags, discounts, deposits, shipping, rounding) stay on their receipt but never show in **What you buy**. Every row there opens the item: its price over time, and its name (on every receipt; the name of another item merges the two), aisle, link and photo (in svc-groceries' own bucket, `GROCERY_S3_BUCKET`, default `grocery-images`). **Delete** removes it from the list and the suggestions; its receipt lines stay in your spending. Shops are company links everywhere on the page.

| Area          | Dates it sends to the Agenda                                                                                                               | AI tool                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| People & IDs  | ID documents that expire                                                                                                                   | —                            |
| Cars          | insurance, road tax, revisione, fines                                                                                                      | insurance quote comparison   |
| Houses        | bills to pay                                                                                                                               | —                            |
| Studies       | exams, course ends, renewals of platforms                                                                                                  | study coach, resource scout  |
| Money         | the next date of each recurring charge                                                                                                     | spending review              |
| Health        | check-ups due, follow-up visits, medicine refills, vaccine boosters                                                                        | results explainer            |
| Contracts     | renewals and the date to cancel by                                                                                                         | renewal advisor              |
| Travel        | departures, check-ins, booking deadlines                                                                                                   | trip planner                 |
| Fitness       | races and events                                                                                                                           | training plan                |
| Dreams        | the dates you give chosen steps, the date you hope to reach a dream                                                                        | dream questions, small steps |
| Agenda itself | your own reminders (one-off, weekly, monthly, yearly) and the Italian calendar (tax dates, bollo, holidays; can be turned off in Settings) | week brief                   |

The hub shows the next six dates under **Coming up**, from `GET /api/agenda/upcoming`, and a **Today** strip above the island: how many dates are late (the Agenda's own count), how many are due today and how many undated things wait for you (the `items` of every area you use), each opening the Agenda.

## Guides: reading matter on demand

Anything a page says that is not your data (what a thing is, how it works, the words it uses, rates and rules that hold for everyone) goes in the page's guide, never in a card or tab beside the data: once you know it, it is only clutter. `<ui-info-guide>` (design system) puts a small **Guide** button where you place it, usually in the page header's `uiPageActions`, and opens a drawer from the side (full screen on a phone) with one tab per `<ui-info-topic key label intro>`. The book mark, the blue `--info-*` tokens, the ruled header and the typography of what goes inside (headings, lists, tables, `<details>` folds, `.ui-info-sources`) are the same in every module, as the violet is for AI.

- Open it from elsewhere on the page with `[(open)]` and `[(topic)]`; link to it from another area with `?guide=<topic>` (the page opens it and drops the parameter when it closes).
- Content tied to your data (a chart's legend, the codes of your own registration certificate, an empty state that says what to upload) stays on the page.
- Today: the 730 (`basics`, `rates`, `glossary`), Work (`payslip`, `cu`, `tfr`, `pension`, `reviews`) and Cars (`cng`, the requalification of CNG cylinders).
