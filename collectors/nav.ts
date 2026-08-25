import type { Address } from 'viem'
import { NAV_DUST_USD, NAV_TOKEN_ALLOWLIST } from '../config.js'
import { fixturePath, isMain, readJson, writeJson } from '../lib/io.js'
import type { BalancesFixture, ChainId } from '../types/fixture.js'
import type { DefiPositionsFixture } from './defi-positions.js'
import type { PricesFixture } from './prices.js'

interface NavPosition {
  chainId: ChainId
  wallet: string
  assetId: string
  contractAddress: Address | null
  canonicalSymbol: string
  decimals: number
  source: 'native' | 'spot' | 'aave_v3'
  positionType: 'asset' | 'liability'
  amount: string
  priceUsd: string
  valueUsd: string
}

interface ExcludedPosition {
  chainId: ChainId
  wallet: string
  assetId: string
  reason: 'unpriced' | 'below_dust'
}

interface NavPositionsFixture {
  identityKey: 'chainId + contractAddress'
  minimumUsdValue: number
  positions: NavPosition[]
  excluded: ExcludedPosition[]
}

const NATIVE_SYMBOL: Record<ChainId, string> = {
  1: 'ETH',
  43114: 'AVAX',
  42161: 'ETH',
  8453: 'ETH',
}

function decimalAmount(raw: bigint, decimals: number): string {
  const negative = raw < 0n
  const absolute = negative ? -raw : raw
  const padded = absolute.toString().padStart(decimals + 1, '0')
  const integer = decimals === 0 ? padded : padded.slice(0, -decimals)
  const fraction = decimals === 0 ? '' : padded.slice(-decimals).replace(/0+$/, '')
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`
}

function historicalPriceValue(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const data = (value as { data?: Array<{ value?: unknown; timestamp?: string }> }).data
  if (!Array.isArray(data) || data.length === 0) return null
  const middle = data[Math.floor(data.length / 2)]?.value
  return typeof middle === 'string' && Number.isFinite(Number(middle)) ? middle : null
}

export async function collectNavPositions(): Promise<NavPositionsFixture> {
  const [balances, defi, prices] = await Promise.all([
    readJson<BalancesFixture>(fixturePath('balances.json')),
    readJson<DefiPositionsFixture>(fixturePath('defi_positions.json')),
    readJson<PricesFixture>(fixturePath('prices.json')),
  ])
  const positions: NavPosition[] = []
  const excluded: ExcludedPosition[] = []

  function addPosition(input: Omit<NavPosition, 'amount' | 'priceUsd' | 'valueUsd'> & {
    rawAmount: bigint
    price: unknown
  }): void {
    const { rawAmount, price, ...base } = input
    const amount = decimalAmount(rawAmount, base.decimals)
    const priceUsd = historicalPriceValue(price)
    if (!priceUsd) {
      excluded.push({
        chainId: base.chainId,
        wallet: base.wallet,
        assetId: base.assetId,
        reason: 'unpriced',
      })
      return
    }
    const unsignedValue = Number(amount) * Number(priceUsd)
    if (Math.abs(unsignedValue) < NAV_DUST_USD) {
      excluded.push({
        chainId: base.chainId,
        wallet: base.wallet,
        assetId: base.assetId,
        reason: 'below_dust',
      })
      return
    }
    const signedValue = base.positionType === 'liability'
      ? -Math.abs(unsignedValue)
      : Math.abs(unsignedValue)
    positions.push({
      ...base,
      amount,
      priceUsd,
      valueUsd: signedValue.toFixed(2),
    })
  }

  for (const [rawChainId, wallets] of Object.entries(balances.chains)) {
    const chainId = Number(rawChainId) as ChainId
    for (const [wallet, balance] of Object.entries(wallets)) {
      if (!balance) continue
      addPosition({
        chainId,
        wallet,
        assetId: `${chainId}:native`,
        contractAddress: null,
        canonicalSymbol: NATIVE_SYMBOL[chainId],
        decimals: 18,
        source: 'native',
        positionType: 'asset',
        rawAmount: BigInt(balance.native.tokenBalanceDecimal),
        price: prices.chains[chainId].native,
      })

      for (const token of balance.erc20) {
        const address = token.contractAddress.toLowerCase()
        if (!NAV_TOKEN_ALLOWLIST[chainId][address] || !token.tokenBalanceDecimal) continue
        addPosition({
          chainId,
          wallet,
          assetId: `${chainId}:${address}`,
          contractAddress: token.contractAddress,
          canonicalSymbol: token.asset.canonicalSymbol,
          decimals: token.asset.decimals,
          source: 'spot',
          positionType: 'asset',
          rawAmount: BigInt(token.tokenBalanceDecimal),
          price: prices.chains[chainId].tokens[token.contractAddress],
        })
      }
    }
  }

  for (const [rawChainId, chain] of Object.entries(defi.protocols.aave_v3)) {
    const chainId = Number(rawChainId) as ChainId
    if (!chain) continue
    for (const [wallet, walletPositions] of Object.entries(chain.wallets)) {
      for (const position of walletPositions) {
        const common = {
          chainId,
          wallet,
          assetId: position.assetId,
          contractAddress: position.underlyingAsset,
          canonicalSymbol: position.canonicalSymbol,
          decimals: position.decimals,
          source: 'aave_v3' as const,
          price: prices.chains[chainId].tokens[position.underlyingAsset],
        }
        const supplied = BigInt(position.currentATokenBalance)
        if (supplied > 0n) addPosition({
          ...common,
          positionType: 'asset',
          rawAmount: supplied,
        })
        const debt = BigInt(position.currentStableDebt) + BigInt(position.currentVariableDebt)
        if (debt > 0n) addPosition({
          ...common,
          positionType: 'liability',
          rawAmount: debt,
        })
      }
    }
  }

  const out: NavPositionsFixture = {
    identityKey: 'chainId + contractAddress',
    minimumUsdValue: NAV_DUST_USD,
    positions,
    excluded,
  }
  await writeJson(fixturePath('nav_positions.json'), out)
  return out
}

if (isMain(import.meta.url)) await collectNavPositions()
