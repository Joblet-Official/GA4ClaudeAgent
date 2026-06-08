# GA4 Visualisation Platform — Agents, LLM Mapping, and Project Context

**Purpose of this document:** drop this into a fresh Claude session as the first message (or attach as a file) so the new session can pick up where the last one stopped without re-discovering anything. Everything a contributing engineer needs is here.

**Last updated:** 2026-05-20.

---

## 1. What this project is

A web app where anyone types a GA4 question in plain English and gets back a clean structured report — tables, charts, KPI cards — modelled on the LinkedIn Traffic Weekly PDF format. The system **does not analyse, diagnose, or recommend**. It pulls the right data, organises it, and presents it. The user does the interpretation.

- **Property:** GA4 property `516147906` for joblet.ai
- **Owner:** Shubham Singh (Chandel)
- **Deployment target:** Vercel Pro (requires the 60s function timeout)
- **Stack:** Next.js 16 App Router, TypeScript strict, Zod, Recharts, Tailwind v4
- **Project root (local):** `E:\Documents\joveo\ga4-visualisation-platform`
- **Sibling sandbox (analytics scripts, GTM tooling):** `E:\Documents\joveo`

**Out of scope (do not implement):** diagnostic / "why" reasoning, recommendations, opinionated written summaries, GSC integration, multi-property comparison.

---

## 2. The hard rules (read these before doing anything)

1. **Never modify GTM.** The service account has `tagmanager.readonly` scope only, and even if it had write access we wouldn't use it. The only legitimate GTM action is `pull_gtm_tags.py` snapshotting tags to a local file.
2. **Never invent GA4 field names.** Every dimension/metric/event referenced in a query MUST exist in `catalog/ga4_catalog.json`. Brain 2 / Agent 2 are catalog-grounded; Agent 4 (Data Access) re-validates as defence in depth.
3. **Never interpret the data.** Agents 1-4 produce data. Brains 5-6 (Data Handling + Visualisation, pending) structure data for display. Neither editorialises. "Applies = 0 with sessions = 368" is a fact to surface; "tracking is broken" is interpretation we do NOT emit.
4. **Stateless functions.** Everything is Vercel-safe — no shared state between invocations. Memory rides in the request body.
5. **No diagnostic brain. No response synthesis brain.** The plan explicitly has 5 brains and a non-LLM Brain 4 slot. Don't add a sixth or a seventh.

---

## 3. Architecture overview

```
User question
     │
     ▼
┌────────────────────┐
│ Brain 1 — Intent   │  classify report_type, split sub-questions, extract scope, flag ambiguity
└────────┬───────────┘
         │ IntentOutput
         ▼
┌────────────────────┐     ┌──────────────────────────────┐
│ Brain 2 — Metrics  │ ◀── │ catalog/ga4_catalog.json     │  built from
└────────┬───────────┘     └──────────────────────────────┘  GA4 metadata + GTM snapshot
         │ MetricsOutput
         ▼
┌────────────────────┐
│ Brain 3 — Gaps     │  approved / default_applied / needs_clarification
└────────┬───────────┘
         │ GapsOutput   (if needs_clarification → STOP, ask user)
         │ otherwise:
         ▼
┌────────────────────┐     ┌──────────────────────────────┐
│ Brain 4 slot       │ ◀── │ catalog (re-validate)        │
│ (Tool Layer)       │     │ runGA4Query → GA4 Data API   │
└────────┬───────────┘
         │ raw rows + headers + metadata
         ▼
   ╔═══════════════════════════════════════════╗
   ║              PENDING                       ║
   ╠═══════════════════════════════════════════╣
   ║ Brain 5 — Data Handling                    ║
   ║   pivots, week-over-week, derived metrics  ║
   ║                                            ║
   ║ Brain 6 — Visualisation                    ║
   ║   emits Report Spec (KpiRow, ReportTable,  ║
   ║   ReportChart, DrilldownGroup, NoteCallout)║
   ╚═══════════════════════════════════════════╝
         │
         ▼
   Report Spec → React components → user
```

**Orchestration is plain code, not an LLM.** No loops, no recursion. Linear: Brain 1 → 2 → 3 → Tool → 5 → 6. Halt at Brain 3 if `needs_clarification`.

---

## 4. The agents and brains, one-to-one mapped

There are **two parallel implementations** of brains 1-3:

