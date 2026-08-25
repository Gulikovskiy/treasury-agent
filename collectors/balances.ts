import { formatEther, toHex, type Address } from 'viem'
import { CHAINS, NAV_TOKEN_ALLOWLIST, TREASURY_WALLETS } from '../config.js'
import { collectManifest } from './manifest.js'
import { discoverErc20s, publicClient } from '../lib/alchemy.js'
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
    const spotAllowlist = NAV_TOKEN_ALLOWLIST[chain.id]
    const aavePositionTokens = new Set(
      Object.values(chain.aave.ASSETS ?? {}).flatMap((asset) =>
        [asset.A_TOKEN, asset.V_TOKEN]
          .filter((address): address is Address => address !== undefined)
          .map((address) => address.toLowerCase()),
      ),
    )
    const blockNumber = BigInt(manifest.chains[chain.id].blockNumber)
    chains[chain.id] = {}

    for (const wallet of TREASURY_WALLETS[chain.id]) {
      console.log(`balances ${chain.name} ${wallet}`)
      const discovery = await discoverErc20s(chain.id, wallet)
      const native = await client.getBalance({ address: wallet, blockNumber })
      const erc20: Erc20BalanceFixture[] = []

      for (const contractAddress of discovery.contracts) {
        const asset = spotAllowlist[contractAddress.toLowerCase()]
        if (!asset) continue

        // Aave wrapper balances are canonicalized in defi_positions.json. Keeping
        // them here as spot ERC-20s would count the same position twice.
        if (aavePositionTokens.has(contractAddress.toLowerCase())) continue

        try {
          const balance = await client.readContract({
            address: contractAddress,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [wallet],
            blockNumber,
          })

          if (balance === 0n) continue

          erc20.push({
            contractAddress,
            asset,
            tokenBalance: toHex(balance),
            tokenBalanceDecimal: balance.toString(),
          })
        } catch (error) {
          erc20.push({
            contractAddress,
            asset,
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
        discovery: {
          contractCount: discovery.contracts.length,
          pageCount: discovery.pages.length,
        },
      }
    }
  }

  const out: BalancesFixture = { chains }
  await writeJson(fixturePath('balances.json'), out)
  return out
}

if (isMain(import.meta.url)) await collectBalances()
