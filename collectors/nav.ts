import type { Address } from "viem";
import { NAV_DUST_USD, NAV_TOKEN_ALLOWLIST } from "../config.js";
import { fixturePath, isMain, readJson, writeJson } from "../lib/io.js";
import type { BalancesFixture, ChainId } from "../types/fixture.js";
import type { DefiPositionsFixture } from "./defi-positions.js";
import type { PricesFixture } from "./prices.js";

interface NavPosition {
  chainId: ChainId;
  wallet: string;
  assetId: string;
  contractAddress: Address | null;
  canonicalSymbol: string;
  decimals: number;
  source: "native" | "spot" | "aave_v3";
  positionType: "asset" | "liability";
  amount: string;
  priceUsd: string;
  valueUsd: string;
  protocol?: "aave_v3";
  marketId?: string;
  account?: string;
  usageAsCollateralEnabled?: boolean;
  debtType?: "stable" | "variable" | "mixed";
}

interface ExcludedPosition {
  chainId: ChainId;
  wallet: string;
  assetId: string;
  contractAddress: Address | null;
  source: "native" | "spot" | "aave_v3";
  rawAmount?: string;
  balanceRef?: string;
  reason: "not_allowlisted" | "collection_error" | "unpriced" | "below_dust";
}

interface NavPositionsFixture {
  identityKey: "chainId + contractAddress";
  minimumUsdValue: number;
  positions: NavPosition[];
  excluded: ExcludedPosition[];
}

const NATIVE_SYMBOL: Record<ChainId, string> = {
  1: "ETH",
  43114: "AVAX",
  42161: "ETH",
  8453: "ETH",
};

