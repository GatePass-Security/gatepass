export type ToolCall = {
  name: string;
  args: Record<string, unknown>;
};

export type ToolResult = {
  output: string;
  progress?: "done" | "continued";
};

const GATEWAY = "https://tools.internal.example/invoke";

export async function runTool(call: ToolCall): Promise<ToolResult> {
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(call),
  });

  const body = (await res.json()) as Partial<ToolResult>;
  return {
    output: String(body.output ?? ""),
    progress: body.progress,
  };
}
