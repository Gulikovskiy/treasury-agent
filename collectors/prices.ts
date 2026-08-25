import type { Address } from 'viem'
import { CHAINS, NAV_TOKEN_ALLOWLIST } from '../config.js'
import { collectManifest } from './manifest.js'
import { historicalPrice } from '../lib/alchemy.js'
import { fixturePath, isMain, readJson, writeJson } from '../lib/io.js'
import type { BalancesFixture, ChainMap } from '../types/fixture.js'
import type { DefiPositionsFixture } from './defi-positions.js'

const NATIVE_SYMBOL: ChainMap<string> = {
  1: 'ETH',
  43114: 'AVAX',
  42161: 'ETH',
  8453: 'ETH',
}

interface PriceOrError {
  data?: unknown
  error?: string
}

export interface ChainPricesFixture {
  native: unknown | { error: string }
  tokens: Record<string, unknown | { error: string }>
}

export interface PricesFixture {
  snapshotTimestamp: string
  chains: ChainMap<ChainPricesFixture>
}

export async function collectPrices(): Promise<PricesFixture> {
  const manifest = await collectManifest()
  const [balances, defiPositions] = await Promise.all([
    readJson<BalancesFixture>(fixturePath('balances.json')),
    readJson<DefiPositionsFixture>(fixturePath('defi_positions.json')),
  ])
  const t = new Date(manifest.snapshotTimestamp)
  const start = new Date(t.getTime() - 60 * 60_000).toISOString()
  const end = new Date(t.getTime() + 60 * 60_000).toISOString()
  const chains = {} as ChainMap<ChainPricesFixture>

  for (const chain of Object.values(CHAINS)) {
    const tokens = new Set<Address>()

    for (const walletData of Object.values(balances.chains[chain.id])) {
      if (!walletData) continue
      for (const token of walletData.erc20) {
        if (
          token.contractAddress
          && !token.error
          && NAV_TOKEN_ALLOWLIST[chain.id][token.contractAddress.toLowerCase()]
        ) tokens.add(token.contractAddress)
      }
    }

    const aaveChain = defiPositions.protocols.aave_v3[chain.id]
    if (aaveChain) {
      for (const positions of Object.values(aaveChain.wallets)) {
        for (const position of positions) tokens.add(position.underlyingAsset)
      }
    }

    const chainOut: ChainPricesFixture = { native: null, tokens: {} }
    chains[chain.id] = chainOut
    console.log(`prices ${chain.name}: ${tokens.size} ERC20s`)

    try {
      chainOut.native = await historicalPrice({
        symbol: NATIVE_SYMBOL[chain.id],
        startTime: start,
        endTime: end,
        interval: '1h',
        withMarketData: false,
      })
    } catch (error) {
      chainOut.native = { error: String(error) }
    }

    for (const address of tokens) {
      try {
        chainOut.tokens[address] = await historicalPrice({
          network: chain.alchemyNetwork,
          address,
          startTime: start,
          endTime: end,
          interval: '1h',
          withMarketData: false,
        })
      } catch (error) {
        chainOut.tokens[address] = { error: String(error) }
      }
    }
  }

  const out: PricesFixture = { snapshotTimestamp: manifest.snapshotTimestamp, chains }
  await writeJson(fixturePath('prices.json'), out)
  return out
}

if (isMain(import.meta.url)) await collectPrices()
