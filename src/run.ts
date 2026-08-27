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
    "Use the calculator for every derived number you present, including subtotals, table rows, " +
    "percentages, ratios, and rounded figures; never do presentation arithmetic mentally. " +
    "Preserve chain, marketId, and account boundaries: assets collateralize a liability only when " +
    "they share its marketId and account and usageAsCollateralEnabled is true. Never call pooled " +
    "cross-market supply collateral or LTV. Distinguish gross assets or supply from net NAV or " +
    "exposure and label the denominator of every ratio. Do not claim a liquidation margin, health " +
    "factor, or safety level without the required risk parameters. Analyze concentration without " +
    "recommending trades, allocation changes, or hedges. Only call tools whose results you use. " +
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
