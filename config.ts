import 'dotenv/config'
import type { Address, Chain } from 'viem'
import { mainnet, avalanche, arbitrum, base } from 'viem/chains'
import {
  AaveV3Ethereum,
  AaveV3Avalanche,
  AaveV3Arbitrum,
  AaveV3Base,
} from '@aave-dao/aave-address-book'
import type { ChainId, ChainMap, AddressLabel } from './types/fixture.js'

export const FIXTURE_DIR = process.env.FIXTURE_DIR ?? './fixtures/treasury_v1'
export const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS ?? 90)

if (!Number.isFinite(LOOKBACK_DAYS) || LOOKBACK_DAYS <= 0) {
  throw new Error(`LOOKBACK_DAYS must be a positive number; got ${process.env.LOOKBACK_DAYS}`)
}

const EXAMPLE_TREASURY = '0x22740deBa78d5a0c24C58C740e3715ec29de1bFa' as Address

export const TREASURY_WALLETS = {
  1: [EXAMPLE_TREASURY],
  43114: [EXAMPLE_TREASURY],
  42161: [EXAMPLE_TREASURY],
  8453: [EXAMPLE_TREASURY],
} satisfies ChainMap<readonly Address[]>

// Eval-only wallet identifiers from questions.jsonl. These are deliberate
// non-address sentinels and must never be sent to an RPC or added to treasury
// ownership lists.
export const TEST_ADDRESSES = {
  q25: {
    wallet: '0xEmptyWalletAddress',
    controlled: false,
    behavior: 'empty_data',
  },
  q26: {
    wallet: '0xExternalWallet',
    controlled: false,
    behavior: 'external_entity',
  },
} as const

type AaveAddressBook = {
  AAVE_PROTOCOL_DATA_PROVIDER?: Address
  POOL?: Address
  COLLECTOR?: Address
  POOL_ADDRESSES_PROVIDER?: Address
  ORACLE?: Address
  ASSETS?: Record<string, {
    UNDERLYING: Address
    A_TOKEN?: Address
    V_TOKEN?: Address
  }>
}

export interface ChainConfig {
  id: ChainId
  name: string
  alchemyNetwork: string
  rpcHost: string
  viemChain: Chain
  aave: AaveAddressBook
}

export const CHAINS = {
  1: {
    id: 1,
    name: 'ethereum',
    alchemyNetwork: 'eth-mainnet',
    rpcHost: 'eth-mainnet.g.alchemy.com',
    viemChain: mainnet,
    aave: AaveV3Ethereum,
  },
  43114: {
    id: 43114,
    name: 'avalanche',
    alchemyNetwork: 'avax-mainnet',
    rpcHost: 'avax-mainnet.g.alchemy.com',
    viemChain: avalanche,
    aave: AaveV3Avalanche,
  },
  42161: {
    id: 42161,
    name: 'arbitrum',
    alchemyNetwork: 'arb-mainnet',
    rpcHost: 'arb-mainnet.g.alchemy.com',
    viemChain: arbitrum,
    aave: AaveV3Arbitrum,
  },
  8453: {
    id: 8453,
    name: 'base',
    alchemyNetwork: 'base-mainnet',
    rpcHost: 'base-mainnet.g.alchemy.com',
    viemChain: base,
    aave: AaveV3Base,
  },
} satisfies ChainMap<ChainConfig>

export type ManualLabel = Omit<AddressLabel, 'source'>

// Human-curated labels are intentionally an overlay. Never infer ownership or
// identity from an unlabeled address during fixture collection.
export const MANUAL_LABELS: Record<string, ManualLabel> = {
  // '1:0x...': { label: 'Coinbase Prime', kind: 'exchange' },
}
