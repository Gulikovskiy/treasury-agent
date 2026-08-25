# Treasury fixture collector (TypeScript)

Creates a deterministic, read-only treasury fixture for wallet/treasury-agent evals.

The collector is TypeScript-first: run source directly with `tsx`, or compile it with `tsc`.

## Outputs

`FIXTURE_DIR` receives:

- `manifest.json` — snapshot metadata, pinned history ranges, source routing, NAV policy, and wallet-control evidence
- `wallets.json` — treasury-controlled addresses by chain
- `balances.json` — native + spot ERC-20 balances read at the pinned block
- `transactions.json` — normal transactions, ERC-20 transfers, Alchemy transfers where supported, and receipts
- `prices.json` — historical prices around the snapshot timestamp
- `defi_positions.json` — Aave V3 user reserve state at the pinned block
- `nav_positions.json` — canonical priced positions after allowlist and dust filters
- `address_labels.json` — controlled/manual/known-protocol labels
- `contracts.json` — code presence + token metadata for encountered addresses
- `protocols.json` — known Aave V3 contracts by chain

## Install and run

```bash
cp .env.example .env
# edit .env
npm install
npm run typecheck
npm run collect
```

You can also run one collector at a time:

```bash
npm run manifest
npm run balances
npm run transactions
npm run prices
npm run defi
npm run metadata
npm run labels
```

## Snapshot behavior

On the first run, `manifest.json` pins one block per chain at or immediately before `SNAPSHOT_TIMESTAMP`. Later runs reuse the existing manifest, so the on-chain state remains deterministic.

To intentionally create a new snapshot:

```bash
RESET_SNAPSHOT=1 \
SNAPSHOT_TIMESTAMP=2026-08-24T15:00:00Z \
npm run collect
```

After collection, commit the whole fixture directory. Eval/CI mode should read these JSON files only and never call live providers.

## Treasury addresses

Edit `TREASURY_WALLETS` in `config.ts`:

```ts
export const TREASURY_WALLETS = {
  1: ['0x...'],
  43114: ['0x...'],
  42161: ['0x...'],
  8453: ['0x...'],
} satisfies ChainMap<readonly Address[]>
```

It is intentionally a per-chain map rather than `ADDRESSES × CHAINS`, because treasury-controlled addresses can differ by network.

`TEST_ADDRESSES` contains the non-address sentinels used by q25/q26 in
`questions.jsonl`. They are emitted under `wallets.json.testAddresses`, always
have `controlled: false`, and are never passed to RPC collectors. q25 explicitly
models empty data; q26 models an external entity that must not be attributed to
the treasury.

## Why balances are collected in two stages

`alchemy_getTokenBalances` is used only to discover ERC-20 contracts. Only
contract addresses in `NAV_TOKEN_ALLOWLIST` proceed to pinned-block `balanceOf`
collection; native balances are read at that same block. Discovery is retained
as counts only. This prevents spam airdrops and current-head balances from
entering model-facing holdings.

Token identity is always `chainId + contractAddress`. Symbols and names are
attacker-controlled display strings, so provider/on-chain token metadata is not
stored in model-facing fixtures. Allowlisted assets receive canonical labels
from configuration; configured Aave reserves receive labels from the pinned
address-book package.

Aave V3 aTokens and variable-debt tokens for markets represented in
`defi_positions.json` are excluded from the canonical `erc20` arrays in
`balances.json`. The DeFi fixture is the canonical source for those supplied
assets and debts, so NAV consumers must not add the wrapper-token balances a
second time. `discoveryRaw` is provenance only and is never an accounting input.
Wrappers for an unqueried market remain spot evidence because there is no
duplicate DeFi position. This policy is machine-readable in
`manifest.json.accountingPolicy.nav`.

## Transactions

The fixture preserves bounded transaction evidence instead of pre-classifying treasury semantics:

1. normal account transactions for zero-value calls/calldata,
2. ERC-20 transfer history (Routescan on Ethereum/Avalanche; Blockscout on Arbitrum/Base),
3. Alchemy asset transfers on configured supported chains,
4. receipts for outgoing normal transactions so gas can be calculated exactly.

Transaction provider responses are projected through explicit field allowlists.
Token names, symbols, Alchemy `asset` labels, raw provider pages, and other
open-ended metadata are discarded before writing the fixture, preventing token
metadata from becoming prompt-injection content.

Both ends of every transaction range are pinned in `manifest.json`: the snapshot
block and `chains.<chainId>.historyFrom`. Transaction collection consumes those
block numbers directly and performs no runtime lookback-block search.

The downstream eval tool should infer bridge/internal-transfer/expense/DeFi-deposit semantics. The collector should not bake those conclusions into the raw fixture.

## Aave positions

The Aave adapter uses the version-pinned `@aave-dao/aave-address-book` package to locate `AAVE_PROTOCOL_DATA_PROVIDER`, then reads `getAllReservesTokens()` and `getUserReserveData()` at the pinned block.

Bigints are written as decimal strings by `writeJson`, so fixture files remain ordinary JSON.

## Labels

Known Aave contracts are labeled from the pinned address-book dependency. Organization, exchange, vendor, payroll, or other labels should be explicitly added to `MANUAL_LABELS` in `config.ts`; do not infer EOA identity during collection.

## Wallet control

The configured treasury is a Safe proxy. Manifest collection reads its runtime
code hash, version, owner set, and threshold at each chain's pinned block. The
fixture also records whether the owner set and threshold match across chains;
owner order is ignored. This verifies the on-chain control configuration rather
than relying on the same address appearing on several networks.

## Contract metadata

`contracts.json` stores `runtimeCodeHash` and `runtimeCodeSize`, not deployed
bytecode. The hash is Keccak-256 over the exact runtime code returned at the
pinned block.

## Prices

Prices are frozen with Alchemy's historical price API around
`snapshotTimestamp`. Spot prices are requested only for address-allowlisted
assets. Aave positions are priced by `underlyingAsset`, never by their aToken or
debt-token wrapper. If retrieval fails, the fixture records the error instead of
inventing a value.

`nav_positions.json` is the canonical accounting projection. A position appears
there only when its address is trusted (explicit spot allowlist or configured
Aave reserve), it has a historical price, and its absolute value is at least the
manifest's `minimumUsdValue`. Excluded positions retain only an identity and an
explicit `unpriced` or `below_dust` reason.

## Type boundaries

Internal fixture structures are strongly typed. Third-party provider payloads that are intentionally preserved raw use narrow boundary interfaces or `unknown`; this avoids giving changing external schemas false compile-time guarantees.
