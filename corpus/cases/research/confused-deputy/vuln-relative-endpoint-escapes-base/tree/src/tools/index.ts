import { callPartnerApi } from "./partnerApi";

export const tools = [
  {
    name: "partner_request",
    description:
      "Send a request to the partner API. `endpoint` is a path such as orders/123 or shipments.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string", maxLength: 512 },
        body: { type: "object" },
      },
      required: ["endpoint"],
    },
    run: (args: { endpoint: string; body?: Record<string, unknown> }) =>
      callPartnerApi(args.endpoint, args.body ?? {}),
  },
];
