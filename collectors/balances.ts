import { formatEther, toHex } from "viem";
import { CHAINS, TREASURY_WALLETS } from "../config.js";
import { collectManifest } from "./manifest.js";
import { discoverErc20s, getTokenMetadata, publicClient } from "../lib/alchemy.js";
import { ERC20_ABI } from "../lib/abis.js";
import { fixturePath, isMain, writeJson } from "../lib/io.js";
import type {
  BalancesFixture,
  ChainMap,
  Erc20BalanceFixture,
  WalletBalanceFixture,
  WalletMap,
} from "../types/fixture.js";

export async function collectBalances(): Promise<BalancesFixture> {
  const manifest = await collectManifest();
  const chains = {} as ChainMap<WalletMap<WalletBalanceFixture>>;

  for (const chain of Object.values(CHAINS)) {
    const client = publicClient(chain.id);
    const blockNumber = BigInt(manifest.chains[chain.id].blockNumber);
    chains[chain.id] = {};

    for (const wallet of TREASURY_WALLETS[chain.id]) {
      console.log(`balances ${chain.name} ${wallet}`);
      const discovery = await discoverErc20s(chain.id, wallet);
      const native = await client.getBalance({ address: wallet, blockNumber });
      const erc20: Erc20BalanceFixture[] = [];

      for (const contractAddress of discovery.contracts) {
        try {
          const balance = await client.readContract({
            address: contractAddress,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [wallet],
            blockNumber,
          });

          if (balance === 0n) continue;

          let metadata: unknown = null;
          try {
            metadata = await getTokenMetadata(chain.id, contractAddress);
          } catch {
            // Raw collection keeps balances even when display metadata fails.
          }

          erc20.push({
            contractAddress,
            tokenBalance: toHex(balance),
            tokenBalanceDecimal: balance.toString(),
            metadata,
            metadataTrust: "untrusted",
          });
        } catch (error) {
          erc20.push({
            contractAddress,
            error: String(error),
          });
        }
      }

      chains[chain.id][wallet.toLowerCase() as Lowercase<typeof wallet>] = {
        blockNumber: blockNumber.toString(),
        native: {
          tokenBalance: toHex(native),
          tokenBalanceDecimal: native.toString(),
          formatted: formatEther(native),
        },
        erc20,
        // Non-reproducible Token API discovery evidence. Never use as NAV input.
        discoveryRaw: discovery.pages,
      };
    }
  }

  const out: BalancesFixture = { chains };
  await writeJson(fixturePath("balances.json"), out);
  return out;
}

if (isMain(import.meta.url)) await collectBalances();
