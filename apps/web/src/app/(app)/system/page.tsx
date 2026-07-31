import { API_BASE, API_BASE_CONFIGURED } from "@/lib/constants";
import SystemClient from "./SystemClient";

/**
 * A server shell whose only job is to read the environment.
 *
 * The page itself is interactive and has to stay a Client Component, but the API's origin is a
 * server-side value — so it is resolved here, at request time, and passed down. That split is
 * what lets `GATEPASS_API_URL` be an ordinary runtime variable instead of a `NEXT_PUBLIC_` one
 * baked into the bundle at build time; see `lib/constants.ts`.
 *
 * `force-dynamic` because the value must reflect the environment this request is being served
 * in, not the one that happened to exist when the page was prerendered.
 */
export const dynamic = "force-dynamic";

export default function SystemPage() {
  return <SystemClient apiBase={API_BASE} apiBaseConfigured={API_BASE_CONFIGURED} />;
}
