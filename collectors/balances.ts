import { formatEther, toHex } from 'viem'
import { CHAINS, TREASURY_WALLETS } from '../config.js'
import { collectManifest } from './manifest.js'
import { discoverErc20s, getTokenMetadata, publicClient } from '../lib/alchemy.js'
import { ERC20_ABI } from '../lib/abis.js'
import { fixturePath, isMain, writeJson } from '../lib/io.js'
import type {
  BalancesFixture,
  ChainMap,
  Erc20BalanceFixture,
  WalletBalanceFixture,
  WalletMap,
} from '../types/fixture.js'

export async function collectBalances(): Promise<BalancesFixture> {
  const manifest = await collectManifest()
  const chains = {} as ChainMap<WalletMap<WalletBalanceFixture>>

  for (const chain of Object.values(CHAINS)) {
    const client = publicClient(chain.id)
    const aaveVariableDebtTokens = new Map(
      Object.values(chain.aave.ASSETS ?? {})
        .filter((asset) => asset.V_TOKEN)
        .map((asset) => [asset.V_TOKEN!.toLowerCase(), asset.UNDERLYING] as const),
    )
    const blockNumber = BigInt(manifest.chains[chain.id].blockNumber)
    chains[chain.id] = {}

    for (const wallet of TREASURY_WALLETS[chain.id]) {
      console.log(`balances ${chain.name} ${wallet}`)
      const discovery = await discoverErc20s(chain.id, wallet)
      const native = await client.getBalance({ address: wallet, blockNumber })
      const erc20: Erc20BalanceFixture[] = []

      for (const contractAddress of discovery.contracts) {
        try {
          const debtUnderlying = aaveVariableDebtTokens.get(contractAddress.toLowerCase())
          const balance = await client.readContract({
            address: contractAddress,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [wallet],
            blockNumber,
          })

          if (balance === 0n) continue

          let metadata: unknown = null
          try {
            metadata = await getTokenMetadata(chain.id, contractAddress)
          } catch {
            // Metadata is helpful but not required for the raw balance fixture.
          }

          erc20.push({
            contractAddress,
            positionType: debtUnderlying ? 'liability' : 'asset',
            ...(debtUnderlying && {
              protocol: 'aave_v3',
              underlyingAsset: debtUnderlying,
            }),
            tokenBalance: toHex(balance),
            tokenBalanceDecimal: balance.toString(),
            metadata,
          })
        } catch (error) {
          const debtUnderlying = aaveVariableDebtTokens.get(contractAddress.toLowerCase())
          erc20.push({
            contractAddress,
            positionType: debtUnderlying ? 'liability' : 'asset',
            ...(debtUnderlying && {
              protocol: 'aave_v3',
              underlyingAsset: debtUnderlying,
            }),
            error: String(error),
          })
        }
      }

      chains[chain.id][wallet.toLowerCase() as Lowercase<typeof wallet>] = {
        blockNumber: blockNumber.toString(),
        native: {
          tokenBalance: toHex(native),
          tokenBalanceDecimal: native.toString(),
          formatted: formatEther(native),
        },
        erc20,
        // Provenance only: raw Token API pages used to discover contracts.
        discoveryRaw: discovery.pages,
      }
    }
  }

  const out: BalancesFixture = { chains }
  await writeJson(fixturePath('balances.json'), out)
  return out
}

if (isMain(import.meta.url)) await collectBalances()
