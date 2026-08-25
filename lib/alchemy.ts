import type { Address, PublicClient } from 'viem'
import { createPublicClient, http } from 'viem'
import { CHAINS } from '../config.js'
import type { ChainId } from '../types/fixture.js'

const apiKey = process.env.ALCHEMY_API_KEY
if (!apiKey) throw new Error('ALCHEMY_API_KEY is required')

export function rpcUrl(chainId: ChainId): string {
  const chain = CHAINS[chainId]
  return `https://${chain.rpcHost}/v2/${apiKey}`

}

export function publicClient(chainId: ChainId): PublicClient {
  const chain = CHAINS[chainId]
  return createPublicClient({
    chain: chain.viemChain,
    transport: http(rpcUrl(chainId)),
  }) as PublicClient
}

let nextId = 1

interface JsonRpcEnvelope<T> {
  jsonrpc?: string
  id?: number
  result?: T
  error?: unknown
}

export async function rpc<T = unknown>(
  chainId: ChainId,
  method: string,
  params: readonly unknown[] = [],
): Promise<T> {
  const response = await fetch(rpcUrl(chainId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  })

  const json = await response.json() as JsonRpcEnvelope<T>
  if (!response.ok || json.error || json.result === undefined) {
    throw new Error(`${method} on ${chainId} failed: ${JSON.stringify(json.error ?? json)}`)
  }
  return json.result
}

interface AlchemyTokenBalancePage {
  tokenBalances?: Array<{ contractAddress?: Address | null }>
  pageKey?: string
  [key: string]: unknown
}

export interface TokenDiscovery {
  contracts: Address[]
  pages: AlchemyTokenBalancePage[]
}

export async function discoverErc20s(chainId: ChainId, address: Address): Promise<TokenDiscovery> {
  const contracts = new Set<Address>()
  const pages: AlchemyTokenBalancePage[] = []
  let pageKey: string | undefined

  do {
    const options: { maxCount: number; pageKey?: string } = { maxCount: 100 }
    if (pageKey) options.pageKey = pageKey

    const result = await rpc<AlchemyTokenBalancePage>(
      chainId,
      'alchemy_getTokenBalances',
      [address, 'erc20', options],
    )
    pages.push(result)

    for (const token of result.tokenBalances ?? []) {
      if (token.contractAddress) contracts.add(token.contractAddress.toLowerCase() as Address)
    }
    pageKey = result.pageKey
  } while (pageKey)

  return { contracts: [...contracts], pages }
}

export async function getTokenMetadata(chainId: ChainId, contractAddress: Address): Promise<unknown> {
  return rpc(chainId, 'alchemy_getTokenMetadata', [contractAddress])
}

export interface AssetTransferPage {
  transfers?: Array<{
    from?: Address
    to?: Address
    rawContract?: { address?: Address | null }
    [key: string]: unknown
  }>
  pageKey?: string
  [key: string]: unknown
}

export type AssetTransferParams = Record<string, unknown>

export async function getAssetTransfersAll(
  chainId: ChainId,
  params: AssetTransferParams,
): Promise<AssetTransferPage[]> {
  const pages: AssetTransferPage[] = []
  let pageKey: string | undefined

  do {
    const request: Record<string, unknown> = { ...params, maxCount: '0x3e8' }
    if (pageKey) request.pageKey = pageKey

    const result = await rpc<AssetTransferPage>(chainId, 'alchemy_getAssetTransfers', [request])
    pages.push(result)
    pageKey = result.pageKey
  } while (pageKey)

  return pages
}

export interface HistoricalPriceRequest {
  symbol?: string
  network?: string
  address?: Address
  startTime: string
  endTime: string
  interval: string
  withMarketData?: boolean
}

export async function historicalPrice(body: HistoricalPriceRequest): Promise<unknown> {
  const response = await fetch(
    `https://api.g.alchemy.com/prices/v1/${apiKey}/tokens/historical`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  )

  const json = await response.json() as unknown
  if (!response.ok) {
    throw new Error(`Alchemy Prices API failed: ${JSON.stringify(json)}`)
  }
  return json
}
