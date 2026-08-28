import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs } from "ai";
import "dotenv/config";
import { appendFile } from "node:fs/promises";
import { SYSTEM_PROMPT, tools } from "./agent.js";
import { generateGroundedAnswer } from "./generate.js";

const question = process.argv[2]!;
const runId = crypto.randomUUID();

const { text, steps } = await generateGroundedAnswer({
  runId,
  question,
  messages: [{ role: "user", content: question }],
  generate: async (messages) =>
    generateText({
      model: anthropic("claude-sonnet-5"),
      tools,
      stopWhen: stepCountIs(10),
      system: SYSTEM_PROMPT,
      messages,
    }),
});

for (const s of steps) {
  await appendFile(
    "traces.jsonl",
    JSON.stringify({
      runId,
      question,
      step: s.step,
      toolCalls: s.toolCalls,
      toolResults: s.toolResults,
      text: s.text,
      guardrail: s.guardrail,
      generation: s.generation,
    }) + "\n",
  );
}

console.log(text);
