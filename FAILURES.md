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

Mitigation: the system prompt requires calculator use for every presented
derived figure, and the groundedness grader reports unsourced figures. The
post-fix q10 trace still contains correct but unverified two-term presentation
arithmetic, so this entry remains open.

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
`debtType`. The q10 oracle distinguishes portfolio debt-to-supply (10.88%, not
LTV) from Ethereum debt-to-enabled-collateral (11.99%). In the post-fix trace,
the agent isolated `$33,937,519.36` of Ethereum collateral, reported 11.99%, and
kept the other markets separate.

## F-003 — Unsupported liquidation-safety conclusion

- Status: Closed for the reproduced q10 case
- Severity: Critical
- Detection: required-data/capability boundary
- Before: run `b6bf56e6-aaa5-4c12-b7f2-64293e4d1b89`
- After: run `e340ab28-9364-41ab-a3ab-4f11d3214bfa`

The pre-fix answer asserted a “large margin of safety before approaching
liquidation thresholds” even though reserve thresholds and account health
factor were unavailable. The system prompt and q10 oracle now forbid that
inference. The post-fix answer explicitly declined to state a health factor or
liquidation margin for lack of those inputs.

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
chain exposure. The prompt now requires explicit gross/net labels and named
ratio denominators. The q10 oracle was corrected because it previously rewarded
a portfolio debt-to-supply ratio presented as market LTV.

## Scoring boundaries

The deterministic groundedness grader answers whether a presented figure can be
traced to an allowed tool field or calculator result. It does not prove that a
calculator expression was correct or that the evidence was used with the right
financial meaning. The eval runner therefore reports trajectory, groundedness,
and oracle-value correctness independently. Semantic requirements and
prohibitions remain explicit review items unless a semantic judge is enabled.
