-- Global reference data. These tables are identical for every tenant, are
-- seeded from the published ISO lists at deploy time and hold no customer
-- rows, so there is nothing for a row level security policy to separate.
create table currencies (
  code char(3) primary key,
  name text not null,
  minor_units smallint not null default 2
);

create table countries (
  iso2 char(2) primary key,
  name text not null,
  default_currency char(3) not null references currencies (code)
);

create table tax_rates (
  id serial primary key,
  country_iso2 char(2) not null references countries (iso2),
  rate_bps integer not null check (rate_bps between 0 and 10000),
  effective_from date not null,
  unique (country_iso2, effective_from)
);

grant select on currencies, countries, tax_rates to authenticated, anon;

insert into currencies (code, name, minor_units) values
  ('USD', 'United States dollar', 2),
  ('EUR', 'Euro', 2),
  ('JPY', 'Japanese yen', 0)
on conflict (code) do nothing;

insert into countries (iso2, name, default_currency) values
  ('US', 'United States', 'USD'),
  ('DE', 'Germany', 'EUR'),
  ('JP', 'Japan', 'JPY')
on conflict (iso2) do nothing;
