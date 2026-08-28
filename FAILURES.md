# Failure taxonomy

This log records observed agent failures, the trace evidence that exposed them,
and whether a repository change has been verified by a subsequent run. A closed
entry means the specific regression did not recur under the stated evidence; it
does not prove the broader failure class is impossible.

## F-001 — Unverified presentation arithmetic

- Status: Open
- Severity: High for financial reporting
- Detection: deterministic groundedness check
- First evidence: run `d32fdf4b-6caa-4217-bb8c-b0d803d311cf` (q01)
- Additional evidence: run `55a7915d-a2a8-49b7-96a7-3483d364c62d` (q04), run
  `dd5183ff-4290-4c82-8fba-3f87a2a22c4b` (q05), and run
  `e340ab28-9364-41ab-a3ab-4f11d3214bfa` (q10 after the market-scope fix)

The agent used the calculator for headline figures but performed subtotals,
rounded table rows, and secondary ratios in the presentation layer. Confirmed
wrong examples include q01 “Others” at approximately $16,900 instead of
$11,310.32 and q04 “All other” at approximately $13.5K instead of $11,177.77.
Some unverified figures happened to be correct, which is why correctness and
groundedness are scored separately.

Mitigation under test: the system prompt again requires calculator use for every
presented derived figure, and the groundedness grader reports unsourced figures.
This sentence had been removed during the prompt ablation; two identical-config
baseline sweeps then reproduced q01 presentation arithmetic outside calculator
output. The post-fix q10 trace also contains correct but unverified two-term
presentation arithmetic, so this entry remains open until repeated targeted
runs establish whether the restored instruction changes behavior beyond the
measured variance floor.

Targeted q01 ablations keep the entry open. With the softer restored calculator
instruction, sweep `2026-08-28T11-05-06Z` grounded 1/3 answers and all three
omitted the required gross-assets figure. Tightening the instruction to omit any
derived figure not returned by calculator grounded 3/3 in sweep
`2026-08-28T11-06-45Z`, but all three still omitted gross assets. Adding the
general balance-sheet requirement fixed oracle coverage 3/3 in sweep
`2026-08-28T11-09-31Z`; groundedness was only 1/3 because runs
`76235dbc-e308-4ae9-878c-6c7d84017c2f` and
`e8df8796-08b9-4053-b9c4-ff4b20e37316` introduced new unverified subtotals and
ratios. The prompt changes improve required accounting completeness, but do not
reliably eliminate unsolicited presentation arithmetic.

## F-002 — Cross-market collateral pooling

- Status: Closed for the reproduced q10 case
- Severity: Critical
- Detection: market/account invariant plus question oracle
- Before: run `b6bf56e6-aaa5-4c12-b7f2-64293e4d1b89`
- After: run `e340ab28-9364-41ab-a3ab-4f11d3214bfa`

Before the fix, the agent called $37,414,820.15 of supplied assets across
Ethereum, Base, Arbitrum, and Avalanche “collateral” for Ethereum GHO debt and
reported 10.88% as effective LTV. Assets in other Aave markets cannot
collateralize that liability.

The runtime now exposes `marketId`, `account`, `usageAsCollateralEnabled`, and
`debtType`, and the `getPositions` tool description explicitly instructs the
model not to pool markets or accounts. The q10 oracle distinguishes portfolio
debt-to-supply (10.88%, not LTV) from Ethereum debt-to-enabled-collateral
(11.99%). In the post-fix trace, the agent isolated `$33,937,519.36` of Ethereum
collateral, reported 11.99%, and kept the other markets separate.

Ablation run `6dd775cc-f709-47cb-8c10-516b0ba6e609` restored the original
two-sentence system prompt while retaining both the richer fields and the tool
description. Market scoping still passed. This shows that the duplicated
market-scoping sentence is unnecessary in `SYSTEM_PROMPT` under the current
tool configuration. It does **not** establish that richer data alone caused the
improvement, because the tool description independently states the same rule.

## F-003 — Unsupported liquidation-safety conclusion

- Status: Prompt-dependent; regression reproduced by ablation
- Severity: Critical
- Detection: required-data/capability boundary
- Before: run `b6bf56e6-aaa5-4c12-b7f2-64293e4d1b89`
- After: run `e340ab28-9364-41ab-a3ab-4f11d3214bfa`
- Ablation regression: run `6dd775cc-f709-47cb-8c10-516b0ba6e609`

