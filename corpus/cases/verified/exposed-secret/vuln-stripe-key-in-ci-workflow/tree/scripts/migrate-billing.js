const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

async function main() {
  const prices = await stripe.prices.list({ limit: 100, active: true });
  for (const price of prices.data) {
    if (!price.metadata.plan_code) {
      console.warn(`price ${price.id} is missing plan_code, skipping`);
      continue;
    }
    console.log(`migrating ${price.metadata.plan_code} -> ${price.id}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
