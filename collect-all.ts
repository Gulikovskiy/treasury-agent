import { collectManifest } from './collectors/manifest.js'
import { collectBalances } from './collectors/balances.js'
import { collectTransactions } from './collectors/transactions.js'
import { collectPrices } from './collectors/prices.js'
import { collectDefiPositions } from './collectors/defi-positions.js'
import { collectMetadata } from './collectors/metadata.js'
import { collectLabels } from './collectors/labels.js'
import { collectNavPositions } from './collectors/nav.js'

await collectManifest()
await collectBalances()
await collectTransactions()
await collectDefiPositions()
await collectPrices()
await collectNavPositions()
await collectMetadata()
await collectLabels()

console.log('fixture collection complete')
