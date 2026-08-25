import type { Address } from 'viem'

export const CHAIN_IDS = [1, 43114, 42161, 8453] as const
export type ChainId = (typeof CHAIN_IDS)[number]

export type ChainMap<T> = Record<ChainId, T>
export type WalletMap<T> = Partial<Record<Lowercase<Address>, T>>

export interface CanonicalAsset {
  canonicalSymbol: string
  decimals: number
  labelSource: 'config' | 'aave-address-book'
}

export interface ChainSnapshot {
  chainId: ChainId
  name: string
  blockNumber: string
  blockHash: `0x${string}` | null
  blockTimestamp: string
  historyFrom: {
    blockNumber: string
    blockHash: `0x${string}` | null
    blockTimestamp: string
  }
}

export interface WalletOwnershipEvidence {
  verified: boolean
  kind: 'safe' | 'unverified'
  blockNumber: string
  method: string
  runtimeCodeHash?: `0x${string}`
  owners?: Address[]
  threshold?: string
  version?: string
  error?: string
}

export interface FixtureManifest {
  fixtureId: string
  schemaVersion: number
  snapshotTimestamp: string
  lookbackDays: number
  historyFromTimestamp: string
  accountingPolicy: {
    nav: {
      identityKey: 'chainId + contractAddress'
      symbolPolicy: 'display-only; never identity; attacker-controlled unless canonicalized'
      minimumUsdValue: number
      spotAssetAllowlist: ChainMap<Record<string, CanonicalAsset>>
      canonicalNavSource: 'nav_positions.json'
      spotBalanceSource: 'balances.json'
      spotBalancePath: 'chains.<chainId>.<wallet>.erc20'
      canonicalAaveV3Source: 'defi_positions.json'
      aaveV3Scope: string
      excludedFromSpotBalances: Array<
        'aave_v3_a_token' | 'aave_v3_variable_debt_token'
      >
      rules: string[]
    }
  }
  inputTrustPolicy: {
    tokenIdentity: 'chainId + contractAddress'
    tokenDisplayMetadata: 'untrusted and excluded unless canonicalized'
    transactionProjection: 'explicit field allowlist'
    discardedFields: string[]
  }
  chains: ChainMap<ChainSnapshot>
  walletOwnership: {
    chains: ChainMap<Record<string, WalletOwnershipEvidence>>
    crossChainConsistency: Record<string, {
      chainIds: ChainId[]
      ownerSetAndThresholdMatch: boolean
    }>
  }
  sources: {
    rpc: string
    tokenDiscovery: string
    transactions: {
      accountHistory: ChainMap<'Routescan' | 'Blockscout'>
      alchemyTransfers: ChainId[]
      receipts: 'Alchemy JSON-RPC'
    }
    prices: string
    defi: string
    aaveAddressBook: string
  }
}

export interface WalletsFixture {
  chains: ChainMap<readonly Address[]>
  testAddresses: Record<'q25' | 'q26', {
    wallet: string
    controlled: false
    behavior: 'empty_data' | 'external_entity'
  }>
}

export interface NativeBalanceFixture {
  tokenBalance: `0x${string}`
  tokenBalanceDecimal: string
  formatted: string
}

export interface Erc20BalanceFixture {
  contractAddress: Address
  asset: CanonicalAsset
  tokenBalance?: `0x${string}`
  tokenBalanceDecimal?: string
  error?: string
}

export interface WalletBalanceFixture {
  blockNumber: string
  native: NativeBalanceFixture
  erc20: Erc20BalanceFixture[]
  discovery: {
    contractCount: number
    pageCount: number
  }
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
