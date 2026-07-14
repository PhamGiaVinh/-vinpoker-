# Product

## Register

product

## Users

VinPoker serves poker-club operators working with live tournaments and real customer funds. The Floor surface is used primarily by floor staff, tournament directors, cashiers, trackers, club owners, and administrators. They work one-handed on phones while standing in a noisy room, and on desktop for denser or higher-risk administration.

## Product Purpose

VinPoker is the operational source of truth for running poker-club tournaments. Floor helps operators understand what is happening now, act on tables and players without losing identity or chip state, recover safely from operator mistakes, and hand off finalized results to the club's financial controls. Success means the server remains authoritative, every destructive action is explicit and auditable, and the same essential workflow is usable on desktop and mobile.

## Brand Personality

Authoritative, calm, and premium. Operator language is direct Vietnamese, task-first, and honest about whether data is live, provisional, locked, or unavailable. The Midnight Sakura direction should feel like a serious poker-club command surface rather than a game lobby or a generic finance dashboard.

## Anti-references

- Generic SaaS administration shells with decorative blue, purple, or neon accents.
- Casino-game spectacle, fake urgency, or animation that competes with live operational state.
- Sample data presented as if it were production truth.
- Dense desktop controls squeezed onto mobile without touch-safe restructuring.
- Financial actions exposed to Floor roles or ambiguous labels that imply provisional numbers are finalized.

## Design Principles

1. Server truth before client convenience: the UI sends intent and displays confirmed results.
2. One urgent task first: show the active tournament, the table or player needing attention, and the safest next action.
3. Fail closed and recover visibly: stale data, missing identity, permission errors, and concurrent actions must not produce partial or false success.
4. Mobile is an operational surface, not a preview: essential Floor workflows must work at 360-390px with 44px targets, safe areas, clear confirmations, and deterministic refresh.
5. Keep money boundaries explicit: Floor may see scoped warnings but cannot silently create, rewrite, or finalize payout or accounting truth.

## Accessibility & Inclusion

Target WCAG 2.1 AA. All actions must be keyboard accessible on desktop, use text or icons in addition to color, preserve contrast in the dark operator theme, support reduced motion, handle Vietnamese and long names without overflow, and expose meaningful loading, empty, permission, and error states.
