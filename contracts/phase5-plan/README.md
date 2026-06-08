# Phase 5A — Implementation plan

This directory contains the Phase 5 implementation plan. No code yet; this is the
decision-locking and roadmap step.

## Files

- **`PLAN.md`** — the comprehensive Phase 5 plan: locked decisions, repo structure,
  sub-phase roadmap (5B → 5F), per-sub-phase deliverables and acceptance criteria,
  TypeScript-specific decisions, risks, what's explicitly deferred.

## Locked decisions (Phase 5A, this turn)

| Decision | Choice |
|---|---|
| Runtime / language | TypeScript on Next.js / Vercel |
| Agent strategy | Stubs first; LLM-backed agents incrementally afterward |
| Production split (anticipated) | A1, A2 LLM-backed; A3–A6 deterministic code |

## What this directory is NOT

- Not code. Implementation begins in Phase 5B.
- Not a frozen plan. As Phase 5B/C/D/E/F land, this plan may be updated.
- Not LLM provider selection. That's locked in Phase 5D when LLM-backed agents arrive.
