# Failure taxonomy

This log records observed agent failures, the trace evidence that exposed them,
and whether a repository change has been verified by a subsequent run. A closed
entry means the specific regression did not recur under the stated evidence; it
does not prove the broader failure class is impossible.

## F-001 — Unverified presentation arithmetic

- Status: Structurally mitigated; verified on q01
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

The initial n=3 result was misleading. Variant B appeared to fix groundedness
at 3/3, but fell to 4/10 when remeasured; variant C remained at 1/10 after its
initial 1/3. Had B been accepted at n=3, F-001 would have been closed on noise.
This is direct evidence that a short successful prompt ablation is not enough to
establish a mitigation for this agent. The remeasurement overturned the working
conclusion rather than confirming it.

At ten samples, variant B (the explicit omit consequence) grounded 4/10 and met
the original oracle 2/10. Variant C (B plus mandatory gross/liabilities/net)
grounded 1/10 and met the oracle 9/10. The groundedness difference is not
statistically distinguishable at this sample size (two-sided Fisher exact
`p≈0.303`), while the oracle difference is (`p≈0.0055`). Variant C also produced
an unverified `80%` in 9/10 answers. Because q01 asks for current money rather
than a full balance-sheet reconciliation, its oracle now requires canonical
NAV, explicit debt treatment, dominant AAVE value, and the coverage caveat, but
does not require gross assets. Variant B remains in the prompt; the prompt-only
approach is rejected because 4/10 grounded answers is not an acceptable fix.

Structural mitigation: final answers now pass through `checkGroundedness` before
they are returned. An unsupported or missing answer receives one repair pass
with the original tool transcript and the exact unsupported figures; the model
may call calculator or omit them. If the repair still fails, the output layer
returns an explicit figure-free fallback and retains both attempts plus the
guardrail verdict in the trace.

Sweep `2026-08-28T12-04-28Z` verified this boundary on ten q01 samples: 7 were
grounded initially, 3 were intercepted and repaired, and none reached fallback.
Groundedness passed 10/10. Oracle coverage passed 9/10; the remaining answer
omitted AAVE's value and was not a grounding failure. This closes the reproduced
q01 presentation-arithmetic path, not the broader correctness problem:
calculator laundering and semantically misused source values remain outside the
groundedness guardrail's claim.

The repair preserved answer richness rather than merely deleting unsupported
rows. Run `b0e87b21-0a0e-4ee5-bb6c-92eaa4910a5f` initially presented six
unsupported per-chain figures and omitted a $12.38 Base USDC position from its
own subtotals. The repair made five calculator calls, noticed the omission, and
returned the same table shape with exact calculator-derived rows; for example,
`~$102,277`became`$102,277.22`. Run
`dc79d9ba-6523-44fb-ad33-e5651b64b9e4` demonstrates the complementary boundary:
the guardrail intercepted the exactly correct `$40,728,330.01` gross-assets
figure because it lacked provenance. The check intentionally enforces evidence,
not truth, and may therefore repair correct mental arithmetic.

Three of ten q01 runs required a second model invocation. That 30% repair rate
is an observed invocation-rate cost, not yet a 30% latency or token estimate.
Generation traces now record elapsed milliseconds and token usage separately
for initial and repair attempts, and the sweep summary aggregates both. Repair
is capped at one pass to bound this cost surface.

The first full guarded sweep, `2026-08-28T12-38-44Z`, grounded 30/30 answers.
Fourteen answers requested repair, thirteen repaired successfully, and one
failed closed. Repair added 215.4 seconds to 577.4 seconds of initial generation
time (37.3%) and 196,967 tokens to 514,936 initial tokens (38.3%). These are
single-sweep measurements, not stable production estimates. The sole rejection
also exposed checker false positives around user-supplied scenario percentages,
the `100%` constant, and a binary subtraction sign; those are now treated as
valid provenance/syntax rather than derived claims.

The false-positive correction is narrowly verified by q11 run
`a117971e-3db8-48d4-8db7-fe39db49afc3` in targeted sweep
`2026-09-04T13-04-26Z`: answer presence, trajectory, groundedness, and oracle
all passed on the initial response, with no repair or fallback. This one sample
confirms the reproducing case is accepted; it does not estimate the corrected
checker's false-positive rate.

