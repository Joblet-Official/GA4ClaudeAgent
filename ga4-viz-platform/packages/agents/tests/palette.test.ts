import { describe, it, expect } from "vitest";
import {
  assertPaletteAllowed,
  loadPaletteAllowlist,
  PaletteViolationError,
} from "../src/palette.js";
import { guardReportHtml } from "../src/a6.caption.js";

describe("loadPaletteAllowlist — from the viz registry", () => {
  it("includes the identity blue + greys + white, and knows the partial peach", () => {
    const { allowed, peach } = loadPaletteAllowlist();
    expect(allowed.has("#2e5c8a")).toBe(true); // identity blue (lower-cased)
    expect(allowed.has("#94a3b8")).toBe(true); // grey
    expect(allowed.has("#ffffff")).toBe(true); // neutral
    expect(allowed.has("transparent")).toBe(true);
    expect(peach).toBe("#fff3e0");
    // peach is NOT a generally-allowed colour
    expect(allowed.has("#fff3e0")).toBe(false);
  });
});

describe("assertPaletteAllowed — clean HTML passes", () => {
  it("accepts identity-palette fills and neutral text", () => {
    const html =
      `<style>.bar{fill:#2E5C8A}.muted{color:#6b7280}</style>` +
      `<svg><rect fill="#1f3f63"></rect><line stroke="#94a3b8"/></svg>` +
      `<p style="color:#1f2937">Sessions rose to 1,177.</p>`;
    expect(() => assertPaletteAllowed(html)).not.toThrow();
  });

  it("accepts peach ONLY on a .partial node (inline and CSS)", () => {
    const inline = `<rect class="partial-marker partial" fill="#fff3e0"></rect>`;
    expect(() => assertPaletteAllowed(inline)).not.toThrow();
    const css = `<style>.partial{background:#fff3e0}</style><div class="partial">May</div>`;
    expect(() => assertPaletteAllowed(css)).not.toThrow();
  });
});

describe("assertPaletteAllowed — violations throw", () => {
  it("throws when an editorial red is injected into an SVG fill (#b71c1c)", () => {
    const html = `<svg><rect fill="#b71c1c"></rect></svg>`;
    expect(() => assertPaletteAllowed(html)).toThrow(PaletteViolationError);
  });

  it("throws on a red in a CSS declaration", () => {
    const html = `<style>.bad{color:#d32f2f}</style>`;
    expect(() => assertPaletteAllowed(html)).toThrow(PaletteViolationError);
  });

  it("throws when peach appears on a NON-.partial node (inline)", () => {
    const html = `<rect class="bar" fill="#fff3e0"></rect>`;
    expect(() => assertPaletteAllowed(html)).toThrow(/non-\.partial/);
  });

  it("throws when peach appears under a NON-.partial CSS selector", () => {
    const html = `<style>.kpi-accent{background:#fff3e0}</style>`;
    expect(() => assertPaletteAllowed(html)).toThrow(/non-\.partial/);
  });
});

describe("guardReportHtml — combined A6 gate (palette + leak)", () => {
  it("passes clean report HTML and returns it unchanged", () => {
    const html =
      `<section class="narrative-stage"><h2 class="stage-header">Acquisition</h2>` +
      `<p class="block-caption">Sessions rose to 1,177 from 640.</p>` +
      `<svg><rect fill="#2E5C8A"></rect></svg></section>`;
    expect(guardReportHtml(html)).toBe(html);
  });

  it("throws on a palette violation", () => {
    expect(() => guardReportHtml(`<svg><rect fill="#b71c1c"/></svg>`)).toThrow(PaletteViolationError);
  });

  it("throws on a prompt-leak in visible text", () => {
    expect(() => guardReportHtml(`<p class="block-caption">execute: always — Step 4 of 11</p>`)).toThrow();
  });
});
