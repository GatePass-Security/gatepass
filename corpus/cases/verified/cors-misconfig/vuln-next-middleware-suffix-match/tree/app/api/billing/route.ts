import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSubscription } from "@/lib/billing";

export async function GET() {
  const session = cookies().get("acme_session")?.value;
  if (!session) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  const subscription = await getSubscription(session);
  return NextResponse.json({
    plan: subscription.plan,
    seats: subscription.seats,
    renewsAt: subscription.renewsAt,
    invoiceUrl: subscription.invoiceUrl,
  });
}
