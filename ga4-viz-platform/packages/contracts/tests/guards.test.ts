import { describe, it, expect } from "vitest";
import {
  assertNoPromptLeak,
  assertNoPromptLeakInValue,
  assertNoPromptLeakInHtml,
  collectVisibleText,
  visibleTextFromHtml,
  PromptLeakError,
} from "../src/guards.js";

describe("assertNoPromptLeak — clean text passes", () => {
  it("accepts a neutral caption", () => {
    expect(() =>
      assertNoPromptLeak("Organic Search sessions were 1,177, higher than the prior month's 640."),
    ).not.toThrow();
  });
  it("accepts empty / undefined text", () => {
    expect(() => assertNoPromptLeak("")).not.toThrow();
    expect(() => assertNoPromptLeak(undefined as unknown as string)).not.toThrow();
  });
});

describe("assertNoPromptLeak — identity / role leaks throw", () => {
  it("throws on the visualisation-agent identity + I-will-now leak", () => {
    expect(() =>
      assertNoPromptLeak("You are the visualisation agent; I will now render the report."),
    ).toThrow(PromptLeakError);
  });
  it("throws on 'as an AI' / 'language model' / 'system prompt'", () => {
    expect(() => assertNoPromptLeak("As an AI language model, here is the data.")).toThrow(PromptLeakError);
    expect(() => assertNoPromptLeak("Per my instructions in the system prompt.")).toThrow(PromptLeakError);
  });
});

describe("assertNoPromptLeak — chain-of-thought leaks throw", () => {
  it("throws on let-me / reasoning / step-by-step", () => {
    expect(() => assertNoPromptLeak("Let me work through this step-by-step.")).toThrow(PromptLeakError);
    expect(() => assertNoPromptLeak("Reasoning: first, I will localise the drop.")).toThrow(PromptLeakError);
  });
});

describe("assertNoPromptLeak — orchestration / spec internals throw", () => {
  it("throws on 'Step N of M'", () => {
    expect(() => assertNoPromptLeak("Apply funnel — Step 4 of 11")).toThrow(PromptLeakError);
  });
  it("throws on 'execute:' and '(always)'", () => {
    expect(() => assertNoPromptLeak("execute: always")).toThrow(PromptLeakError);
    expect(() => assertNoPromptLeak("Stage 3 (always) — Step 5 of 7")).toThrow(PromptLeakError);
  });
  it("throws on spec phrasing leaks", () => {
    expect(() => assertNoPromptLeak("the symmetric difference is 7")).toThrow(PromptLeakError);
    expect(() => assertNoPromptLeak("the >=5 condition is met")).toThrow(PromptLeakError);
    expect(() => assertNoPromptLeak("Trigger: Ran by default")).toThrow(PromptLeakError);
    expect(() => assertNoPromptLeak("marker event view_search_results")).toThrow(PromptLeakError);
  });
});

describe("assertNoPromptLeak — internal identifiers throw", () => {
  it("throws on agent ids and brain/tool/registry names", () => {
    expect(() => assertNoPromptLeak("Output from A5 to A6")).toThrow(PromptLeakError);
    expect(() => assertNoPromptLeak("see agent 6 for details")).toThrow(PromptLeakError);
    expect(() => assertNoPromptLeak("written by html_file_writer")).toThrow(PromptLeakError);
    expect(() => assertNoPromptLeak("resolved via narrative_stage_map")).toThrow(PromptLeakError);
    expect(() => assertNoPromptLeak("section sec_funnel rendered")).toThrow(PromptLeakError);
  });
});

describe("collectVisibleText — scans visible-text keys only, not ids/slugs", () => {
  it("collects caption/description/label but NOT id/class/execute values", () => {
    const value = {
      section_id: "sec_funnel",
      narrative_stage: "behavior",
      execute: "always",
      components: [
        { component: "kpi_strip", block_ref: "sq_1_b_1", caption: "Sessions were 1,177." },
        { component: "funnel_diagram", block_ref: "sq_1_b_2", label: "Apply funnel" },
      ],
      description: "Top entry pages by sessions.",
    };
    const text = collectVisibleText(value);
    expect(text).toContain("Sessions were 1,177.");
    expect(text).toContain("Apply funnel");
    expect(text).toContain("Top entry pages by sessions.");
    expect(text).not.toContain("sec_funnel");
    expect(text).not.toContain("always");
    expect(() => assertNoPromptLeakInValue(value)).not.toThrow();
  });

  it("throws when a leak hides in a caption", () => {
    const value = {
      section_id: "sec_overview",
      components: [{ caption: "You are the visualisation agent; I will now render." }],
    };
    expect(() => assertNoPromptLeakInValue(value, "A6")).toThrow(PromptLeakError);
  });

  it("throws when a step-index / execute leak hides in a step_number eyebrow", () => {
    const value = { sections: [{ step_number: "Stage 3 (always) — Step 4 of 11", section_title: "Apply funnel" }] };
    expect(() => assertNoPromptLeakInValue(value)).toThrow(PromptLeakError);
  });
});

describe("visibleTextFromHtml — text nodes only, attributes excluded", () => {
  it("ignores id/class attributes and style blocks; scans text nodes", () => {
    const html =
      `<style>.sec_funnel{fill:#2E5C8A}</style>` +
      `<section class="sec_funnel" data-stage="behavior" id="sec_x">` +
      `<h2 class="stage-header">Behavior</h2>` +
      `<p class="block-caption">Sessions rose to 1,177.</p></section>`;
    const text = visibleTextFromHtml(html);
    expect(text).toBe("Behavior Sessions rose to 1,177.");
    expect(() => assertNoPromptLeakInHtml(html)).not.toThrow();
  });

  it("throws on a leak in a visible text node", () => {
    const html = `<p class="block-caption">execute: always — Step 4 of 11</p>`;
    expect(() => assertNoPromptLeakInHtml(html, "A6")).toThrow(PromptLeakError);
  });
});
