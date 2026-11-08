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
create role home_svc login password 'dev_home';
create role people_svc login password 'dev_people';
create role cars_svc login password 'dev_cars';

grant connect on database life_island to ingestion_svc, review_svc, grocery_svc, tax730_svc, home_svc, people_svc, cars_svc;

create schema ingestion authorization ingestion_svc;
create schema review authorization review_svc;
create schema grocery authorization grocery_svc;
create schema tax730 authorization tax730_svc;
create schema home authorization home_svc;
create schema people authorization people_svc;
create schema cars authorization cars_svc;

alter role ingestion_svc set search_path = ingestion;
alter role review_svc set search_path = review;
alter role grocery_svc set search_path = grocery;
alter role tax730_svc set search_path = tax730;
alter role home_svc set search_path = home;
alter role people_svc set search_path = people;
alter role cars_svc set search_path = cars;
