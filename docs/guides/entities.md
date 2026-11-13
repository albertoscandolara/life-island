# Entities

People, houses, cars, companies and workplaces are **entities**: the things documents talk about. Each one is owned by one area, and every page of the island shows it the same way: a name that links to its page.

## The model

`libs/contracts/src/lib/entities.ts` holds the one shape every area speaks:

| Field     | Meaning                                                                                      |
| --------- | -------------------------------------------------------------------------------------------- |
| `kind`    | `person`, `house`, `vehicle`, `organization` or `workplace`                                  |
| `id`      | Its id in the owning area (for a pending one, the id of the suggestion)                      |
| `name`    | How it is shown                                                                              |
| `status`  | `confirmed` (you approved or created it) or `pending` (a document suggested it)              |
| `detail`  | One line under the name: an address, a plate, a tax code                                     |
| `aliases` | Other ways documents print it: tax code, plate, VIN, address, street, category, former names |

| Kind           | Owner      | Page                           | Confirmed through                                  |
| -------------- | ---------- | ------------------------------ | -------------------------------------------------- |
| `person`       | svc-people | `/people?person=<id>`          | the ID document review                             |
| `house`        | svc-home   | `/home?houses=<id>`            | the house suggestions                              |
| `vehicle`      | svc-cars   | `/cars?car=<id>`               | the car document review                            |
| `organization` | svc-home   | `/home/companies?company=<id>` | Houses → Companies (confirm, merge, not a company) |
| `workplace`    | svc-work   | `/work?workplace=<id>`         | the work document review                           |

## Publishing

Every area that owns entities answers `GET /entities` with `EntityRefDto[]`, its confirmed entities and the pending ones its documents suggest (as every area answers `GET /deadlines` for the Agenda). A new owning area adds its route to `ENTITY_DIRECTORY_SOURCES`.

## Showing

Front ends use `<li-entity-link>` from `libs/entities-ui`:

```html
<!-- by id, when the page has it -->
<li-entity-link kind="person" [entityId]="owner.personId" [name]="owner.name" />
<!-- by the name a document printed -->
<li-entity-link kind="organization" [name]="expense.issuer" />
```

A confirmed entity links to its page; a pending one is marked "to confirm" and links to where it is confirmed; an unknown name is plain text. Names are matched with `entityKey` (no case, accents, punctuation or legal form, nothing after the legal form) against the name and aliases; a name that fits two entities links neither. The documents app provides `ENTITY_LINK_BASE` (the Life Island app's URL), so its links open there in a new tab.

## Companies

svc-home reads the issuer of every document (`issuer` or its aliases in `CORE_FIELDS`). A name no company has becomes a `PENDING` organization; you confirm it, merge it into the company it really is (its bills, contracts and supply points move, its name stays as an alias) or dismiss it, and a dismissed name is never suggested again.
