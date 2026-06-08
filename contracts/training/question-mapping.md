# Question → Mapping (Training Corpus, v1)

**Purpose**: Canonical mapping from natural-language questions to A1 classification + A3 default-vs-clarify decision + A2 query plan. Built row-by-row in a training session with human feedback. Each row is confirmed-correct.

**Audience**: A1 and A2 brain prompts in Phase 5D-brains. Used as few-shot anchors and as regression targets.

**Source rule**: GA4 only. No GSC. No other external sources.

**Status**: 51 entries (50 from the L1–L5 training set + 1 ad-hoc verification).

---

## Preamble — rules and definitions

### The L1–L5 spectrum

Every question is classified on a five-level complexity spectrum.

| Level | Shape | Example | A2's path |
|---|---|---|---|
| **L1** | Single fact, single metric, single window | "What was traffic last week?" | One report query, no breakdown |
| **L2** | Ranking or PoP comparison | "Top 10 sources" / "Engagement this week vs last" | One report with sort+limit, or PoP comparison |
| **L3** | Multi-surface descriptive ("how is X doing") | "How is organic traffic doing?" | Parallel basket: 4–8 queries across surfaces, filtered to slice |
| **L4** | Single-metric diagnostic ("why did X change") | "Why did engagement drop?" | Universal RCA playbook — 12 stages + Tier-2 overrides |
| **L5** | Compound, open-ended, un-mapped, single-event multi-pillar | "What's wrong with the site?" / "Is there bot activity?" | Decomposition → A3 halts → user picks → expand as L4/L3 |

### Hard rule — anchor period (time-anchor rule)

When the question contains **no explicit time anchor** ("last week", "in April", "this month", "May 19", "right now", etc.), A3 **MUST** halt with NEEDS_CLARIFICATION. The `time_scope_missing` ambiguity flag can **never** resolve via DEFAULT_APPLIED. There is no implicit "last 28 days" or any other window.

- Anchor period missing → A3 halts. Defaults registry still provides the option list — but as a clarification choice, not auto-applied.
- Anchor period explicit, baseline missing → A3 may still silently default the baseline (e.g. "why did engagement drop in April" → April explicit, March silent).
- Partial-period anchors ("this month" mid-cycle, "today" in-progress) → count as explicit. Partial-period marker applied at A5/A6.

### Hard rule — decline rule (subjective states about people)

Questions about subjective states applied to people ("frustrated", "happy", "satisfied") are declined at A3 with:

> *"Cannot be determined. Please be specific — e.g. 'how many form submissions started but didn't complete', 'how often does the exception event fire', 'how many sessions ended within 30 seconds of an apply-button click'."*

System-state questions ("is tracking broken", "is there bot activity") are NOT declined — they get the proxy-investigation playbook (cap 3 parallel) because the subject is the system, not the user.

### Caps and exemptions

- **Compound L5**: max 2 sub-questions per turn (L2 RCA addendum §6.3)
- **Proxy investigations**: max 3 parallel proxies (L2 RCA addendum §6.2)
- **Cap-exempt**: single-event multi-pillar assessments (Q46 redesign impact, Q50 cohort retention) can run all pillars in parallel via `cap_exempt: true` with reason `single_event_assessment` / `single_dimension_comparison`

### Universal RCA playbook (referenced by L4 and L5-resolved-to-L4)

12 stages from `metric-ontology.example.json#/universal_l2_playbook`:

1. confirm_headline — always
2. decompose_components — always (skipped for primitive metrics with no `catalog.MetricDef.components`)
3. temporal_weekly — always
4. temporal_daily — always
5. breakdown_channel (sessionDefaultChannelGroup) — always
6. breakdown_landing_page (landingPagePlusQueryString, cap 20) — always
7. breakdown_device (deviceCategory) — always
8. breakdown_country (country) — always
9. breakdown_event (eventName, cap 20) — always
10. structural_diff_all (A5-derived, no fetch) — always
11. path_exploration — conditional: `top_n_dim_diff("landingPage", n=20) >= 5`
12. cohort_drilldown — conditional: `any_dimension_concentration_change(any_dim) > 0.15`

Tier-2 overrides per metric live in `metric-ontology.example.json#/metrics/<id>/rca_playbook`.

### Reference documents

- `HANDOVER.md` §7 — canonical agent specs (wins on conflict)
- `contracts/_shared.schema.json` — closed enums (AnalysisLevel, AmbiguityFlag, etc.)
- `contracts/registries/metric-ontology.schema.json` — playbook schema
- `contracts/examples/metric-ontology.example.json` — universal_l2_playbook + Tier-2 entries
- `contracts/examples/catalog.example.json` — field-level definitions
- `contracts/examples/defaults.example.json` — defaults registry (option-list source; never auto-applies time_scope)

### Re-annotation note

22+ entries were re-annotated on 2026-05-28 to reflect the time-anchor rule. Affected entries are marked `Status: confirmed (re-annotated per time-anchor rule 2026-05-28)`. The pre-rule annotations resolved `time_scope_missing` via DEFAULT_APPLIED; post-rule they resolve via NEEDS_CLARIFICATION.

---

# L1 — Factoid (10)

### Q1 — "What was our session count last week?"

**Tier**: L1 — Factoid
**Status**: confirmed

#### A1 — Intent
- analysis_level: L1
- report_type: snapshot
- ambiguity_flags: []
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: no

#### A2 — Query Plan
- surface: R:TrafAcq
- metric: sessions
- dimensions: []
- filters: []
- date_range: last 7 days (rolling, ending yesterday)
- sort: -
- limit: -

#### Notes
None.

---

### Q2 — "How many users visited yesterday?"

**Tier**: L1
**Status**: confirmed

#### A1 — Intent
- analysis_level: L1
- report_type: snapshot
- ambiguity_flags: [metric_resolution_needed]  ("users" → totalUsers vs activeUsers vs newUsers)
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: ["users" → totalUsers (default per defaults_registry.user_metric.default)]
- clarification_required: no

#### A2 — Query Plan
- surface: R:UserAcq
- metric: totalUsers
- dimensions: []
- filters: []
- date_range: yesterday
- sort: -
- limit: -

#### Notes
None.

---

### Q3 — "What is our engagement rate this month?"

**Tier**: L1
**Status**: confirmed

#### A1 — Intent
- analysis_level: L1
- report_type: snapshot
- ambiguity_flags: [time_scope_partial]  ("this month" is in-progress)
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: no
- notes: time_scope_partial → partial-period flag set at A5; peach marker at A6. Anchor still explicit.

#### A2 — Query Plan
- surface: R:EngOv
- metric: engagementRate
- dimensions: []
- filters: []
- date_range: current calendar month, start to yesterday
- sort: -
- limit: -

#### Notes
Partial-period rendering convention applies at A5/A6.

---

### Q4 — "Average session duration last 7 days?"

**Tier**: L1
**Status**: confirmed

#### A1 — Intent
- analysis_level: L1
- report_type: snapshot
- ambiguity_flags: []
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: no

#### A2 — Query Plan
- surface: R:EngOv
- metric: averageSessionDuration
- dimensions: []
- filters: []
- date_range: last 7 days (rolling, ending yesterday)
- sort: -
- limit: -

---

### Q5 — "Total events fired today?"

**Tier**: L1
**Status**: confirmed

#### A1 — Intent
- analysis_level: L1
- report_type: snapshot
- ambiguity_flags: [time_scope_partial]
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: no

#### A2 — Query Plan
- surface: R:Events
- metric: eventCount
- dimensions: []
- filters: []
- date_range: today (partial)
- sort: -
- limit: -

---

### Q6 — "How many job applications happened this week?"

**Tier**: L1
**Status**: confirmed

#### A1 — Intent
- analysis_level: L1
- report_type: snapshot
- ambiguity_flags: [time_scope_partial]
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: no

#### A2 — Query Plan
- surface: R:KE
- metric: eventCount
- dimensions: []
- filters: [eventName starts-with "job_apply"]
- date_range: current ISO week, Monday to today
- sort: -
- limit: -

#### Notes
Filter covers all job_apply* variants (job_apply, job_apply_kornferry_honeywell, etc.) — the joblet domain has many event-name variants per HANDOVER §14.3.

---

### Q7 — "How many users are on the site right now?"

**Tier**: L1
**Status**: confirmed

#### A1 — Intent
- analysis_level: L1
- report_type: snapshot (realtime)
- ambiguity_flags: []  ("right now" → realtime window per defaults_registry.realtime convention)
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: no

#### A2 — Query Plan
- surface: R:Real
- metric: activeUsers (last 30 minutes — GA4 realtime convention)
- dimensions: []
- filters: []
- date_range: last 30 minutes
- sort: -
- limit: -

---

