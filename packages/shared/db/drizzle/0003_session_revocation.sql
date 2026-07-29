-- Make sign-out actually end a session.
--
-- Sessions are stateless HMAC tokens, so until now the only thing that ended one was its own
-- expiry: signing out cleared the browser cookie and left the token itself valid for the rest
-- of its seven days. A token copied off the wire, or left behind on a shared machine, could not
-- be withdrawn by anyone.
--
-- Rows here are bounded by the token they revoke — past `expires_at` the signature check refuses
-- it regardless, so the row is redundant and safe to delete:
--   delete from revoked_sessions where expires_at < now();
CREATE TABLE IF NOT EXISTS "revoked_sessions" (
  "jti" text PRIMARY KEY NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- Supports the prune above; the lookup on the hot path is by primary key.
CREATE INDEX IF NOT EXISTS "revoked_sessions_expires_at_idx" ON "revoked_sessions" USING btree ("expires_at");
