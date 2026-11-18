# Design guidelines

Life Island exists to make life easier and more organised, so every screen is judged by one question: **after looking at it, do you know what to do next, and can you do it from here?** These guidelines keep every area clean, clear and alike, so you learn one page and can read them all. They apply to every new page and to every change of an existing one; the [review checklist](#review-checklist) at the end is what a pull request is checked against.

The tokens and components named here live in `libs/design-system` and `libs/records-ui`; where code is shared is in [Code sharing](code-sharing.md).

## 1. Actions first, then state, then history

A page reads top to bottom in the order you need it:

| Order | Block                  | What it holds                                                                                                                                                  | Built with                                                                                    |
| ----- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1     | **Header**             | The character's emblem, the area's name, one sentence on what it does (one line on a laptop), the page actions and the **Guide** button                        | `<ui-page-header>`, `<ui-info-guide>` in `uiPageActions`                                      |
| 2     | **Needs you**          | What you should do now, most urgent first, at most five lines. Each line: a verb, why it matters (a date, an amount saved or at risk), one button that does it | `<ui-alert>` for one blocking problem; a "Needs you" list for the rest                        |
| 3     | **Where you stand**    | Three to five stat tiles. Each number has a comparison: against last month or year, a goal, a limit                                                            | `.li-tiles` / `.li-tile` (`--lead`, `--warning`, `--danger`), `<li-delta>` for the comparison |
| 4     | **Views**              | When the area has more than one view, tabs, each with the count of what needs you there                                                                        | `<li-tabs>`                                                                                   |
| 5     | **Trends and details** | Charts with their table, then lists and tables, newest or most urgent first                                                                                    | [Charts](#4-charts), `<ui-table>`, `.li-list`                                                 |

- **No reading matter on the page.** What a thing is, how a rule works and glossaries go in the page's Guide (`docs/guides/life-island-app.md`, Guides). Content tied to your data (a chart's legend, an empty state that says what to upload) stays.
- **Every insight ends in an action.** A warning without a button is a worry, not help. The action is, in order of preference: do it here (mark as paid, file the document, log the session), open the place where it is done (a deep link with the record selected), or put it in the Agenda as a reminder. If none exists, the insight is not ready to ship.
- **One primary button per block.** The accent-filled button is the next step; everything else is secondary or a link.
- **Empty states teach the next step.** "No bills yet: upload an electricity, gas or water bill" with the button to open the documents app, never a bare "No data".
- **Count what needs you, everywhere it shows.** A tab, the hub card and the Agenda show the same number for the same thing (the area's `GET /attention`). A thing with no date that needs you is also listed in that answer's `items`, so the Agenda can show it with its action: never count something the person cannot find and act on.

## 2. Visual identity: one island, many characters

Every area looks like the same app; the character only re-tints it.

**The base (same in every area): sand and sea.** In the light theme white cards lie on warm sand (`--surface-page`, `--surface-sunken`) and the text is deep-sea ink; the dark theme is a night lagoon. Faint contour lines of an island map sit behind the page, never behind a card. Inter for text and Fredoka for titles and big numbers, the spacing scale (`--space-*`), the radii (`--radius-*`), the shadows (`--shadow-card`, `--shadow-tile`, `--shadow-popover`, `--shadow-dialog`), the status tones (`--tone-*`) and the motion tokens (`--duration-*`, `--ease-*`).

**The character accent (`[data-character]`).** Used only for identity and the next step: the emblem's island token, the active tab, the primary button, the lead tile (its ribbon and lip), the bar beside a card title, focus rings. Never for data (a chart series, a value that is good or bad) and never for status: a late payment is `--tone-danger` in every area, whatever the character's colour.

**Cross-module identities.** Some features look the same in every area so you recognise them anywhere. Each has its own tokens and components, and an area never restyles them:

| Feature         | Identity                                                 | Use                                                                                            |
| --------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| AI              | Quiet violet, `--ai-*`, sparkle icon                     | `<ui-ai-panel>`, `<ui-ai-badge>`, `<ui-ai-status>`, `<li-ai-tool>` (`docs/guides/ai-tools.md`) |
| Guide           | Calm blue, `--info-*`, book icon, a drawer from the side | `<ui-info-guide>`, `<ui-info-topic>`                                                           |
| Entities        | A name that links to its page, with its kind's icon      | `<li-entity-link>` (`docs/guides/entities.md`)                                                 |
| Dates and money | "in 5 days", "11 nov 2026", "€ 12,50", "–" when missing  | `daysText`, `dateText`, `euro` from `libs/records-ui`                                          |
| Status          | Neutral, info, progress, warning, success, danger        | `<ui-badge>`, `<ui-status-dot>`, `<ui-alert>`, `--tone-*`                                      |
| Documents       | The original file opens in the same preview everywhere   | the area's `documents/:uploadId/preview` route                                                 |

A new cross-module feature gets its own identity the same way: tokens in `semantic.css` next to `--ai-*` and `--info-*`, components in the design system, a line in this table.

**Never in an area.** Raw colours, px spacing and font sizes (Stylelint blocks them), new primitives, a local copy of a design-system component, a second style for something the table above already covers.

## 3. Modern, clean and 3D-friendly, without losing clarity

The island hub (its models made in Blender, `tools/island-models`) is the only real 3D scene a page depends on (plus a character's avatar and a small hero model, such as the Cars garage, when it shows the entity the page is about). Everything else is 2D that _feels_ physical, so the 3D hub and the pages belong to one world:

- **Tactile, not glossy.** Light falls from the top-left: every raised surface has a bright top edge (`--edge-light`, already inside `--shadow-card` and `--shadow-tile`) and a soft shadow under it. Stat tiles (`.li-tile`) add a short solid lip, like a key you can press; the lead tile's lip and the ribbon on its top edge take the accent. Cards lift to `--shadow-card-hover` when they open something. Bars over content use `--surface-glass` with a backdrop blur. Three levels at most on one screen: page, card, overlay.
- **Light from one side.** Gradients run at 135° (`--accent-gradient`), highlights sit top-left. Do not add other directions.
- **Motion explains, never decorates.** Blocks rise in once (`ui-rise-in`, `--duration-slow`), tiles one after the other; a value that changes moves within `--duration-normal`; nothing loops. Everything honours `prefers-reduced-motion`.
- **3D never holds data alone.** Whatever a scene shows (a car, a house, a zone's badge) is also in the 2D page, readable by keyboard and screen reader. Three.js loads lazily (`@defer`), and the page works without WebGL. The island floats on the page: its sea fades into it, with no box around it.
- **Clarity wins every tie.** When a visual effect and readability compete (contrast on glass, a gradient behind numbers, a shadow on a dense table) drop the effect. Tables and numbers sit on flat `--surface-card`, and a card never turns in 3D: only its token does, so text stays sharp.

### Treasures: the few 3D touches

A treasure is rare by definition. These are the only ones, all in `libs/design-system/src/styles/treasures.css`; an area never adds its own, and a new one is a design-system change with a line here.

| Treasure            | What it is                                                                                                 | Where                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| The island token    | `.ui-token`: a coin of the accent with a real side, a shine and a cast shadow; it turns into place once    | The emblem in `<ui-page-header>` (until the character's avatar exists), the brand mark, hub cards |
| The quiet token     | `.ui-token--soft`: the same coin in the accent's wash, so it never reads as a button                       | `<ui-empty-state>`, areas still planned on the hub                                                |
| Turn to the pointer | `uiTilt` sets `--tilt-x`, `--tilt-y` and `--glare-x`; the tokens inside turn and their glare slides across | `<ui-page-header>` (built in), hub cards. Mouse only, never with reduced motion                   |
| The map             | Faint contour lines behind the page (`--contour-ink`, `--contour-opacity`), fixed while you scroll         | The page background, once, from `body::before`                                                    |

Sizes are `.ui-token--sm` (a control's height), `.ui-token--md` and the default (`--space-16`), or `--token-size` and `--token-depth`. One token per block at most: a list of rows uses plain emblems, never a column of coins.

## 4. Charts

Every chart is drawn by the design system, so they all share axes, tooltips, legends and colours:

| Question                                             | Chart                                     |
| ---------------------------------------------------- | ----------------------------------------- |
| How much, period by period (and its parts)?          | `<ui-column-chart>` (stacked or grouped)  |
| How does a value move over time, or year over year?  | `<ui-line-chart>`                         |
| Where is it heading, in one glance next to a number? | `<ui-sparkline>`                          |
| How is one total split?                              | `<ui-segmented-bar>`                      |
| A small count per week or month against a goal       | `<li-bars>`                               |
| How far along, or how much of a budget is used?      | `<ui-progress-bar>` (`tone` for a budget) |

- **Colour follows the thing, never the rank.** Named entities have their own tokens (`--viz-electricity`, `--viz-gross`, `--viz-property-1`…). Anything else (topics, kinds, people) takes the categorical palette in order, `--viz-1` to `--viz-6`, and keeps its slot in every chart of the area. A seventh series goes into `--viz-other` ("Other"). A new named entity gets a token in `semantic.css`, in both themes.
- **Bars start at zero; lines may not.** Say so when a line's axis does not start at zero.
- **Label directly.** The last value at the end of a line, the goal as a dashed line with its name, the legend above the plot only when there is more than one series.
- **One question per chart**, written as its card title ("Your pay against inflation"), with a one-line note on how to read it when it is not obvious.
- **Every chart has its numbers.** A table under it, or a visually hidden one, so the figures are readable without the picture.
- **A chart leads somewhere.** A bar that is too high (a bill, a month of spending) opens the records behind it.

When a chart type is missing, add it to `libs/design-system/src/lib/charts/` with a unit test of its arithmetic; never draw a one-off SVG or CSS chart in an area.

## 5. Data order and usability

- **Most urgent first, then newest first.** Lists of things to do sort by date due; history sorts newest first; a table of years starts from the latest.
- **Numbers line up.** Right-aligned with `tabular-nums`, the unit always shown, `–` for a missing value and never `0`, two decimals for money unless the column is in whole euros.
- **Italian figures, English words.** Numbers and dates are written the Italian way (`1.234,56 €`, `11 nov 2026`), the interface text is in English, and Italian terms of art keep their name with the English beside it the first time (carta di circolazione, Certificazione Unica).
- **State lives in the URL.** The open tab, the selected record and the filters are query parameters, so a link from the Agenda or another area opens exactly the right place.
- **Phones are first-class.** Every page works at 360 px: tiles wrap, tabs scroll, wide tables scroll inside `.table-wrap`, dialogs and the Guide go full screen.
- **Keyboard and screen readers.** Every action is a real button or link, focus is visible (`--focus-ring`), icons that carry meaning have a label, and status is never shown by colour alone.
- **Plain words.** Buttons are verbs ("File the receipt", "Mark as paid"); titles say what you get ("What each year really paid you"); a number always says compared with what.

## 6. Review checklist

A page or feature is done when:

- [ ] The page follows the order of section 1: header, Needs you, tiles, tabs, details
- [ ] Every warning or insight has an action (do it here, open it, remind me)
- [ ] The area's `GET /attention` count matches what the page and its tabs show
- [ ] Only semantic tokens; the accent only for identity and the next step; status with `--tone-*`
- [ ] AI, guides, entities, dates and money use their shared components and formatters
- [ ] Charts come from the design system, use entity tokens or `--viz-1…6`, and have their numbers in a table
- [ ] Reading matter is in the Guide, not on the page
- [ ] Works at 360 px, by keyboard, in light and dark, with reduced motion
- [ ] No new 3D touch, gradient direction or looping animation outside the treasures of section 3
- [ ] No component, style block or formatter copied from another area ([Code sharing](code-sharing.md))
