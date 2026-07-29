-- Global reference data. These tables intentionally have no tenant_id and no
-- row level security: the contents are ISO published lists, identical for every
-- customer, and writable only by the migration role. There is no per-tenant row
-- here for a policy to filter.
CREATE TABLE currencies (
    code           char(3) PRIMARY KEY,
    numeric_code   smallint NOT NULL,
    minor_units    smallint NOT NULL,
    display_name   text NOT NULL
);

CREATE TABLE country_currency (
    country_code char(2) PRIMARY KEY,
    currency     char(3) NOT NULL REFERENCES currencies(code)
);

INSERT INTO currencies (code, numeric_code, minor_units, display_name) VALUES
    ('USD', 840, 2, 'United States dollar'),
    ('EUR', 978, 2, 'Euro'),
    ('JPY', 392, 0, 'Japanese yen'),
    ('CHF', 756, 2, 'Swiss franc');

INSERT INTO country_currency (country_code, currency) VALUES
    ('US', 'USD'), ('DE', 'EUR'), ('JP', 'JPY'), ('CH', 'CHF');

-- Read-only to the application role; no INSERT/UPDATE/DELETE is granted, so the
-- absence of a policy cannot be used to write either.
REVOKE ALL ON currencies, country_currency FROM app_user;
GRANT SELECT ON currencies, country_currency TO app_user;
