import { Queue, Worker, type Job } from "bullmq";

import { callModel } from "../agent/model";
import { runTool } from "../agent/tools";

const connection = {
  host: process.env.REDIS_HOST ?? "127.0.0.1",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

export const agentQueue = new Queue("agent-step", { connection });

type StepJob = {
  runId: string;
  transcript: string;
};

// Each job performs exactly one model turn and enqueues its own follow-up.
export const agentWorker = new Worker<StepJob>(
  "agent-step",
  async (job: Job<StepJob>) => {
    const { runId, transcript } = job.data;

    const turn = await callModel(transcript);
    if (turn.toolCalls.length === 0) {
      await finish(runId, turn.text);
      return;
    }

    let next = `${transcript}\n${turn.text}`;
    for (const call of turn.toolCalls) {
      const result = await runTool(call);
      next += `\n<tool name="${call.name}">${result.output}</tool>`;
    }

    await agentQueue.add("agent-step", { runId, transcript: next });
  },
  { connection, concurrency: 8 },
);

async function finish(runId: string, text: string): Promise<void> {
  await fetch(`https://api.internal.example/runs/${encodeURIComponent(runId)}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
}