### Q8 — "How many new users this month?"

**Tier**: L1
**Status**: confirmed

#### A1 — Intent
- analysis_level: L1
- report_type: snapshot
- ambiguity_flags: [time_scope_partial]
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: no

#### A2 — Query Plan
- surface: R:UserAcq
- metric: newUsers
- dimensions: []
- filters: []
- date_range: current calendar month, start to yesterday
- sort: -
- limit: -

---

### Q9 — "What's our bounce rate last 28 days?"

**Tier**: L1
**Status**: confirmed

#### A1 — Intent
- analysis_level: L1
- report_type: snapshot
- ambiguity_flags: []
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: no

#### A2 — Query Plan
- surface: R:EngOv
- metric: bounceRate
- dimensions: []
- filters: []
- date_range: last 28 days (rolling, ending yesterday)
- sort: -
- limit: -

---

### Q10 — "Conversion rate this week?"

**Tier**: L1
**Status**: confirmed

#### A1 — Intent
- analysis_level: L1
- report_type: snapshot
- ambiguity_flags: [metric_resolution_needed, time_scope_partial]
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: ["conversion rate" → sessionKeyEventRate (default per defaults_registry.conversion_rate_metric.default = session_level)]
- clarification_required: no

#### A2 — Query Plan
- surface: R:KE
- metric: sessionKeyEventRate
- dimensions: []
- filters: [] (all key events)
- date_range: current ISO week, Monday to today
- sort: -
- limit: -

---

# L2 — Comparison / ranking (10)

### Q11 — "Top 10 traffic sources last 28 days"

**Tier**: L2
**Status**: confirmed

#### A1 — Intent
- analysis_level: L2
- report_type: ranking
- ambiguity_flags: [dimension_resolution_needed]  ("sources" → sessionSource vs sessionSourceMedium vs sessionDefaultChannelGroup vs firstUserSource)
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: ["sources" → sessionSourceMedium (default per defaults_registry.source_dimension.default — most granular session-touch source)]
- clarification_required: no

#### A2 — Query Plan
- surface: R:TrafAcq
- metric: sessions (rank-by)
- dimensions: [sessionSourceMedium]
- filters: []
- date_range: last 28 days (rolling, ending yesterday)
- sort: sessions desc
- limit: 10

---

### Q12 — "Top 20 landing pages by sessions this month"

**Tier**: L2
**Status**: confirmed

#### A1 — Intent
- analysis_level: L2
- report_type: ranking
- ambiguity_flags: [time_scope_partial]
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: no

#### A2 — Query Plan
- surface: R:LP
- metric: sessions
- dimensions: [landingPagePlusQueryString]  (preferred over plain landingPage — keeps query-string variants distinct)
- filters: []
- date_range: current calendar month, start to yesterday
- sort: sessions desc
- limit: 20

---

### Q13 — "Top 5 countries by users last week"

**Tier**: L2
**Status**: confirmed

#### A1 — Intent
- analysis_level: L2
- report_type: ranking
- ambiguity_flags: [metric_resolution_needed]
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: ["users" → totalUsers]
- clarification_required: no

#### A2 — Query Plan
- surface: R:Demo
- metric: totalUsers
- dimensions: [country]
- filters: []
- date_range: last 7 days
- sort: totalUsers desc
- limit: 5

---

### Q14 — "Engagement rate this week vs last"

**Tier**: L2
**Status**: confirmed

#### A1 — Intent
- analysis_level: L2
- report_type: comparison
- ambiguity_flags: [time_scope_partial]  ("this week" is in-progress; "vs last" is explicit)
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: no

#### A2 — Query Plan
- surface: R:EngOv
- metric: engagementRate
- dimensions: []
- filters: []
- date_range_current: current ISO week, Monday to today
- date_range_comparison: prior ISO week, Monday to Sunday
- sort: -
- limit: -

#### Notes
A5 may flag the truncation in the current-period side.

---

### Q15 — "Most common events fired yesterday"

**Tier**: L2
**Status**: confirmed

#### A1 — Intent
- analysis_level: L2
- report_type: ranking
- ambiguity_flags: [ranking_limit_missing]  ("most common" → top-N, N unspecified)
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: [ranking_limit → 10 (default per defaults_registry.ranking_limit.default)]
- clarification_required: no

#### A2 — Query Plan
- surface: R:Events
- metric: eventCount
- dimensions: [eventName]
- filters: []
- date_range: yesterday
- sort: eventCount desc
- limit: 10

---

### Q16 — "Top 10 referring domains"

**Tier**: L2
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L2
- report_type: ranking
- ambiguity_flags: [time_scope_missing]
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: []  (time_scope_missing CANNOT auto-default per hard rule)
- clarification_required: YES
- clarification_text:
    "What time window should we look at?
     - Last 7 days
     - Last 28 days (recommended)
     - Last 90 days
     - Current month so far
     - A specific date range I'll provide"

#### A2 — Query Plan (after resume — assuming user picks "last 28 days")
- surface: R:TrafAcq
- metric: sessions
- dimensions: [sessionSource]
- filters: [sessionMedium = "referral"]
- date_range: <resolved from clarification>
- sort: sessions desc
- limit: 10

---

### Q17 — "Sessions by device category this month"

**Tier**: L2
**Status**: confirmed

#### A1 — Intent
- analysis_level: L2
- report_type: breakdown
- ambiguity_flags: [time_scope_partial]
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: no

#### A2 — Query Plan
- surface: R:Tech
- metric: sessions
- dimensions: [deviceCategory]  (desktop, mobile, tablet — 3 values)
- filters: []
- date_range: current calendar month, start to yesterday
- sort: sessions desc
- limit: -

---

### Q18 — "Top 10 browsers by users last 28d"

**Tier**: L2
**Status**: confirmed

#### A1 — Intent
- analysis_level: L2
- report_type: ranking
- ambiguity_flags: [metric_resolution_needed]
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: ["users" → totalUsers]
- clarification_required: no

#### A2 — Query Plan
- surface: R:Tech
- metric: totalUsers
- dimensions: [browser]
- filters: []
- date_range: last 28 days
- sort: totalUsers desc
- limit: 10

---

### Q19 — "Sessions by hour of day this week"

**Tier**: L2
**Status**: confirmed

#### A1 — Intent
- analysis_level: L2
- report_type: breakdown
- ambiguity_flags: [time_scope_partial]
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: no

#### A2 — Query Plan
- surface: X:Free  (Reports tab has no `hour` dimension)
- metric: sessions
- dimensions: [hour]  (0–23)
- filters: []
- date_range: current ISO week, Monday to today
- sort: hour asc (chronological)
- limit: -

---

### Q20 — "Top 10 first-touch sources for new users last 28d"

**Tier**: L2
**Status**: confirmed

#### A1 — Intent
- analysis_level: L2
- report_type: ranking
- ambiguity_flags: []  ("first-touch" explicitly disambiguates from session-touch)
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: no

#### A2 — Query Plan
- surface: R:UserAcq  (distinct from Q11 — UserAcq uses firstUser* dims, TrafAcq uses session*)
- metric: newUsers
- dimensions: [firstUserSourceMedium]
- filters: []
- date_range: last 28 days
- sort: newUsers desc
- limit: 10

---

# L3 — Multi-surface descriptive (10)

### Q21 — "How is our organic traffic doing?"

**Tier**: L3
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L3
- report_type: composite
- ambiguity_flags: [time_scope_missing, comparison_period_implicit]
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: ["organic" → sessionDefaultChannelGroup = "Organic Search" (DEFAULT)]
- clarification_required: YES (time_scope_missing)
- clarification_text:
    "What time window should we look at?
     - Last 7 days
     - Last 28 days (recommended)
     - Last 90 days
     - Current month so far
     - A specific date range I'll provide"

#### A2 — Query Plan (after resume — assuming "last 28 days")
- slice_filter: sessionDefaultChannelGroup = "Organic Search"
- date_range: <resolved>
- comparison: prior same-length period (silent default)
- query basket:
  - q1: R:TrafAcq, dim=[], metrics=[sessions, totalUsers, engagedSessions, engagementRate, averageSessionDuration]  (top-line PoP)
  - q2: R:TrafAcq, dim=[date], metrics=[sessions]  (daily trend)
  - q3: R:TrafAcq, dim=[sessionSourceMedium], metrics=[sessions, totalUsers, engagementRate], limit=10  (source/medium concentration)
  - q4: R:LP, dim=[landingPagePlusQueryString], metrics=[sessions, engagedSessions, engagementRate], limit=15  (both periods for PoP)
  - q5: R:KE, dim=[]+[eventName], metrics=[eventCount, sessionKeyEventRate]  (conversion volume + rate)
  - q6: R:Demo, dim=[country], metrics=[sessions, totalUsers, engagementRate], limit=10
  - q7: R:Tech, dim=[deviceCategory], metrics=[sessions, engagementRate]

