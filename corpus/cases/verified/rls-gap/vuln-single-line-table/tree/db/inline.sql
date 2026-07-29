create table sessions (id uuid primary key, user_id uuid not null, expires_at timestamptz);
