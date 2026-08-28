# Treasury fixture collector (TypeScript)

Creates a deterministic, read-only treasury fixture for wallet/treasury-agent evals.

The collector is TypeScript-first: run source directly with `tsx`, or compile it with `tsc`.

## Outputs

`FIXTURE_DIR` receives:

- `manifest.json` — snapshot metadata, pinned history ranges, source routing, NAV policy, and wallet-control evidence
- `wallets.json` — treasury-controlled addresses by chain
- `balances.json` — raw ERC-20 discovery evidence plus balances read at the pinned block
- `transactions.json` — normal transactions, ERC-20 transfers, Alchemy transfers where supported, and receipts
- `prices.json` — snapshot and transaction-window historical prices
- `defi_positions.json` — Aave V3 user reserve state at the pinned block
- `nav_positions.json` — canonical priced positions after allowlist and dust filters
- `address_labels.json` — controlled/manual/known-protocol labels
- `contracts.json` — code presence, runtime code hash, and runtime code size
- `protocols.json` — known Aave V3 contracts by chain
- `ground_truth.json` — deterministic metrics and generated expected answers for `questions.jsonl`

## Install and run

```bash
cp .env.example .env
# edit .env
npm install
npm run typecheck
npm run collect
npm run ground-truth:update
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
npm run ground-truth
```

## Ground truth

`ground-truth.ts` is a plain TypeScript accounting program: it reads committed
fixture JSON only, makes no RPC or LLM calls, and calculates NAV, concentration,
liquidity, stablecoin exposure, chain allocation, flows, spend coverage, gas,
and stress scenarios. It uses the canonical transfer source and classification
policy declared in the manifest, address-keyed daily prices, and the pinned Aave
address-book package.

Run `npm run ground-truth` for a read-only JSON report. Run
`npm run ground-truth:update` to write `fixtures/treasury_v1/ground_truth.json`
and replace each question's `expected_answer` and `must_include` fields with the
computed result. Unsupported metrics remain explicitly unsupported; for example,
the script does not invent burn or runway when no operating-expense labels exist.
Run `npm test` for independent oracle checks covering raw-balance valuation,
date-window boundaries, NAV cross-footing by accounting bucket, chain and asset,
signed allocation percentages, and collateral-component reconciliation.

The accounting policy includes EURS in the broad stablecoin total because it is
EUR-pegged, but reports it separately as EUR/USD FX exposure. The
`usdPeggedGrossAssets` subtotal excludes EURS.

## Eval tool boundary

Runtime tools never read `ground_truth.json`; that file belongs exclusively to
the grader. `getPositions({ chainId? })` projects canonical position rows from
`nav_positions.json` without totals or allocations. Aave rows retain their
`marketId`, `account`, collateral-enabled flag, and debt type so market-scoped
collateral analysis does not pool unrelated chains or accounts. `getPrices({ assetIds })`
returns only requested address-keyed prices from `prices.json`, nearest the
snapshot. `calculator({ expression })` evaluates arithmetic with a restricted
parser and cannot execute JavaScript. This leaves NAV, concentration, chain
allocation, leverage, and scenario reasoning to the evaluated agent.

## Evaluation runner

Run all questions and write fresh traces plus detailed JSONL scores:

```bash
npm run eval
```

Score existing traces without making model calls:

```bash
npm run eval:score
```

Use `--questions q01,q04,q10` to run or score a subset. Fresh runs write
`eval-traces.jsonl`; both modes write `eval-results.jsonl`. The console table
keeps trajectory, numeric groundedness, and value-versus-oracle scores
separate. Detailed results retain semantic `must_include` and
`must_not_include` requirements for human or judge review rather than treating
them as deterministic substring checks.

To run every question sequentially as one identifiable sweep:

```bash
npm run run:all
```

Each invocation creates `runs/<UTC sweep ID>/` containing `manifest.json`,
`traces.jsonl`, and `scores.json`. The manifest records the Git revision and
dirty state, model, full system prompt and its hash, projected tool fields,
fixture ID, exact question-set hash, and sample count. Sweep traces are ignored
by default; manifests and scores remain commit-visible. Force-add a trace when
it is cited as evidence in `FAILURES.md`.

Use `--samples 3` for repeated samples or `--runs-dir another-directory` to
choose a different sweep root. The top-level `traces.jsonl` remains scratch
space for single-question runs.

## Snapshot behavior

On the first run, `manifest.json` pins one block per chain at or immediately before `SNAPSHOT_TIMESTAMP`. Later runs reuse the existing manifest, so the on-chain state remains deterministic.

To intentionally create a new snapshot:

```bash
RESET_SNAPSHOT=1 \
SNAPSHOT_TIMESTAMP=2026-08-24T15:00:00Z \
npm run collect
```

After collection, commit the whole fixture directory. The grader may read the
answer key, but the evaluated agent's runtime tool allowlist is limited to the
non-grader fixture projections documented above and never calls live providers.

## Treasury addresses

Edit `TREASURY_WALLETS` in `config.ts`:

