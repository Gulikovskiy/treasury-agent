import type { Address } from 'viem'
import type {
  AccountHistoryRange,
  AccountHistoryResult,
  AccountPage,
  Erc20Transfer,
  NormalTransaction,
} from './account-history.js'
import type { ChainId } from '../types/fixture.js'

const BLOCKSCOUT_CHAIN_IDS = [42161, 8453] as const satisfies readonly ChainId[]

const configuredKey = process.env.BLOCKSCOUT_API_KEY
if (!configuredKey) throw new Error('BLOCKSCOUT_API_KEY is required')
const key: string = configuredKey
const REQUEST_INTERVAL_MS = 1050

let requestQueue = Promise.resolve()
let lastRequestStartedAt = 0

async function waitForRateLimit(): Promise<void> {
  const turn = requestQueue.then(async () => {
    const waitMs = Math.max(0, REQUEST_INTERVAL_MS - (Date.now() - lastRequestStartedAt))
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
    lastRequestStartedAt = Date.now()
  })

  requestQueue = turn.catch(() => undefined)
  await turn
}

async function blockscoutAccount<T>(
  chainId: ChainId,
  action: string,
  address: Address,
  { fromBlock, toBlock }: AccountHistoryRange,
): Promise<AccountHistoryResult<T>> {
  if (!(BLOCKSCOUT_CHAIN_IDS as readonly ChainId[]).includes(chainId))
    throw new Error(`Blockscout is not configured for chain ${chainId}`)

  const all: T[] = []
  const pages: AccountPage<T>[] = []
  const offset = 100
  let page = 1

  while (true) {
    const url = new URL('https://api.blockscout.com/v2/api')
    url.searchParams.set('chain_id', String(chainId))
    url.searchParams.set('module', 'account')
    url.searchParams.set('action', action)
    url.searchParams.set('address', address)
    url.searchParams.set('startblock', fromBlock)
    url.searchParams.set('endblock', toBlock)
    url.searchParams.set('page', String(page))
    url.searchParams.set('offset', String(offset))
    url.searchParams.set('sort', 'asc')
    url.searchParams.set('apikey', key)

    await waitForRateLimit()
    const response = await fetch(url)
    const json = await response.json() as AccountPage<T>
    if (!response.ok) {
      throw new Error(`Blockscout ${action} ${chainId} failed: ${JSON.stringify(json)}`)
    }

    if (json.status === '0' && /no transactions/i.test(String(json.result ?? json.message ?? ''))) {
      pages.push(json)
      break
    }

    if (!Array.isArray(json.result)) {
      throw new Error(`Blockscout ${action} ${chainId} unexpected response: ${JSON.stringify(json)}`)
    }

    pages.push(json)
    all.push(...json.result)
    if (json.result.length < offset) break
    page += 1
  }

  return { items: all, pages }
}

export function blockscoutNormalTransactions(
  chainId: ChainId,
  address: Address,
  range: AccountHistoryRange,
): Promise<AccountHistoryResult<NormalTransaction>> {
  return blockscoutAccount(chainId, 'txlist', address, range)
}

export function blockscoutErc20Transfers(
  chainId: ChainId,
  address: Address,
  range: AccountHistoryRange,
): Promise<AccountHistoryResult<Erc20Transfer>> {
  return blockscoutAccount(chainId, 'tokentx', address, range)
}
