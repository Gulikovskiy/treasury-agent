import { basename } from 'node:path'
import { CHAINS, FIXTURE_DIR, LOOKBACK_DAYS, TREASURY_WALLETS } from '../config.js'
import { blockAtOrBefore } from '../lib/blocks.js'
import { exists, fixturePath, isMain, readJson, writeJson } from '../lib/io.js'
import type { ChainMap, ChainSnapshot, FixtureManifest, WalletsFixture } from '../types/fixture.js'

export async function collectManifest(): Promise<FixtureManifest> {
  const path = fixturePath('manifest.json')
  if (await exists(path) && process.env.RESET_SNAPSHOT !== '1') {
    console.log(`reusing pinned snapshot from ${path}`)
    return readJson<FixtureManifest>(path)
  }

  const requested = process.env.SNAPSHOT_TIMESTAMP
    ?? new Date(Date.now() - 5 * 60_000).toISOString()

  const chains = {} as ChainMap<ChainSnapshot>

  for (const chain of Object.values(CHAINS)) {
    console.log(`pinning ${chain.name} at ${requested}`)
    chains[chain.id] = {
      chainId: chain.id,
      name: chain.name,
      ...(await blockAtOrBefore(chain.id, requested)),
    }
  }

  const manifest: FixtureManifest = {
    fixtureId: basename(FIXTURE_DIR),
    schemaVersion: 2,
    snapshotTimestamp: requested,
    lookbackDays: LOOKBACK_DAYS,
    accountingPolicy: {
      nav: {
        spotBalanceSource: 'balances.json',
        spotBalancePath: 'chains.<chainId>.<wallet>.erc20',
        canonicalAaveV3Source: 'defi_positions.json',
        aaveV3Scope: 'Configured Aave V3 markets queried in defi_positions.json',
        excludedFromSpotBalances: [
          'aave_v3_a_token',
          'aave_v3_variable_debt_token',
        ],
        rules: [
          'Use currentATokenBalance from defi_positions.json as the Aave V3 supplied asset.',
          'Subtract currentStableDebt and currentVariableDebt from defi_positions.json as Aave V3 liabilities.',
          'Never add wrapper ERC-20 balances for Aave V3 markets represented in defi_positions.json; those wrappers are excluded from the canonical erc20 arrays in balances.json.',
          'discoveryRaw in balances.json is provider provenance only and is never an accounting input.',
        ],
      },
    },
    chains,
    sources: {
      rpc: 'Alchemy JSON-RPC',
      tokenDiscovery: 'alchemy_getTokenBalances',
      transactions: 'Alchemy Transfers API; Routescan account APIs',
      prices: 'Alchemy Historical Prices API',
      defi: 'Aave V3 ProtocolDataProvider at pinned block',
      aaveAddressBook: '@aave-dao/aave-address-book@4.66.0',
    },
  }

  const wallets: WalletsFixture = { chains: TREASURY_WALLETS }
  await writeJson(path, manifest)
  await writeJson(fixturePath('wallets.json'), wallets)
  return manifest
}

if (isMain(import.meta.url)) await collectManifest()
