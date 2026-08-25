import { basename } from 'node:path'
import { keccak256 } from 'viem'
import {
  CHAINS,
  FIXTURE_DIR,
  LOOKBACK_DAYS,
  TEST_ADDRESSES,
  TREASURY_WALLETS,
} from '../config.js'
import { SAFE_ABI } from '../lib/abis.js'
import { publicClient } from '../lib/alchemy.js'
import { blockAtOrBefore } from '../lib/blocks.js'
import { exists, fixturePath, isMain, readJson, writeJson } from '../lib/io.js'
import type {
  ChainMap,
  ChainSnapshot,
  FixtureManifest,
  WalletOwnershipEvidence,
  WalletsFixture,
} from '../types/fixture.js'

export async function collectManifest(): Promise<FixtureManifest> {
  const path = fixturePath('manifest.json')
  const wallets: WalletsFixture = {
    chains: TREASURY_WALLETS,
    testAddresses: TEST_ADDRESSES,
  }
  if (await exists(path) && process.env.RESET_SNAPSHOT !== '1') {
    console.log(`reusing pinned snapshot from ${path}`)
    await writeJson(fixturePath('wallets.json'), wallets)
    return readJson<FixtureManifest>(path)
  }

  const requested = process.env.SNAPSHOT_TIMESTAMP
    ?? new Date(Date.now() - 5 * 60_000).toISOString()
  const historyFromTimestamp = new Date(
    new Date(requested).getTime() - LOOKBACK_DAYS * 86_400_000,
  ).toISOString()

  const chains = {} as ChainMap<ChainSnapshot>

  for (const chain of Object.values(CHAINS)) {
    console.log(`pinning ${chain.name} at ${requested}`)
    const [snapshot, historyFrom] = await Promise.all([
      blockAtOrBefore(chain.id, requested),
      blockAtOrBefore(chain.id, historyFromTimestamp),
    ])
    chains[chain.id] = {
      chainId: chain.id,
      name: chain.name,
      ...snapshot,
      historyFrom,
    }
  }

  const ownershipChains = {} as ChainMap<Record<string, WalletOwnershipEvidence>>
  for (const chain of Object.values(CHAINS)) {
    ownershipChains[chain.id] = {}
    const client = publicClient(chain.id)
    const blockNumber = BigInt(chains[chain.id].blockNumber)

    for (const wallet of TREASURY_WALLETS[chain.id]) {
      try {
        const [code, owners, threshold, version] = await Promise.all([
          client.getCode({ address: wallet, blockNumber }),
          client.readContract({
            address: wallet,
            abi: SAFE_ABI,
            functionName: 'getOwners',
            blockNumber,
          }),
          client.readContract({
            address: wallet,
            abi: SAFE_ABI,
            functionName: 'getThreshold',
            blockNumber,
          }),
          client.readContract({
            address: wallet,
            abi: SAFE_ABI,
            functionName: 'VERSION',
            blockNumber,
          }),
        ])

        if (!code || code === '0x') throw new Error('Configured treasury is not a contract')
        ownershipChains[chain.id][wallet.toLowerCase()] = {
          verified: true,
          kind: 'safe',
          blockNumber: blockNumber.toString(),
          method: 'Safe getOwners/getThreshold/VERSION at pinned block',
          runtimeCodeHash: keccak256(code),
          owners: [...owners],
          threshold: threshold.toString(),
          version,
        }
      } catch (error) {
        ownershipChains[chain.id][wallet.toLowerCase()] = {
          verified: false,
          kind: 'unverified',
          blockNumber: blockNumber.toString(),
          method: 'Safe getOwners/getThreshold/VERSION at pinned block',
          error: String(error),
        }
      }
    }
  }

  const crossChainConsistency: FixtureManifest['walletOwnership']['crossChainConsistency'] = {}
  const configuredWallets = new Set(
    Object.values(TREASURY_WALLETS).flat().map((wallet) => wallet.toLowerCase()),
  )
  for (const wallet of configuredWallets) {
    const evidence = Object.values(CHAINS)
      .filter((chain) => TREASURY_WALLETS[chain.id].some(
        (candidate) => candidate.toLowerCase() === wallet,
      ))
      .map((chain) => ({
        chainId: chain.id,
        evidence: ownershipChains[chain.id][wallet],
      }))
    const configurations = evidence.map(({ evidence: item }) => item?.verified
      ? `${[...(item.owners ?? [])].map((owner) => owner.toLowerCase()).sort().join(',')}:${item.threshold}`
      : null)

    crossChainConsistency[wallet] = {
      chainIds: evidence.map(({ chainId }) => chainId),
      ownerSetAndThresholdMatch: configurations.every(Boolean)
        && new Set(configurations).size === 1,
    }
  }

  const manifest: FixtureManifest = {
    fixtureId: basename(FIXTURE_DIR),
    schemaVersion: 3,
    snapshotTimestamp: requested,
    lookbackDays: LOOKBACK_DAYS,
    historyFromTimestamp,
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
    walletOwnership: {
      chains: ownershipChains,
      crossChainConsistency,
    },
    sources: {
      rpc: 'Alchemy JSON-RPC',
      tokenDiscovery: 'alchemy_getTokenBalances',
      transactions: {
        accountHistory: {
          1: 'Routescan',
          43114: 'Routescan',
          42161: 'Blockscout',
          8453: 'Blockscout',
        },
        alchemyTransfers: [1, 42161, 8453],
        receipts: 'Alchemy JSON-RPC',
      },
      prices: 'Alchemy Historical Prices API',
      defi: 'Aave V3 ProtocolDataProvider at pinned block',
      aaveAddressBook: '@aave-dao/aave-address-book@4.66.0',
    },
  }

  await writeJson(path, manifest)
  await writeJson(fixturePath('wallets.json'), wallets)
  return manifest
}

if (isMain(import.meta.url)) await collectManifest()
