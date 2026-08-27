import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs } from "ai";
import "dotenv/config";
import { appendFile } from "node:fs/promises";
import { tools } from "./agent.js";

const question = process.argv[2]!;
const runId = crypto.randomUUID();

const { text, steps } = await generateText({
  model: anthropic("claude-sonnet-5"),
  tools,
  stopWhen: stepCountIs(10),
  system:
    "You are a treasury analyst. Ground every figure in tool output. " +
    "If the data cannot answer the question, say so instead of estimating.",
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
