import { publicClient } from "./alchemy.js";
import type { ChainId } from "../types/fixture.js";

export interface BlockSnapshot {
  blockNumber: string;
  blockHash: `0x${string}` | null;
  blockTimestamp: string;
}

// Finds the highest block whose timestamp <= target timestamp.
export async function blockAtOrBefore(
  chainId: ChainId,
  isoTimestamp: string,
): Promise<BlockSnapshot> {
  const client = publicClient(chainId);
  const timestampMs = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(timestampMs)) throw new Error(`Invalid ISO timestamp: ${isoTimestamp}`);

  const target = BigInt(Math.floor(timestampMs / 1000));
  let lo = 0n;
  let hi = await client.getBlockNumber();

  while (lo < hi) {
    const mid = (lo + hi + 1n) >> 1n;
    const block = await client.getBlock({ blockNumber: mid });
    if (block.timestamp <= target) lo = mid;
    else hi = mid - 1n;
  }

  const block = await client.getBlock({ blockNumber: lo });
  return {
    blockNumber: lo.toString(),
    blockHash: block.hash,
    blockTimestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
  };
}