#### Notes
Same shape as the manually-built `organic_search_2026-05-26.html` from the recent session.

---

### Q22 — "How are mobile users behaving?"

**Tier**: L3
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L3
- report_type: composite
- ambiguity_flags: [time_scope_missing, comparison_period_implicit]
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: ["mobile" → deviceCategory = "mobile"]
- clarification_required: YES (time_scope_missing)
- clarification_text: <standard time-window template>

#### A2 — Query Plan (after resume)
- slice_filter: deviceCategory = "mobile"
- query basket:
  - q1: R:Tech, dim=[], metrics=[sessions, totalUsers, engagementRate, averageSessionDuration, screenPageViewsPerSession]
  - q2: R:Tech, dim=[date], metrics=[sessions]
  - q3: R:LP, dim=[landingPagePlusQueryString], metrics=[sessions, engagedSessions, engagementRate], limit=15
  - q4: R:EngOv, dim=[sessionDefaultChannelGroup], metrics=[sessions, engagementRate]
  - q5: R:KE, dim=[]+[eventName], metrics=[eventCount, sessionKeyEventRate]
  - q6: R:Tech, dim=[browser], metrics=[sessions, engagementRate], limit=10
  - q7: R:Tech, dim=[mobileDeviceModel], metrics=[sessions, engagementRate], limit=10

---

### Q23 — "How is the homepage performing?"

**Tier**: L3
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L3
- report_type: composite
- ambiguity_flags: [time_scope_missing, comparison_period_implicit, dimension_resolution_needed]
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: ["homepage" → landingPage = "/" (for acquisition surfaces) AND pagePath = "/" (for engagement surfaces)]
- clarification_required: YES (time_scope_missing)
- clarification_text: <standard time-window template>

#### A2 — Query Plan (after resume)
- query basket:
  - q1: R:LP, dim=[], filter=[landingPage="/"], metrics=[sessions, engagedSessions, engagementRate, averageSessionDuration]
  - q2: R:LP, dim=[date], filter=[landingPage="/"], metrics=[sessions]
  - q3: R:Pages, dim=[], filter=[pagePath="/"], metrics=[screenPageViews, totalUsers, averageEngagementTime]
  - q4: R:TrafAcq, dim=[sessionDefaultChannelGroup], filter=[landingPage="/"], metrics=[sessions, engagementRate]
  - q5: R:KE, dim=[eventName], filter=[landingPage="/"], metrics=[eventCount]
  - q6: X:Path, start=pagePath "/", direction=forward (next-event distribution)

---

### Q24 — "How is our paid traffic doing?"

**Tier**: L3
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L3
- report_type: composite
- ambiguity_flags: [time_scope_missing, comparison_period_implicit, dimension_resolution_needed]
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: ["paid" → sessionDefaultChannelGroup IN ("Paid Search", "Paid Social", "Paid Video", "Paid Shopping", "Paid Other", "Display")]
- clarification_required: YES (time_scope_missing)
- clarification_text: <standard time-window template>

#### A2 — Query Plan (after resume)
- slice_filter: sessionDefaultChannelGroup IN paid set
- query basket:
  - q1: R:TrafAcq, dim=[], metrics=[sessions, totalUsers, engagementRate, averageSessionDuration]
  - q2: R:TrafAcq, dim=[date], metrics=[sessions]
  - q3: R:TrafAcq, dim=[sessionDefaultChannelGroup], metrics=[sessions, totalUsers, engagementRate]
  - q4: R:TrafAcq, dim=[sessionCampaignName], metrics=[sessions, totalUsers, engagementRate], limit=10
  - q5: R:KE, dim=[]+[eventName], metrics=[eventCount, sessionKeyEventRate]
  - q6: R:LP, dim=[landingPagePlusQueryString], metrics=[sessions, engagementRate], limit=15
  - q7: R:Adv, dim=[sessionDefaultChannelGroup], metrics=[cost, ROAS if R:Mon linked else sessions+conversions]

---

### Q25 — "How is on-site job search performing?"

**Tier**: L3
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L3
- report_type: composite
- ambiguity_flags: [time_scope_missing, comparison_period_implicit]
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: ["job search" → domain_profile.funnels.search_to_apply (joblet.ai = job_board)]
- clarification_required: YES (time_scope_missing)
- clarification_text: <standard time-window template>

#### A2 — Query Plan (after resume)
- query basket:
  - q1: R:Events, dim=[eventName], filter=[eventName IN {search, view_search_results, view_job, job_apply*}], metrics=[eventCount, totalUsers]
  - q2: R:Events, dim=[date, eventName], same filter, metrics=[eventCount]
  - q3: X:Funnel, steps=[search → view_search_results → view_job → job_apply*] from domain_profile.funnels.search_to_apply
  - q4: R:LP, dim=[landingPagePlusQueryString], filter=[landingPage matches "/jobs*" OR "/search*"], metrics=[sessions, eventCount("view_search_results")], limit=10
  - q5: R:KE, dim=[], filter=[eventName starts-with "job_apply"], metrics=[eventCount, sessionKeyEventRate]
  - q6: R:Tech, dim=[deviceCategory], step rate (computed for the funnel)

---

### Q26 — "How is the apply flow performing?"

**Tier**: L3
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L3
- report_type: composite
- ambiguity_flags: [time_scope_missing, comparison_period_implicit]
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: ["apply flow" → domain_profile.funnels.apply_flow]
- clarification_required: YES (time_scope_missing)
- clarification_text: <standard time-window template>

#### A2 — Query Plan (after resume)
- query basket:
  - q1: R:Events, dim=[eventName], filter=[eventName IN {view_job, start_apply, submit_apply, job_apply*, form_abandon}], metrics=[eventCount, totalUsers]
  - q2: X:Funnel, steps=[view_job → start_apply → submit_apply]
  - q3: X:Funnel, same steps, secondary dim=deviceCategory
  - q4: R:Pages, dim=[pageTitle], filter=[pagePath matches "/jobs/*/apply" OR "/apply*"], metrics=[screenPageViews, averageEngagementTime], limit=15
  - q5: R:KE, dim=[], filter=[eventName starts-with "job_apply" OR "submit_apply"], metrics=[eventCount, sessionKeyEventRate]
  - q6: R:Events, dim=[eventName, sessionDefaultChannelGroup], filter=[apply set], metrics=[eventCount]

---

### Q27 — "How are returning vs new users behaving?"

**Tier**: L3
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L3
- report_type: composite (segment-vs-segment within same window)
- ambiguity_flags: [time_scope_missing]
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: YES (time_scope_missing)
- clarification_text: <standard time-window template>

#### A2 — Query Plan (after resume)
- query basket (no PoP — segment comparison within same window):
  - q1: R:UserAcq, dim=[newVsReturning], metrics=[totalUsers, sessions]
  - q2: R:EngOv, dim=[newVsReturning], metrics=[engagementRate, averageSessionDuration, screenPageViewsPerSession]
  - q3: R:KE, dim=[newVsReturning], metrics=[eventCount, sessionKeyEventRate]
  - q4: R:LP, dim=[newVsReturning, landingPagePlusQueryString], metrics=[sessions], limit=10 per segment
  - q5: R:TrafAcq, dim=[newVsReturning, sessionDefaultChannelGroup], metrics=[sessions]
  - q6: X:Seg, segments=[returning users, engaged users], overlap counts (optional)

#### Notes
Q27 uses X:Seg — segment_overlap_run is a deferred stage kind. Optional usage.

---

### Q28 — "How are users in India behaving?"

**Tier**: L3
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L3
- report_type: composite
- ambiguity_flags: [time_scope_missing, comparison_period_implicit, geo_resolution_needed]
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: ["India" → country = "India"]
- clarification_required: YES (time_scope_missing)
- clarification_text: <standard time-window template>

#### A2 — Query Plan (after resume)
- slice_filter: country = "India"
- query basket:
  - q1: R:Demo, dim=[], metrics=[sessions, totalUsers, newUsers, engagementRate, averageSessionDuration]
  - q2: R:Demo, dim=[date], metrics=[sessions]
  - q3: R:Demo, dim=[region], metrics=[sessions, totalUsers, engagementRate], limit=10
  - q4: R:Demo, dim=[city], metrics=[sessions, totalUsers, engagementRate], limit=10
  - q5: R:TrafAcq, dim=[sessionDefaultChannelGroup], metrics=[sessions, engagementRate]
  - q6: R:LP, dim=[landingPagePlusQueryString], metrics=[sessions, engagementRate], limit=15
  - q7: R:Tech, dim=[deviceCategory], metrics=[sessions, engagementRate]
  - q8: R:KE, dim=[]+[eventName], metrics=[eventCount, sessionKeyEventRate]

