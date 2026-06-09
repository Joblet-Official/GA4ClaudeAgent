/**
 * Local, network-independent test for the escalation layer.
 *
 *   npx tsx scripts/test_escalation.ts
 *
 * Validates classifyFailure() routing and withEscalation()'s one-shot Flash->Pro
 * behaviour. No DeepSeek calls — pure logic, runnable anywhere.
 */
import { classifyFailure, withEscalation } from "@/lib/escalate";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}  ${detail}`); }
}

// --- classifyFailure: escalate cases ---
check("timeout -> escalate", classifyFailure(new Error("Request timed out")).klass === "escalate");
check("empty -> escalate", classifyFailure(new Error("Brain 1: empty response from LLM")).klass === "escalate");
check("json parse -> escalate", classifyFailure(new Error("not valid JSON: x")).klass === "escalate");
check("invalid structured output -> escalate", classifyFailure(new Error("invalid structured output")).klass === "escalate");
const ve = new Error("Brain 1 failed schema validation twice"); ve.name = "BrainValidationError";
check("typed ValidationError -> escalate", classifyFailure(ve).klass === "escalate");

// --- classifyFailure: surface cases ---
check("401 -> surface", classifyFailure({ status: 401, message: "x" }).klass === "surface");
check("429 -> surface", classifyFailure({ status: 429, message: "x" }).klass === "surface");
check("5xx -> surface", classifyFailure({ status: 503, message: "x" }).klass === "surface");
check("missing env -> surface", classifyFailure(new Error("GA4_PROPERTY_ID is not set")).klass === "surface");
check("credentials -> surface", classifyFailure(new Error("invalid credential")).klass === "surface");
check("ga4 data -> surface", classifyFailure(new Error("GA4 runReport failed: ...")).klass === "surface");
check("connection error -> surface", classifyFailure(new Error("Connection error.")).klass === "surface");
check("unknown -> surface", classifyFailure(new Error("something weird happened")).klass === "surface");

async function main() {
  // --- withEscalation: escalatable failure retries on fallback ---
  const r1 = await withEscalation<string>(
    async () => { throw new Error("Request timed out"); },
    async () => "pro",
  );
  check("escalatable -> uses fallback", r1.usedFallback === true && r1.value === "pro");

  // --- withEscalation: surface failure is rethrown (no fallback) ---
  let surfaced = false;
  try {
    await withEscalation<string>(
      async () => { throw new Error("invalid credential"); },
      async () => { throw new Error("fallback should not run"); },
    );
  } catch (e) {
    surfaced = (e as Error).message.includes("credential");
  }
  check("surface -> rethrown, no fallback", surfaced);

  // --- withEscalation: success on primary, no fallback ---
  const r3 = await withEscalation<string>(async () => "flash", async () => "pro");
  check("primary success -> no fallback", r3.usedFallback === false && r3.value === "flash");

  // --- withEscalation: downstream-validation failure escalates ---
  const r4 = await withEscalation<string>(
    async () => "flash",
    async () => "pro",
    { validate: (v) => { if (v === "flash") throw new Error("downstream validation failed"); } },
  );
  check("validate-fail on primary -> escalates", r4.usedFallback === true && r4.value === "pro");

  console.log(`\nRESULT: ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
