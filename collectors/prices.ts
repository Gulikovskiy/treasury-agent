import type { Address } from 'viem'
import { CHAINS, NAV_TOKEN_ALLOWLIST } from '../config.js'
import { collectManifest } from './manifest.js'
import { historicalPrice } from '../lib/alchemy.js'
import { fixturePath, isMain, readJson, writeJson } from '../lib/io.js'
import type { BalancesFixture, ChainMap } from '../types/fixture.js'
import type { DefiPositionsFixture } from './defi-positions.js'
import type { TransactionsFixture } from './transactions.js'

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
  nativeHistory: unknown | { error: string }
  tokens: Record<string, unknown | { error: string }>
  tokenHistory: Record<string, unknown | { error: string }>
}

export interface PricesFixture {
  snapshotTimestamp: string
  chains: ChainMap<ChainPricesFixture>
}

export async function collectPrices(): Promise<PricesFixture> {
  const manifest = await collectManifest()
  const [balances, defiPositions, transactions] = await Promise.all([
    readJson<BalancesFixture>(fixturePath('balances.json')),
    readJson<DefiPositionsFixture>(fixturePath('defi_positions.json')),
    readJson<TransactionsFixture>(fixturePath('transactions.json')),
  ])
  const t = new Date(manifest.snapshotTimestamp)
  const start = new Date(t.getTime() - 60 * 60_000).toISOString()
  const end = new Date(t.getTime() + 60 * 60_000).toISOString()
  const chains = {} as ChainMap<ChainPricesFixture>

  for (const chain of Object.values(CHAINS)) {
    // Normalize contract keys once: checksum casing is display formatting, not
    // identity, and spot/Aave sources may represent the same address differently.
    const snapshotTokens = new Set<string>()

    for (const walletData of Object.values(balances.chains[chain.id])) {
      if (!walletData) continue
      for (const token of walletData.erc20) {
        if (
          token.contractAddress
          && !token.error
          && NAV_TOKEN_ALLOWLIST[chain.id][token.contractAddress.toLowerCase()]
        ) snapshotTokens.add(token.contractAddress.toLowerCase())
      }
    }

    const aaveChain = defiPositions.protocols.aave_v3[chain.id]
    if (aaveChain) {
      for (const positions of Object.values(aaveChain.wallets)) {
        for (const position of positions) {
          snapshotTokens.add(position.underlyingAsset.toLowerCase())
        }
      }
    }

    // Flow valuation needs assets that moved during the history window even if
    // the treasury no longer holds them at the snapshot. Contract-only joins do
    // not import attacker-controlled token labels into the price fixture.
    const historyTokens = new Set(snapshotTokens)
    for (const walletTransactions of Object.values(transactions.chains[chain.id])) {
      for (const transfer of walletTransactions.erc20Transfers.items) {
        if (transfer.contractAddress) {
          historyTokens.add(transfer.contractAddress.toLowerCase())
        }
      }
      if (walletTransactions.alchemyTransfers) {
        for (const transfer of [
          ...walletTransactions.alchemyTransfers.outgoing,
          ...walletTransactions.alchemyTransfers.incoming,
        ]) {
          const address = transfer.rawContract?.address
          if (address) historyTokens.add(address.toLowerCase())
        }
      }
    }

    const chainOut: ChainPricesFixture = {
      native: null,
      nativeHistory: null,
      tokens: {},
      tokenHistory: {},
    }
    chains[chain.id] = chainOut
    console.log(
      `prices ${chain.name}: ${snapshotTokens.size} snapshot ERC20s, ${historyTokens.size} flow ERC20s`,
    )

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

    try {
      chainOut.nativeHistory = await historicalPrice({
        symbol: NATIVE_SYMBOL[chain.id],
        startTime: manifest.historyFromTimestamp,
        endTime: manifest.snapshotTimestamp,
        interval: '1d',
        withMarketData: false,
      })
    } catch (error) {
      chainOut.nativeHistory = { error: String(error) }
    }

    for (const address of snapshotTokens) {
      try {
        chainOut.tokens[address] = await historicalPrice({
          network: chain.alchemyNetwork,
          address: address as Address,
          startTime: start,
          endTime: end,
          interval: '1h',
          withMarketData: false,
        })
      } catch (error) {
        chainOut.tokens[address] = { error: String(error) }
      }
    }

    for (const address of historyTokens) {
      try {
        chainOut.tokenHistory[address] = await historicalPrice({
          network: chain.alchemyNetwork,
          address: address as Address,
          startTime: manifest.historyFromTimestamp,
          endTime: manifest.snapshotTimestamp,
          interval: '1d',
          withMarketData: false,
        })
      } catch (error) {
        chainOut.tokenHistory[address] = { error: String(error) }
      }
    }
  }

  const out: PricesFixture = { snapshotTimestamp: manifest.snapshotTimestamp, chains }
  await writeJson(fixturePath('prices.json'), out)
  return out
}

if (isMain(import.meta.url)) await collectPrices()
