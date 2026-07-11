# Tracker Settlement Contract V1

This folder is server/shared pure code. Client bundles must not import it.

The contract locks these formulas for every player:

```text
creditedTotal = potAward + refund
netDelta = creditedTotal - committedTotal
endingStack = startingStack + netDelta + externalDelta
```

It also locks whole-hand conservation, keeps uncalled refunds outside pots, and
uses `clockwise-first-eligible-winner-left-of-button/v1` for odd chips. The
server records final allocations; clients render them without re-running the
odd-chip rule.

Any non-zero `externalDelta` must be backed by a private, source-identified
re-entry, add-on, or admin adjustment. That source is included in the source
chain hash and removed from the public projection.

The private evidence also carries a revision/hash anchor for the target and
every later hand in the affected chain. Reordering anchors is hash-stable;
changing any revision or per-hand source hash changes `sourceChainHash`.

`projectPublicSettlementV1` is the only supported private-to-public boundary.
It removes hole cards that were not public, mucked cards, evaluator input,
correction notes, and actor identity.
