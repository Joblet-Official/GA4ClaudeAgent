# GA4 Visualization Platform

An agent-first system that turns a natural-language GA4 question into a
descriptive HTML investigation report for `joblet.ai` (GA4 property
`516147906`), via six agents A1 through A6.

This repository is an isolated copy of the GA4 platform.

## Repository structure

- `contracts/` - canonical JSON Schemas + `verify.py` validator.
- `ga4-viz-platform/` - pnpm monorepo: orchestrator (FSM), contracts, agents,
  tools, registry-data.
- `ga4-visualisation-platform/` - the live Next.js runtime: GA4 catalog,
  `runGA4Query.ts` tool layer, the `.md` subagent pipeline, brains 1-3,
  and guard scripts.

## The six agents

1. **A1 - Intent**: natural-language question -> structured Intent JSON.
2. **A2 - Query Planning**: Intent -> catalog-grounded GA4 query plans.
3. **A3 - Clarification**: checks for missing source/timeline, asks the user.
4. **A4 - Data Access**: executes queries against the GA4 Data API.
5. **A5 - Data Handling**: shapes rows into descriptive data blocks.
6. **A6 - Visualisation**: renders the self-contained HTML report.

## Setup

1. Install dependencies:
   - `ga4-visualisation-platform/`: `npm install`
   - `ga4-viz-platform/`: `pnpm install`
2. Copy `ga4-visualisation-platform/.env.example` to `.env.local` and fill in
   real values (LLM provider keys, GA4 property id, Google service-account
   credentials). **Never commit `.env.local`.**

## Validation

- `python contracts/verify.py`
- `pnpm -C ga4-viz-platform test` (vitest)

## Deployment

The deployable app is `ga4-visualisation-platform/` (Next.js). On Vercel, set
the project **Root Directory** to `ga4-visualisation-platform`.

## Notes

- Secrets are never committed; see `.gitignore`.
- GA4 property `516147906` is read-only analytics data for `joblet.ai`.
