import { collectManifest } from './collectors/manifest.js'
import { collectBalances } from './collectors/balances.js'
import { collectTransactions } from './collectors/transactions.js'
import { collectPrices } from './collectors/prices.js'
import { collectDefiPositions } from './collectors/defi-positions.js'
import { collectMetadata } from './collectors/metadata.js'
import { collectLabels } from './collectors/labels.js'

await collectManifest()
await collectBalances()
await collectTransactions()
await collectPrices()
await collectDefiPositions()
await collectMetadata()
await collectLabels()

console.log('fixture collection complete')