- **LLM brains** (TypeScript, `src/brains/*.ts`) — production path, called from Next.js API routes. Each is one OpenAI-SDK call to a configured provider.
- **Claude agents** (Markdown, `.claude/agents/*.md`) — same logical jobs, but executed by Claude in a subagent context. Used for prompt iteration, debugging, and oracle comparisons.

The agents and brains share the same prompts and output schemas. They are interchangeable from the orchestrator's perspective.

| # | Name | Role | LLM brain (production) | LLM brain provider/model | Claude agent slug | Status |
|---|---|---|---|---|---|---|
| 1 | **Intent** | Classify report_type, split sub-questions, extract scope, flag ambiguity | `src/brains/brain1_intent.ts` | Cerebras / `llama3.1-8b` *(temp — designed for Groq / `llama-3.3-70b-versatile`)* | `ga4-intent` | ✓ built, tested |
| 2 | **Metrics** | Translate intent into GA4 Data API query specs, catalog-grounded | `src/brains/brain2_metrics.ts` | Cerebras / `gpt-oss-120b` | `ga4-metrics` | ✓ built, tested |
| 3 | **Gaps** | Decide approved / default_applied / needs_clarification. Halts the chain on clarification. | `src/brains/brain3_gaps.ts` | Cerebras / `qwen-3-235b-a22b-instruct-2507` | `ga4-gaps` | ✓ built, tested |
| **4** | **Data Access (the "Brain 4 slot")** | Non-LLM. Re-validate against catalog + execute via `runGA4Query`. Returns raw rows. | `src/support/tools/runGA4Query.ts` (pure code) | n/a (deterministic) | `ga4-data-access` (the agent version uses Bash to invoke runGA4Query) | ✓ built, tested |
| 5 | **Data Handling** | Pivot, group, derive (apply/user ratios, week-over-week, partial-week flags) | NOT BUILT | TBD | NOT BUILT | ○ pending |
| 6 | **Visualisation** | Emit the Report Spec the React components render | NOT BUILT | TBD | NOT BUILT | ○ pending |

### LLM provider selection — why it landed where it did

| brain | provider | model | rationale |
|---|---|---|---|
| 1 (Intent) | Cerebras | `llama3.1-8b` (temp) | Plan says Groq `llama-3.3-70b-versatile` — extremely fast (TTFT ~600ms p95). Currently temp-routed to Cerebras llama3.1-8b because Groq's 100k tokens/day free-tier quota was exhausted during heavy testing. Revert to Groq once daily window resets. |
| 2 (Metrics) | Cerebras | `gpt-oss-120b` | Brain 2's prompt embeds the catalog vocabulary (~3.8k input tokens) so it burns through Groq's 12k TPM limit in ~3 calls. Cerebras free tier has ~60k TPM. Cerebras's free key on this account doesn't host Llama 3.3 70B, so we use OpenAI's open `gpt-oss-120b` which has native JSON-mode support. |
| 3 (Gaps) | Cerebras | `qwen-3-235b-a22b-instruct-2507` | User wanted a *different* LLM family per brain (diagnostic separation if one provider misbehaves). Tried Gemini 2.0 Flash first; **blocked by Google account billing history** (free-tier quota = 0 on every project under accounts with prior paid Cloud projects, even when creating "new project" keys). Cerebras qwen-3-235b satisfies "different model from Brain 2" without needing a new account. |

**Three LLM families across the 3 brains**: Llama (Brain 1), GPT-OSS (Brain 2), Qwen (Brain 3). If a future Brain 5 / 6 wants its own family, Gemini is available *with a non-billing Google account* or via Cloud Billing on a project with a payment method (Flash is ~$0.10/M tokens — negligible).

### Per-brain env vars

```env
LLM_PROVIDER=cerebras                                  # fallback for any brain without an override

LLM_PROVIDER_BRAIN1=cerebras
LLM_MODEL_BRAIN1=llama3.1-8b                           # temp; design is Groq llama-3.3-70b-versatile

LLM_PROVIDER_BRAIN2=cerebras
LLM_MODEL_BRAIN2=gpt-oss-120b

LLM_PROVIDER_BRAIN3=cerebras
LLM_MODEL_BRAIN3=qwen-3-235b-a22b-instruct-2507

# Per-provider API keys — only those matching active providers need to be set
CEREBRAS_API_KEY=csk-...
GROQ_API_KEY=gsk_...
NVIDIA_API_KEY=nvapi-...
GEMINI_API_KEY=AIzaSy...                               # available but free-tier blocked, see above

# GA4
GA4_PROPERTY_ID=516147906
GOOGLE_APPLICATION_CREDENTIALS=<absolute path>         # local: file path
# Vercel uses GOOGLE_APPLICATION_CREDENTIALS_JSON instead (entire JSON inline)
```

