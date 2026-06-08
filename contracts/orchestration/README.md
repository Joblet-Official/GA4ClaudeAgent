# Phase 3 — Orchestration

This directory defines the orchestrator: the deterministic runtime layer that hosts the agents,
passes data between them per the Phase 2 contracts, manages session state across clarification
halts, evaluates conditional-stage triggers, and routes failures.

**The orchestrator is not an agent.** It is plain code that calls agents in order. It does not
reason, does not interpret data, does not modify agent outputs, and does not generate any
user-facing text.

## Files

- **`ORCHESTRATION.md`** — the comprehensive design document. State machine, single-pass and
  staged flows, halt-and-resume, retry policy, failure routing, state storage, concurrency,
  telemetry, and what the orchestrator is NOT.
- **`state-machine.schema.json`** — schema validating finite-state-machine specifications.
- **`state-machine.example.json`** — the orchestrator's actual state machine, schema-validated.
- **`walkthroughs.md`** — three end-to-end scenarios traced step-by-step:
  1. Single-pass with default-apply (`"what is the engagement rate"`)
  2. Halt-and-resume with clarification (`"top traffic sources"`)
  3. Staged investigation with conditional path-exploration (`"why did engagement rate drop in April"`)

## Verification

The state-machine example is validated by `../verify.py`. Run from the contracts root:

```bash
python verify.py
```

Phase 3 adds 1 schema, 1 example, and several negative tests to the existing harness.

## What Phase 3 does NOT cover

- LLM provider selection, caching, Vercel runtime, deployment topology — these are Phase 5.
- Tool boundaries per agent — these are Phase 4.
- Agent implementations — these are Phase 5.

## What "design" means here

Phase 3 produces specifications that a real orchestrator implementation must conform to.
Once Phase 5 begins, the orchestrator code is written against this spec; deviations are
spec changes, not implementation choices.