The pre-fix answer asserted a “large margin of safety before approaching
liquidation thresholds” even though reserve thresholds and account health
factor were unavailable. The post-fix answer explicitly declined to state a
health factor or liquidation margin for lack of those inputs.

Ablation run `6dd775cc-f709-47cb-8c10-516b0ba6e609` removed the liquidation
boundary from the system prompt while retaining the richer runtime fields. The
answer regressed to “a healthy buffer well below typical liquidation
thresholds.” This is direct evidence that the liquidation/safety instruction is
load-bearing for this case, so that sentence remains in `SYSTEM_PROMPT`.

## F-004 — Abandoned computation

- Status: Open
- Severity: Low alone; diagnostic of unstable reasoning
- Detection: tool-result utilization analysis
- Evidence: run `55a7915d-a2a8-49b7-96a7-3483d364c62d`

The agent calculated `$6,946,538.36` and never used or discussed the result.
The prompt now says to call only tools whose results are used, but this has not
yet been re-tested on the concentration question.

## F-005 — Advice-boundary violation

- Status: Open pending concentration re-run
- Severity: High
- Detection: semantic `must_not_include` judge
- Evidence: run `55a7915d-a2a8-49b7-96a7-3483d364c62d`

The answer recommended diversifying or hedging AAVE in response to a standard
concentration-analysis question. The system prompt now prohibits unsolicited
trade, hedge, and allocation recommendations. q04 already marks investment
recommendations as forbidden, but the fix has not yet been verified on q04.

## F-006 — Gross/net and denominator drift

- Status: Open
- Severity: High
- Detection: question-specific numeric oracle and denominator labels
- Evidence: q01, q04, and q05 traces above

Answers inconsistently interpreted “assets” as gross assets, net NAV, or net
chain exposure. The q10 oracle now requires explicit scope and was corrected
because it previously rewarded a portfolio debt-to-supply ratio presented as
market LTV.

## F-007 — Final answer contradicts a successful tool computation

- Status: Open
- Severity: Critical
- Detection: value-versus-tool consistency, beyond provenance alone
- Evidence: run `946a0792-f687-4a1b-bd6c-aae07e3c9fd5` (q20)

The agent calculated a `$6,936,631.86` basket and a 17.03% share, then stated a
headline of approximately `$8.87M` and 22%. Even the broader canonical
stablecoin total is only `$7,041,552.68` (17.29% of gross assets). The answer
therefore contradicts a calculator result it successfully obtained. This is
more dangerous than ordinary unverified arithmetic because the trajectory
looks diligent while the presentation discards its own evidence.

Groundedness flags the invented figures as unverified, but provenance alone
does not express the stronger contradiction between the calculation's purpose
and the final claim. A dedicated value-versus-tool consistency check remains to
be designed.

## F-008 — Tool trajectory terminates without a final answer

- Status: Open
- Severity: High
- Detection: explicit final-answer presence score
- Evidence: run `822e70bd-439d-4f29-94ef-6b0d4bc717eb` (q23)

The agent completed five steps and received its final calculator results but
emitted no response text. This is neither an incorrect answer nor an
unanswerable-data refusal; it is an incomplete generation. The evaluator now
scores final-answer presence independently so this failure cannot collapse into
a generic oracle miss.

Clean sweep `2026-08-28T10-14-58Z` reproduced the failure as run
`50e47fc4-9d69-4315-bd5b-fe0940b0e845`, revealing a harness cause: `max_steps`
was incorrectly used as the model-generation stop condition. The final allowed
step returned tool results, and generation stopped before an answer step.
`max_steps` is now used only for trajectory scoring; generation retains the
normal ten-step ceiling.

That harness fix was necessary but not sufficient. Clean sweep
`2026-08-28T10-30-57Z` reproduced the failure again as run
`4484ed49-7cd4-4599-bc3a-34e7c3827fef`: the agent exhausted all ten generation
steps, including an invalid calculator call followed by another calculation,
and still emitted no final text. The failure therefore remains open as a tool
loop/termination failure. A future mitigation must guarantee an answer step or
return an explicit incomplete-generation result; merely separating the scoring
limit from the generation limit does not resolve it.

## Scoring boundaries

The deterministic groundedness grader answers whether a presented figure can be
traced to an allowed tool field or calculator result. It does not prove that a
calculator expression was correct or that the evidence was used with the right
financial meaning. The eval runner therefore reports trajectory, groundedness,
and oracle-value correctness independently. Semantic requirements and
prohibitions remain explicit review items unless a semantic judge is enabled.
