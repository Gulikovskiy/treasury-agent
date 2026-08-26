import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { calculator, getPositions, getPrices } from './treasury.js'

describe('treasury tool boundary', () => {
  it('returns raw position rows without summary or answer-key fields', async () => {
    const result = await getPositions({ chainId: 43114 })

    expect(result.positions.length).toBeGreaterThan(0)
    expect(result.positions.every(({ chainId }) => chainId === 43114)).toBe(true)
    expect(Object.keys(result).sort()).toEqual(['positions'])
    expect(Object.keys(result.positions[0]!).sort()).toEqual([
      'amount',
      'assetId',
      'canonicalSymbol',
      'chainId',
      'positionType',
      'priceUsd',
      'source',
      'valueUsd',
    ])
  })

  it('returns only requested address-keyed prices nearest the snapshot', async () => {
    const assetIds = [
      '1:0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
      '43114:native',
      '1:0x0000000000000000000000000000000000000001',
    ]
    const result = await getPrices({ assetIds })

    expect(result.prices.map(({ assetId }) => assetId)).toEqual(assetIds)
    expect(result.prices[0]).toMatchObject({ priceUsd: '135.7939153611' })
    expect(result.prices[1]).toMatchObject({ priceUsd: '7.5798025536' })
    expect(result.prices[2]).toEqual({ assetId: assetIds[2], error: 'not_found' })
  })

  it('evaluates arithmetic without executing JavaScript', () => {
    expect(calculator({ expression: '(32658754.64 * 0.2) / 36659437.35 * 100' }).result)
      .toBe('17.817379098427434')
    expect(calculator({ expression: '2 + 3 * 4' }).result).toBe('14')
    expect(() => calculator({ expression: 'process.exit()' })).toThrow('expected number')
  })

  it('contains no answer-key filename or import in any runtime tool source', async () => {
    const toolDir = resolve('./tools')
    const runtimeFiles = (await readdir(toolDir)).filter((name) =>
      name.endsWith('.ts') && !name.endsWith('.test.ts'))
    const source = (await Promise.all(runtimeFiles.map((name) =>
      readFile(resolve(toolDir, name), 'utf8')))).join('\n')
    const forbiddenName = ['ground', 'truth.json'].join('_')

    expect(source).not.toContain(forbiddenName)
    expect(source).not.toContain('../ground-truth')
  })
})
