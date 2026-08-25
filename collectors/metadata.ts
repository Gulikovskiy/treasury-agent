import { keccak256, type Address, type Hex } from 'viem'
import { CHAINS } from '../config.js'
import { collectManifest } from './manifest.js'
import { publicClient } from '../lib/alchemy.js'
import { fixturePath, isMain, readJson, writeJson } from '../lib/io.js'
import type { BalancesFixture, ChainMap } from '../types/fixture.js'
import type { TransactionsFixture } from './transactions.js'

interface ContractMetadataFixture {
  isContract?: boolean
  runtimeCodeHash?: Hex | null
  runtimeCodeSize?: number | null
  error?: string
}

interface ContractsFixture {
  chains: ChainMap<Record<string, ContractMetadataFixture>>
}

function addAddress(set: Set<Address>, value: string | undefined | null): void {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) return
  set.add(value.toLowerCase() as Address)
}

export async function collectMetadata(): Promise<ContractsFixture> {
  const manifest = await collectManifest()
  const balances = await readJson<BalancesFixture>(fixturePath('balances.json'))
  const txs = await readJson<TransactionsFixture>(fixturePath('transactions.json'))
  const chains = {} as ChainMap<Record<string, ContractMetadataFixture>>

  for (const chain of Object.values(CHAINS)) {
    const blockNumber = BigInt(manifest.chains[chain.id].blockNumber)
    const client = publicClient(chain.id)
    const candidates = new Set<Address>()

    for (const walletData of Object.values(balances.chains[chain.id])) {
      if (!walletData) continue
      for (const token of walletData.erc20) {
        addAddress(candidates, token.contractAddress)
      }
    }

    for (const walletTx of Object.values(txs.chains[chain.id])) {
      for (const tx of walletTx.normalTransactions.items) {
        addAddress(candidates, tx.from)
        addAddress(candidates, tx.to)
        addAddress(candidates, tx.contractAddress)
      }

      for (const transfer of walletTx.erc20Transfers.items) {
        addAddress(candidates, transfer.from)
        addAddress(candidates, transfer.to)
        addAddress(candidates, transfer.contractAddress)
      }

      if (walletTx.alchemyTransfers) {
        for (const direction of ['incoming', 'outgoing'] as const) {
          for (const transfer of walletTx.alchemyTransfers[direction]) {
            addAddress(candidates, transfer.from)
            addAddress(candidates, transfer.to)
            addAddress(candidates, transfer.rawContract?.address)
          }
        }
      }
    }

    const chainOut: Record<string, ContractMetadataFixture> = {}
    chains[chain.id] = chainOut

    for (const address of candidates) {
      try {
        const code = await client.getCode({ address, blockNumber })
        const isContract = Boolean(code && code !== '0x')
        chainOut[address] = {
          isContract,
          runtimeCodeHash: isContract && code ? keccak256(code) : null,
          runtimeCodeSize: isContract && code ? (code.length - 2) / 2 : null,
        }
      } catch (error) {
        chainOut[address] = { error: String(error) }
      }
    }
  }

  const out: ContractsFixture = { chains }
  await writeJson(fixturePath('contracts.json'), out)
  return out
}

if (isMain(import.meta.url)) await collectMetadata()
