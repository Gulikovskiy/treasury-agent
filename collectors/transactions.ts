import type { Address } from 'viem'
import { CHAINS, TREASURY_WALLETS } from '../config.js'
import { collectManifest } from './manifest.js'
import { getAssetTransfersAll, rpc, type AssetTransferPage } from '../lib/alchemy.js'
import { fixturePath, isMain, writeJson } from '../lib/io.js'
import {
  blockscoutErc20Transfers,
  blockscoutNormalTransactions,
} from '../lib/blockscout.js'
import type {
  AccountHistoryFixtureResult,
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
const NORMAL_TRANSACTION_FIELDS = [
  'hash', 'from', 'to', 'contractAddress', 'input', 'value', 'gas', 'gasUsed',
  'gasPrice', 'blockNumber', 'timeStamp', 'nonce', 'isError', 'methodId',
] as const
const ERC20_TRANSFER_FIELDS = [
  'hash', 'from', 'to', 'contractAddress', 'value', 'tokenDecimal',
  'blockNumber', 'timeStamp',
] as const

function pickFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(fields.flatMap((field) =>
    value[field] === undefined ? [] : [[field, value[field]]],
  ))
}

function safeAccountHistory<T>(
  result: { items: T[]; pages: unknown[] },
  fields: readonly string[],
): AccountHistoryFixtureResult<T> {
  return {
    items: result.items.map((item) => pickFields(
      item as Record<string, unknown>,
      fields,
    ) as T),
    pageCount: result.pages.length,
  }
}

export interface SafeAssetTransfer {
  uniqueId?: string
  category?: string
  blockNum?: string
  hash?: `0x${string}`
  from?: Address
  to?: Address
  value?: number
  rawContract?: { address?: Address | null; decimal?: string | null }
  metadata?: { blockTimestamp?: string }
}

function safeAssetTransfers(pages: AssetTransferPage[]): SafeAssetTransfer[] {
  return pages.flatMap((page) => (page.transfers ?? []).map((transfer) => ({
    ...pickFields(transfer, [
      'uniqueId', 'category', 'blockNum', 'hash', 'from', 'to', 'value',
    ]),
    ...(transfer.rawContract && {
      rawContract: pickFields(transfer.rawContract, ['address', 'decimal']),
    }),
    ...(transfer.metadata && typeof transfer.metadata === 'object' ? {
      metadata: pickFields(
        transfer.metadata as Record<string, unknown>,
        ['blockTimestamp'],
      ),
    } : {}),
  } as SafeAssetTransfer)))
}

export interface WalletTransactionsFixture {
  fromBlock: string
  toBlock: string
  normalTransactions: AccountHistoryFixtureResult<NormalTransaction>
  erc20Transfers: AccountHistoryFixtureResult<Erc20Transfer>
  alchemyTransfers: {
    outgoing: SafeAssetTransfer[]
    incoming: SafeAssetTransfer[]
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
  const fromTime = manifest.historyFromTimestamp

  const chains = {} as ChainMap<Record<string, WalletTransactionsFixture>>

  for (const chain of Object.values(CHAINS)) {
    const fromBlock = BigInt(manifest.chains[chain.id].historyFrom.blockNumber)
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
      const normalRaw = useBlockscout
        ? await blockscoutNormalTransactions(chain.id, wallet, range)
        : await routescanNormalTransactions(chain.id, wallet, range)
      const normal = safeAccountHistory<NormalTransaction>(
        normalRaw,
        NORMAL_TRANSACTION_FIELDS,
      )

      // ERC-20 transfer history gives a common transfer source across all chains.
      const erc20Raw = useBlockscout
        ? await blockscoutErc20Transfers(chain.id, wallet, range)
        : await routescanErc20Transfers(chain.id, wallet, range)
      const erc20 = safeAccountHistory<Erc20Transfer>(erc20Raw, ERC20_TRANSFER_FIELDS)

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
        alchemyTransfers = {
          outgoing: safeAssetTransfers(outgoing),
          incoming: safeAssetTransfers(incoming),
        }
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