---

### Q29 — "What's our acquisition picture this month?"

**Tier**: L3
**Status**: confirmed

#### A1 — Intent
- analysis_level: L3
- report_type: composite
- ambiguity_flags: [time_scope_partial, comparison_period_implicit]
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: [comparison_period → prior calendar month (full, silent default)]
- clarification_required: no

#### A2 — Query Plan
- date_range_current: current calendar month, start to yesterday
- date_range_comparison: prior calendar month, full
- query basket:
  - q1: R:Acq, dim=[], metrics=[sessions, totalUsers, newUsers, engagementRate, sessionKeyEventRate]
  - q2: R:TrafAcq, dim=[sessionDefaultChannelGroup], metrics=[sessions, totalUsers, engagementRate]
  - q3: R:UserAcq, dim=[firstUserDefaultChannelGroup], metrics=[newUsers, totalUsers]
  - q4: R:TrafAcq, dim=[sessionSourceMedium], metrics=[sessions], limit=10
  - q5: R:UserAcq, dim=[firstUserSourceMedium], metrics=[newUsers], limit=10
  - q6: R:TrafAcq, dim=[date], metrics=[sessions]
  - q7: R:KE, dim=[sessionDefaultChannelGroup], metrics=[eventCount, sessionKeyEventRate]
  - q8: R:TrafAcq, dim=[sessionCampaignName], metrics=[sessions, totalUsers], limit=10

---

### Q30 — "How is long-term user retention?"

**Tier**: L3
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L3
- report_type: composite (retention-focused)
- ambiguity_flags: [time_scope_missing]  ("long-term" is fuzzy, no specific anchor — needs window length)
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: YES (time_scope_missing — needs cohort window length)
- clarification_text:
    "What time horizon should we use for cohort retention?
     - Last 4 weeks
     - Last 13 weeks (≈ 3 months)
     - Last 26 weeks (≈ 6 months, recommended)
     - Last 52 weeks (≈ 1 year)
     - Custom"

#### A2 — Query Plan (after resume, assuming 26 weeks)
- query basket:
  - q1: R:Ret, dim=[], metrics=[newUsers, returningUsers, retention curve day 1/7/28/90]
  - q2: X:Cohort [DEFERRED KIND retention_cohort_run], cohort=acquisition week, return=any session, weekly matrix
  - q3: X:Cohort [DEFERRED], cohort=acquisition month, return=any session, monthly matrix
  - q4: X:LTV [DEFERRED KIND lifetime_value_run], metrics=[lifetimeEngagementDuration, lifetimeSessions, lifetimeKeyEvents]
  - q5: R:UserAcq, dim=[firstUserDefaultChannelGroup], metrics=[newUsers, returningUsers (computed)]
  - q6: R:EngOv, dim=[newVsReturning], metrics=[engagementRate, averageSessionDuration]
  - q7: X:Cohort [DEFERRED], cohort=acquisition week, secondary=firstUserSourceMedium, weekly per source (top 5)

#### Notes
Q30 depends on retention_cohort_run and lifetime_value_run — both deferred stage kinds. A3 surfaces "capability pending" markers for those queries until promoted.

---

# L4 — Single-metric diagnostic (10)

### Q31 — "Why did engagement rate drop in April?"

**Tier**: L4
**Status**: confirmed

#### A1 — Intent
- analysis_level: L4
- report_type: composite (diagnostic)
- ambiguity_flags: [comparison_period_implicit]
- interpretation_request: true

#### A3 — Defaults vs Clarify
- preapplied_defaults: [comparison_period → preceding period same length = March 2026 (silent default)]
- clarification_required: no
- notes: April explicit (anchor); March silent baseline. No clarification needed.

#### A2 — Query Plan
- headline_metric: engagementRate
- playbook: universal_l2 + Tier-2 overrides for engagementRate from metric ontology
- date_range_current: April 2026 (full month)
- date_range_baseline: March 2026 (full month)
- staged_plan:
  - S1: confirm_headline — always
  - S2: decompose_components — always — components=[engagedSessions, sessions]
  - S3: temporal_weekly — always
  - S4: temporal_daily — always
  - S5: breakdown_channel — always — dim=sessionDefaultChannelGroup
  - S6: breakdown_landing_page — always — dim=landingPagePlusQueryString, cap=20
  - S7: breakdown_device — always — dim=deviceCategory
  - S8: breakdown_country — always — dim=country
  - S9: breakdown_event — always — dim=eventName, cap=20
  - S10: structural_diff_all — always — A5-derived from S5–S9
  - S11 [Tier-2 add]: funnel_search_to_apply — always — funnel from domain_profile.funnels.search_to_apply
  - S12 [Tier-2 add]: funnel_step_breakdown — conditional — execute_if: funnel_step_rate_drop("view_search_results") > 0.3
  - S13 [Tier-2 replaces universal S11]: path_exploration_with_event — conditional — execute_if: top_n_dim_diff("landingPage", n=20) >= 5; sample_strategy=landing_pages_where_event_fired_in_baseline; target_event=view_search_results; cap=10
  - S14 [universal]: cohort_drilldown — conditional — execute_if: any_dimension_concentration_change(any_dim) > 0.15

#### Notes
Joblet trace per HANDOVER §14.3: search step rate Mar→Apr 30.6%→3.4% (drop 88.79%, triggers S12); top-20 LP diff = 15 (triggers S13).
Key explorations: X:Funnel (S11, S12), X:Path (S13).

---

### Q32 — "Why is bounce rate increasing?"

**Tier**: L4
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L4
- report_type: composite (diagnostic)
- ambiguity_flags: [time_scope_missing, comparison_period_implicit]
- interpretation_request: true

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: YES (time_scope_missing)
- clarification_text: <standard time-window template>

#### A2 — Query Plan (after resume — assuming "last 28 days")
- headline_metric: bounceRate
- playbook: universal_l2 + Tier-2 override for bounceRate (decompose_components = [bounces, sessions])
- date_range_current: <resolved>
- date_range_baseline: prior same-length period (silent default)
- staged_plan:
  - S1: confirm_headline
  - S2: decompose_components [Tier-2 override] — components=[bounces, sessions]
  - S3: temporal_weekly
  - S4: temporal_daily
  - S5: breakdown_channel
  - S6: breakdown_landing_page — **emphasised** (entry quality = where bounces originate)
  - S7: breakdown_device
  - S8: breakdown_country
  - S9: breakdown_event
  - S10: structural_diff_all
  - S11: path_exploration (universal, conditional) — **forward** from top bouncing pages
  - S12: cohort_drilldown (universal, conditional)

#### Notes
bounceRate inherits universal_l2 + overrides only decompose_components per Appendix B. Landing-page breakdown is the diagnostic surface.

---

### Q33 — "Why are users not completing applications?"

**Tier**: L4
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L4
- report_type: composite (diagnostic, funnel-shaped)
- ambiguity_flags: [time_scope_missing, comparison_period_implicit]
- interpretation_request: true

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: YES (time_scope_missing)
- clarification_text: <standard time-window template>

