import { basename } from 'node:path'
import { keccak256 } from 'viem'
import {
  CHAINS,
  FIXTURE_DIR,
  LOOKBACK_DAYS,
  NAV_DUST_USD,
  NAV_TOKEN_ALLOWLIST,
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

const SCHEMA_VERSION = 5
const AFC_WALLET = '0x22740deBa78d5a0c24C58C740e3715ec29de1bFa' as const

function accountingPolicy(): FixtureManifest['accountingPolicy'] {
  return {
    nav: {
      identityKey: 'chainId + contractAddress',
      symbolPolicy: 'display-only; never identity; attacker-controlled unless canonicalized',
      minimumUsdValue: NAV_DUST_USD,
      spotAssetAllowlist: NAV_TOKEN_ALLOWLIST,
      canonicalNavSource: 'nav_positions.json',
      spotBalanceSource: 'balances.json',
      spotBalancePath: 'chains.<chainId>.<wallet>.erc20',
      canonicalAaveV3Source: 'defi_positions.json',
      aaveV3Scope: 'Configured Aave V3 markets queried in defi_positions.json',
      excludedFromNav: [
        'aave_v3_a_token',
        'aave_v3_variable_debt_token',
      ],
      rules: [
        'A token can enter NAV only when its chain/address is allowlisted, it has a price, and its absolute USD value meets minimumUsdValue.',
        'Every raw ERC-20 rejected by the spot allowlist is retained in balances.json and recorded in nav_positions.json with reason not_allowlisted.',
        'Token symbols and names are display labels, never identity keys, and raw provider/on-chain labels never enter canonical NAV positions.',
        'Use currentATokenBalance from defi_positions.json as the Aave V3 supplied asset.',
        'Price Aave V3 positions by underlyingAsset, never by the aToken or debt-token wrapper address.',
        'Subtract currentStableDebt and currentVariableDebt from defi_positions.json as Aave V3 liabilities.',
        'Never add Aave wrapper ERC-20 balances to NAV; raw wrapper balances remain in balances.json and configured-market positions are represented canonically in defi_positions.json.',
        'discoveryRaw in balances.json is provider provenance only and is never an accounting input.',
      ],
    },
    flows: {
      canonicalSource: 'transactions.json',
      transactionIdentityKey: 'chainId + transactionHash',
      transferIdentityKey: 'Alchemy uniqueId where alchemyTransfers is canonical; chainId + providerEventIndex where erc20Transfers is canonical',
      transferEventSource: {
        1: 'alchemyTransfers',
        43114: 'erc20Transfers',
        42161: 'alchemyTransfers',
        8453: 'alchemyTransfers',
      },
      controlledWalletSource: 'wallets.json',
      labelSource: 'address_labels.json',
      historicalPriceSource: 'prices.json nativeHistory/tokenHistory',
      classificationOrder: [
        'internal_transfer',
        'bridge',
        'defi_movement',
        'external_flow',
      ],
      rules: [
        'Use transferEventSource as the canonical event list; other provider lists are corroborating evidence and must not be added a second time.',
        'Deduplicate transactions by transactionIdentityKey and transfer events by transferIdentityKey; never collapse distinct transfers in the same transaction.',
        'Transfers between controlled wallets are internal and excluded from external flow and spend.',
        'Bridge transfers and DeFi deposits or withdrawals are treasury movements and excluded from operating spend.',
        'Net external flow equals external inflows minus external outflows after internal, bridge, and DeFi exclusions.',
        'Operating expense is a secondary classification on successful external outflows; unlabeled outflows remain unclassified and are not silently treated as spend.',
        'Token identity and pricing joins use chainId plus contractAddress, never token symbol.',
        'Classify transfers before valuation; a missing historical price is reported as unpriced and is never silently valued at zero.',
      ],
      externalFlow: {
        windowDays: 30,
        usdPricing: 'nearest historical asset price to transaction timestamp',
      },
      operatingSpend: {
        timezone: 'UTC',
        monthlyWindow: 'calendar_month',
      },
      burnRate: {
        timezone: 'UTC',
        monthlyWindow: 'calendar_month',
        trailingMonths: 3,
        includeCurrentMonth: true,
      },
      gas: {
        nativeAmountFormula: 'gasUsed * effectiveGasPrice',
        include: 'successful outgoing treasury transactions only',
        usdPricing: 'nearest historical native price to block timestamp',
        windowDays: 30,
      },
    },
  }
}

function inputTrustPolicy(): FixtureManifest['inputTrustPolicy'] {
  return {
    tokenIdentity: 'chainId + contractAddress',
    tokenDisplayMetadata: 'untrusted; retained in raw balances only; excluded from normalized views',
    transactionProjection: 'explicit field allowlist',
    discardedFields: [
      'Alchemy asset label',
      'raw transaction-provider pages',
      'open-ended transaction metadata',
    ],
  }
}

function sources(): FixtureManifest['sources'] {
  return {
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
  }
}

const organizationalAttribution: FixtureManifest['walletOwnership']['organizationalAttribution'] = {
  status: 'publicly_attested',
  organization: 'Aave Finance Committee',
  wallet: AFC_WALLET,
  chainIds: [1, 43114, 42161, 8453],
  evidenceType: 'primary_governance_record',
  sourceUrl: 'https://governance.aave.com/t/direct-to-aip-april-2026-funding-update/24447',
  statement: 'Aave governance identifies this address as the AFC spender on Ethereum, Avalanche, Arbitrum, and Base.',
  limitation: 'The governance record establishes organizational attribution; pinned Safe reads separately verify technical control configuration, not legal beneficial ownership.',
}

export async function collectManifest(): Promise<FixtureManifest> {
  const path = fixturePath('manifest.json')
  const wallets: WalletsFixture = {
    chains: TREASURY_WALLETS,
    testAddresses: TEST_ADDRESSES,
  }
  if (await exists(path) && process.env.RESET_SNAPSHOT !== '1') {
    console.log(`reusing pinned snapshot from ${path}`)
    const existing = await readJson<FixtureManifest>(path)
    const upgraded: FixtureManifest = {
      ...existing,
      schemaVersion: SCHEMA_VERSION,
      accountingPolicy: accountingPolicy(),
      inputTrustPolicy: inputTrustPolicy(),
      sources: sources(),
      walletOwnership: {
        ...existing.walletOwnership,
        organizationalAttribution,
      },
    }
    await writeJson(path, upgraded)
    await writeJson(fixturePath('wallets.json'), wallets)
    return upgraded
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
    schemaVersion: SCHEMA_VERSION,
    snapshotTimestamp: requested,
    lookbackDays: LOOKBACK_DAYS,
    historyFromTimestamp,
    accountingPolicy: accountingPolicy(),
    inputTrustPolicy: inputTrustPolicy(),
    chains,
    walletOwnership: {
      chains: ownershipChains,
      crossChainConsistency,
      organizationalAttribution,
    },
    sources: sources(),
  }

  await writeJson(path, manifest)
  await writeJson(fixturePath('wallets.json'), wallets)
  return manifest
}

if (isMain(import.meta.url)) await collectManifest()
