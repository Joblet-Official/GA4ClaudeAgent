/**
 * SessionStore — the orchestrator's only durable surface.
 *
 * Per Phase 3 ORCHESTRATION.md §8:
 *   - per-turn record (intent, plan, decision, …) keyed by turn_id
 *   - per-session record (turn list, resolved_metrics_by_user_term) keyed by session_id
 *   - halt TTL 24h, completed retention 30 days
 *
 * Phase 5C provides the interface + an InMemorySessionStore for dev/tests.
 * Phase 5F adds a Vercel KV implementation.
 */
import type { HaltedTurnState } from "./types.js";

export interface SessionStore {
  /** Persist a halted turn. Expires at halted_at + halt_ttl. */
  putHaltedTurn(state: HaltedTurnState): Promise<void>;

  /** Retrieve a halted turn by id. Returns null if not found or expired. */
  getHaltedTurn(turnId: string): Promise<HaltedTurnState | null>;

  /** Remove a halted turn (after successful resume). */
  deleteHaltedTurn(turnId: string): Promise<void>;

  /** Optional per-session sticky resolutions. Phase-1 finding fold-in. */
  getResolvedMetric(sessionId: string, userTerm: string): Promise<string | null>;
  setResolvedMetric(sessionId: string, userTerm: string, metricName: string): Promise<void>;
}

/**
 * In-memory store. Single-process, dev-only. Vercel KV in Phase 5F.
 */
export class InMemorySessionStore implements SessionStore {
  private halted = new Map<string, HaltedTurnState>();
  private resolvedMetrics = new Map<string, Map<string, string>>();

  async putHaltedTurn(state: HaltedTurnState): Promise<void> {
    this.halted.set(state.turn_id, state);
  }

  async getHaltedTurn(turnId: string): Promise<HaltedTurnState | null> {
    const state = this.halted.get(turnId);
    if (!state) return null;
    if (Date.parse(state.expires_at) < Date.now()) {
      this.halted.delete(turnId);
      return null;
    }
    return state;
  }

  async deleteHaltedTurn(turnId: string): Promise<void> {
    this.halted.delete(turnId);
  }

  async getResolvedMetric(sessionId: string, userTerm: string): Promise<string | null> {
    return this.resolvedMetrics.get(sessionId)?.get(userTerm.toLowerCase()) ?? null;
  }

  async setResolvedMetric(sessionId: string, userTerm: string, metricName: string): Promise<void> {
    let m = this.resolvedMetrics.get(sessionId);
    if (!m) {
      m = new Map();
      this.resolvedMetrics.set(sessionId, m);
    }
    m.set(userTerm.toLowerCase(), metricName);
  }
}
