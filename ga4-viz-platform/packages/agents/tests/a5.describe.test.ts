import { describe, it, expect } from "vitest";
import {
  describeBlock,
  describeBlockLLM,
  assertDescriptive,
  loadDescribeRegistry,
  assignNarrativeStage,
  loadNarrativeConfig,
  metricClassFromOntology,
  metricClassIncludesQuality,
  DescriptiveViolationError,
  MissingFactError,
  type DescribeRegistry,
  type DescribableBlock,
  type NarrativeConfig,
} from "../src/a5.describe.js";
import {
  attachCaptions,
  descriptionsByBlockId,
  renderCaptionHtml,
  narrativeStageByBlockId,
  attachNarrativeStages,
  groupSectionsByNarrative,
  renderNarrativeReportHtml,
} from "../src/a6.caption.js";

// Inline narrative config mirroring packages/registry-data/block-pattern.json,
// so deterministic tests don't depend on the registry file's exact contents.
const NARR: NarrativeConfig = {
  narrative_stages: [
    { id: "overview", label: "Overview", order: 1, intro: "Overview intro.", handoff: "Next, the report groups by acquisition." },
    { id: "acquisition", label: "Acquisition", order: 2, intro: "Acquisition intro.", handoff: "Next, the report turns to quality." },
    { id: "quality", label: "Quality", order: 3, intro: "Quality intro.", handoff: "Next, the report turns to behavior." },
    { id: "behavior", label: "Behavior", order: 4, intro: "Behavior intro.", handoff: "Next, the report covers outcomes." },
    { id: "outcomes", label: "Outcomes", order: 5, intro: "Outcomes intro.", handoff: "Final stage; no further grouping." },
  ],
  narrative_stage_map: [
    { stage_kind: ["temporal_daily", "temporal_weekly", "time_series"], stage: "overview" },
    { stage_kind: "funnel", stage: "behavior" },
    { event: ["view_search_results", "scroll", "page_view", "first_visit", "session_start"], stage: "behavior" },
    { event: ["job_apply"], stage: "outcomes" },
    { metric: ["conversions", "eventCount"], stage: "outcomes" },
    { metric: ["engagementRate", "bounceRate", "averageSessionDuration"], stage: "quality" },
    { dimension: ["landingPage", "pagePath", "pageTitle"], stage: "acquisition" },
    { dimension: ["sessionSource", "sessionDefaultChannelGroup"], stage: "acquisition" },
    { dimension: ["deviceCategory", "country"], stage: "acquisition" },
    { stage_kind: ["kpi_strip", "kpi_card", "comparison_pair"], stage: "overview" },
  ],
  narrative_default_stage: "overview",
};

// Inline registry mirroring packages/registry-data/block-pattern.json, so the
// deterministic tests don't depend on file contents drifting.
const REG: DescribeRegistry = {
  description_templates: {
    kpi_card: "{label} is {value}.{delta_clause}",
    ranked_table:
      "Top {shown_count} of {total_available} {dimension} by {metric}; {top_label} leads with {top_value} ({top_share}).{delta_clause}",
  },
  delta_clauses: {
    higher: " {metric} is {delta_abs} higher than {vs_period} ({delta_pct}).",
    lower: " {metric} is {delta_abs} lower than {vs_period} ({delta_pct}).",
    unchanged: " {metric} is unchanged from {vs_period}.",
  },
};