Provider selection happens in `src/lib/nvidia.ts` via `getClient(brain?: string)`. Each brain calls `getClient("brain1")`, `getClient("brain2")`, etc. The function reads `LLM_PROVIDER_<BRAIN>` first, then falls back to `LLM_PROVIDER`. Same pattern for `LLM_MODEL_<BRAIN>` overriding the provider's default model.

---

## 5. The catalog (`catalog/ga4_catalog.json`)

The single source of truth for valid GA4 field names. Brain 2 / Agent 2 emit only names that exist here. Brain 4 / Agent 4 re-validate.

**Current contents:**
- 378 dimensions (`api_name`, `ui_name`, `category`, `description`, `custom_definition`)
- 113 metrics (same shape + `type`)
- 10 events (joblet-specific, from GTM tags, e.g. `job_apply`, `share_open`, `book_a_consult`)
- 7 limitations (sampling threshold, ingestion lag, naming-rule quirks, templated-event tags)

**Generated by:** `scripts/refresh_catalog.py` (Python). Reads:
1. GA4 Data API metadata endpoint (`properties/516147906/metadata`)
2. `../gtm_snapshot.latest.json` (GTM tag snapshot from `E:\Documents\joveo\pull_gtm_tags.py`)

**Catalog gaps vs the plan's spec:**

The plan specifies 5 fields per dimension/metric but we currently only generate 3:

| field | plan | what we have |
|---|---|---|
| `api_name` | ✓ | ✓ |
| `ui_name` | ✓ | ✓ |
| `category` | ✓ | ✓ |
| `compatible_metrics` (per dim) | ✓ required | ✗ missing — would need GA4 CheckCompatibility calls per dim |
| `natural_language_aliases` | ✓ required | ✗ missing — would need hand-curation or LLM-generation |
| event `variants` | ✓ required | ✗ missing — would need to query GA4's `eventName` dimension for actual seen values |

For Brain 2's current grounding (validate that names exist), the simpler catalog is enough. The missing fields would help Brain 2 (compatibility pre-filter), Brain 1 (alias resolution), and Brain 2 (knowing about runtime event names from templated GTM tags like `JD_VIEW_TAG`). Defer until Brain 5/6 need them.

**Vercel handling:** loaded via `import rawCatalog from "../../../catalog/ga4_catalog.json"` in `src/support/catalog/loadCatalog.ts`. Static import → Next.js bundles the JSON into the function. No filesystem read at runtime.

**Refresh cadence (plan):** weekly cron + admin-triggered button. Loader logs a warning if catalog > 14 days old.

**On Vercel:** the Python refresh script can't run there. Catalog updates happen externally — locally then `git push`, or via a GitHub Actions cron that runs both Python scripts and commits the result.

---

## 6. The Tool Layer (`src/support/tools/runGA4Query.ts`)

Pure TypeScript. One function: `runGA4Query(request_body)`. Calls the GA4 Data API via the service account, returns rows mapped to `{ colName: value }` objects plus headers + metadata.

**Credentials:**
- Local: `GOOGLE_APPLICATION_CREDENTIALS=<file path>` — the SDK auto-resolves.
- Vercel: `GOOGLE_APPLICATION_CREDENTIALS_JSON=<entire JSON as one-line string>` — we explicitly parse.

The Tool Layer code supports both — picks JSON inline if set, else falls back to file path.

**Latency:** ~1-2s typical per query. Three test queries (time series, categorical, filtered) all pass in `npm run test:tool`.

**Return shape:**
```typescript
{
  rows: Array<Record<string, string | number>>,    // mapped, numeric metrics coerced to numbers
  dimensionHeaders: string[],
  metricHeaders: Array<{ name: string; type: string }>,
  rowCount: number,
  metadata: {
    sampled: boolean,                              // GA4 set when sampling kicked in
    dataLossFromOtherRow: boolean,                 // GA4 collapsed groups into "(other)" row
    schemaRestriction: unknown,
  }
}
```

---

## 7. File map

