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
create role work_svc login password 'dev_work';
create role settings_svc login password 'dev_settings';
create role studies_svc login password 'dev_studies';
create role agenda_svc login password 'dev_agenda';
create role money_svc login password 'dev_money';
create role goals_svc login password 'dev_goals';
create role health_svc login password 'dev_health';
create role subscriptions_svc login password 'dev_subscriptions';
create role mailbox_svc login password 'dev_mailbox';
create role travel_svc login password 'dev_travel';
create role fitness_svc login password 'dev_fitness';

grant connect on database life_island to ingestion_svc, review_svc, grocery_svc, tax730_svc, home_svc, people_svc, cars_svc, work_svc, settings_svc, studies_svc, agenda_svc, money_svc, goals_svc, health_svc, subscriptions_svc, mailbox_svc, travel_svc, fitness_svc;

create schema ingestion authorization ingestion_svc;
create schema review authorization review_svc;
create schema grocery authorization grocery_svc;
create schema tax730 authorization tax730_svc;
create schema home authorization home_svc;
create schema people authorization people_svc;
create schema cars authorization cars_svc;
create schema work authorization work_svc;
create schema settings authorization settings_svc;
create schema studies authorization studies_svc;
create schema agenda authorization agenda_svc;
create schema money authorization money_svc;
create schema goals authorization goals_svc;
create schema health authorization health_svc;
create schema subscriptions authorization subscriptions_svc;
create schema mailbox authorization mailbox_svc;
create schema travel authorization travel_svc;
create schema fitness authorization fitness_svc;

alter role ingestion_svc set search_path = ingestion;
alter role review_svc set search_path = review;
alter role grocery_svc set search_path = grocery;
alter role tax730_svc set search_path = tax730;
alter role home_svc set search_path = home;
alter role people_svc set search_path = people;
alter role cars_svc set search_path = cars;
alter role work_svc set search_path = work;
alter role settings_svc set search_path = settings;
alter role studies_svc set search_path = studies;
alter role agenda_svc set search_path = agenda;
alter role money_svc set search_path = money;
alter role goals_svc set search_path = goals;
alter role health_svc set search_path = health;
alter role subscriptions_svc set search_path = subscriptions;
alter role mailbox_svc set search_path = mailbox;
alter role travel_svc set search_path = travel;
alter role fitness_svc set search_path = fitness;