describe("describeBlock — deterministic template fill", () => {
  it("fills a ranked_table template from description_facts (no delta)", () => {
    const block: DescribableBlock = {
      block_type: "ranked_table",
      description_facts: {
        shown_count: 10,
        total_available: 81,
        dimension: "sources",
        metric: "total users",
        top_label: "(direct)",
        top_value: "3,470",
        top_share: "37.3% of shown",
      },
    };
    expect(describeBlock(block, REG)).toBe(
      "Top 10 of 81 sources by total users; (direct) leads with 3,470 (37.3% of shown).",
    );
  });

  it("splices a neutral delta clause when a delta fact is present", () => {
    const block: DescribableBlock = {
      block_type: "kpi_card",
      description_facts: {
        label: "Engagement rate",
        value: "60.5%",
        delta: {
          direction: "lower",
          metric: "Engagement rate",
          delta_abs: "2.1 pts",
          delta_pct: "-3.4%",
          vs_period: "the prior 28 days",
        },
      },
    };
    expect(describeBlock(block, REG)).toBe(
      "Engagement rate is 60.5%. Engagement rate is 2.1 pts lower than the prior 28 days (-3.4%).",
    );
  });

  it("omits the delta slot entirely when there is no delta", () => {
    const block: DescribableBlock = {
      block_type: "kpi_card",
      description_facts: { label: "Sessions", value: "9,298" },
    };
    expect(describeBlock(block, REG)).toBe("Sessions is 9,298.");
  });

  it("throws MissingFactError when a placeholder is unfilled", () => {
    const block: DescribableBlock = {
      block_type: "ranked_table",
      description_facts: { shown_count: 10, total_available: 81 },
    };
    expect(() => describeBlock(block, REG)).toThrow(MissingFactError);
  });

  it("works with the real on-disk registry (default arg)", () => {
    const reg = loadDescribeRegistry();
    expect(reg.description_templates.ranked_table).toContain("{top_label}");
    const block: DescribableBlock = {
      block_type: "kpi_card",
      description_facts: { label: "Sessions", value: "9,298" },
    };
    expect(describeBlock(block)).toBe("Sessions is 9,298.");
  });

  it("its own output always passes the descriptive guard", () => {
    const block: DescribableBlock = {
      block_type: "kpi_card",
      description_facts: {
        label: "Sessions",
        value: "2,496",
        delta: {
          direction: "lower",
          metric: "Sessions",
          delta_abs: "842",
          delta_pct: "-25%",
          vs_period: "the prior week",
        },
      },
    };
    const out = describeBlock(block, REG);
    expect(() => assertDescriptive(out)).not.toThrow();
  });
});

describe("assertDescriptive — the guard", () => {
  it("passes neutral, figure-only text", () => {
    expect(() =>
      assertDescriptive(
        "Sessions were 2,496, 25% lower than the prior week; (direct) leads with 3,470.",
      ),
    ).not.toThrow();
  });

  it("rejects causation language", () => {
    expect(() => assertDescriptive("Sessions fell because of a bot surge.")).toThrow(
      DescriptiveViolationError,
    );
    expect(() => assertDescriptive("The drop was driven by paid search.")).toThrow(
      DescriptiveViolationError,
    );
  });

  it("rejects judgement / recommendation language", () => {
    expect(() => assertDescriptive("Engagement is strong this week.")).toThrow(
      DescriptiveViolationError,
    );
    expect(() => assertDescriptive("You should increase the budget.")).toThrow(
      DescriptiveViolationError,
    );
    expect(() => assertDescriptive("This is a good result.")).toThrow(
      DescriptiveViolationError,
    );
  });

  it("does not false-positive on factual comparatives or substrings", () => {
    // "higher"/"lower"/"drop"/"leads" are factual; "database" must not trip "bad".
    expect(() =>
      assertDescriptive("The biggest step drop is at view_search_results; the database held 81 rows."),
    ).not.toThrow();
  });
});

describe("describeBlockLLM — guarded LLM path", () => {
  const block: DescribableBlock = {
    block_type: "kpi_card",
    description_facts: { label: "Engagement rate", value: "60.5%" },
  };

  it("returns the model output when it is descriptive", async () => {
    const llm = async () => "Engagement rate is 60.5% over the period.";
    await expect(describeBlockLLM(block, llm, REG)).resolves.toBe(
      "Engagement rate is 60.5% over the period.",
    );
  });

  it("throws when the model drifts into causation", async () => {
    const llm = async () => "Engagement rate is 60.5%, down because of bot traffic.";
    await expect(describeBlockLLM(block, llm, REG)).rejects.toThrow(
      DescriptiveViolationError,
    );
  });

  it("falls back to the deterministic description when the model returns empty", async () => {
    const llm = async () => "";
    await expect(describeBlockLLM(block, llm, REG)).resolves.toBe(
      describeBlock(block, REG),
    );
  });
});