function decimalAmount(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const absolute = negative ? -raw : raw;
  const padded = absolute.toString().padStart(decimals + 1, "0");
  const integer = decimals === 0 ? padded : padded.slice(0, -decimals);
  const fraction = decimals === 0 ? "" : padded.slice(-decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

function historicalPriceValue(value: unknown, targetTimestamp: string): string | null {
  if (!value || typeof value !== "object") return null;
  const data = (value as { data?: Array<{ value?: unknown; timestamp?: string }> }).data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const target = new Date(targetTimestamp).getTime();
  const nearest = data
    .filter((point) => typeof point.value === "string" && point.timestamp)
    .map((point) => ({
      ...point,
      distance: Math.abs(new Date(point.timestamp!).getTime() - target),
    }))
    .sort((a, b) => a.distance - b.distance)[0];
  return typeof nearest?.value === "string" && Number.isFinite(Number(nearest.value))
    ? nearest.value
    : null;
}

// Prices and token units are multiplied as integers, with half-up rounding to
// cents. This keeps the accounting output deterministic and avoids IEEE-754
// drift even for large positions; Number is used only to validate price text.
function usdValueCents(rawAmount: bigint, decimals: number, priceUsd: string): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(priceUsd);
  if (!match) throw new Error(`Invalid USD price: ${priceUsd}`);
  const fractional = match[2] ?? "";
  const priceUnits = BigInt(`${match[1]}${fractional}`);
  const denominator = 10n ** BigInt(decimals + fractional.length);
  const numerator = rawAmount * priceUnits * 100n;
  return (numerator + denominator / 2n) / denominator;
}

function formatUsdCents(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  return `${negative ? "-" : ""}${absolute / 100n}.${(absolute % 100n)
    .toString()
    .padStart(2, "0")}`;
}

export async function collectNavPositions(): Promise<NavPositionsFixture> {
  const [balances, defi, prices] = await Promise.all([
    readJson<BalancesFixture>(fixturePath("balances.json")),
    readJson<DefiPositionsFixture>(fixturePath("defi_positions.json")),
    readJson<PricesFixture>(fixturePath("prices.json")),
  ]);
  const positions: NavPosition[] = [];
  const excluded: ExcludedPosition[] = [];

  function addPosition(
    input: Omit<NavPosition, "amount" | "priceUsd" | "valueUsd"> & {
      rawAmount: bigint;
      price: unknown;
    },
  ): void {
    const { rawAmount, price, ...base } = input;
    const amount = decimalAmount(rawAmount, base.decimals);
    const priceUsd = historicalPriceValue(price, prices.snapshotTimestamp);
    if (!priceUsd) {
      excluded.push({
        chainId: base.chainId,
        wallet: base.wallet,
        assetId: base.assetId,
        contractAddress: base.contractAddress,
        source: base.source,
        rawAmount: rawAmount.toString(),
        reason: "unpriced",
      });
      return;
    }
    const unsignedValueCents = usdValueCents(rawAmount, base.decimals, priceUsd);
    if (unsignedValueCents < BigInt(Math.round(NAV_DUST_USD * 100))) {
      excluded.push({
        chainId: base.chainId,
        wallet: base.wallet,
        assetId: base.assetId,
        contractAddress: base.contractAddress,
        source: base.source,
        rawAmount: rawAmount.toString(),
        reason: "below_dust",
      });
      return;
    }
    const signedValueCents =
      base.positionType === "liability" ? -unsignedValueCents : unsignedValueCents;
    positions.push({
      ...base,
      amount,
      priceUsd,
      valueUsd: formatUsdCents(signedValueCents),
    });
  }

  for (const [rawChainId, wallets] of Object.entries(balances.chains)) {
    const chainId = Number(rawChainId) as ChainId;
    for (const [wallet, balance] of Object.entries(wallets)) {
      if (!balance) continue;
      addPosition({
        chainId,
        wallet,
        assetId: `${chainId}:native`,
        contractAddress: null,
        canonicalSymbol: NATIVE_SYMBOL[chainId],
        decimals: 18,
        source: "native",
        positionType: "asset",
        rawAmount: BigInt(balance.native.tokenBalanceDecimal),
        price: prices.chains[chainId].native,
      });

      for (const [tokenIndex, token] of balance.erc20.entries()) {
        const address = token.contractAddress.toLowerCase();
        const asset = NAV_TOKEN_ALLOWLIST[chainId][address];
        const balanceRef = `balances.json#/chains/${chainId}/${wallet}/erc20/${tokenIndex}`;
        if (!asset) {
          excluded.push({
            chainId,
            wallet,
            assetId: `${chainId}:${address}`,
            contractAddress: token.contractAddress,
            source: "spot",
            rawAmount: token.tokenBalanceDecimal,
            balanceRef,
            reason: "not_allowlisted",
          });
          continue;
        }
        if (!token.tokenBalanceDecimal) {
          excluded.push({
            chainId,
            wallet,
            assetId: `${chainId}:${address}`,
            contractAddress: token.contractAddress,
            source: "spot",
            balanceRef,
            reason: "collection_error",
          });
          continue;
        }
        addPosition({
          chainId,
          wallet,
          assetId: `${chainId}:${address}`,
          contractAddress: token.contractAddress,
          canonicalSymbol: asset.canonicalSymbol,
          decimals: asset.decimals,
          source: "spot",
          positionType: "asset",
          rawAmount: BigInt(token.tokenBalanceDecimal),
          price: prices.chains[chainId].tokens[address],
        });
      }
    }
  }

  for (const [rawChainId, chain] of Object.entries(defi.protocols.aave_v3)) {
    const chainId = Number(rawChainId) as ChainId;
    if (!chain) continue;
    for (const [wallet, walletPositions] of Object.entries(chain.wallets)) {
      for (const position of walletPositions) {
        const common = {
          chainId,
          wallet,
          assetId: position.assetId,
          contractAddress: position.underlyingAsset,
          canonicalSymbol: position.canonicalSymbol,
          decimals: position.decimals,
          source: "aave_v3" as const,
          protocol: "aave_v3" as const,
          marketId: `aave_v3:${chainId}`,
          account: wallet,
          price: prices.chains[chainId].tokens[position.underlyingAsset.toLowerCase()],
        };
        const supplied = BigInt(position.currentATokenBalance);
        if (supplied > 0n)
          addPosition({
            ...common,
            positionType: "asset",
            usageAsCollateralEnabled: position.usageAsCollateralEnabled,
            rawAmount: supplied,
          });
        const debt = BigInt(position.currentStableDebt) + BigInt(position.currentVariableDebt);
        if (debt > 0n)
          addPosition({
            ...common,
            positionType: "liability",
            usageAsCollateralEnabled: false,
            debtType:
              BigInt(position.currentStableDebt) > 0n && BigInt(position.currentVariableDebt) > 0n
                ? "mixed"
                : BigInt(position.currentStableDebt) > 0n
                  ? "stable"
                  : "variable",
            rawAmount: debt,
          });
      }
    }
  }

  const out: NavPositionsFixture = {
    identityKey: "chainId + contractAddress",
    minimumUsdValue: NAV_DUST_USD,
    positions,
    excluded,
  };
  await writeJson(fixturePath("nav_positions.json"), out);
  return out;
}

if (isMain(import.meta.url)) await collectNavPositions();
