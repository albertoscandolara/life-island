-- Runs once, when the Postgres volume is first created.
-- One login role and one schema per service. A role owns its schema and has
-- no grants anywhere else, so it physically cannot read other services' data.
-- Dev passwords only; production roles get their passwords from the secret manager.

revoke all on schema public from public;
revoke all on database life_island from public;

create role ingestion_svc login password 'dev_ingestion';
create role review_svc login password 'dev_review';
create role grocery_svc login password 'dev_grocery';
create role tax730_svc login password 'dev_tax730';

grant connect on database life_island to ingestion_svc, review_svc, grocery_svc, tax730_svc;

create schema ingestion authorization ingestion_svc;
create schema review authorization review_svc;
create schema grocery authorization grocery_svc;
create schema tax730 authorization tax730_svc;

alter role ingestion_svc set search_path = ingestion;
alter role review_svc set search_path = review;
alter role grocery_svc set search_path = grocery;
alter role tax730_svc set search_path = tax730;