```ts
export const TREASURY_WALLETS = {
  1: ["0x..."],
  43114: ["0x..."],
  42161: ["0x..."],
  8453: ["0x..."],
} satisfies ChainMap<readonly Address[]>;
```

It is intentionally a per-chain map rather than `ADDRESSES × CHAINS`, because treasury-controlled addresses can differ by network.

`TEST_ADDRESSES` contains the non-address sentinels used by q25/q26 in
`questions.jsonl`. They are emitted under `wallets.json.testAddresses`, always
have `controlled: false`, and are never passed to RPC collectors. q25 explicitly
models empty data; q26 models an external entity that must not be attributed to
the treasury.

## Why balances are collected in two stages

`alchemy_getTokenBalances` is used only to discover ERC-20 contracts. Only
nonzero balances survive the subsequent pinned-block `balanceOf` read; native
balances are read at that same block. The complete nonzero ERC-20 array and the
provider's raw discovery pages are retained in `balances.json`. This matters
because token discovery is a current-state indexer call and cannot be reproduced
from the pinned block later. Collection records what was observed; NAV applies
accounting policy in a separate projection.

Token identity is always `chainId + contractAddress`. Symbols and names are
attacker-controlled display strings. Raw metadata is retained only with
`metadataTrust: "untrusted"` for provenance, spam analysis, and adversarial evals;
it must not be treated as an instruction or emitted by normalized holdings tools.
Allowlisted assets receive canonical labels from configuration; configured Aave
reserves receive labels from the pinned address-book package.

Aave V3 aTokens and variable-debt tokens remain visible in raw balances, but are
not spot NAV assets. The DeFi fixture is the canonical source for supplied assets
and debts in configured markets, so NAV consumers must not add wrapper balances a
second time. A wrapper from an unqueried market therefore remains auditable as a
`not_allowlisted` exclusion instead of disappearing or being misreported as a
clean position. `discoveryRaw` is provenance only and is never an accounting
input. This policy is machine-readable in `manifest.json.accountingPolicy.nav`.

## Transactions

The fixture preserves bounded transaction evidence instead of pre-classifying treasury semantics:

1. normal account transactions for zero-value calls/calldata,
2. ERC-20 transfer history (Routescan on Ethereum/Avalanche; Blockscout on Arbitrum/Base),
3. Alchemy asset transfers on configured supported chains,
4. receipts for outgoing normal transactions so gas can be calculated exactly.

Transaction provider responses are projected through explicit field allowlists.
Token names, symbols, Alchemy `asset` labels, raw provider pages, and other
open-ended metadata are discarded before writing the fixture, preventing token
metadata from becoming prompt-injection content. Transfer event IDs or stable
provider ordinals and exact raw contract amounts are retained so distinct events
inside one transaction are not collapsed during deduplication.

Both ends of every transaction range are pinned in `manifest.json`: the snapshot
block and `chains.<chainId>.historyFrom`. Transaction collection consumes those
block numbers directly and performs no runtime lookback-block search.

The downstream eval tool should infer bridge/internal-transfer/expense/DeFi-deposit semantics. The collector should not bake those conclusions into the raw fixture.

`manifest.json.accountingPolicy.flows` governs that inference: transaction
deduplication, classification order, internal/bridge/DeFi exclusions, 30-day
external-flow and gas windows, UTC calendar-month spend, trailing three-month
burn, and historical pricing by contract address are explicit rather than
left to each ground-truth implementation. It also names one canonical transfer
event source per chain, so overlapping provider lists are corroboration rather
than amounts to add together. Expense is a secondary classification of external
outflow, and missing prices must be disclosed rather than treated as zero.

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
than relying on the same address appearing on several networks. Organizational
attribution is a separate claim: the manifest links the primary Aave governance
record that identifies the wallet as the Aave Finance Committee spender on all
four chains and states that this is public attribution, not proof of legal
beneficial ownership.

## Contract metadata

`contracts.json` stores `runtimeCodeHash` and `runtimeCodeSize`, not deployed
bytecode. The hash is Keccak-256 over the exact runtime code returned at the
pinned block.

## Prices

Prices are frozen with Alchemy's historical price API around
`snapshotTimestamp`, with daily address-keyed histories covering the transaction
window. Snapshot NAV chooses the observation nearest `snapshotTimestamp` rather
than the midpoint of the request window. Spot prices are requested only for
address-allowlisted assets. Aave positions are priced by `underlyingAsset`, never
by their aToken or debt-token wrapper. If retrieval fails, the fixture records
the error instead of inventing a value.

`nav_positions.json` is the canonical accounting projection. A position appears
there only when its address is trusted (explicit spot allowlist or configured
Aave reserve), it has a historical price, and its absolute value is at least the
manifest's `minimumUsdValue`. Excluded positions retain only an identity and an
explicit `not_allowlisted`, `collection_error`, `unpriced`, or `below_dust`
reason, plus a pointer back to the raw balance when applicable. USD values are
calculated with integer fixed-point arithmetic and rounded half-up to cents.

## Type boundaries

Internal fixture structures are strongly typed. Third-party provider payloads that are intentionally preserved raw use narrow boundary interfaces or `unknown`; this avoids giving changing external schemas false compile-time guarantees.
