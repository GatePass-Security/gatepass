-- Connect / disconnect repositories, and per-repository settings.
--
-- `github_repo_id` loses NOT NULL because the table has to hold two rows it previously could
-- not: a repository connected on a deployment with no GitHub App, and a directory scanned on
-- the API host. Postgres allows repeated NULLs under a UNIQUE constraint, so uniqueness still
-- holds for every row that does carry an id.
--
-- `visibility` is nullable and defaults to NULL deliberately. It is written only when GitHub
-- reported it. A security dashboard that prints "Private" beside a public repository has told
-- the operator something false about their exposure; NULL means "not known" and renders as
-- nothing.
ALTER TABLE "repositories" ALTER COLUMN "github_repo_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "source" text DEFAULT 'github' NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "visibility" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "default_branch" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "last_scan_id" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "last_scan_at" timestamp with time zone;--> statement-breakpoint
-- A repo name is unique within an org, not globally: two tenants may each connect the same
-- public repository and neither may see or clobber the other's row.
CREATE UNIQUE INDEX "repositories_org_name_idx" ON "repositories" USING btree ("org_id","name");
