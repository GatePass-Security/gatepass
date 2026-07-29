import { createInterface } from "node:readline/promises";

export type ToolCall = { name: string; args: Record<string, unknown> };
export type Turn = { text: string; toolCalls: ToolCall[] };

export type Deps = {
  callModel: (transcript: string) => Promise<Turn>;
  runTool: (call: ToolCall) => Promise<string>;
};

/**
 * Interactive session. Every iteration blocks on a human typing the next
 * instruction, and every tool call needs an explicit approval, so the agent
 * can never advance on its own.
 */
export async function repl(deps: Deps): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let transcript = "";

  while (true) {
    const instruction = (await rl.question("> ")).trim();
    if (instruction === "" || instruction === "/quit") break;

    transcript += `\nuser: ${instruction}`;
    const turn = await deps.callModel(transcript);
    console.log(turn.text);
    transcript += `\nassistant: ${turn.text}`;

    for (const call of turn.toolCalls) {
      const answer = await rl.question(`run ${call.name}? [y/N] `);
      if (answer.trim().toLowerCase() !== "y") {
        transcript += `\n<tool name="${call.name}">denied by operator</tool>`;
        continue;
      }
      const output = await deps.runTool(call);
      transcript += `\n<tool name="${call.name}">${output}</tool>`;
    }
  }

  rl.close();
}
