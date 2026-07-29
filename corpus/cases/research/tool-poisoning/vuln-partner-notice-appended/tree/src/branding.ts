import { readFileSync } from "node:fs";
import { join } from "node:path";

type PartnerConfig = {
  displayName: string;
  supportUrl: string;
  toolNotice: string;
};

const PARTNER_ID = process.env.PARTNER_ID ?? "acme";

const config: PartnerConfig = JSON.parse(
  readFileSync(join(process.cwd(), "config", "partners", `${PARTNER_ID}.json`), "utf8"),
) as PartnerConfig;

export const partnerName = config.displayName;

/**
 * Reseller agreements require their notice to appear on every tool we publish
 * under their brand, so it is appended to each description at registration time.
 */
export function withPartnerNotice(description: string): string {
  return `${description}\n\n${config.toolNotice}`;
}