describe("a6 caption layer", () => {
  it("attaches block descriptions onto matching components as captions", () => {
    const vizSpec = {
      sections: [
        {
          components: [
            { component: "bar_chart_table_pair", block_ref: "sq_1_b_2" },
            { component: "kpi_strip", block_ref: "sq_1_b_1" },
          ],
        },
      ],
    };
    const out = attachCaptions(vizSpec, {
      sq_1_b_2: "Top 10 of 81 sources by total users; (direct) leads with 3,470.",
    });
    expect(out.sections[0].components[0].caption).toBe(
      "Top 10 of 81 sources by total users; (direct) leads with 3,470.",
    );
    // No description for sq_1_b_1 → no caption attached.
    expect(out.sections[0].components[1].caption).toBeUndefined();
  });

  it("builds a block_id → description map, skipping blocks without one", () => {
    const map = descriptionsByBlockId({
      sq_1: [
        { block_id: "sq_1_b_1", description: "Four summary figures." },
        { block_id: "sq_1_b_2" },
      ],
    });
    expect(map).toEqual({ sq_1_b_1: "Four summary figures." });
  });

  it("renders a caption as neutral body text with no status colour", () => {
    const html = renderCaptionHtml("Top 10 of 81 sources; (direct) leads with 3,470.");
    expect(html).toBe(
      '<p class="block-caption">Top 10 of 81 sources; (direct) leads with 3,470.</p>',
    );
    // Neutral: no evaluative colour / status hooks.
    expect(html).not.toMatch(/red|green|status|warn|danger|success|color/i);
  });

  it("escapes HTML and returns empty string for an empty caption", () => {
    expect(renderCaptionHtml('a < b & "c"')).toBe(
      '<p class="block-caption">a &lt; b &amp; &quot;c&quot;</p>',
    );
    expect(renderCaptionHtml("")).toBe("");
    expect(renderCaptionHtml(undefined)).toBe("");
  });
});

describe("assignNarrativeStage — first-match-wins map resolution", () => {
  it("stamps acquisition for a source-dimension block", () => {
    const block = { block_type: "ranked_table", dimension_fields: ["sessionSource"], metric_fields: ["totalUsers"] };
    expect(assignNarrativeStage(block, NARR)).toBe("acquisition");
    expect(block.narrative_stage).toBe("acquisition");
  });

  it("stamps behavior for a funnel block (stage_kind = block_type)", () => {
    const block = { block_type: "funnel", steps: [{ event_name: "session_start" }, { event_name: "view_search_results" }] };
    expect(assignNarrativeStage(block, NARR)).toBe("behavior");
  });

  it("stamps outcomes for a block whose event is job_apply (earlier than dimension rules)", () => {
    const block = { block_type: "ranked_table", dimension_fields: ["landingPage"], event_name: "job_apply" };
    // event:job_apply rule precedes the landingPage→acquisition rule, so first-match-wins → outcomes.
    expect(assignNarrativeStage(block, NARR)).toBe("outcomes");
  });

  it("stamps acquisition for a landingPage (entry-page) breakdown of a primitive count", () => {
    // entry/landing page → acquisition (no rate metric to send it to quality).
    expect(
      assignNarrativeStage({ block_type: "breakdown", dimension_field: "landingPage", metric_field: "sessions" }, NARR),
    ).toBe("acquisition");
  });

  it("stamps overview for any daily/temporal block, regardless of metric", () => {
    // daily/temporal → overview (the temporal rule precedes the metric rules).
    expect(
      assignNarrativeStage({ block_type: "time_series", metric_field: "engagementRate", dimension_field: "date" }, NARR),
    ).toBe("overview");
    expect(
      assignNarrativeStage({ block_type: "time_series", metric_field: "averageSessionDuration", dimension_field: "yearMonth" }, NARR),
    ).toBe("overview");
  });

  it("stamps quality for a composite-rate metric breakdown (non-temporal)", () => {
    // engagementRate / bounceRate by a dimension → quality (rate metric, not a temporal block).
    expect(
      assignNarrativeStage({ block_type: "breakdown", metric_field: "engagementRate", dimension_field: "deviceCategory" }, NARR),
    ).toBe("quality");
    expect(
      assignNarrativeStage({ block_type: "breakdown", metric_field: "bounceRate", dimension_field: "landingPage" }, NARR),
    ).toBe("quality");
  });

  it("stamps overview for a headline KPI card", () => {
    expect(assignNarrativeStage({ block_type: "kpi_card" }, NARR)).toBe("overview");
  });

  it("loads the real on-disk narrative config (5 funnel stages in order)", () => {
    const cfg = loadNarrativeConfig();
    expect(cfg.narrative_stages.map((s) => s.id)).toEqual([
      "overview", "acquisition", "quality", "behavior", "outcomes",
    ]);
    expect(cfg.narrative_default_stage).toBe("overview");
  });
});

