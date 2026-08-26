import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  eventsInRange,
  generateGroundTruth,
} from './ground-truth.js'

const FIXTURE_DIR = resolve('./fixtures/treasury_v1')

interface GroundTruthNav {
  total: string
  grossAssets: string
  liabilities: string
  walletLiquid: string
  defiNet: string
  byAsset: Record<string, { value: string; percentOfNav: string }>
  byChain: Record<string, { value: string; percentOfNav: string }>
}

interface GroundTruthLeverage {
  ethereumEnabledCollateral: string
  ethereumCollateralByAsset: Record<string, string>
}

describe('ground-truth oracle checks', () => {
  it('independently values Avalanche USDC.e from raw units and snapshot price', async () => {
    const [balances, prices, nav] = await Promise.all([
      readJson('balances.json'),
      readJson('prices.json'),
      readJson('nav_positions.json'),
    ])
    const address = '0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664'
    const wallet = Object.values(balances.chains['43114'] as Record<string, {
      erc20: Array<{ contractAddress: string; tokenBalanceDecimal: string; metadata: { decimals: number } }>
    }>)[0]!
    const balance = wallet.erc20.find((token) => token.contractAddress === address)!
    const priceSeries = (prices.chains['43114'] as {
      tokens: Record<string, { data: Array<{ timestamp: string; value: string }> }>
    }).tokens[address]!.data
    const snapshot = Date.parse(prices.snapshotTimestamp as string)
    const price = priceSeries.reduce((nearest, point) =>
      Math.abs(Date.parse(point.timestamp) - snapshot)
        < Math.abs(Date.parse(nearest.timestamp) - snapshot) ? point : nearest)
    const position = (nav.positions as Array<{
      chainId: number
      contractAddress: string
      source: string
      valueUsd: string
    }>).find((candidate) => candidate.chainId === 43114
      && candidate.contractAddress === address && candidate.source === 'spot')!

    const fractionDigits = price.value.split('.')[1]?.length ?? 0
    const priceUnits = BigInt(price.value.replace('.', ''))
    const denominator = 10n ** BigInt(balance.metadata.decimals + fractionDigits)
    const cents = (BigInt(balance.tokenBalanceDecimal) * priceUnits * 100n
      + denominator / 2n) / denominator

    expect(formatPlainCents(cents)).toBe(position.valueUsd)
  })

  it('includes both date-window boundaries and excludes adjacent milliseconds', () => {
    const start = Date.parse('2026-07-25T15:00:00.000Z')
    const end = Date.parse('2026-08-24T15:00:00.000Z')
    const events = [
      { id: 'before', timestamp: '2026-07-25T14:59:59.999Z' },
      { id: 'start', timestamp: '2026-07-25T15:00:00.000Z' },
      { id: 'end', timestamp: '2026-08-24T15:00:00.000Z' },
      { id: 'after', timestamp: '2026-08-24T15:00:00.001Z' },
    ]

    expect(eventsInRange(events, start, end).map(({ id }) => id)).toEqual(['start', 'end'])
  })

  describe('generated report cross-foots', () => {
    let nav: GroundTruthNav
    let leverage: GroundTruthLeverage

    beforeAll(async () => {
      const generated = await generateGroundTruth(FIXTURE_DIR)
      nav = generated.report.nav as GroundTruthNav
      leverage = generated.report.leverage as GroundTruthLeverage
    })

    it('cross-foots gross assets less liabilities to NAV', () => {
      const total = parseUsdCents(nav.total)
      expect(parseUsdCents(nav.grossAssets) - parseUsdCents(nav.liabilities)).toBe(total)
    })

    it('cross-foots wallet-held and net DeFi positions to NAV', () => {
      const total = parseUsdCents(nav.total)
      expect(parseUsdCents(nav.walletLiquid) + parseUsdCents(nav.defiNet)).toBe(total)
    })

    it('cross-foots chain allocations to NAV', () => {
      const total = parseUsdCents(nav.total)
      expect(sum(Object.values(nav.byChain).map(({ value }) => parseUsdCents(value))))
        .toBe(total)
    })

    it('cross-foots asset allocations to NAV', () => {
      const total = parseUsdCents(nav.total)
      expect(sum(Object.values(nav.byAsset).map(({ value }) => parseUsdCents(value))))
        .toBe(total)
    })

    it('cross-foots signed asset percentages to 100%', () => {
      expect(sum(Object.values(nav.byAsset).map(({ percentOfNav }) =>
        parsePercentBasisPoints(percentOfNav)))).toBe(10_000n)
    })

    it('cross-foots Ethereum collateral components to enabled collateral', () => {
      expect(sum(Object.values(leverage.ethereumCollateralByAsset).map(parseUsdCents)))
        .toBe(parseUsdCents(leverage.ethereumEnabledCollateral))
    })
  })
})

async function readJson(name: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(resolve(FIXTURE_DIR, name), 'utf8')) as Record<string, any>
}

function parseUsdCents(value: string): bigint {
  const normalized = value.replace('$', '').replaceAll(',', '')
  const negative = normalized.startsWith('-')
  const [integer, fraction = ''] = normalized.replace('-', '').split('.')
  const cents = BigInt(integer!) * 100n + BigInt(fraction.padEnd(2, '0'))
  return negative ? -cents : cents
}

function formatPlainCents(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`
}

function parsePercentBasisPoints(value: string): bigint {
  const normalized = value.replace('%', '')
  const negative = normalized.startsWith('-')
  const [integer, fraction = ''] = normalized.replace('-', '').split('.')
  const basisPoints = BigInt(integer!) * 100n + BigInt(fraction.padEnd(2, '0'))
  return negative ? -basisPoints : basisPoints
}

function sum(values: bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n)
}
