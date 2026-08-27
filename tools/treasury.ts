import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ChainId } from "../types/fixture.js";

const FIXTURE_DIR = resolve(process.env.FIXTURE_DIR ?? "./fixtures/treasury_v1");
const POSITION_FIELDS = [
  "chainId",
  "assetId",
  "canonicalSymbol",
  "amount",
  "priceUsd",
  "valueUsd",
  "positionType",
  "source",
  "protocol",
  "marketId",
  "account",
  "usageAsCollateralEnabled",
  "debtType",
] as const;

interface StoredPosition {
  chainId: ChainId;
  assetId: string;
  canonicalSymbol: string;
  amount: string;
  priceUsd: string;
  valueUsd: string;
  positionType: "asset" | "liability";
  source: "native" | "spot" | "aave_v3";
  protocol?: "aave_v3";
  marketId?: string;
  account?: string;
  usageAsCollateralEnabled?: boolean;
  debtType?: "stable" | "variable" | "mixed";
}

interface PositionsFixture {
  positions: StoredPosition[];
}

interface PriceSeries {
  currency?: string;
  data?: Array<{ value?: string; timestamp?: string }>;
}

interface PricesFixture {
  snapshotTimestamp: string;
  chains: Record<
    string,
    {
      native?: PriceSeries;
      tokens?: Record<string, PriceSeries>;
    }
  >;
}

export type Position = Pick<StoredPosition, (typeof POSITION_FIELDS)[number]>;

export interface PriceResult {
  assetId: string;
  currency?: string;
  priceUsd?: string;
  timestamp?: string;
  error?: "not_found" | "no_price_observations";
}

export async function getPositions(input: { chainId?: ChainId } = {}): Promise<{
  positions: Position[];
}> {
  const fixture = await readFixture<PositionsFixture>("nav_positions.json");
  const selected =
    input.chainId == null
      ? fixture.positions
      : fixture.positions.filter((position) => position.chainId === input.chainId);
  return {
    positions: selected.map(
      (position) =>
        Object.fromEntries(
          POSITION_FIELDS.filter((field) => position[field] !== undefined).map((field) => [
            field,
            position[field],
          ]),
        ) as unknown as Position,
    ),
  };
}

export async function getPrices(input: { assetIds: string[] }): Promise<{
  snapshotTimestamp: string;
  prices: PriceResult[];
}> {
  if (!Array.isArray(input.assetIds) || input.assetIds.length === 0) {
    throw new Error("assetIds must contain at least one chainId:asset identifier");
  }
  if (input.assetIds.length > 100) throw new Error("assetIds is limited to 100 entries");
  const fixture = await readFixture<PricesFixture>("prices.json");
  return {
    snapshotTimestamp: fixture.snapshotTimestamp,
    prices: [...new Set(input.assetIds)].map((assetId) => priceForAsset(fixture, assetId)),
  };
}

export function calculator(input: { expression: string }): {
  expression: string;
  result: string;
} {
  const parser = new ArithmeticParser(input.expression);
  const result = parser.parse();
  if (!Number.isFinite(result)) throw new Error("expression result must be finite");
  return { expression: input.expression, result: String(result) };
}

async function readFixture<T>(name: "nav_positions.json" | "prices.json"): Promise<T> {
  return JSON.parse(await readFile(resolve(FIXTURE_DIR, name), "utf8")) as T;
}

function priceForAsset(fixture: PricesFixture, assetId: string): PriceResult {
  const separator = assetId.indexOf(":");
  if (separator < 1 || separator === assetId.length - 1) {
    return { assetId, error: "not_found" };
  }
  const chainId = assetId.slice(0, separator);
  const identifier = assetId.slice(separator + 1).toLowerCase();
  const chain = fixture.chains[chainId];
  const series = identifier === "native" ? chain?.native : chain?.tokens?.[identifier];
  if (!series) return { assetId, error: "not_found" };
  const observations =
    series.data?.filter(
      (point): point is { value: string; timestamp: string } =>
        typeof point.value === "string" && typeof point.timestamp === "string",
    ) ?? [];
  if (observations.length === 0) {
    return { assetId, currency: series.currency, error: "no_price_observations" };
  }
  const snapshot = Date.parse(fixture.snapshotTimestamp);
  const nearest = observations.reduce((best, point) =>
    Math.abs(Date.parse(point.timestamp) - snapshot) <
    Math.abs(Date.parse(best.timestamp) - snapshot)
      ? point
      : best,
  );
  return {
    assetId,
    currency: series.currency,
    priceUsd: nearest.value,
    timestamp: nearest.timestamp,
  };
}

class ArithmeticParser {
  private index = 0;

  constructor(private readonly expression: string) {
    if (expression.length === 0 || expression.length > 500) {
      throw new Error("expression must contain between 1 and 500 characters");
    }
  }

  parse(): number {
    const value = this.additive();
    this.whitespace();
    if (this.index !== this.expression.length) this.fail("unexpected token");
    return value;
  }

  private additive(): number {
    let value = this.multiplicative();
    while (true) {
      this.whitespace();
      if (this.consume("+")) value += this.multiplicative();
      else if (this.consume("-")) value -= this.multiplicative();
      else return value;
    }
  }

  private multiplicative(): number {
    let value = this.power();
    while (true) {
      this.whitespace();
      if (this.consume("*")) value *= this.power();
      else if (this.consume("/")) {
        const divisor = this.power();
        if (divisor === 0) throw new Error("division by zero");
        value /= divisor;
      } else return value;
    }
  }

  private power(): number {
    const base = this.unary();
    this.whitespace();
    return this.consume("^") ? base ** this.power() : base;
  }

  private unary(): number {
    this.whitespace();
    if (this.consume("+")) return this.unary();
    if (this.consume("-")) return -this.unary();
    return this.primary();
  }

  private primary(): number {
    this.whitespace();
    if (this.consume("(")) {
      const value = this.additive();
      this.whitespace();
      if (!this.consume(")")) this.fail("expected closing parenthesis");
      return value;
    }
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(this.expression.slice(this.index));
    if (!match) this.fail("expected number");
    this.index += match![0].length;
    return Number(match![0]);
  }

  private consume(token: string): boolean {
    if (!this.expression.startsWith(token, this.index)) return false;
    this.index += token.length;
    return true;
  }

  private whitespace(): void {
    while (/\s/.test(this.expression[this.index] ?? "")) this.index += 1;
  }

  private fail(message: string): never {
    throw new Error(`${message} at character ${this.index + 1}`);
  }
}
