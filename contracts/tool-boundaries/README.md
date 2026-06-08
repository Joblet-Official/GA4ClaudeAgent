# Phase 4 — Tool boundaries

This directory defines, per agent, which tools are permitted, which are forbidden, and
under what constraints. Most of this is implicit in the Phase 1 agent designs and the
Phase 2 schemas; Phase 4's job is to make it **explicit, structured, and orchestrator-enforceable**.

## The two absolute rules

1. **Rule 1: no data access before A4.** A1, A2, A3 — the reasoning agents — have no
   access to GA4, GSC, or any live data source. They may only read static design-time
   registries (catalog, defaults, metric ontology, domain profile). Violations are
   architectural, not configurable.
2. **Rule 2: only A3 may contact the user.** A1, A2, A4, A5, A6 emit structured records;
   user-facing text appears only in A3's `clarification.question` (rendered by A6) and in
   templated chip text in A6. No agent generates free-form prose to the user.

## Files

- **`TOOL-BOUNDARIES.md`** — the design narrative: principles, per-agent rationale,
  constraint policies, enforcement model, auditing.
- **`tool-boundaries.schema.json`** — schema validating tool-catalog + per-agent-permission specifications.
- **`tool-boundaries.example.json`** — the concrete policy for joblet.ai. Six agents,
  10 tools, every constraint named.

## Verification

`../verify.py` validates the example against the schema. Negative tests confirm the
schema rejects invalid permission grants (e.g. giving A1 the GA4 data tool).

## What this directory is NOT

- Not an implementation. The orchestrator enforces these boundaries at runtime; Phase 4
  defines the contract the orchestrator enforces.
- Not credential management. How the GA4 service-account JSON is loaded, rotated, and
  scoped is a Phase 5 deployment concern. Phase 4 only declares which agents need credentials.
- Not the tool implementations themselves. The actual GA4 client wrapper, registry
  reader functions, HTML writer — those are Phase 5 code.