Against clean baseline `2026-08-28T10-14-58Z`, the full-set dimensions moved as
follows: groundedness 15→30, answer presence 29→30, oracle coverage 14→13, and
trajectory compliance 18→17. The oracle and trajectory changes are within the
previously measured 7.5% identical-configuration flip rate. The guardrail fixed
provenance and empty output; it did not improve demonstrated correctness or tool
selection. The conjunction score rose from 2/30 to 6/30 only because
groundedness stopped vetoing otherwise-passing answers, and must not be read as
evidence that the underlying agent became smarter.

The full sweep also establishes prevalence: 14/30 answers (47%) reached the
guardrail with unsupported figures or missing text. That interception rate is a
more direct measure of the underlying failure frequency than the original q01
case study.

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

- Status: Structurally mitigated; verified on q23
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
and still emitted no final text. At that point the failure remained open as a
tool-loop/termination failure: a complete mitigation needed to guarantee an
answer step or return an explicit incomplete-generation result.

The output guardrail now treats missing final text as a repair condition. In
clean sweep `2026-08-28T12-38-44Z`, q23 run
`5bbdc89d-1540-4e02-8846-d552b26f3fec` again exhausted ten tool steps without
an answer; the single repair pass produced a complete grounded response. This
closes the reproduced empty-answer path. If repair also returns no answer, the
same bounded guardrail emits an explicit fallback rather than returning an
empty response.

## F-009 — Oracle coverage mistaken for correctness

- Status: Structurally corrected; existing full sweep re-scored
- Severity: High for evaluation validity
- Detection: scorer audit against concise correct answers
- Evidence: committed sweep `2026-08-28T12-38-44Z`

The original oracle extracted every figure from `expected_answer` and
`must_include`, then failed an answer if any figure was absent. This measured
whether the model repeated the oracle's preferred level of detail, not whether
the answer contradicted it. A concise answer to q01 could state the exact NAV
and still fail for omitting the AAVE holding; q09 similarly required an
unasked-for debt-to-supply ratio and therefore a needless calculator call.

The scorer now separates two outputs. Required-figure coverage comes only from
numeric claims in `must_include`; figures that occur only in `expected_answer`
are optional. Coverage remains visible but does not gate the overall score.
Numeric contradiction is the hard-fail dimension: an answer figure must match
the question-specific required or optional oracle, a figure supplied by the
question, trusted tool output, or a calculator result whose numeric operands
trace to those sources. Calculator inputs are inspected for lineage but are
still not evidence by themselves, so routing an invented literal through the
calculator does not launder it.

Question-supplied dollar and percentage parameters are admissible in both the
groundedness guardrail and the oracle and are removed from required coverage.
Percentage constants such as `100%` are also admissible. This preserves the q11
counterfactual repair without requiring the answer to restate the scenario.

The question oracle was narrowed where its required figures exceeded the
question: q01, q09, q16, q27, and q28 now require their direct answer while
retaining supporting figures as optional context. q06–q08 are categorized as
`unanswerable_tool_gap`, require no unavailable calls, and expect a refusal;
their transaction-derived fixture answers remain unavailable to the runtime
agent until a transaction tool exists.

Re-scoring the same 30 committed guarded traces changed the reported dimensions
to answer presence 30/30, trajectory 21/30, groundedness 30/30, numeric
contradiction 30/30, and required coverage 23/30. Overall moved from the old
coverage-gated 6/30 to 21/30. This is a correction to the measuring instrument,
not an improvement in agent behavior: no model call was made and the traces are
identical. The remaining seven coverage misses are retained as completeness
signals rather than correctness failures.

## Scoring boundaries

The deterministic groundedness grader answers whether a presented figure can be
traced to the user's stated scenario, an allowed tool field, or calculator
result. Model-chosen tool inputs are never evidence. The numeric contradiction
check additionally verifies calculator-operand lineage and rejects figures that
match none of the question-specific oracle or trusted evidence. Neither check
proves that a valid number was attached to the right financial concept or that
the model chose the correct basket of otherwise valid operands. The eval runner
therefore reports trajectory, groundedness, numeric contradiction, and coverage
independently. Semantic requirements and prohibitions remain explicit review
items unless a semantic judge is enabled.
