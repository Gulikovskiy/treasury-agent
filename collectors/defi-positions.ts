import type { Address } from 'viem'
import { CHAINS, TREASURY_WALLETS } from '../config.js'
import { collectManifest } from './manifest.js'
import { publicClient } from '../lib/alchemy.js'
import { AAVE_DATA_PROVIDER_ABI } from '../lib/abis.js'
import { fixturePath, isMain, writeJson } from '../lib/io.js'
import type { ChainId } from '../types/fixture.js'

export interface AavePositionFixture {
  assetId: string
  canonicalSymbol: string
  decimals: number
  labelSource: 'aave-address-book'
  underlyingAsset: Address
  currentATokenBalance: bigint
  currentStableDebt: bigint
  currentVariableDebt: bigint
  principalStableDebt: bigint
  scaledVariableDebt: bigint
  stableBorrowRate: bigint
  liquidityRate: bigint
  stableRateLastUpdated: number
  usageAsCollateralEnabled: boolean
}

export interface AaveChainFixture {
  dataProvider: Address
  blockNumber: string
  wallets: Record<string, AavePositionFixture[]>
}

export interface DefiPositionsFixture {
  protocols: {
    aave_v3: Partial<Record<ChainId, AaveChainFixture>>
  }
}

export async function collectDefiPositions(): Promise<DefiPositionsFixture> {
  const manifest = await collectManifest()
  const out: DefiPositionsFixture = { protocols: { aave_v3: {} } }

  for (const chain of Object.values(CHAINS)) {
    const provider = chain.aave.AAVE_PROTOCOL_DATA_PROVIDER
    if (!provider) continue

    const client = publicClient(chain.id)
    const blockNumber = BigInt(manifest.chains[chain.id].blockNumber)
    const assetsByUnderlying = new Map(
      Object.entries(chain.aave.ASSETS ?? {}).map(([canonicalSymbol, asset]) => [
        asset.UNDERLYING.toLowerCase(),
        { canonicalSymbol, decimals: asset.decimals },
      ] as const),
    )

    const reserves = await client.readContract({
      address: provider,
      abi: AAVE_DATA_PROVIDER_ABI,
      functionName: 'getAllReservesTokens',
      blockNumber,
    })

    const chainOut: AaveChainFixture = {
      dataProvider: provider,
      blockNumber: blockNumber.toString(),
      wallets: {},
    }
    out.protocols.aave_v3[chain.id] = chainOut

    for (const wallet of TREASURY_WALLETS[chain.id]) {
      console.log(`Aave V3 positions ${chain.name} ${wallet}`)
      const positions: AavePositionFixture[] = []

      for (const reserve of reserves) {
        const canonicalAsset = assetsByUnderlying.get(reserve.tokenAddress.toLowerCase())
        if (!canonicalAsset) continue

        const result = await client.readContract({
          address: provider,
          abi: AAVE_DATA_PROVIDER_ABI,
          functionName: 'getUserReserveData',
          args: [reserve.tokenAddress, wallet],
          blockNumber,
        })

        const [
          currentATokenBalance,
          currentStableDebt,
          currentVariableDebt,
          principalStableDebt,
          scaledVariableDebt,
          stableBorrowRate,
          liquidityRate,
          stableRateLastUpdated,
          usageAsCollateralEnabled,
        ] = result

        if (
          currentATokenBalance === 0n
          && currentStableDebt === 0n
          && currentVariableDebt === 0n
        ) continue

        positions.push({
          assetId: `${chain.id}:${reserve.tokenAddress.toLowerCase()}`,
          canonicalSymbol: canonicalAsset.canonicalSymbol,
          decimals: canonicalAsset.decimals,
          labelSource: 'aave-address-book',
          underlyingAsset: reserve.tokenAddress,
          currentATokenBalance,
          currentStableDebt,
          currentVariableDebt,
          principalStableDebt,
          scaledVariableDebt,
          stableBorrowRate,
          liquidityRate,
          stableRateLastUpdated,
          usageAsCollateralEnabled,
        })
      }

      chainOut.wallets[wallet.toLowerCase()] = positions
    }
  }

  await writeJson(fixturePath('defi_positions.json'), out)
  return out
}

if (isMain(import.meta.url)) await collectDefiPositions()
