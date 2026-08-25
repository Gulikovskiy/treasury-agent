import type { Address } from 'viem'

export const CHAIN_IDS = [1, 43114, 42161, 8453] as const
export type ChainId = (typeof CHAIN_IDS)[number]

export type ChainMap<T> = Record<ChainId, T>
export type WalletMap<T> = Partial<Record<Lowercase<Address>, T>>

export interface ChainSnapshot {
  chainId: ChainId
  name: string
  blockNumber: string
  blockHash: `0x${string}` | null
  blockTimestamp: string
}

export interface FixtureManifest {
  fixtureId: string
  schemaVersion: number
  snapshotTimestamp: string
  lookbackDays: number
  chains: ChainMap<ChainSnapshot>
  sources: {
    rpc: string
    tokenDiscovery: string
    transactions: string
    prices: string
    defi: string
    aaveAddressBook: string
  }
}

export interface WalletsFixture {
  chains: ChainMap<readonly Address[]>
}

export interface NativeBalanceFixture {
  tokenBalance: `0x${string}`
  tokenBalanceDecimal: string
  formatted: string
}

export interface Erc20BalanceFixture {
  contractAddress: Address
  /** Economic treatment for NAV. Debt-token balances are liabilities, not assets. */
  positionType?: 'asset' | 'liability'
  protocol?: string
  underlyingAsset?: Address
  tokenBalance?: `0x${string}`
  tokenBalanceDecimal?: string
  metadata?: unknown
  error?: string
}

export interface WalletBalanceFixture {
  blockNumber: string
  native: NativeBalanceFixture
  erc20: Erc20BalanceFixture[]
  discoveryRaw: unknown[]
}

export interface BalancesFixture {
  chains: ChainMap<WalletMap<WalletBalanceFixture>>
}

export interface AddressLabel {
  label: string
  kind: string
  source?: string
  controlled?: boolean
  protocol?: string
}

export interface AddressLabelsFixture {
  chains: ChainMap<Record<string, AddressLabel>>
}

export interface ProtocolsFixture {
  chains: ChainMap<{
    aave_v3: Record<string, Address>
  }>
}

export interface JsonRpcReceipt {
  transactionHash?: `0x${string}`
  gasUsed?: `0x${string}`
  effectiveGasPrice?: `0x${string}`
  [key: string]: unknown
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }
