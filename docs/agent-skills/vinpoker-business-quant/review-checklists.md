# Review Checklists — PRs and Product Plans (Money Path)

Use this workflow whenever reviewing a VinPoker PR, migration, Edge function change, or product
plan that touches money, financial numbers, or owner-facing reporting. This is an ANALYSIS
workflow only: the reviewer inspects and reports; it never merges, applies migrations, deploys,
or approves financial transactions. Any recommendation that changes a money path requires
explicit owner approval.

## Output format

Every review ends with exactly this structure:

**Verdict** (one of three):

| Verdict | Meaning |
|---|---|
| **GO** | Safe to proceed as-is. No P0 findings, P1 findings (if any) have accepted mitigations, evidence requirements met, rollback documented. |
| **HOLD** | Do not proceed yet. At least one P1 unresolved, or evidence missing (tests / screenshots / live-state verification), or the live-apply plan is ambiguous. Fixable — state exactly what unblocks it. |
| **NO-GO** | Do not proceed. At least one P0: money would be wrong, data lost, funds trapped, or the change is irreversible without a documented recovery. Requires redesign, not patching. |

**Findings by severity**, each with file/line or plan-section reference, a one-line defect
statement, and a concrete failure scenario:

- **P0 — money wrong / data loss / irreversible / funds trapped.** Examples: pass-through
  prize-pool money counted as club revenue; a refund route referencing non-existent schema so
  player funds cannot be returned (the Staking/VBacker pre-#656 state); a migration that drops
  or rewrites saved payroll values; an escrow write with no compensating path.
- **P1 — misleading numbers / missing guardrail / unverified live state.** Examples:
  contribution margin labeled "lợi nhuận" (profit); GTD subsidy with the sign flipped or netted
  invisibly into revenue; a dashboard reading from a dark-flag module and showing 0 as truth;
  the plan assumes a merged migration is live without verifying the live object.
- **P2 — clarity / polish.** Examples: jargon labels on owner-facing UI, missing Vietnamese
  label, ambiguous column naming ("revenue" without qualifier), missing link to runbook.

**Checks run** — list which of the six checklists below were applied and their result
(pass / finding-ref / not-applicable).

## Checklist 1 — Formula correctness

- [ ] **Revenue vs pass-through separated.** True Revenue = fee/rake retained by club, only.
      Buy-in prize-pool money is player money passing through — a **liability**, never revenue.
      Reject any query, RPC, or UI line that sums buy-ins into a "revenue" figure.
- [ ] **GTD subsidy sign and floor.** `GTD Subsidy = max(0, Guarantee − player-funded prize pool)`.
      It is a COST when positive and zero when the guarantee is covered — never negative, never
      a revenue credit. Check the `max(0, …)` floor is actually in the code, not assumed.
- [ ] **Contribution vs profit labeling.** Event Contribution
      (`retained_fee_revenue + other_event_revenue − GTD_subsidy − dealer_wages − floor_wages −
      cashier_wages − marketing_cost − F&B_COGS_if_comped_or_subsidized − other_direct_costs`)
      is a CONTRIBUTION margin. If operating/overhead costs are excluded, it must never be
      labeled "profit" / "lợi nhuận". `Event Margin % = Event Contribution / retained_fee_revenue`
      — check the denominator is retained revenue, not gross buy-ins.
- [ ] **No recompute of saved values.** Saved payroll values NEVER recompute (payroll doctrine).
      Same principle for any finalized/closed number: a formula change must apply forward-only;
      flag any code path that re-derives historical saved amounts.
- [ ] **Overlay break-even uses net contribution per entry:**
      `ceil((Guarantee + direct_costs − other_revenue) / net_prize_contribution_per_entry)` —
      check it divides by the per-entry amount that actually funds the pool, not the gross buy-in.
- [ ] **Units and currency.** VND throughout; no silent unit mixing (per-entry vs per-event,
      per-hour vs per-shift wage).

## Checklist 2 — Data source correctness (LIVE vs source-only vs dark-flag)

- [ ] **Merged PR ≠ live.** Merged code ≠ applied DB migration ≠ deployed Edge function ≠
      deployed Vercel frontend ≠ active feature flag. State which layer each claimed number
      depends on. Example: Repair Wave #656 merged 2026-07-03 but DB apply + Edge deploy remain
      owner-gated — until the gate runs, live behavior is the pre-fix behavior.
- [ ] **Migration ledger is unreliable.** Local migration files diverge from the live DB
      (`orlesggcjamwuknxwcpk`). Never trust the ledger; require verification of the live object
      state (table/column/function exists with expected shape) via read-only inspection.
- [ ] **Dark flags zero out lines.** A module can be fully applied live yet DARK — F&B backend
      P0–P7 is applied live but all `fnb*` flags and `fnb_in_club_net` are OFF, so P&L shows no
      F&B line. A review must ask: does this number read from a dark module, and does the UI
      present the resulting 0 as truth or as "not enabled"?
- [ ] **Known stale/broken sources.** PT wage line missing from Finance P&L until #656 R2 is
      applied; payout Edge v1 stale until R1 applied; staking refund broken until R3 applied.
      Any plan consuming these lines before the gate runs is consuming wrong numbers.
- [ ] **Provisional vs finalized.** Downstream consumers (Series Intelligence, owner reports)
      must use finalized (post-close) numbers or clearly label provisional. Close Report is NOT
      STARTED — so today essentially all live numbers are provisional; check the plan admits this.

## Checklist 3 — Live/source-only risk (split-brain scenarios)

Ask both directions explicitly:

- [ ] **Code merges but migration/Edge never applies:** does the frontend call an RPC or column
      that does not exist live (runtime error, blank panel, or silent 0)? Does it degrade safely
      behind a flag, or does it show wrong money numbers? The staking refund bug is the canonical
      case: code path existed, target schema did not, funds-trapped outcome.
- [ ] **Migration applies but code never ships / flag never flips:** does the new object sit
      inert and harmless (acceptable, like dark F&B), or does a trigger/cron start writing rows
      the old code misreads?
- [ ] **Partial apply ordering:** if the change is migration + Edge + FE, is there a stated apply
      order where every intermediate state is safe? Reject plans where step 2 failing leaves
      money-path behavior undefined.
- [ ] **Single-row assumptions.** Check for OLDEST-vs-NEWEST style hazards (the SePay escrow-row
      hazard: picker edits the oldest active escrow row, edge function reads the newest —
      safe only while exactly one active row exists per club). Any "there will only be one row"
      assumption needs a constraint or a documented invariant.
- [ ] **Kill-switch reachability:** if live behavior is wrong after apply, can the owner turn it
      off with a flag alone, without a DB revert?

## Checklist 4 — Owner decision impact

- [ ] **Name the decision.** What owner decision does this number/change actually inform?
      (Run this event again? Raise the guarantee? Adjust dealer staffing? Approve a refund?)
      A metric that changes no decision is vanity — flag it as P2 at minimum.
- [ ] **Decision-wrongness test.** If this number is wrong in the way the finding describes,
      what bad decision does the owner make? Use this to justify P0 vs P1 severity.
- [ ] **Plain-language Vietnamese labels.** Owner is non-technical and Vietnamese-speaking.
      Owner-facing surfaces must use terms like: Doanh thu giữ lại (retained revenue),
      Tiền giải thưởng của người chơi (pass-through prize pool), Bù đắp đảm bảo GTD (GTD subsidy),
      Biên đóng góp (contribution margin), Tạm tính / Đã chốt (provisional / finalized).
      UI naming: **Tài chính & Đối soát** — never "Kế toán" alone, never "Legal/Tax Accounting"
      (this is management accounting, not statutory accounting).
- [ ] **One-task-first.** Does the change add another panel to an already-dense screen, or does
      it guide the owner through one task? Advanced/empty panels hidden until data exists?

## Checklist 5 — Test/screenshot requirements

Money-path changes require BOTH kinds of evidence before GO:

- [ ] **Test evidence:** unit/integration tests covering the formula boundaries (subsidy at
      exactly-covered guarantee, zero entries, refund/void paths), run output attached — not
      "tests exist" but "tests ran and passed, here is the output". Note the tsc baseline:
      ~75 pre-existing type errors on main — grep for the PR's own filenames, don't demand a
      clean global build.
- [ ] **Screenshot proof in live (or live-equivalent) UI:** the actual rendered number in the
      target environment, with the flag state that will ship. A screenshot from a local branch
      with flags forced ON does not prove the live default experience.
- [ ] **Live object verification** (for DB-touching changes): read-only query output showing the
      object exists live with the expected shape, or an explicit statement that apply is pending
      the owner gate.

Missing evidence on a money path = HOLD, not GO-with-caveats.

## Checklist 6 — Rollback plan

- [ ] **Every money-path change has a written rollback** in the PR/plan, not implied.
- [ ] **Flag kill-switch preferred:** the fastest safe rollback is a feature flag flip that
      restores prior behavior without DB changes. Verify the flag actually gates ALL new
      behavior (grep consumers — a flag nobody reads is not a kill-switch).
- [ ] **DB rollback stated separately:** if a migration is involved, is it additive (safe to
      leave in place) or destructive (needs a reverse script)? Destructive migrations on money
      tables without a tested reverse = P0.
- [ ] **Data written during the bad window:** does rollback strand rows written while the
      feature was live? State how they are identified and reconciled.
- [ ] **Who flips it:** rollback steps must be executable by the owner or a single on-call
      session with read-only diagnosis first — no multi-agent heroics.

## Money-path PR review sequence (tie-it-together)

1. **Scope:** what money does this touch — revenue, pass-through, subsidy, wage, escrow, cash?
   If none, downgrade to a normal review.
2. **Formulas** (Checklist 1): verify every financial expression against the formula library;
   check labels (contribution ≠ profit; revenue ≠ buy-ins).
3. **Sources** (Checklist 2): for each number, classify LIVE / source-only / dark-flag; verify
   live object state where the plan claims LIVE.
4. **Split-brain** (Checklist 3): walk both failure directions and each intermediate apply step.
5. **Decision impact** (Checklist 4): name the owner decision; check owner-facing labels.
6. **Evidence** (Checklist 5): tests ran + screenshot in the shipping flag state.
7. **Rollback** (Checklist 6): kill-switch verified, DB rollback classified, bad-window data plan.
8. **Write the verdict:** GO only if steps 2–7 all pass; HOLD listing exact unblockers;
   NO-GO for any P0. Findings ranked most-severe first. Remind: live apply of anything
   (migration, Edge, flag flip) remains owner-gated and outside this review's authority.
