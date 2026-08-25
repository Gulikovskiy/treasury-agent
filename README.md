# Treasury fixture collector (TypeScript)

Creates a deterministic, read-only treasury fixture for wallet/treasury-agent evals.

The collector is TypeScript-first: run source directly with `tsx`, or compile it with `tsc`.

## Outputs

`FIXTURE_DIR` receives:

- `manifest.json` — snapshot timestamp + one pinned block per chain
- `wallets.json` — treasury-controlled addresses by chain
- `balances.json` — native + ERC-20 balances read at the pinned block, with explicit asset/liability treatment
- `transactions.json` — normal transactions, ERC-20 transfers, Alchemy transfers where supported, and receipts
- `prices.json` — historical prices around the snapshot timestamp
- `defi_positions.json` — Aave V3 user reserve state at the pinned block
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

## Why balances are collected in two stages

`alchemy_getTokenBalances` is used only to discover ERC-20 contracts. For each discovered contract, the collector performs `balanceOf(wallet)` at the block pinned in `manifest.json`; native balances are read at that same block. This prevents current-head balances from leaking into a historical fixture.

Aave variable-debt tokens are retained as raw ERC-20 evidence, but their balance
records have `positionType: "liability"`, `protocol: "aave_v3"`, and the reserve's
`underlyingAsset`. NAV consumers must subtract liabilities and must not also
subtract the matching debt in `defi_positions.json`.

## Transactions

The fixture preserves raw evidence instead of pre-classifying treasury semantics:

1. normal account transactions for zero-value calls/calldata,
2. ERC-20 transfer history,
3. Alchemy asset transfers on configured supported chains,
4. receipts for outgoing normal transactions so gas can be calculated exactly.

The downstream eval tool should infer bridge/internal-transfer/expense/DeFi-deposit semantics. The collector should not bake those conclusions into the raw fixture.

## Aave positions

The Aave adapter uses the version-pinned `@aave-dao/aave-address-book` package to locate `AAVE_PROTOCOL_DATA_PROVIDER`, then reads `getAllReservesTokens()` and `getUserReserveData()` at the pinned block.

Bigints are written as decimal strings by `writeJson`, so fixture files remain ordinary JSON.

## Labels

Known Aave contracts are labeled from the pinned address-book dependency. Organization, exchange, vendor, payroll, or other labels should be explicitly added to `MANUAL_LABELS` in `config.ts`; do not infer EOA identity during collection.

## Prices

Prices are frozen with Alchemy's historical price API around `snapshotTimestamp`. Provider responses are preserved as fixture truth. If price retrieval fails, the fixture records the error instead of inventing a value.

## Type boundaries

Internal fixture structures are strongly typed. Third-party provider payloads that are intentionally preserved raw use narrow boundary interfaces or `unknown`; this avoids giving changing external schemas false compile-time guarantees.