describe("descriptive guard — cross-stage causal connectors (handoff framing)", () => {
  it("rejects cross-stage causal links in a handoff-style string", () => {
    expect(() => assertDescriptive("The acquisition drop feeds into the quality stage.")).toThrow(DescriptiveViolationError);
    expect(() => assertDescriptive("This stage drives the next.")).toThrow(DescriptiveViolationError);
    expect(() => assertDescriptive("which explains the behavior section")).toThrow(DescriptiveViolationError);
  });

  it("accepts neutral method-framing handoffs", () => {
    expect(() => assertDescriptive("Next, the report groups the detail by how traffic was acquired.")).not.toThrow();
    expect(() => assertDescriptive("Next, the report turns to engagement quality on the landing pages.")).not.toThrow();
  });

  it("every registry intro and handoff passes the descriptive guard", () => {
    const cfg = loadNarrativeConfig();
    for (const s of cfg.narrative_stages) {
      expect(() => assertDescriptive(s.intro)).not.toThrow();
      expect(() => assertDescriptive(s.handoff)).not.toThrow();
    }
  });
});

describe("A6 funnel-narrative grouping + render", () => {
  // A viz spec whose sections are deliberately OUT of funnel order.
  const vizSpec = {
    sections: [
      { section_id: "s_funnel", section_title: "Apply funnel", step_number: "Stage 3 (always) — Step 5 of 7",
        components: [{ component: "funnel_diagram", block_ref: "sq_1_b_5", narrative_stage: "behavior", caption: "4-step funnel." }] },
      { section_id: "s_kpi", section_title: "Headline", step_number: "Stage 1 (always) — Step 1 of 7",
        components: [{ component: "kpi_strip", block_ref: "sq_1_b_1", narrative_stage: "overview", caption: "Engagement rate is 60.5%." }] },
      { section_id: "s_chan", section_title: "By channel", step_number: "Stage 2 (always) — Step 2 of 7",
        components: [{ component: "bar_chart_table_pair", block_ref: "sq_1_b_2", narrative_stage: "acquisition", caption: "Sessions by channel." }] },
    ],
  };

  it("groups sections into registry order regardless of input order", () => {
    const groups = groupSectionsByNarrative(vizSpec, NARR);
    expect(groups.map((g) => g.stage.id)).toEqual(["overview", "acquisition", "behavior"]);
  });

  it("renders the stages in funnel order with bridging handoff captions, keeps block titles, drops step header", () => {
    const html = renderNarrativeReportHtml(vizSpec, NARR);

    // Stage headers appear in funnel order.
    const overviewAt = html.indexOf("Overview");
    const acqAt = html.indexOf("Acquisition");
    const behAt = html.indexOf("Behavior");
    expect(overviewAt).toBeGreaterThanOrEqual(0);
    expect(overviewAt).toBeLessThan(acqAt);
    expect(acqAt).toBeLessThan(behAt);

    // Block titles kept; per-block "Step X of 7" header dropped.
    expect(html).toContain("Headline");
    expect(html).toContain("Apply funnel");
    expect(html).not.toMatch(/Step \d+ of \d+/);
    expect(html).not.toContain("Stage 3 (always)");

    // Bridging captions between stages (overview→acquisition, acquisition→behavior),
    // but no handoff after the final present stage. Strings come from NARR's handoffs.
    expect(html).toContain("Next, the report groups by acquisition.");
    expect(html).toContain("Next, the report turns to quality.");
    expect(html).not.toContain("Next, the report covers outcomes."); // behavior is last present → no handoff
  });

  it("renders all five funnel stages in order with four bridging captions (scrambled input)", () => {
    // One section per stage, supplied OUT of funnel order.
    const scrambled = {
      sections: [
        { section_id: "s_out", section_title: "Applies", components: [{ component: "funnel_diagram", block_ref: "b5", narrative_stage: "outcomes", caption: "Applies." }] },
        { section_id: "s_beh", section_title: "Funnel", components: [{ component: "funnel_diagram", block_ref: "b4", narrative_stage: "behavior", caption: "Funnel." }] },
        { section_id: "s_ov", section_title: "Headline", components: [{ component: "kpi_strip", block_ref: "b1", narrative_stage: "overview", caption: "Headline." }] },
        { section_id: "s_qual", section_title: "By landing page", components: [{ component: "bar_chart_table_pair", block_ref: "b3", narrative_stage: "quality", caption: "By landing page." }] },
        { section_id: "s_acq", section_title: "By channel", components: [{ component: "bar_chart_table_pair", block_ref: "b2", narrative_stage: "acquisition", caption: "By channel." }] },
      ],
    };
    const groups = groupSectionsByNarrative(scrambled, NARR);
    expect(groups.map((g) => g.stage.id)).toEqual([
      "overview", "acquisition", "quality", "behavior", "outcomes",
    ]);

    const html = renderNarrativeReportHtml(scrambled, NARR);
    const order = ["Overview", "Acquisition", "Quality", "Behavior", "Outcomes"].map((l) => html.indexOf(`>${l}<`));
    expect(order).toEqual([...order].sort((a, b) => a - b)); // strictly increasing → funnel order
    expect(order.every((i) => i >= 0)).toBe(true);
    // Four bridging handoffs between the five stages; none after the last.
    expect((html.match(/class="stage-handoff"/g) ?? []).length).toBe(4);
    expect(html).not.toContain("Final stage; no further grouping."); // outcomes is last → its handoff is not rendered
  });

  it("carries narrative_stage from A5 blocks onto A6 components by block_ref", () => {
    const map = narrativeStageByBlockId({
      sq_1: [
        { block_id: "sq_1_b_1", narrative_stage: "overview" },
        { block_id: "sq_1_b_2", narrative_stage: "acquisition" },
      ],
    });
    const spec = { sections: [{ components: [{ component: "kpi_strip", block_ref: "sq_1_b_1" }] }] };
    attachNarrativeStages(spec, map);
    expect(spec.sections[0].components[0].narrative_stage).toBe("overview");
  });

  it("stage purity: every rendered section's blocks carry that section's narrative_stage", () => {
    const spec = {
      sections: [
        { section_id: "s_ov", section_title: "Headline", components: [{ component: "kpi_strip", block_ref: "b1", narrative_stage: "overview" }] },
        { section_id: "s_acq", section_title: "By channel", components: [{ component: "bar_chart_table_pair", block_ref: "b2", narrative_stage: "acquisition" }] },
        { section_id: "s_qual", section_title: "By device", components: [{ component: "bar_chart_table_pair", block_ref: "b3", narrative_stage: "quality" }] },
        { section_id: "s_beh", section_title: "Funnel", components: [{ component: "funnel_diagram", block_ref: "b4", narrative_stage: "behavior" }] },
        { section_id: "s_out", section_title: "Applies", components: [{ component: "funnel_diagram", block_ref: "b5", narrative_stage: "outcomes" }] },
      ],
    };
    const groups = groupSectionsByNarrative(spec, NARR);
    for (const group of groups) {
      for (const section of group.sections) {
        for (const c of section.components ?? []) {
          expect(c.narrative_stage).toBe(group.stage.id);
        }
      }
    }
  });
});