```
ga4-visualisation-platform/
├── AGENTS.md                                     ← this document
├── .env.example                                  ← env var template
├── .env.local                                    ← real values, gitignored
├── package.json
├── next.config.ts
├── tsconfig.json                                 ← path alias @/* → src/*, JSON imports on
├── postcss.config.mjs                            ← Tailwind v4
│
├── catalog/
│   └── ga4_catalog.json                          ← single source of truth (378d + 113m + 10e)
│
├── scripts/
│   ├── refresh_catalog.py                        ← Python: GA4 metadata + GTM snapshot → catalog.json
│   ├── test_brain1.ts                            ← smoke test Brain 1
│   ├── test_brain2.ts                            ← chained B1 → B2 smoke test
│   ├── test_brain3.ts                            ← chained B1 → B2 → B3 smoke test
│   ├── test_brain3_isolated.ts                   ← B3 with hand-crafted intent (no LLM calls 1+2)
│   └── test_tool_layer.ts                        ← real GA4 queries
│
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── globals.css                           ← Tailwind v4 @import
│   │   ├── page.tsx                              ← / — Brain 1 tester UI
│   │   ├── brain2/page.tsx                       ← /brain2 — Brain 2 tester (pipeline / direct modes)
│   │   ├── brain3/page.tsx                       ← /brain3 — Brain 3 tester with clarification UI
│   │   ├── run/page.tsx                          ← /run — full pipeline with GA4 data tables
│   │   └── api/
│   │       ├── brain1/route.ts                   ← POST /api/brain1
│   │       ├── brain2/route.ts                   ← POST /api/brain2
│   │       ├── brain3/route.ts                   ← POST /api/brain3 (pipeline + mode2 + mode3)
│   │       └── run/route.ts                      ← POST /api/run (B1 → B2 → B3 → Tool Layer)
│   │
│   ├── brains/
│   │   ├── brain1_intent.ts                      ← Intent LLM brain
│   │   ├── brain2_metrics.ts                     ← Metrics LLM brain
│   │   ├── brain3_gaps.ts                        ← Gaps LLM brain
│   │   └── prompts/
│   │       ├── brain1_intent.ts                  ← system prompt
│   │       ├── brain2_metrics.ts                 ← prompt builder (takes catalog)
│   │       └── brain3_gaps.ts                    ← system prompt
│   │
│   ├── schemas/
│   │   ├── intent.ts                             ← IntentOutput Zod
│   │   ├── metrics.ts                            ← MetricsOutput Zod
│   │   └── gaps.ts                               ← GapsOutput Zod (with cross-field invariants)
│   │
│   ├── support/
│   │   ├── catalog/loadCatalog.ts                ← static JSON import + index building
│   │   ├── tools/runGA4Query.ts                  ← Tool Layer (GA4 Data API)
│   │   └── dates.ts                              ← relative window → absolute YYYY-MM-DD
│   │
│   ├── orchestrator/
│   │   └── validate.ts                           ← catalog grounding for Brain 2 outputs
│   │
│   └── lib/
│       └── nvidia.ts                             ← per-brain OpenAI-SDK client factory (getClient)
│
└── .claude/
    └── agents/                                   ← Claude subagent definitions
        ├── README.md
        ├── ga4-intent.md                         ← Agent 1
        ├── ga4-metrics.md                        ← Agent 2
        ├── ga4-gaps.md                           ← Agent 3 (includes completeness check for region/timeline/source)
        └── ga4-data-access.md                    ← Agent 4
```

User-level copies of the four agent .md files also live at `C:\Users\zbali\.claude\agents\` so they're available in any Claude Code session globally.

**Sibling sandbox (`E:\Documents\joveo\`):**
- `test_connections.py` — GA4 + GSC connection smoke test
- `test_gtm.py` — GTM access probe
- `pull_gtm_tags.py` — GTM snapshot + diff (re-run to detect tag changes)
- `gtm_snapshot.latest.json` — latest snapshot, consumed by `refresh_catalog.py`
- `gtm_snapshots/` — timestamped archive

---

## 8. Commands

```bash
# Dev server
npm run dev                       # next dev → http://localhost:3000
                                  #   /         Brain 1 tester
                                  #   /brain2   Brain 2 tester
                                  #   /brain3   Brain 3 tester
                                  #   /run      Full pipeline + GA4 data

# LLM-brain smoke tests (each chains the brains via the production code path)
npm run test:brain1               # 8 cases, all 6 report_types + memory follow-up
npm run test:brain2               # chained B1 → B2, 6 cases
npm run test:brain3               # chained B1 → B2 → B3, 6 cases
npm run test:brain3:isolated      # B3 alone with hand-crafted intent (cheaper, faster)
npm run test:tool                 # real GA4 queries, 3 cases

