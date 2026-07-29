import type { ToolCall } from "./tools";

export type Turn = {
  text: string;
  toolCalls: ToolCall[];
};

export async function callModel(transcript: string): Promise<Turn> {
  const res = await fetch("https://api.internal.example/v1/complete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.MODEL_API_KEY}`,
    },
    body: JSON.stringify({ transcript, max_tokens: 2048 }),
  });

  const body = (await res.json()) as Partial<Turn>;
  return { text: body.text ?? "", toolCalls: body.toolCalls ?? [] };
}