describe("metric-class-aware stage set", () => {
  it("classifies metrics from the ontology decomposition_kind", () => {
    expect(metricClassFromOntology("sessions")).toBe("primitive_count");
    expect(metricClassFromOntology("newUsers")).toBe("primitive_count");
    expect(metricClassFromOntology("totalUsers")).toBe("primitive_count");
    expect(metricClassFromOntology("bounceRate")).toBe("composite_rate");
    expect(metricClassFromOntology("engagementRate")).toBe("composite_rate");
    expect(metricClassFromOntology("averageSessionDuration")).toBe("composite_rate");
    expect(metricClassIncludesQuality("composite_rate")).toBe(true);
    expect(metricClassIncludesQuality("primitive_count")).toBe(false);
  });

  it("a primitive-count report omits the quality stage; a composite-rate report keeps it", () => {
    const spec = {
      sections: [
        { section_title: "Headline", components: [{ component: "kpi_strip", block_ref: "b1", narrative_stage: "overview" }] },
        { section_title: "By channel", components: [{ component: "bar_chart_table_pair", block_ref: "b2", narrative_stage: "acquisition" }] },
        { section_title: "Engagement by device", components: [{ component: "bar_chart_table_pair", block_ref: "b3", narrative_stage: "quality" }] },
      ],
    };
    const primitive = groupSectionsByNarrative(spec, NARR, { metricClass: "primitive_count" });
    expect(primitive.map((g) => g.stage.id)).not.toContain("quality");

    const composite = groupSectionsByNarrative(spec, NARR, { metricClass: "composite_rate" });
    expect(composite.map((g) => g.stage.id)).toContain("quality");
  });

  it("drops any stage with zero blocks (no quality section → no quality stage even for composite rate)", () => {
    const spec = {
      sections: [
        { section_title: "Headline", components: [{ component: "kpi_strip", block_ref: "b1", narrative_stage: "overview" }] },
        { section_title: "By channel", components: [{ component: "bar_chart_table_pair", block_ref: "b2", narrative_stage: "acquisition" }] },
      ],
    };
    const composite = groupSectionsByNarrative(spec, NARR, { metricClass: "composite_rate" });
    expect(composite.map((g) => g.stage.id)).toEqual(["overview", "acquisition"]);
  });
});
