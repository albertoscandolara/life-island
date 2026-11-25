-- VEHICLE_OWNERSHIP, a car document beside the registration certificate: the
-- certificato di proprietà (CdP) of the PRA (ACI), paper until 2015 and
-- digital since (CDPD), and the papers of a change of owner (passaggio di
-- proprietà): the PRA's receipt of the formality and the sale (atto di
-- vendita). It proves who owns the car, which the carta di circolazione does
-- not; svc-cars reads it as a series of the car, with the history of owners.
-- Since 2020 the Documento Unico holds both: it stays VEHICLE_REGISTRATION.
-- It sits under CAR_DOCUMENT, where VEHICLE_REGISTRATION sits. A category with
-- the same id is kept as it is; when one of yours already has the title "Car
-- ownership", this one is added as "Car ownership (certificato di proprietà)"
-- instead (titles are unique). VEHICLE_REGISTRATION's description gains a
-- line telling the two apart, only where it is still as 0013 wrote it.
-- Data only. Rollback: drizzle/rollback/0034_car_ownership_category.down.sql.
WITH inserted AS (
  INSERT INTO "ingestion"."document_categories" ("id", "title", "description", "template_json", "dimension", "parent_id")
  SELECT 'VEHICLE_OWNERSHIP',
         CASE WHEN EXISTS (SELECT 1 FROM "ingestion"."document_categories" WHERE lower("title") = 'car ownership')
              THEN 'Car ownership (certificato di proprietà)' ELSE 'Car ownership' END,
         'The certificato di proprietà (CdP) of a car from the PRA (ACI, Pubblico Registro Automobilistico), paper or digital (CDPD), or the papers of a change of owner (passaggio di proprietà): the PRA''s receipt (attestazione di presentazione formalità, trasferimento di proprietà) and the sale (atto di vendita). Plate, VIN, owner and previous owners, sale date, liens (fermo, ipoteca), access code and amount paid. Not the carta di circolazione, and not the Documento Unico, which is a registration certificate.',
         '{"fields": [{"key": "registration_number", "label": "Number plate", "type": "string", "description": "TARGA, without spaces, upper-case (AB123CD)", "required": true}, {"key": "vin", "label": "VIN", "type": "string", "description": "TELAIO: the numero di telaio, if printed", "required": false}, {"key": "make", "label": "Make", "type": "string", "description": "Marca, the first word of fabbrica/tipo (FIAT 199 BXB1A is FIAT)", "required": false}, {"key": "commercial_name", "label": "Model", "type": "string", "description": "Model of the car, only if printed by name (PUNTO)", "required": false}, {"key": "first_registration_date", "label": "First registration", "type": "date", "description": "Data immatricolazione: the car''s first registration", "required": false}, {"key": "document_kind", "label": "Document", "type": "enum", "description": "certificate: the certificato di proprietà (CdP), paper or digital (CDPD); transfer: the PRA''s receipt of a change of owner (attestazione di presentazione formalità, trasferimento di proprietà); sale: the sale itself (atto di vendita, dichiarazione di vendita); other: a visura PRA, a lien recorded or cancelled", "required": true, "options": ["certificate", "transfer", "sale", "other"]}, {"key": "document_number", "label": "Number", "type": "string", "description": "N. of the certificate (17/A105607P), else the registro progressivo of the formality", "required": false}, {"key": "issue_date", "label": "Issued", "type": "date", "description": "The date the certificate or receipt was issued (data at the bottom, or del ... of the registro progressivo)", "required": false}, {"key": "pra_office", "label": "PRA office", "type": "string", "description": "Ufficio provinciale di: the PRA office, town only (VERONA)", "required": false}, {"key": "owner_name", "label": "Owner", "type": "string", "description": "PROPRIETARIO (dati della intestazione), surname and name or company as printed; co-owners separated by ;. On a sale, the buyer", "required": true}, {"key": "owner_tax_code", "label": "Owner tax code", "type": "string", "description": "Codice fiscale of the owner, if printed", "required": false}, {"key": "previous_owners", "label": "Previous owners", "type": "integer", "description": "Numero precedenti intestazioni", "required": false}, {"key": "sale_date", "label": "Sale date", "type": "date", "description": "The day the car changed hands: atto di vendita del ..., or the date of the sale. Null when none is printed", "required": false}, {"key": "seller_name", "label": "Seller", "type": "string", "description": "Venditore, only when a sale prints it", "required": false}, {"key": "liens", "label": "Liens", "type": "string", "description": "Gravami: fermo amministrativo, ipoteca, riservato dominio or leasing, as written. Null when none is recorded; never the other notes (dispositivo antinquinamento, atto di vendita)", "required": false}, {"key": "no_liens", "label": "No liens", "type": "boolean", "description": "True when it says no lien is recorded (Non risultano iscritte ipoteche)", "required": false}, {"key": "access_code", "label": "Access code", "type": "string", "description": "The code to see a digital certificate online: ID CDPD, or the codice di accesso of the receipt", "required": false}, {"key": "total_amount", "label": "Total paid", "type": "amount", "description": "Importo riscosso, or Totale of the importi versati: what the change of owner cost", "required": false}]}'::jsonb,
         COALESCE((SELECT "dimension" FROM "ingestion"."document_categories" WHERE "id" = 'VEHICLE_REGISTRATION'), 'DOCUMENT_TYPE'),
         (SELECT "parent_id" FROM "ingestion"."document_categories" WHERE "id" = 'VEHICLE_REGISTRATION')
  ON CONFLICT DO NOTHING
  RETURNING "id", "title", "parent_id", "dimension"
)
-- Modules that keep their own copy of the categories (review inbox, Cars) learn it from category.changed@1.
INSERT INTO "ingestion"."outbox" (event_type, payload)
SELECT 'category.changed@1',
       jsonb_build_object(
         'id', i.id,
         'title', i.title,
         'parentId', i.parent_id,
         'dimension', i.dimension,
         'deleted', false,
         'changedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )
  FROM inserted i;--> statement-breakpoint
UPDATE "ingestion"."document_categories"
   SET "description" = 'The carta di circolazione (libretto) or the documento unico di circolazione e di proprietà: every field next to its EU code (A, B, C.1, D.1, E, F.1, J, K, P.1, V.7...). Its car data is checked against the car before it is kept. Not the certificato di proprietà of the PRA, which is a document of its own.'
 WHERE "id" = 'VEHICLE_REGISTRATION' AND "description" = 'The carta di circolazione (libretto) or the documento unico di circolazione e di proprietà: every field next to its EU code (A, B, C.1, D.1, E, F.1, J, K, P.1, V.7...). Its car data is checked against the car before it is kept.';
