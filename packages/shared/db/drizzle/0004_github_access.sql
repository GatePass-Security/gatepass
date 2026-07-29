-- Derive access from GitHub instead of from a list Gatepass keeps.
--
-- Before this, a deployment served one org and admitted people from an environment variable.
-- That is a second list to keep in sync with GitHub, and a second list is how somebody keeps
-- access after they have been removed from the org.
--
-- Now: an organization installs the Gatepass App, and the people who may use Gatepass for a
-- repository are exactly the people GitHub already says may work on that repository. Two
-- schema changes carry it.
--
-- 1. An organization row can *be* a GitHub org.
--
-- `github_org_login` is UNIQUE because a GitHub org is one tenant. Two Gatepass orgs claiming
-- the same GitHub org would each derive access from the same membership list while holding
-- separate findings, and a user signing in would land in whichever was found first — a tenancy
-- bug with a data-leak shape. The database refuses it rather than the application remembering
-- to.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "github_org_login" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "github_installation_id" bigint;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "organizations" ADD CONSTRAINT "organizations_github_org_login_unique" UNIQUE ("github_org_login");
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- 2. A cache of what GitHub said about each user.
--
-- This table is a CACHE, not a grant. Nothing here confers access: every row records an answer
-- GitHub gave, and it is re-derived on a short TTL. Truncating it logs everyone out of their
-- repositories until they next sign in and does not widen anybody's access by one repository.
-- That is the property to preserve — the day an operator can edit a row here to grant somebody
-- a repository, the model this migration exists to establish is gone.
--
-- `access_token` is the user's own OAuth token (`read:user read:org`, no `repo` scope, so it
-- cannot read code) and is what makes refreshing possible without a fresh sign-in. It is
-- deleted on sign-out. Encrypt at rest if your threat model calls for it:
--   ALTER TABLE user_access_grants ALTER COLUMN access_token TYPE bytea USING pgp_sym_encrypt(...)
CREATE TABLE IF NOT EXISTS "user_access_grants" (
  "github_user_id" text PRIMARY KEY NOT NULL,
  "login" text NOT NULL,
  "grant" jsonb NOT NULL,
  "access_token" text,
  "refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- Supports pruning grants nobody has refreshed in a long time; the hot lookup is by primary key.
CREATE INDEX IF NOT EXISTS "user_access_grants_refreshed_at_idx" ON "user_access_grants" USING btree ("refreshed_at");
