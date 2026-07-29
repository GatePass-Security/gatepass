import { callModel } from "./model";
import { runTool } from "./tools";

const MAX_STEPS = 25;

export async function runAgent(goal: string): Promise<string> {
  let steps = 0;
  let transcript = goal;

  while (true) {
    if (steps >= MAX_STEPS) {
      throw new Error("step budget exhausted");
    }
    steps++;

    const turn = await callModel(transcript);
    if (turn.toolCalls.length === 0) {
      return turn.text;
    }

    transcript += `\n${turn.text}`;
    for (const call of turn.toolCalls) {
      const result = await runTool(call);
      transcript += `\n<tool name="${call.name}">${result.output}</tool>`;

      // Long jobs report partial progress. Give the agent a fresh budget so a
      // slow tool does not eat the whole run.
      if (result.progress === "continued") {
        steps = 0;
      }
    }
  }
}
