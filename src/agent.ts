import { tool } from "ai";
import { z } from "zod";
import * as t from "../tools/index.js";

export const SYSTEM_PROMPT =
  "You are a treasury analyst. Ground every figure in tool output. " +
  "Every subtotal, ratio, percentage, and other derived figure in the final answer must be the " +
  "result of a calculator call. If you did not obtain a derived figure as calculator output, omit " +
  "it from the answer. " +
  "Do not claim a liquidation margin, health factor, or safety level without the required risk " +
  "parameters. Analyze concentration without recommending trades, allocation changes, or hedges. " +
  "Only call tools whose results you use. " +
  "If the data cannot answer the question, say so instead of estimating.";

export const tools = {
  getPositions: tool({
    description:
      "Treasury positions with amount, price, and USD value. " +
      'positionType "liability" means debt owed — subtract it. ' +
      "Aave collateral and debt are isolated by marketId and account; never treat assets in a " +
      "different market or account as collateral for a liability. usageAsCollateralEnabled is " +
      "meaningful only for Aave asset positions. Omit chainId for all chains.",
    inputSchema: z.object({
      chainId: z.coerce
        .number()
        .pipe(z.union([z.literal(1), z.literal(8453), z.literal(42161), z.literal(43114)]))
        .optional(),
    }),
    execute: t.getPositions,
  }),
  getPrices: tool({
    description:
      'Snapshot USD prices by assetId ("<chainId>:<contractAddress>" or "<chainId>:native").',
    inputSchema: z.object({ assetIds: z.array(z.string()).min(1).max(100) }),
    execute: t.getPrices,
  }),
  calculator: tool({
    description: "Evaluate arithmetic. Use this for every calculation — do not compute mentally.",
    inputSchema: z.object({ expression: z.string().min(1).max(500) }),
    execute: async (i) => t.calculator(i),
  }),
};
