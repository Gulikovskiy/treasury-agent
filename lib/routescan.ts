import type { Address } from 'viem'
import type {
  AccountHistoryRange,
  AccountHistoryResult,
  AccountPage,
  Erc20Transfer,
  NormalTransaction,
} from './account-history.js'
import type { ChainId } from '../types/fixture.js'

const key = process.env.ROUTESCAN_API_KEY
const REQUEST_INTERVAL_MS = 550

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

async function etherscanAccount<T>(
  chainId: ChainId,
  action: string,
  params: Record<string, string | number | undefined>,
): Promise<AccountHistoryResult<T>> {
  const all: T[] = []
  const pages: AccountPage<T>[] = []
  const offset = 100
  let page = 1

  while (true) {
    const url = new URL(`https://api.routescan.io/v2/network/mainnet/evm/${chainId}/etherscan/api`)
    // const url = new URL(`https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api\?module=account&action=balance\&address=0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae&tag=latest`)
    url.searchParams.set('module', 'account')
    url.searchParams.set('action', action)
    url.searchParams.set('page', String(page))
    url.searchParams.set('offset', String(offset))
    url.searchParams.set('sort', 'asc')

    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, String(v))
    }

    // Routescan's free tier permits at most two request starts per second.
    // Throttle here so back-to-back transaction types and pagination are covered.
    await waitForRateLimit()
    const response = await fetch(url, { headers: key ? { apikey: key } : {} })
    const json = await response.json() as AccountPage<T>
    if (!response.ok) {
      throw new Error(`Routescan ${action} ${chainId} failed: ${JSON.stringify(json)}`)
    }

    if (json.status === '0' && /no transactions/i.test(json.message ?? '')) {
      pages.push(json)
      break
    }

    if (!Array.isArray(json.result)) {
      throw new Error(`Routescan ${action} unexpected response: ${JSON.stringify(json)}`)
    }

    pages.push(json)
    all.push(...json.result)
    if (json.result.length < offset) break
    page += 1
  }

  return { items: all, pages }
}

export function routescanNormalTransactions(
  chainId: ChainId,
  address: Address,
  { fromBlock, toBlock }: AccountHistoryRange,
): Promise<AccountHistoryResult<NormalTransaction>> {
  return etherscanAccount(chainId, 'txlist', {
    address,
    startblock: fromBlock,
    endblock: toBlock,
  })
}

export function routescanErc20Transfers(
  chainId: ChainId,
  address: Address,
  { fromBlock, toBlock }: AccountHistoryRange,
): Promise<AccountHistoryResult<Erc20Transfer>> {
  return etherscanAccount(chainId, 'tokentx', {
    address,
    startblock: fromBlock,
    endblock: toBlock,
  })
}
