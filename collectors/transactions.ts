import type { Address } from 'viem'
import { CHAINS, LOOKBACK_DAYS, TREASURY_WALLETS } from '../config.js'
import { collectManifest } from './manifest.js'
import { getAssetTransfersAll, rpc, type AssetTransferPage } from '../lib/alchemy.js'
import { blockAtOrBefore } from '../lib/blocks.js'
import { fixturePath, isMain, writeJson } from '../lib/io.js'
import {
  blockscoutErc20Transfers,
  blockscoutNormalTransactions,
} from '../lib/blockscout.js'
import type {
  AccountHistoryResult,
  Erc20Transfer,
  NormalTransaction,
} from '../lib/account-history.js'
import {
  routescanErc20Transfers,
  routescanNormalTransactions,
} from '../lib/routescan.js'
import type { ChainId, ChainMap, JsonRpcReceipt } from '../types/fixture.js'

const ALCHEMY_TRANSFER_CHAINS = new Set<ChainId>([1, 42161, 8453])
const BLOCKSCOUT_CHAINS = new Set<ChainId>([42161, 8453])

export interface WalletTransactionsFixture {
  fromBlock: string
  toBlock: string
  normalTransactions: AccountHistoryResult<NormalTransaction>
  erc20Transfers: AccountHistoryResult<Erc20Transfer>
  alchemyTransfers: {
    outgoing: AssetTransferPage[]
    incoming: AssetTransferPage[]
  } | null
  receipts: Record<string, JsonRpcReceipt | { error: string }>
}

export interface TransactionsFixture {
  fromTimestamp: string
  toTimestamp: string
  chains: ChainMap<Record<string, WalletTransactionsFixture>>
}

export async function collectTransactions(): Promise<TransactionsFixture> {
  const manifest = await collectManifest()
  const fromTime = new Date(
    new Date(manifest.snapshotTimestamp).getTime() - LOOKBACK_DAYS * 86_400_000,
  ).toISOString()

  const chains = {} as ChainMap<Record<string, WalletTransactionsFixture>>

  for (const chain of Object.values(CHAINS)) {
    const fromBlockInfo = await blockAtOrBefore(chain.id, fromTime)
    const fromBlock = BigInt(fromBlockInfo.blockNumber)
    const toBlock = BigInt(manifest.chains[chain.id].blockNumber)
    chains[chain.id] = {}

    for (const wallet of TREASURY_WALLETS[chain.id]) {
      console.log(`transactions ${chain.name} ${wallet}`)

      const range = {
        fromBlock: fromBlock.toString(),
        toBlock: toBlock.toString(),
      }
      const useBlockscout = BLOCKSCOUT_CHAINS.has(chain.id)

      // Normal transactions preserve zero-value contract calls and calldata.
      const normal = useBlockscout
        ? await blockscoutNormalTransactions(chain.id, wallet, range)
        : await routescanNormalTransactions(chain.id, wallet, range)

      // ERC-20 transfer history gives a common transfer source across all chains.
      const erc20 = useBlockscout
        ? await blockscoutErc20Transfers(chain.id, wallet, range)
        : await routescanErc20Transfers(chain.id, wallet, range)

      let alchemyTransfers: WalletTransactionsFixture['alchemyTransfers'] = null
      if (ALCHEMY_TRANSFER_CHAINS.has(chain.id)) {
        const common = {
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: `0x${toBlock.toString(16)}`,
          category: ['external', 'erc20'],
          withMetadata: true,
          excludeZeroValue: true,
          order: 'asc',
        }

        const [outgoing, incoming] = await Promise.all([
          getAssetTransfersAll(chain.id, { ...common, fromAddress: wallet }),
          getAssetTransfersAll(chain.id, { ...common, toAddress: wallet }),
        ])
        alchemyTransfers = { outgoing, incoming }
      }

      const outgoingHashes = [...new Set(
        normal.items
          .filter((tx) => tx.from?.toLowerCase() === wallet.toLowerCase())
          .map((tx) => tx.hash)
          .filter((hash): hash is `0x${string}` => Boolean(hash)),
      )]

      const receipts: WalletTransactionsFixture['receipts'] = {}
      for (const hash of outgoingHashes) {
        try {
          receipts[hash] = await rpc<JsonRpcReceipt>(chain.id, 'eth_getTransactionReceipt', [hash])
        } catch (error) {
          receipts[hash] = { error: String(error) }
        }
      }

      chains[chain.id][wallet.toLowerCase()] = {
        fromBlock: fromBlock.toString(),
        toBlock: toBlock.toString(),
        normalTransactions: normal,
        erc20Transfers: erc20,
        alchemyTransfers,
        receipts,
      }
    }
  }

  const out: TransactionsFixture = {
    fromTimestamp: fromTime,
    toTimestamp: manifest.snapshotTimestamp,
    chains,
  }

  await writeJson(fixturePath('transactions.json'), out)
  return out
}

if (isMain(import.meta.url)) await collectTransactions()