# Catalog refresh (Python; runs locally, never on Vercel)
npm run refresh:catalog           # → catalog/ga4_catalog.json
# Or directly: python scripts/refresh_catalog.py

# Typecheck
npm run typecheck                 # tsc --noEmit
```

**Smoke tests honor `TEST_DELAY_MS`** (default 8000ms between cases) to stay under free-tier TPM. Set to lower values once on a paid tier.

**PowerShell execution policy gotcha:** npm scripts fail with `running scripts is disabled on this system`. Prepend every PowerShell call that touches npm with:
```powershell
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
```

---

## 9. Current status — what's built, what's not

### Working end-to-end (LLM-brain path)
- ✓ Brain 1, 2, 3 — all three pass their smoke tests
- ✓ Tool Layer — `runGA4Query` against real property `516147906`
- ✓ `/api/run` — full pipeline returns real GA4 rows
- ✓ UI for each brain + a full pipeline page (`/run`)
- ✓ Catalog generator (Python) + Vercel-bundled static import
- ✓ Per-brain provider routing via env

### Working end-to-end (Claude agent path)
- ✓ Agents 1, 2, 3, 4 invoked via `Agent(subagent_type: "ga4-...")`
- ✓ Same prompts, same schemas, same expected outputs as the LLM brains
- ✓ Verified chained: e.g. "how much traffic are we getting" → Agent 1 → 2 → 3 (clarify) → 4 → real data on resolution

### Most recent agent change — Agent 3 strict completeness check
Agent 3's prompt now requires every query to explicitly specify **region** (country dim or filter), **timeline** (dateRanges, always present after Agent 2), and **source** (sessionSource/sessionMedium/sessionDefaultChannelGroup dim or filter). Missing any → `needs_clarification` with options, priority order region → source → timeline. Asks ONE missing thing per turn.

**Implication:** most casual questions ("how many users", "engagement rate") now require 2 clarifications (region, then source) before Agent 4 fires. If this feels too aggressive, soften to "default + flag" mode — Agent 3 silently applies "all" for missing region/source, surfaces them in `defaults_applied`, returns `default_applied`. User sees data immediately.

### Not yet built
- ○ Brain 5 — Data Handling (pivots, groupings, derived metrics)
- ○ Brain 6 — Visualisation (Report Spec emitter)
- ○ Orchestrator with clarification re-fire loop (UI shows options but doesn't yet feed the answer back through the pipeline)
- ○ Brain 5 / 6 React components (KpiRow, ReportTable, ReportChart, DrilldownGroup, NoteCallout, ClarificationCard already exist as concepts)
- ○ Git repo + first Vercel deploy
- ○ Auth (Vercel password protection or Google SSO)
- ○ Regex fallback parser for when all brains 429/error
- ○ Catalog refresh automation (GitHub Actions cron)

---

## 10. Known issues / gotchas

| issue | where it bites | mitigation |
|---|---|---|
| **Groq daily 100k TPM cap (free tier)** | Heavy testing burns through it; takes ~24h to reset | Move Brain 1 to Cerebras temporarily, or upgrade to Groq Dev (free with card on file) |
| **Cerebras shared TPM across all brains on it** | B1 + B2 + B3 all on Cerebras → bursty smoke tests can 429 | Use `TEST_DELAY_MS=8000` between cases; in production single-user load is fine |
| **Gemini free-tier blocked for some Google accounts** | Any account with prior Cloud billing → free quota = 0 even on new projects. Confirmed reproducible. | Use different Google account OR enable Cloud Billing (Flash is ~$0.10/M tokens) |
| **Agent 4 latency in Claude path** | ~47s for a 1.5s GA4 call due to tsx cold-start spawn | Acceptable for ad-hoc agent testing; production uses in-process `runGA4Query` (~1.5s end-to-end) |
| **Catalog refresh requires Python** | Can't run on Vercel | Local + git push, or GitHub Actions cron (Python available there) |
| **Claude Code agent registry loads at session start** | Editing an agent .md mid-session may take effect on next invocation but not always; restart for guaranteed pickup | Restart Claude Code after editing `.claude/agents/*.md` |
| **PowerShell ExecutionPolicy blocks npm.ps1** | First-time `npm run ...` calls error out | `Set-ExecutionPolicy -Scope Process Bypass -Force` per shell session |
| **GTM templated event names lose data** | `JD_VIEW_TAG` emits `{{job_title}}{{job_id}}...` — hundreds of unique names. GA4 caps custom events at 500/property. | Out of our scope to fix (no GTM writes), but worth knowing when interpreting low apply counts. Recorded in catalog limitations. |
| **Comparison report_type has one dateRange slot in Brain 1 schema** | Two-window comparisons lose the second window upstream | Brain 2 detects `report_type=comparison` and synthesizes the two windows. Not perfect; revisit when Brain 5/6 build comparison views. |

---

## 11. The agents in `.claude/agents/`

All four are project-level (also copied to user-level for global availability).

| slug | tools | what it does |
|---|---|---|
| `ga4-intent` | (none) | Classify question → Intent JSON. Schemas, rules, and 3 worked examples embedded in the system prompt. |
| `ga4-metrics` | `Read` | Read catalog → build GA4 query specs. Hard-rule: never invent names. |
| `ga4-gaps` | (none) | Decide approved / default_applied / needs_clarification. **Completeness check fires FIRST** — requires region + source + timeline explicit, asks one missing field per turn (region → source → timeline). |
| `ga4-data-access` | `Read`, `Bash` | Re-validate against catalog; execute via `runGA4Query`. The Bash invocation pattern is described in the agent's system prompt. |

**Invoking from Claude Code:**

```
Agent({
  subagent_type: "ga4-intent",
  description: "Classify question",
  prompt: "question: <user's question>\nmemory: null\ntoday: <YYYY-MM-DD>\n\nReturn ONLY the JSON object."
})
```

For chaining: take each agent's JSON output and pass it into the next agent's prompt. The main Claude loop is the orchestrator.

---

## 12. Vercel deployment readiness

| concern | status |
|---|---|
| Runtime = nodejs on all routes | ✓ |
| maxDuration = 60 on all routes | ✓ |
| Stateless (no shared state) | ✓ |
| Catalog bundled via static JSON import | ✓ |
| LLM clients work via env vars only | ✓ |
| Tool Layer supports `GOOGLE_APPLICATION_CREDENTIALS_JSON` for Vercel | ✓ |
| Streaming responses in Node runtime | ✓ |
| Per-brain provider env vars wired | ✓ |
| Git repo initialized | ✗ — needs `git init`, first commit, push to GitHub/GitLab, import into Vercel |
| Env vars in Vercel project settings | ✗ — copy from `.env.local`, use `GOOGLE_APPLICATION_CREDENTIALS_JSON` not the file path |
| Auth on the deployed URL | ✗ — Vercel password protection or Google SSO before sharing beyond the team |
| Catalog refresh outside Vercel | ✗ — set up GitHub Actions cron or local + push workflow |

---

## 13. Memory entries to add for the new session

A new Claude session would benefit from these reference memory entries (`~/.claude/projects/<dir-slug>/memory/`):

- `project_ga4_viz_platform.md` — what we're building
- `reference_ga4_viz_platform.md` — paths, commands, env vars, brain pattern, current provider routing
- `project_joblet.md` — joblet.ai is the site we're analysing
- `reference_joblet_analytics.md` — GA4 + GSC + GTM service account, GTM-readonly hard rule

The new session should also know:
- Today's date as of last update: **2026-05-20**
- The user (Shubham) prefers data-on-screen over clarification dialogs (we have a strict rule now, but watch for "soften" requests)
- Three API keys leaked in the previous session's transcript: rotate Cerebras, Groq, Gemini, NVIDIA keys before any production deploy

---

## 14. Quick start for the new session

When picking up:

1. Read this file end to end.
2. `npm run dev` from `E:\Documents\joveo\ga4-visualisation-platform` — verify the four UI pages load.
3. `npm run test:tool` — verify GA4 still answers.
4. Decide where to continue:
   - Brain 5 (Data Handling) is the natural next build — turns raw rows into pivots / derived metrics / WoW deltas.
   - Brain 6 (Visualisation) — emits the Report Spec; needs Brain 5 first.
   - Orchestrator clarification loop — UI lets users click an option, but the click doesn't yet feed back into the pipeline. Low-effort wire-up.
   - Soften Agent 3's strict completeness rule if it's too friction-heavy in real usage.

When making changes:
- Touch the LLM brain (`src/brains/*.ts`) for production behavior.
- Touch the Claude agent (`.claude/agents/*.md`) for ad-hoc testing in Claude Code sessions.
- Keep the two parallel — same prompts, same schemas. If you change one, mirror it in the other.

---

*End of document. If anything in here is wrong or stale, fix it before continuing — this file is the contract.*
