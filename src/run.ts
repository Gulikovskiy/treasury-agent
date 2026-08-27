import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs } from "ai";
import "dotenv/config";
import { appendFile } from "node:fs/promises";
import { SYSTEM_PROMPT, tools } from "./agent.js";

const question = process.argv[2]!;
const runId = crypto.randomUUID();

const { text, steps } = await generateText({
  model: anthropic("claude-sonnet-5"),
  tools,
  stopWhen: stepCountIs(10),
  system: SYSTEM_PROMPT,
  messages: [{ role: "user", content: question }],
});

for (const [i, s] of steps.entries()) {
  await appendFile(
    "traces.jsonl",
    JSON.stringify({
      runId,
      question,
      step: i,
      toolCalls: s.toolCalls,
      toolResults: s.toolResults,
      text: s.text,
    }) + "\n",
  );
}

console.log(text);
