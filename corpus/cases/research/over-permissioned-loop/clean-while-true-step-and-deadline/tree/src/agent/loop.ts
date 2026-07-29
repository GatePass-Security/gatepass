export type ToolCall = { name: string; args: Record<string, unknown> };
export type Turn = { text: string; toolCalls: ToolCall[] };

export type Deps = {
  callModel: (transcript: string) => Promise<Turn>;
  runTool: (call: ToolCall) => Promise<{ output: string }>;
};

export type RunResult = {
  status: "done" | "step_limit" | "timeout";
  text: string;
  steps: number;
};

const MAX_STEPS = 30;
const WALL_CLOCK_MS = 5 * 60 * 1000;

export async function runAgent(goal: string, deps: Deps): Promise<RunResult> {
  let steps = 0;
  let transcript = goal;
  const deadline = Date.now() + WALL_CLOCK_MS;

  while (true) {
    if (++steps > MAX_STEPS) {
      return { status: "step_limit", text: transcript, steps: steps - 1 };
    }
    if (Date.now() > deadline) {
      return { status: "timeout", text: transcript, steps: steps - 1 };
    }

    const turn = await deps.callModel(transcript);
    if (turn.toolCalls.length === 0) {
      return { status: "done", text: turn.text, steps };
    }

    transcript += `\n${turn.text}`;
    for (const call of turn.toolCalls) {
      const result = await deps.runTool(call);
      transcript += `\n<tool name="${call.name}">${result.output}</tool>`;
    }
  }
}
