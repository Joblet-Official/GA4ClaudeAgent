/**
 * SessionStore unit tests — InMemorySessionStore.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { InMemorySessionStore } from "../src/session-store.js";
import type { HaltedTurnState } from "../src/types.js";

function makeState(overrides: Partial<HaltedTurnState> = {}): HaltedTurnState {
  return {
    turn_id: "turn_test_1",
    session_id: "sess_1",
    halted_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    a1_intent: { report_type: "snapshot" },
    a2_plan: {},
    preapplied_defaults_pending: [],
    clarification: { question: "q?", decision_points: [], rationale: "r" },
    ...overrides,
  };
}

describe("InMemorySessionStore — halted turns", () => {
  let store: InMemorySessionStore;
  beforeEach(() => { store = new InMemorySessionStore(); });

  it("put then get returns the state", async () => {
    const state = makeState();
    await store.putHaltedTurn(state);
    const back = await store.getHaltedTurn(state.turn_id);
    expect(back).toEqual(state);
  });

  it("get returns null for unknown id", async () => {
    expect(await store.getHaltedTurn("nonexistent")).toBeNull();
  });

  it("get returns null and evicts an expired state", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const state = makeState({ expires_at: past });
    await store.putHaltedTurn(state);
    expect(await store.getHaltedTurn(state.turn_id)).toBeNull();
  });

  it("delete removes the state", async () => {
    const state = makeState();
    await store.putHaltedTurn(state);
    await store.deleteHaltedTurn(state.turn_id);
    expect(await store.getHaltedTurn(state.turn_id)).toBeNull();
  });
});

describe("InMemorySessionStore — resolved metrics (sticky carryover)", () => {
  let store: InMemorySessionStore;
  beforeEach(() => { store = new InMemorySessionStore(); });

  it("returns null when no resolution stored", async () => {
    expect(await store.getResolvedMetric("s1", "traffic")).toBeNull();
  });

  it("set then get returns the metric name (lower-cased lookup)", async () => {
    await store.setResolvedMetric("s1", "Traffic", "sessions");
    expect(await store.getResolvedMetric("s1", "TRAFFIC")).toBe("sessions");
    expect(await store.getResolvedMetric("s1", "traffic")).toBe("sessions");
  });

  it("isolates sessions from each other", async () => {
    await store.setResolvedMetric("s1", "traffic", "sessions");
    expect(await store.getResolvedMetric("s2", "traffic")).toBeNull();
  });
});
