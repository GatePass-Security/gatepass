export interface Subscription {
  plan: "free" | "team" | "enterprise";
  seats: number;
  renewsAt: string;
  invoiceUrl: string;
}

const SUBSCRIPTIONS = new Map<string, Subscription>();

export async function getSubscription(sessionToken: string): Promise<Subscription> {
  const existing = SUBSCRIPTIONS.get(sessionToken);
  if (existing) return existing;

  const fallback: Subscription = {
    plan: "free",
    seats: 1,
    renewsAt: "2026-08-01",
    invoiceUrl: "https://billing.acme.com/invoices/latest",
  };
  SUBSCRIPTIONS.set(sessionToken, fallback);
  return fallback;
}
