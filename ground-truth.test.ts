import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  eventsInRange,
  generateGroundTruth,
  summarizeNav,
  type NavPosition,
} from './ground-truth.js'

const FIXTURE_DIR = resolve('./fixtures/treasury_v1')

describe('ground-truth oracle checks', () => {
  it('subtracts Ethereum debt from assets in the hand-computed chain NAV', async () => {
    const fixture = JSON.parse(
      await readFile(resolve(FIXTURE_DIR, 'nav_positions.json'), 'utf8'),
    ) as { positions: NavPosition[] }
    const ethereum = fixture.positions.filter((position) => position.chainId === 1)

    const summary = summarizeNav(ethereum)

    // $34,039,796.58 assets - $4,068,892.66 GHO debt = $29,970,903.92 NAV.
    expect(summary.grossAssets).toBe(3_403_979_658n)
    expect(summary.liabilities).toBe(406_889_266n)
    expect(summary.net).toBe(2_997_090_392n)
  })

  it('classifies the known Aave Lido/GHO transaction as DeFi movement', async () => {
    const { report } = await generateGroundTruth(FIXTURE_DIR)
    const flows = report.flows as {
      currentMonth: {
        topTransactions: Array<{ hash: string; classes: string[] }>
      }
    }
    const transaction = flows.currentMonth.topTransactions.find(({ hash }) =>
      hash === '0x924e2579dd8b32d96c23df2242ae73702c219339640059a7c5e695a06aa1f0b7')

    expect(transaction).toBeDefined()
    expect(transaction?.classes).toEqual(['defi_movement'])
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

  it('reports EURS separately from USD-pegged stablecoin liquidity', async () => {
    const { report } = await generateGroundTruth(FIXTURE_DIR)
    const nav = report.nav as {
      stableGrossAssets: string
      usdPeggedGrossAssets: string
      fxExposedStableAssets: string
    }

    expect(nav.stableGrossAssets).toBe('$7,041,552.68')
    expect(nav.usdPeggedGrossAssets).toBe('$6,946,538.36')
    expect(nav.fxExposedStableAssets).toBe('$95,014.32')
  })
})
