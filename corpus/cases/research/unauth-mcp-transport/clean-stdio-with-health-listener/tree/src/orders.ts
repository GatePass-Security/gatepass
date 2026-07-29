export type LineItem = { sku: string; qty: number; unitPrice: number };
export type Order = { id: string; status: string; items: LineItem[] };

const ORDERS = new Map<string, Order>([
  [
    "ord_9f3a1c72b0d4",
    {
      id: "ord_9f3a1c72b0d4",
      status: "shipped",
      items: [{ sku: "SKU-1001", qty: 2, unitPrice: 1899 }],
    },
  ],
]);

export async function lookupOrder(orderId: string): Promise<Order> {
  const order = ORDERS.get(orderId);
  if (!order) {
    throw new Error(`no such order: ${orderId}`);
  }
  return order;
}