#### A2 — Query Plan (after resume)
- headline_metric: apply funnel completion rate (computed from domain_profile.funnels.apply_flow)
- playbook: universal_l2 adapted — funnel mandatory rather than Tier-2
- staged_plan:
  - S1: confirm_headline (A5-computed completion rate PoP)
  - S2: decompose_components — view_job count + start_apply count + submit_apply / job_apply* count
  - S3: temporal_weekly
  - S4: temporal_daily
  - S5: apply_funnel_run — **mandatory** — runs apply_flow funnel
  - S6: apply_funnel_step_breakdown by sessionDefaultChannelGroup — always
  - S7: apply_funnel_step_breakdown by deviceCategory — always
  - S8: apply_funnel_step_breakdown by country — always
  - S9: breakdown_landing_page filtered to apply-flow entry pages (/jobs/*, /apply*), cap=15
  - S10: breakdown_event filtered to apply set + form_abandon/validation_error if tracked
  - S11: structural_diff_all
  - S12: path_exploration_apply — conditional — execute_if: any_funnel_step_drop > 0.15; sample_strategy=landing_pages_where_event_fired_in_baseline; target_event=view_job; cap=10
  - S13: cohort_drilldown — conditional

#### Notes
Headline is a derived metric (eventCount[submit_apply OR job_apply*] / eventCount[view_job]). X:Funnel mandatory.

---

### Q34 — "Why did organic traffic fall this month?"

**Tier**: L4
**Status**: confirmed

#### A1 — Intent
- analysis_level: L4
- report_type: composite (diagnostic)
- ambiguity_flags: [time_scope_partial, comparison_period_implicit, metric_resolution_needed]
- interpretation_request: true

#### A3 — Defaults vs Clarify
- preapplied_defaults:
  - "traffic" → sessions (silent default)
  - comparison_period → prior calendar month full (silent default)
- clarification_required: no

#### A2 — Query Plan
- headline_metric: sessions (primitive — S2 auto-skipped)
- slice_filter: sessionDefaultChannelGroup = "Organic Search"  (dimensional_filter pattern per L2 RCA addendum §6.1)
- playbook: universal_l2 (sessions has no Tier-2 adds per Appendix B)
- date_range_current: current calendar month, start to yesterday (partial)
- date_range_baseline: prior calendar month, full
- staged_plan:
  - S0 [prepended per §6.1]: share_of_whole — Organic Search's share of all sessions PoP
  - S1: confirm_headline — organic sessions PoP
  - [S2 skipped — sessions primitive]
  - S3: temporal_weekly
  - S4: temporal_daily
  - S5: breakdown_channel (degenerate — slice already filtered)
  - S6: breakdown_landing_page — **emphasised** (cap 20)
  - S7: breakdown_device
  - S8: breakdown_country
  - S9: breakdown_event
  - S10 [added for organic context]: breakdown_source_medium — dim=sessionSourceMedium (google/organic vs bing/organic etc.)
  - S11: structural_diff_all
  - S12: path_exploration — conditional — sample_strategy=landing_pages_where_event_fired_in_baseline if KE registered, else landing_pages_in_structural_diff
  - S13: cohort_drilldown — conditional

#### Notes
Every stage carries dimensional_filter={sessionDefaultChannelGroup: "Organic Search"}.

---

### Q35 — "Why are mobile users converting less?"

**Tier**: L4
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L4
- report_type: composite (diagnostic)
- ambiguity_flags: [time_scope_missing, comparison_period_implicit, metric_resolution_needed]
- interpretation_request: true

#### A3 — Defaults vs Clarify
- preapplied_defaults: ["converting" → sessionKeyEventRate]
- clarification_required: YES (time_scope_missing)
- clarification_text: <standard time-window template>

#### A2 — Query Plan (after resume)
- headline_metric: sessionKeyEventRate
- slice_filter: deviceCategory = "mobile"
- playbook: universal_l2 (no Tier-2 entry; conversion = funnel completion for joblet so funnel added Tier-2-style)
- staged_plan:
  - S0: share_of_whole — mobile's share of sessions + conversions PoP
  - S1: confirm_headline
  - S2: decompose_components — sessionsWithKeyEvent + sessions
  - S3: temporal_weekly
  - S4: temporal_daily
  - S5: breakdown_channel
  - S6: breakdown_landing_page (cap 20)
  - S7: breakdown_device → swapped for deviceModel (within-mobile variation)
  - S8: breakdown_country
  - S9: breakdown_event
  - S10 [added]: breakdown_browser (mobile chrome vs safari vs in-app webview)
  - S11: structural_diff_all
  - S12 [Tier-2-style add]: apply_funnel_mobile — funnel_run filtered to mobile
  - S13: apply_funnel_step_breakdown — conditional — execute_if: any_funnel_step_drop > 0.15
  - S14: path_exploration — conditional — target_event=view_job; cap=10
  - S15: cohort_drilldown — conditional

#### Notes
Browser breakdown swapped in for within-mobile variation. Apply funnel added because conversion = funnel completion for joblet.

---

### Q36 — "Why did homepage session duration drop?"

**Tier**: L4
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L4
- report_type: composite (diagnostic)
- ambiguity_flags: [time_scope_missing, comparison_period_implicit, dimension_resolution_needed]
- interpretation_request: true

#### A3 — Defaults vs Clarify
- preapplied_defaults: ["homepage" → landingPage = "/"]
- clarification_required: YES (time_scope_missing)
- clarification_text: <standard time-window template>

#### A2 — Query Plan (after resume)
- headline_metric: averageSessionDuration
- slice_filter: landingPage = "/"
- playbook: universal_l2 + Tier-2 override (decompose_components = [userEngagementDuration, sessions])
- staged_plan:
  - S0: share_of_whole — homepage's share of entry sessions PoP
  - S1: confirm_headline
  - S2: decompose_components [Tier-2] — [userEngagementDuration, sessions]
  - S3: temporal_weekly
  - S4: temporal_daily
  - S5: breakdown_channel
  - S6: breakdown_landing_page → swapped for pagePath (which subsequent pages, cap 20)
  - S7: breakdown_device
  - S8: breakdown_country
  - S9: breakdown_event fired during homepage-entry sessions
  - S10 [added]: breakdown_source_medium within homepage slice
  - S11: structural_diff_all
  - S12: path_exploration_forward — conditional — execute_if: top_n_dim_diff("pagePath", n=20) >= 5
  - S13: cohort_drilldown — conditional

---

### Q37 — "Why did our top landing page lose traffic?"

**Tier**: L4
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L4
- report_type: composite (diagnostic)
- ambiguity_flags: [time_scope_missing, comparison_period_implicit, dimension_resolution_needed]
- interpretation_request: true

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: YES (time_scope_missing)
- clarification_text: <standard time-window template>
- additional resolution: "top landing page" is implicit reference — A2 pre-stage resolves by sessions in baseline period; if gap <10% A3 also asks "which page?"

#### A2 — Query Plan (after resume)
- headline_metric: sessions (primitive)
- slice_filter: landingPagePlusQueryString = <resolved top LP>
- playbook: universal_l2 + pre-stage to identify LP
- staged_plan:
  - S0a: identify_top_lp — pre-stage — R:LP dim=[landingPagePlusQueryString], baseline 28d, sort desc, limit 1
  - S0b: share_of_whole — that LP's share of all sessions PoP
  - S1: confirm_headline
  - [S2 skipped — sessions primitive]
  - S3: temporal_weekly
  - S4: temporal_daily
  - S5: breakdown_channel — **emphasised**
  - S6 [added]: breakdown_source_medium
  - S7 [added]: breakdown_campaign — dim=sessionCampaignName
  - S8: breakdown_device
  - S9: breakdown_country
  - S10: breakdown_event fired on this LP
  - S11: structural_diff_all
  - S12: path_exploration_backward — conditional — execute_if: top_n_dim_diff("sessionSourceMedium", n=10) >= 3 OR top_n_dim_diff("sessionCampaignName", n=10) >= 3
  - S13: cohort_drilldown — conditional

#### Notes
Path direction = backward (what stopped sending traffic). Stages 6+7 added because LP losses are typically referrer/campaign-driven.

---

### Q38 — "Why are new users declining?"

**Tier**: L4
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L4
- report_type: composite (diagnostic)
- ambiguity_flags: [time_scope_missing, comparison_period_implicit]
- interpretation_request: true

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: YES (time_scope_missing)
- clarification_text: <standard time-window template>

#### A2 — Query Plan (after resume)
- headline_metric: newUsers (primitive — S2 auto-skipped)
- playbook: universal_l2 with surface choices skewed to R:UserAcq (firstUser* dims correct for newUsers attribution)
- staged_plan:
  - S1: confirm_headline
  - [S2 skipped — newUsers primitive]
  - S3: temporal_weekly
  - S4: temporal_daily
  - S5: breakdown_first_user_channel — R:UserAcq dim=firstUserDefaultChannelGroup (NOT session-touch)
  - S6 [added]: breakdown_first_user_source_medium — dim=firstUserSourceMedium, cap=15
  - S7 [added]: breakdown_first_user_campaign — dim=firstUserCampaignName, cap=15
  - S8: breakdown_landing_page filter newVsReturning="new", cap=20
  - S9: breakdown_device filter newVsReturning="new"
  - S10: breakdown_country filter newVsReturning="new"
  - S11: breakdown_event fired by new-user sessions
  - S12: structural_diff_all
  - S13 [added, DEFERRED KIND retention_cohort_run]: new_user_cohort_retention — X:Cohort weekly by firstUserDefaultChannelGroup, return=any session within day-7
  - S14: path_exploration — conditional (within new-user sessions)
  - S15: cohort_drilldown — conditional

#### Notes
R:UserAcq surface used throughout (not R:TrafAcq) because first-touch attribution. S13 deferred until retention_cohort_run is implemented.

---

### Q39 — "Why did `view_search_results` event decline?"

**Tier**: L4
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L4
- report_type: composite (diagnostic, event-shaped)
- ambiguity_flags: [time_scope_missing, comparison_period_implicit]
- interpretation_request: true

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: YES (time_scope_missing)
- clarification_text: <standard time-window template>

#### A2 — Query Plan (after resume)
- headline_metric: eventCount filtered to eventName="view_search_results" (primitive)
- slice_filter: eventName = "view_search_results"
- playbook: universal_l2 adapted (no Tier-2 for raw eventCount)
- staged_plan:
  - S0: event_metadata_check — confirm event exists in both periods (catches rename sentinel — joblet has casing changes per HANDOVER §14.3)
  - S1: confirm_headline
  - [S2 skipped — eventCount primitive]
  - S3: temporal_weekly
  - S4: temporal_daily
  - S5: breakdown_channel
  - S6: breakdown_landing_page — **emphasised** (cap 20)
  - S7 [added]: breakdown_page_path — fires mid-session on any page hosting search
  - S8: breakdown_device
  - S9: breakdown_country
  - S10 [replaces universal breakdown_event since headline already pins event]: breakdown_adjacent_events — eventName for sessions containing view_search_results
  - S11: structural_diff_all
  - S12 [Tier-2-style add]: search_funnel_context — funnel_run on search_to_apply
  - S13: path_exploration_backward — conditional — target_event=view_search_results; cap=10
  - S14: cohort_drilldown — conditional

#### Notes
S0 catches rename — the most common cause of an "event decline" is renaming (joblet trace: job_apply_kornferry_honeywell → job_apply_Kornferry_Honeywell). Path = backward.

---

### Q40 — "Why is direct traffic surging on May 19?"

**Tier**: L4
**Status**: confirmed

#### A1 — Intent
- analysis_level: L4
- report_type: composite (point-in-time spike)
- ambiguity_flags: []  (date explicit, slice explicit)
- interpretation_request: true

#### A3 — Defaults vs Clarify
- preapplied_defaults: [baseline → trailing 28-day mean (default per defaults_registry.point_in_time_baseline)]
- clarification_required: no

#### A2 — Query Plan
- headline_metric: sessions (primitive)
- slice_filter: sessionDefaultChannelGroup = "Direct"
- playbook: universal_l2 adapted for point-in-time (temporal stages compressed; hourly added)
- date_range_current: May 19, 2026
- date_range_baseline: trailing 28 days (Apr 21 – May 18)
- staged_plan:
  - S0: share_of_whole — Direct's share May 19 vs trailing-mean share
  - S1: confirm_headline — Direct sessions May 19 vs trailing mean (with z-score)
  - [S2 skipped]
  - [weekly skipped — single-day]
  - S2: temporal_daily — Direct daily across trailing 28d + May 19 marked focal
  - S3 [added, replaces weekly]: temporal_hourly — X:Free dim=hour, May 19 only
  - S4: breakdown_landing_page filter Direct on May 19, cap=20
  - S5 [added]: breakdown_source_detail — dim=sessionSource (raw, pre-grouping) for (direct)/(none)/(not set) split
  - S6: breakdown_device
  - S7: breakdown_country
  - S8: breakdown_event
  - S9 [added]: breakdown_engagement_flag — dim=isEngagedSession (computed), engaged vs non-engaged
  - S10: structural_diff_all — Direct's top-20 LPs May 19 vs typical
  - S11: path_exploration_forward — conditional — execute_if: top_n_dim_diff("landingPage", n=20) >= 5 OR engagement_rate_drop > 0.5; sample_strategy=top_n_by_traffic constrained to May 19's Direct set; cap=10
  - S12: cohort_drilldown — conditional

#### Notes
Bot-proxy-investigation shape per HANDOVER §14.4–14.5. Hourly view substituted for weekly (point-in-time anomaly). Source-detail breakdown surfaces the (direct)/(not set) split. Engagement flag surfaces bot-crawler signature without asserting it.

---

# L5 — Compound / open-ended / un-mapped (10)

### Q41 — "What's wrong with the site?"

**Tier**: L5
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L5
- report_type: composite (decomposition-then-expand)
- ambiguity_flags: [metric_resolution_needed, time_scope_missing, comparison_period_implicit]
- interpretation_request: true

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: YES (time_scope_missing + headline metric to be confirmed by user via A3 after scan)
- clarification_text:
    "First, what time window to scan?
     - Last 7 days
     - Last 28 days (recommended)
     - Last 90 days
     - Custom"
- on resume: A2 runs lightweight scan per pillar, then A3 emits a SECOND clarification (decomposition pick)

#### A2 — Decomposition (emitted after time-window resolved)
- lightweight scan per pillar (PoP totals):
  - (a) Traffic — R:TrafAcq, sessions PoP
  - (b) Engagement — R:EngOv, [engagementRate, averageSessionDuration, bounceRate] PoP
  - (c) Conversion — R:KE, [eventCount KE, sessionKeyEventRate] PoP
  - (d) Tech / error events — R:Events filter eventName matches *error*/exception/form_abandon, PoP
- A3 emits clarification with scan results filled in:
    "Each pillar moved as follows [in the resolved window]. Which to investigate first?
     - Traffic         (sessions: <Δ%>)
     - Engagement      (engagementRate: <Δpp>, bounceRate: <Δpp>)
     - Conversion      (sessionKeyEventRate: <Δpp>)
     - Tech / errors   (error eventCount: <Δ%>)
     (Pick 1 or 2 — compound L5 cap = 2.)"

#### A2 — On resume after pillar pick
- Each chosen pillar expands as L4 universal RCA on its respective metric (same shape as Q31–Q40)

#### Notes
Two clarification rounds — first time window, then decomposition pick. Cap 2 sub-questions per addendum §6.3.

---

### Q42 — "Why is the business slowing down?"

**Tier**: L5
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L5
- report_type: composite (decomposition-then-expand)
- ambiguity_flags: [metric_resolution_needed, time_scope_missing, comparison_period_implicit, feasibility_conditional]
- interpretation_request: true

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: YES (time_scope_missing + decomposition pick)
- clarification_text: <standard time-window template, then decomposition>

#### A2 — Decomposition (after time-window resolved + feasibility check)
- feasibility scan: is R:Mon linked? is retention_cohort_run available?
- pillars:
  - (a) Traffic — R:TrafAcq, [sessions, newUsers] PoP — always available
  - (b) Conversion — R:KE, [KE eventCount, sessionKeyEventRate] PoP — always available
  - (c) Revenue — R:Mon, [purchaseRevenue, transactions, averagePurchaseRevenue] PoP — **conditional**: requires R:Mon linked
  - (d) Retention — R:Ret + X:Cohort, week-1 returning rate PoP — **conditional**: deferred kind
- A3 clarification with feasibility annotations:
    "[available pillars listed with PoP] [unavailable pillars listed with reason: 'monetization not configured', 'retention drill deferred']
     Pick 1 or 2."

#### A2 — On resume
- (a), (b): L4 universal RCA on respective metric
- (c): L4 universal RCA on purchaseRevenue (only if R:Mon linked)
- (d): hybrid — universal stages 1–10 on returningUsers/cohort-share + X:Cohort + X:LTV (deferred-kind handling: stages render as "capability pending" markers)

#### Notes
Joblet.ai is job_board — no commerce surface — pillar (c) likely suppressed at decomposition time. Pillar (d) demonstrates the deferred-stage warning pattern.

---

### Q43 — "Why are job seekers leaving?"

**Tier**: L5
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L5
- report_type: composite (decomposition-then-expand)
- ambiguity_flags: [metric_resolution_needed, time_scope_missing, comparison_period_implicit]
- interpretation_request: true

#### A3 — Defaults vs Clarify
- preapplied_defaults: ["job seekers" → whole-site population (joblet.ai = job_board, no slice needed)]
- clarification_required: YES (time_scope_missing + decomposition pick)
- clarification_text: <standard time-window then decomposition>

#### A2 — Decomposition (after time-window resolved)
- pillars (4 ways "leaving" manifests):
  - (a) Bounce — R:EngOv, bounceRate PoP → branch = Q32 shape (L4 on bounceRate)
  - (b) Funnel drop-off — X:Funnel on apply_flow, per-step rate PoP → branch = Q33 shape (L4 funnel-mandatory)
  - (c) Session duration — R:EngOv, averageSessionDuration PoP → branch = L4 on averageSessionDuration
  - (d) Exit pages — R:Pages with exits / R:LP with engagementRate <0.3 by page, top 10 PoP → branch = L4 on exits + X:Path backward
- A3 clarification with PoP results filled in (pick 1 or 2)

#### A2 — On resume
- (a): Q32 shape — universal RCA on bounceRate, LP breakdown emphasised, X:Path forward
- (b): Q33 shape — universal RCA on apply funnel completion rate, X:Funnel mandatory
- (c): L4 on averageSessionDuration site-wide (Q36-ish without homepage filter)
- (d): L4 on exit-shaped metric + X:Path backward from top exit pages

#### Notes
Pillars overlap (bounce ⊂ short duration; funnel drop ⊂ exit pages). If user picks 2, A4 suppresses redundant breakdowns at batching.

---

### Q44 — "Is there bot activity affecting our metrics?"

**Tier**: L5
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L5
- report_type: composite (proxy investigations — un-mapped concept)
- ambiguity_flags: [no_direct_concept, time_scope_missing, comparison_period_implicit]
- interpretation_request: true

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: YES (time_scope_missing + proxy pick + mandatory disclaimer)
- clarification_text:
    "First, what time window?
     [standard template]"
- on resume: A2 runs proxy scans, A3 emits second clarification with disclaimer:
    "There is no direct measurement of 'bot activity' in GA4. Automated traffic shows up as behavioural anomalies in normal metrics. Each proxy signal moved as follows. Which to investigate? (Pick up to 3.)
     - (not set) source — abnormal dwell    (<sessions>, avg duration <Δs>, engagement <Δpp>)
     - Zero-engagement long sessions         (<session count Δ>)
     - Geographic concentration spike        (<top surging country: Δsessions>)
     - High pages/session + 0% engagement    (<session count Δ>)
     NOTE: Outputs describe the patterns. The system will not assert 'this is a bot' — that interpretation is for you."

#### A2 — Proxy basket (per chosen proxy on resume)
- Per-proxy descriptive basket (L3-style, not full L4 RCA):
  - q1: R:TrafAcq or R:Demo, dim=[date], on proxy slice
  - q2: X:Free, dim=[hour], on proxy slice (hourly distribution)
  - q3: R:EngOv, metrics=[engagementRate, averageSessionDuration, screenPageViewsPerSession]
  - q4: R:Tech, dim=[browser, deviceCategory]
  - q5: R:LP, dim=[landingPagePlusQueryString], cap=10
  - q6: R:Events, dim=[eventName]

#### Notes
Proxies derived from always-available metrics (no event-feasibility check needed — distinct from Q48). Cap 3 parallel. Mandatory disclaimer.

---

### Q45 — "Why are campaigns underperforming AND conversion dropping?"

**Tier**: L5
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L5
- report_type: composite (compound — two L4 plans in parallel)
- ambiguity_flags: [time_scope_missing, comparison_period_implicit]
- interpretation_request: true

#### A3 — Defaults vs Clarify
- preapplied_defaults:
  - "campaigns" → sessionCampaignName (session-touch)
  - "conversion" → sessionKeyEventRate (default)
- clarification_required: YES (time_scope_missing + execution scope confirmation)
- clarification_text:
    "First, what time window?
     [standard template]"
- on resume: A2 runs lightweight scan (top campaigns by drop), A3 emits second clarification:
    "Both sub-questions well-formed. Campaign scan surfaced N campaigns with material drops. Investigate:
     - All material drops (RCA per campaign with drop ≥X% — cap 3 per L5 §6.3)
     - Pick one campaign       (list with deltas)
     - Top one (recommended)   (largest-drop campaign only)
     Conversion sub-question runs as-is."

#### A2 — On resume (both sub-questions in parallel per §6.3)
- sub-q1 — campaign RCA: L4 universal on sessions + sessionKeyEventRate filtered to chosen campaign (Q34-shape with sessionCampaignName slice + share_of_whole prepended); path backward to campaign's top LPs (Q37 shape)
- sub-q2 — conversion RCA: L4 universal on sessionKeyEventRate site-wide (Q35 shape without device filter); apply_flow funnel mandatory

#### Notes
The "AND" → A5 derives cross-section (pages bouncing more AND contributing less to funnel entry). Compound L5 cap = 2.

---

### Q46 — "What's the impact of the new website redesign?"

**Tier**: L5
**Status**: confirmed

#### A1 — Intent
- analysis_level: L5
- report_type: composite (before/after across multiple pillars)
- ambiguity_flags: [cutover_date_missing, metric_resolution_needed]
- interpretation_request: true

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: YES (cutover_date_missing — MANDATORY, A3 cannot proceed without)
- clarification_text:
    "When did the redesign launch? This investigation compares a pre-launch window to a post-launch window of equal length.
     - <date picker / text input>
     - Approximate week (week of YYYY-MM-DD; windows widen)
     - I don't know — show me launch-event candidates (A2 reverse-infers from anomaly markers in last 90 days)
     NOTE: Default window after you confirm = 21 days pre / 21 days post. Adjust if you want a different length."

#### A2 — On resume (cutover = D)
- date_range_pre: D − Δ to D − 1
- date_range_post: D to today
- cap_exempt: true (reason: single_event_assessment)
- pillars (all run in parallel — §6.3 cap exempt):
  - (a) Traffic — L4 universal RCA on sessions (periods = pre/post, not last 28d vs prior)
  - (b) Engagement — L4 universal RCA on engagementRate (Q31 shape, Tier-2 funnel + path adds apply)
  - (c) Funnel — L4 funnel-shaped RCA (Q33 shape on apply_flow)
  - (d) Page-set diff — structural_diff_derived on landingPagePlusQueryString + pageTitle + eventName between pre and post (standalone, not substage)

#### Notes
Introduces: free-text date input pattern (decision_point.input_kind extension — deferred), cutover_date_missing ambiguity flag (deferred), cap_exempt field (deferred). All deferred per HANDOVER §16.

---

### Q47 — "Why are conversions dropping AND bounce rate rising?"

**Tier**: L5
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L5
- report_type: composite (compound — two L4 plans in parallel)
- ambiguity_flags: [time_scope_missing, comparison_period_implicit]
- interpretation_request: true

#### A3 — Defaults vs Clarify
- preapplied_defaults: ["conversions" → sessionKeyEventRate; "bounce rate" → bounceRate (explicit)]
- clarification_required: YES (time_scope_missing + minimal framing confirmation)
- clarification_text:
    "First, what time window?
     [standard template]"
- on resume: A3 emits minimal second clarification with scan results:
    "Both well-formed. Scan: sessionKeyEventRate <Δpp>, bounceRate <Δpp>. Proceed with both?
     - Yes, both (recommended)
     - Conversion only
     - Bounce only"

#### A2 — On resume (both in parallel)
- sub-q1: L4 universal RCA on sessionKeyEventRate site-wide (Q35 shape unfiltered); apply_flow funnel mandatory
- sub-q2: L4 universal RCA on bounceRate (Q32 shape); LP breakdown emphasised; X:Path forward

#### Notes
A5 cross-section: pages with rising bounceRate AND falling funnel-entry contribution. Compound L5 cap = 2.

---

### Q48 — "Why are users frustrated?"

**Tier**: L5 — un-mapped + emotional
**Status**: confirmed (DECLINE pattern, not affected by time-anchor rule)

#### A1 — Intent
- analysis_level: L5
- report_type: un-mapped
- ambiguity_flags: [no_direct_concept, emotional_concept]
- interpretation_request: true

#### A2 — Plan
- **No plan emitted.** A2 marks intent as unfulfillable per the decline rule.

#### A3 — Decision
- decision: feasibility_failure: cannot_be_determined
- user_facing_text:
    "Cannot be determined. Please be specific — e.g. 'how many form submissions started but didn't complete', 'how often does the exception event fire', 'how many sessions ended within 30 seconds of an apply-button click'."

#### A4/A5/A6
- Not invoked — turn ends at A3.

#### Notes
Decline rule established during training. Applies to subjective states applied to people. No proxy investigation playbook (distinct from Q44 bot activity, where the subject is the system). Time-anchor rule does not apply — turn declines before time becomes relevant.

---

### Q49 — "Is our tracking broken somewhere?"

**Tier**: L5
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L5
- report_type: composite (proxy investigations — un-mapped concept, system state)
- ambiguity_flags: [no_direct_concept, time_scope_missing, comparison_period_implicit]
- interpretation_request: true

#### A3 — Defaults vs Clarify
- preapplied_defaults: []
- clarification_required: YES (time_scope_missing + proxy pick + mandatory disclaimer)
- clarification_text:
    "First, what time window?
     [standard template]"
- on resume: A2 runs proxy scans (always-available metrics, no event-feasibility check), A3 emits second clarification with disclaimer:
    "There is no direct measurement of 'tracking broken' in GA4 — issues show up as anomalies in standard metrics. Each proxy signal scanned as follows. Which to investigate? (Pick up to 3.)
     - Per-event volume anomalies (<N events with material PoP move>)
     - Page–event ratio anomalies (<N pages with ratio shift>)
     - (not set) share trend (<Δ% across surfaces>)
     - Data freshness lag (<N days flagged low-completeness>)
     NOTE: Outputs describe the patterns. The system will not assert 'tracking is broken' — that judgement is for you."

#### A2 — Proxy basket (per chosen proxy on resume)
- (a) Per-event volume: R:Events + R:LP, per-event structural diff
- (b) Page–event ratio: R:Pages + R:Events + X:Path forward from anomalous pages
- (c) (not set) share: R:TrafAcq + R:LP + R:Demo, daily series of (not set) share per surface
- (d) Freshness lag: R:Real + R:TrafAcq, daily completeness curve vs trailing mean

#### Notes
Subject is the system, not the user — proceeds with proxy playbook (distinct from Q48). All proxies use always-available metrics. Cap 3 parallel. Mandatory disclaimer.

---

### Q50 — "Are recent user cohorts retaining worse than older cohorts?"

**Tier**: L5
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L5
- report_type: composite (retention-focused comparison)
- ambiguity_flags: [time_scope_missing, granularity_unspecified]
- interpretation_request: true

#### A3 — Defaults vs Clarify
- preapplied_defaults: [granularity → weekly (recommended)]
- clarification_required: YES (time_scope_missing — cohort window length needed)
- clarification_text:
    "Cohort framing:
     - Grain: weekly (recommended) | monthly
     - Window: how many weeks of history to use? Recommended: last 26 weeks (13 recent + 13 older)
     - Return event: any session (recommended) | any key event"

#### A2 — Plan (no decomposition halt — directly answerable)
- cap_exempt: true (reason: single_dimension_comparison)
- date_range: last 26 weeks; split at midpoint
- stages:
  - S1 [DEFERRED retention_cohort_run]: retention_curves_recent — X:Cohort, last 13 weekly cohorts, day 1/7/28/90
  - S2 [DEFERRED]: retention_curves_older — same for prior 13 weekly cohorts
  - S3: retention_diff — structural_diff_derived, A5-derived per-cohort-week recent-vs-older deltas
  - S4 [DEFERRED]: retention_by_acquisition_source — X:Cohort split by firstUserDefaultChannelGroup
  - S5 [DEFERRED]: retention_by_landing_page — X:Cohort split by first-session landingPage (top 5)
  - S6 [DEFERRED]: retention_by_device — X:Cohort split by deviceCategory
  - S7 [DEFERRED]: retention_by_country — X:Cohort split by country (top 5)
  - S8: retention_reference_curve — R:Ret property-level retention curve (cross-check)
  - S9 [DEFERRED lifetime_value_run]: lifetime_metrics — X:LTV split recent vs older
  - S10: cohort_drilldown — conditional — any_dimension_concentration_change against S4–S7; cap=3

#### Notes
Heavy dependence on retention_cohort_run and lifetime_value_run (deferred kinds). A3 surfaces partial-coverage warning until promoted. Compound-L5 cap exempt (single retention comparison, not independent sub-questions).

---

# Ad-hoc verification (1)

### Q-adhoc — "How is our weekend traffic performing compared to weekdays?"

**Tier**: L3 — segment-vs-segment comparison within same window
**Status**: confirmed (re-annotated per time-anchor rule 2026-05-28)

#### A1 — Intent
- analysis_level: L3
- report_type: composite
- ambiguity_flags: [metric_resolution_needed, time_scope_missing, definition_assumption]
- interpretation_request: false

#### A3 — Defaults vs Clarify
- preapplied_defaults:
  - "traffic" → sessions (default)
  - "weekend" → {Saturday, Sunday}; "weekday" → {Mon–Fri} (default; flagged via definition_assumption)
- clarification_required: YES (time_scope_missing)
- clarification_text: <standard time-window template>

#### A2 — Query Plan (after resume — assuming "last 28 days")
- comparison axis: segment (weekend vs weekday) computed in A5 from dayOfWeek dim (0/6=weekend, 1–5=weekday)
- surface note: almost all queries via X:Free (Reports tab has no dayOfWeek dim)
- query basket:
  - q1: X:Free, dim=[dayOfWeek], metrics=[sessions, totalUsers, engagedSessions, engagementRate, averageSessionDuration]
  - q2: X:Free, dim=[date], metrics=[sessions]  (daily series; A6 marks weekend bars)
  - q3: X:Free, dim=[dayOfWeek, hour], metrics=[sessions]  (hourly-by-day-of-week heatmap)
  - q4: X:Free, dim=[dayOfWeek, sessionDefaultChannelGroup], metrics=[sessions, engagementRate]
  - q5: X:Free, dim=[dayOfWeek, landingPagePlusQueryString], metrics=[sessions, engagementRate]  (top 10 per segment)
  - q6: X:Free, dim=[dayOfWeek, deviceCategory], metrics=[sessions, engagementRate]
  - q7: X:Free, dim=[dayOfWeek, country], metrics=[sessions]  (top 10)
  - q8: X:Free, dim=[dayOfWeek], metrics=[eventCount, sessionKeyEventRate]

#### A5 derivation
- Group dayOfWeek: {0,6}→weekend, {1,2,3,4,5}→weekday
- Compute per-segment totals AND per-day averages (weekend / 8 days, weekday / 20 days) — normalises for volume asymmetry
- Surface both absolute and average-per-day in A6

#### A6 encoding
- Per-segment KPI strip with Δ = "weekend / weekday ratio"
- Hourly-by-day heatmap (q3): 7 rows × 24 cols; weekend rows marked with thin marker (not red/green)
- Daily sparkline (q2) with weekend bars marked (lighter shade, not editorial colour)

#### Notes
- First ad-hoc question using `dayOfWeek` — confirm in `registry-data/catalog.json` that the field is registered.
- L3 cap-exempt-style: 8 queries, all parallelisable; A4 batches in one round.

---

# Appendix A — Summary statistics

| Tier | Count | Time-anchor missing | Decline | Cap-exempt |
|---|---|---|---|---|
| L1 | 10 | 0 | 0 | 0 |
| L2 | 10 | 1 (Q16) | 0 | 0 |
| L3 | 10 | 9 (all except Q29) | 0 | 0 |
| L4 | 10 | 7 (Q32, Q33, Q35, Q36, Q37, Q38, Q39) | 0 | 0 |
| L5 | 10 | 7 (Q41, Q42, Q43, Q44, Q45, Q47, Q49) — Q46 has cutover; Q48 declines; Q50 has cohort-window clarification | 1 (Q48) | 2 (Q46, Q50) |
| Ad-hoc | 1 | 1 | 0 | 0 |
| **Total** | **51** | **25** | **1** | **2** |

# Appendix B — Deferred capabilities referenced

| Capability | Used by | Status |
|---|---|---|
| retention_cohort_run (stage kind) | Q30, Q38, Q42 pillar (d), Q50 | Not modelled |
| lifetime_value_run (stage kind) | Q30, Q50 | Not modelled |
| segment_overlap_run (stage kind) | Q27 | Not modelled (optional) |
| cap_exempt: true (query-plan field) | Q46, Q50 | Not in schema |
| cutover_date_missing (ambiguity flag) | Q46 | Not in enum |
| emotional_concept (ambiguity flag) | Q48 | Not in enum |
| event_coverage_unknown (ambiguity flag) | (was Q48 — deprecated by decline rule) | Removed from need |
| decision_point.input_kind = date \| enum \| free_text | Q46 | Not in A3 schema |
| feasibility_failure: cannot_be_determined | Q48 | Not in A3 schema |

# Appendix C — Cross-reference index

| Question pattern | Q numbers |
|---|---|
| Site-wide / no slice | Q1–Q10, Q15, Q19, Q29, Q32, Q33, Q38, Q39, Q41, Q42, Q43, Q47 |
| Channel slice | Q11, Q16, Q21, Q24, Q34, Q45 |
| Page slice | Q12, Q23, Q25, Q26, Q36, Q37 |
| Geo slice | Q13, Q28 |
| Device slice | Q17, Q18, Q22, Q35 |
| Time slice (single day) | Q40 |
| Segment slice (user type) | Q20, Q27 |
| Segment slice (weekend/weekday) | Q-adhoc |
| L4 path forward emphasis | Q23, Q31, Q32, Q34, Q36, Q40 |
| L4 path backward emphasis | Q37, Q39 |
| Funnel mandatory | Q25, Q26, Q33, Q35, Q45 |
| Decline | Q48 |
| Cap-exempt | Q46, Q50 |
| Compound L5 (cap 2) | Q45, Q47 |
| Proxy L5 (cap 3) | Q44, Q49 |
| Decomposition L5 (halt for pillar pick) | Q41, Q42, Q43 |

---

# End of training corpus (v1)

When LLM brains for A1 and A2 are mapped in Phase 5D-brains, every entry in this file is a regression target. Each row's A1 classification, A3 decision, and A2 plan must match exactly (within schema validation tolerance) when the corresponding question is re-asked.

Conflict rule: if any row disagrees with HANDOVER.md §7 (the agent specs), HANDOVER.md wins. Update this file to match.
