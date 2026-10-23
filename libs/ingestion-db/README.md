# ingestion-db

Drizzle table definitions for the `ingestion` schema (`uploads`, `parse_runs`), shared by the two apps of the ingestion context: `svc-ingestion` (which owns and runs the migrations) and `svc-parse-worker`. Tagged `scope:ingestion`, so no other module can import it.
