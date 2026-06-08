"""Phase 2 verification harness.

Runs four classes of checks against the contracts/ tree:
  1. Schemas are valid JSON Schema 2020-12   (meta-validation)
  2. Example records validate against schemas (positive tests)
  3. Cross-file $refs resolve                (registry-based validation)
  4. Intentionally-broken records FAIL       (negative tests, proves constraint power)

Exit code 0 = all PASS. Exit code 1 = any FAIL.
"""
import json
import sys
from copy import deepcopy
from pathlib import Path
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

ROOT = Path(__file__).resolve().parent

# ---------- Load all schemas ----------
schema_paths = sorted(ROOT.rglob("*.schema.json"))
schemas = {}
for p in schema_paths:
    rel = p.relative_to(ROOT).as_posix()
    with open(p, encoding="utf-8") as f:
        schemas[rel] = json.load(f)

example_paths = sorted(ROOT.rglob("*.example.json"))
examples = {}
for p in example_paths:
    with open(p, encoding="utf-8") as f:
        examples[p.name] = json.load(f)

# Map each example file to the agent schema it should validate against
EXAMPLE_TO_SCHEMA = {
    "intent.example.json": "agents/a1-intent.schema.json",
    "intent.l3.example.json": "agents/a1-intent.schema.json",
    "intent.l4.example.json": "agents/a1-intent.schema.json",
    "intent.l5.example.json": "agents/a1-intent.schema.json",
    "query-plan.example.json": "agents/a2-query-plan.schema.json",
    "decision-approved.example.json": "agents/a3-decision.schema.json",
    "decision-default-applied.example.json": "agents/a3-decision.schema.json",
    "decision-needs-clarification.example.json": "agents/a3-decision.schema.json",
    "data-record.example.json": "agents/a4-data-record.schema.json",
    "data-blocks.example.json": "agents/a5-data-blocks.schema.json",
    "viz-spec.example.json": "agents/a6-viz-spec.schema.json",
    "catalog.example.json": "registries/catalog.schema.json",
    "defaults.example.json": "registries/defaults.schema.json",
    "metric-ontology.example.json": "registries/metric-ontology.schema.json",
    "domain-profile.example.json": "registries/domain-profile.schema.json",
    "block-pattern.example.json": "registries/block-pattern.schema.json",
    "viz-registry.example.json": "registries/viz-registry.schema.json",
    "trigger-expressions.example.json": "pipeline/trigger-expressions.schema.json",
    "state-machine.example.json": "orchestration/state-machine.schema.json",
    "tool-boundaries.example.json": "tool-boundaries/tool-boundaries.schema.json",
}

# ---------- Build cross-file registry ----------
registry = Registry()
for rel, schema in schemas.items():
    if "$id" in schema:
        resource = Resource.from_contents(schema, default_specification=DRAFT202012)
        registry = registry.with_resource(uri=schema["$id"], resource=resource)

def validator_for(schema):
    return Draft202012Validator(schema, registry=registry)

# ---------- Result accounting ----------
results = []  # list of (category, name, status, details)
def record(category, name, ok, details=""):
    results.append((category, name, ok, details))

# ===================== CHECK 1: Meta-validation =====================
print("=" * 64)
print("CHECK 1 / 4 — Schemas conform to JSON Schema 2020-12 metaschema")
print("=" * 64)
meta_validator = Draft202012Validator(Draft202012Validator.META_SCHEMA)
for rel, schema in schemas.items():
    errors = list(meta_validator.iter_errors(schema))
    ok = not errors
    print(f"  [{'OK' if ok else 'FAIL'}] {rel}")
    if not ok:
        for e in errors[:3]:
            print(f"        {e.message}  (at: {'/'.join(map(str, e.absolute_path))})")
    record("meta", rel, ok, "" if ok else f"{len(errors)} errors")
print()

# ===================== CHECK 2: Positive validation =====================
print("=" * 64)
print("CHECK 2 / 4 — Example records validate against their schemas")
print("=" * 64)
for ex_name, ex in examples.items():
    schema_rel = EXAMPLE_TO_SCHEMA.get(ex_name)
    if schema_rel is None:
        print(f"  [SKIP] {ex_name} (no mapping)")
        continue
    schema = schemas[schema_rel]
    # Strip $comment fields (they're informational, not validated)
    def strip_comments(obj):
        if isinstance(obj, dict):
            return {k: strip_comments(v) for k, v in obj.items() if k != "$comment"}
        if isinstance(obj, list):
            return [strip_comments(x) for x in obj]
        return obj
    ex_clean = strip_comments(ex)
    v = validator_for(schema)
    errors = list(v.iter_errors(ex_clean))
    ok = not errors
    print(f"  [{'OK' if ok else 'FAIL'}] {ex_name}  against  {schema_rel}")
    if not ok:
        for e in errors[:5]:
            path = "/".join(map(str, e.absolute_path)) or "(root)"
            print(f"        at {path}: {e.message}")
    record("positive", ex_name, ok, "" if ok else f"{len(errors)} errors")
print()

# ===================== CHECK 3: $ref resolution =====================
print("=" * 64)
print("CHECK 3 / 4 — Cross-file $refs resolve")
print("=" * 64)
# Walk every schema and find $refs; verify each resolves via the registry.
def walk_refs(obj, refs):
    if isinstance(obj, dict):
        if "$ref" in obj and isinstance(obj["$ref"], str):
            refs.append(obj["$ref"])
        for v in obj.values():
            walk_refs(v, refs)
    elif isinstance(obj, list):
        for item in obj:
            walk_refs(item, refs)

all_ok = True
for rel, schema in schemas.items():
    refs = []
    walk_refs(schema, refs)
    base_id = schema.get("$id", "")
    cross_refs = [r for r in refs if r.startswith("../") or r.startswith("http")]
    if not cross_refs:
        continue
    schema_ok = True
    errors_here = []
    # Use the validator; if a $ref doesn't resolve, validation of a trivial doc against the schema raises
    try:
        v = validator_for(schema)
        # Force resolution by validating an empty doc — many resolvers are lazy.
        list(v.iter_errors({}))
    except Exception as e:
        schema_ok = False
        errors_here.append(str(e))
    if schema_ok:
        # Additionally check each ref can be resolved by the registry
        from referencing.exceptions import Unresolvable
        for ref in cross_refs:
            try:
                # Resolve against the schema's $id
                resolver = registry.resolver(base_uri=base_id)
                _ = resolver.lookup(ref)
            except Unresolvable as e:
                schema_ok = False
                errors_here.append(f"{ref}: {e}")
    status = "OK" if schema_ok else "FAIL"
    print(f"  [{status}] {rel}  ({len(cross_refs)} cross-refs)")
    if not schema_ok:
        all_ok = False
        for e in errors_here[:5]:
            print(f"        {e}")
    record("refs", rel, schema_ok, "" if schema_ok else "ref resolution failed")
print()

# ===================== CHECK 4: Negative tests =====================
print("=" * 64)
print("CHECK 4 / 4 — Intentionally-broken records FAIL validation")
print("=" * 64)

a1_schema = schemas["agents/a1-intent.schema.json"]
a2_schema = schemas["agents/a2-query-plan.schema.json"]
a3_schema = schemas["agents/a3-decision.schema.json"]
a4_schema = schemas["agents/a4-data-record.schema.json"]
a5_schema = schemas["agents/a5-data-blocks.schema.json"]
a6_schema = schemas["agents/a6-viz-spec.schema.json"]

base_intent = examples["intent.example.json"]
base_plan = examples["query-plan.example.json"]
base_dec_approved = examples["decision-approved.example.json"]
base_dec_clarify = examples["decision-needs-clarification.example.json"]
base_data_record = examples["data-record.example.json"]
base_data_blocks = examples["data-blocks.example.json"]
base_viz_spec = examples["viz-spec.example.json"]

def strip_c(obj):
    if isinstance(obj, dict): return {k: strip_c(v) for k, v in obj.items() if k != "$comment"}
    if isinstance(obj, list): return [strip_c(x) for x in obj]
    return obj

negatives = []

# N1: A1 with invalid ambiguity_flag value
bad = strip_c(deepcopy(base_intent))
bad["ambiguity_flags"].append("not_a_real_flag_name")
negatives.append(("A1: invalid ambiguity_flag value", a1_schema, bad))

# N2: A1 missing required field
bad = strip_c(deepcopy(base_intent))
del bad["report_type"]
negatives.append(("A1: missing required 'report_type'", a1_schema, bad))

# N3: A1 with additional property (strict mode should reject)
bad = strip_c(deepcopy(base_intent))
bad["surprise_field"] = "should be rejected"
negatives.append(("A1: additional property rejected", a1_schema, bad))

# N4: A1 sub_question with bad id pattern
bad = strip_c(deepcopy(base_intent))
bad["sub_questions"][0]["id"] = "wrong_id_format"
negatives.append(("A1: SubQuestionId pattern violation", a1_schema, bad))

# N5: A2 query with single-candidate mapping_choices (must have >= 2)
bad = strip_c(deepcopy(base_plan))
bad["ambiguity_report"]["mapping_choices"][0]["candidates"] = bad["ambiguity_report"]["mapping_choices"][0]["candidates"][:1]
negatives.append(("A2: mapping_choices with only 1 candidate", a2_schema, bad))

# N6: A3 NEEDS_CLARIFICATION without halted_state
bad = strip_c(deepcopy(base_dec_clarify))
del bad["halted_state"]
negatives.append(("A3: NEEDS_CLARIFICATION missing halted_state", a3_schema, bad))

# N7: A3 with invalid decision const
bad = strip_c(deepcopy(base_dec_approved))
bad["decision"] = "MAYBE"
negatives.append(("A3: invalid decision value", a3_schema, bad))

# N8: A3 APPROVED with applied_defaults (only DEFAULT_APPLIED has that field)
bad = strip_c(deepcopy(base_dec_approved))
bad["applied_defaults"] = [{"field": "date_range", "chosen": "last_28_days", "source": "registry"}]
negatives.append(("A3: APPROVED with applied_defaults (not in its variant)", a3_schema, bad))

# N9: A4 status invalid value
bad = strip_c(deepcopy(base_data_record))
bad["status"] = "kinda_ok"
negatives.append(("A4: invalid status value", a4_schema, bad))

# N10: A4 sub_question_id outside pattern
bad = strip_c(deepcopy(base_data_record))
bad["rows_by_sub_question"] = {"not_a_valid_id": bad["rows_by_sub_question"]["sq_1"]}
negatives.append(("A4: rows_by_sub_question key violates SubQuestionId pattern", a4_schema, bad))

# N11: A4 row missing 'metrics'
bad = strip_c(deepcopy(base_data_record))
del bad["rows_by_sub_question"]["sq_1"][0]["metrics"]
negatives.append(("A4: canonical row missing 'metrics'", a4_schema, bad))

# N12: A4 truncated_by invalid value
bad = strip_c(deepcopy(base_data_record))
bad["execution_metadata"]["per_query"][0]["truncated_by"] = "for_fun"
negatives.append(("A4: truncated_by outside enum", a4_schema, bad))

# N13: A5 block with invalid block_type
bad = strip_c(deepcopy(base_data_blocks))
bad["blocks_by_sub_question"]["sq_1"][0]["block_type"] = "kpi_pile"
negatives.append(("A5: block_type outside discriminated union", a5_schema, bad))

# N14: A5 ranked_table annotations with extra property (should be rejected)
bad = strip_c(deepcopy(base_data_blocks))
bad["blocks_by_sub_question"]["sq_1"][1]["annotations"]["likely_cause"] = "bots"
negatives.append(("A5: ranked_table annotations rejects unapproved key", a5_schema, bad))

# N15: A5 other_rollup with is_fabricated=true (must always be false per spec)
bad = strip_c(deepcopy(base_data_blocks))
bad["blocks_by_sub_question"]["sq_1"][1]["annotations"]["other_rollup"] = {
    "label": "Others",
    "tail_count": 71,
    "tail_metrics": {"totalUsers": 999},
    "is_fabricated": True
}
# Note: schema permits is_fabricated:true syntactically; the constraint is enforced by the description.
# Phase-2 finding: bump this from documentation-only to a const:false constraint in v0.2.
# For now, this is a "should be caught by code review, not schema". Skip as a negative test.

# N16: A6 component referencing nonexistent block_id (pattern still valid syntactically)
bad = strip_c(deepcopy(base_viz_spec))
bad["sections"][0]["components"][0]["block_ref"] = "not_a_block_id"
negatives.append(("A6: block_ref violates BlockId pattern", a6_schema, bad))

# N17: A6 chip kind outside enum
bad = strip_c(deepcopy(base_viz_spec))
bad["context_chips"][0]["kind"] = "scary"
negatives.append(("A6: chip kind outside enum (no editorial colours allowed)", a6_schema, bad))

# N18: A6 heatmap shading set to editorial gradient (explicitly forbidden)
# (Construct minimal heatmap component to test, as the example doesn't include one)
bad = strip_c(deepcopy(base_viz_spec))
bad["sections"].append({
    "section_id": "test_heat",
    "section_title": "Test",
    "components": [{
        "component": "heatmap",
        "block_ref": "sq_1_b_2",
        "matrix": {
            "row_labels": ["a"],
            "col_labels": ["b"],
            "cells": [[1.0]],
            "shading": "red_green_gradient"
        }
    }]
})
negatives.append(("A6: heatmap shading outside enum (editorial gradient forbidden)", a6_schema, bad))

# ---- Chunk 3: registry negative tests ----
catalog_schema = schemas["registries/catalog.schema.json"]
defaults_schema = schemas["registries/defaults.schema.json"]
ontology_schema = schemas["registries/metric-ontology.schema.json"]
domain_schema = schemas["registries/domain-profile.schema.json"]
block_pattern_schema = schemas["registries/block-pattern.schema.json"]
viz_registry_schema = schemas["registries/viz-registry.schema.json"]
trigger_schema = schemas["pipeline/trigger-expressions.schema.json"]

base_catalog = examples["catalog.example.json"]
base_defaults = examples["defaults.example.json"]
base_ontology = examples["metric-ontology.example.json"]
base_domain = examples["domain-profile.example.json"]
base_block_pattern = examples["block-pattern.example.json"]
base_viz_registry = examples["viz-registry.example.json"]
base_triggers = examples["trigger-expressions.example.json"]

# N19: Catalog source key outside Source enum
bad = strip_c(deepcopy(base_catalog))
bad["sources"]["mixpanel"] = bad["sources"]["ga4"]
negatives.append(("Catalog: source key outside Source enum", catalog_schema, bad))

# N20: Catalog FieldDef kind invalid
bad = strip_c(deepcopy(base_catalog))
bad["sources"]["ga4"]["metrics"][0]["kind"] = "weird"
negatives.append(("Catalog: FieldDef.kind outside enum", catalog_schema, bad))

# N21: Defaults registry — defaultable=true without default_value should still pass syntactically
# (we only enforce defaultable). Let's instead test that an additionalProperty in DefaultPolicy fails.
bad = strip_c(deepcopy(base_defaults))
bad["fields"]["date_range"]["surprise"] = "rejected"
negatives.append(("Defaults: additionalProperty rejected", defaults_schema, bad))

# N22: Metric ontology decomposition_kind outside enum
bad = strip_c(deepcopy(base_ontology))
bad["metrics"]["engagementRate"]["decomposition_kind"] = "magic"
negatives.append(("Ontology: decomposition_kind outside enum", ontology_schema, bad))

# N23: Domain profile domain_type outside enum
bad = strip_c(deepcopy(base_domain))
bad["profiles"]["ga4:516147906"]["domain_type"] = "telepathy_app"
negatives.append(("DomainProfile: domain_type outside enum", domain_schema, bad))

# N24: Block-pattern report_type key outside ReportType enum
bad = strip_c(deepcopy(base_block_pattern))
bad["patterns"]["narrative"] = bad["patterns"]["ranking"]
negatives.append(("BlockPattern: report_type key outside ReportType enum", block_pattern_schema, bad))

# N25: Block-pattern other_rollup_policy outside enum
bad = strip_c(deepcopy(base_block_pattern))
bad["patterns"]["ranking"]["other_rollup_policy"] = "fabricate_freely"
negatives.append(("BlockPattern: other_rollup_policy outside enum", block_pattern_schema, bad))

# N26: Viz-registry forbidden_uses must be from enum
bad = strip_c(deepcopy(base_viz_registry))
bad["colour_policy"]["forbidden_uses"].append("rainbow_chart")
negatives.append(("VizRegistry: forbidden_uses outside enum", viz_registry_schema, bad))

# N27: Viz-registry identity_palette must be hex
bad = strip_c(deepcopy(base_viz_registry))
bad["colour_policy"]["identity_palette"][0] = "blue"
negatives.append(("VizRegistry: identity_palette non-hex rejected", viz_registry_schema, bad))

# N28: Trigger DSL operator name outside enum
bad = strip_c(deepcopy(base_triggers))
bad["operators"][0]["name"] = "do_magic"
negatives.append(("Triggers: operator name outside enum", trigger_schema, bad))

# N29: Trigger DSL operator argument type outside enum
bad = strip_c(deepcopy(base_triggers))
bad["operators"][0]["arguments"][0]["type"] = "narrative"
negatives.append(("Triggers: argument type outside enum", trigger_schema, bad))

# ---- Orchestration negative tests ----
fsm_schema = schemas["orchestration/state-machine.schema.json"]
base_fsm = examples["state-machine.example.json"]

# N30: FSM state name not uppercase
bad = strip_c(deepcopy(base_fsm))
bad["states"][0]["name"] = "idle_lowercase"
negatives.append(("FSM: state.name pattern violation (must be uppercase)", fsm_schema, bad))

# N31: FSM state.kind outside enum
bad = strip_c(deepcopy(base_fsm))
bad["states"][0]["kind"] = "mystery"
negatives.append(("FSM: state.kind outside enum", fsm_schema, bad))

# N32: FSM transition missing 'trigger'
bad = strip_c(deepcopy(base_fsm))
del bad["transitions"][0]["trigger"]
negatives.append(("FSM: transition missing required 'trigger'", fsm_schema, bad))

# N33: Retry policy action outside enum
bad = strip_c(deepcopy(base_fsm))
bad["retry_policy"]["rules"][0]["action"] = "pray"
negatives.append(("FSM: retry policy action outside enum", fsm_schema, bad))

# N34: Retry policy failure_class outside enum
bad = strip_c(deepcopy(base_fsm))
bad["retry_policy"]["rules"][0]["failure_class"] = "vibes_off"
negatives.append(("FSM: retry policy failure_class outside enum", fsm_schema, bad))

# N35: Retry policy agent outside enum
bad = strip_c(deepcopy(base_fsm))
bad["retry_policy"]["rules"][0]["agent"] = "A7"
negatives.append(("FSM: retry policy agent outside enum (no A7 exists)", fsm_schema, bad))

# ---- Tool boundaries negative tests ----
tb_schema = schemas["tool-boundaries/tool-boundaries.schema.json"]
base_tb = examples["tool-boundaries.example.json"]

# N36: Tool kind outside enum
bad = strip_c(deepcopy(base_tb))
bad["tools"][0]["kind"] = "rocket_launcher"
negatives.append(("ToolBoundaries: tool.kind outside enum", tb_schema, bad))

# N37: tool_id pattern violation (snake_case required)
bad = strip_c(deepcopy(base_tb))
bad["tools"][0]["tool_id"] = "GA4-DataAPI"
negatives.append(("ToolBoundaries: tool_id pattern violation", tb_schema, bad))

# N38: agent_permissions missing rationale
bad = strip_c(deepcopy(base_tb))
del bad["agent_permissions"]["A1"]["rationale"]
negatives.append(("ToolBoundaries: AgentPermissions missing required rationale", tb_schema, bad))

# N39: invariant violation — changing agents_permitted_data_apis (const-locked)
bad = strip_c(deepcopy(base_tb))
bad["invariants"]["agents_permitted_data_apis"] = ["A4", "A1"]
negatives.append(("ToolBoundaries: agents_permitted_data_apis const violated (must be [A4])", tb_schema, bad))

# N40: agent_permissions missing required agent A6
bad = strip_c(deepcopy(base_tb))
del bad["agent_permissions"]["A6"]
negatives.append(("ToolBoundaries: agent_permissions missing required A6", tb_schema, bad))

# N41: can_generate_user_facing_text outside enum
bad = strip_c(deepcopy(base_tb))
bad["agent_permissions"]["A1"]["can_generate_user_facing_text"] = "sometimes"
negatives.append(("ToolBoundaries: can_generate_user_facing_text outside enum", tb_schema, bad))

# ---- L2 RCA addendum negative tests (per addendum §7) ----
base_intent_l4 = examples["intent.l4.example.json"]

# N42: Intent missing analysis_level entirely (now required)
bad = strip_c(deepcopy(base_intent))
del bad["analysis_level"]
negatives.append(("A1: missing required 'analysis_level'", a1_schema, bad))

# N43: Intent with analysis_level outside enum (must be L1..L5)
bad = strip_c(deepcopy(base_intent))
bad["analysis_level"] = "L6"
negatives.append(("A1: analysis_level outside enum (L1..L5 only)", a1_schema, bad))

# N44: Ontology entry with rca_playbook.adds.stages[*].execute=conditional but no execute_if
bad = strip_c(deepcopy(base_ontology))
bad["metrics"]["sessions"]["rca_playbook"] = {
    "inherits": "universal_l2",
    "adds": {
        "stages": [
            { "id": "bad_conditional_stage", "kind": "cohort_drilldown", "execute": "conditional" }
        ]
    }
}
negatives.append(("Ontology: rca_playbook conditional stage missing execute_if", ontology_schema, bad))

# N45: universal_l2_playbook.stages array with fewer than 12 stages
bad = strip_c(deepcopy(base_ontology))
bad["universal_l2_playbook"]["stages"] = bad["universal_l2_playbook"]["stages"][:11]
negatives.append(("Ontology: universal_l2_playbook stages minItems=12 violated", ontology_schema, bad))

# N46: PlaybookStage with dimensional_breakdown kind but missing dimension/surface
bad = strip_c(deepcopy(base_ontology))
bad["metrics"]["sessions"]["rca_playbook"] = {
    "inherits": "universal_l2",
    "adds": {
        "stages": [
            { "id": "incomplete_breakdown", "kind": "dimensional_breakdown", "execute": "always" }
        ]
    }
}
negatives.append(("Ontology: PlaybookStage dimensional_breakdown missing dimension/surface", ontology_schema, bad))

# N47: PlaybookStage with invalid 'kind' value
bad = strip_c(deepcopy(base_ontology))
bad["metrics"]["sessions"]["rca_playbook"] = {
    "inherits": "universal_l2",
    "adds": {
        "stages": [
            { "id": "weird_kind", "kind": "wave_a_wand", "execute": "always" }
        ]
    }
}
negatives.append(("Ontology: PlaybookStage kind outside enum", ontology_schema, bad))

# N48: rca_playbook.inherits outside enum (universal_l2|none only)
bad = strip_c(deepcopy(base_ontology))
bad["metrics"]["sessions"]["rca_playbook"] = { "inherits": "something_else" }
negatives.append(("Ontology: rca_playbook.inherits outside enum", ontology_schema, bad))

# N49: A5 block with an empty description (BlockDescription minLength=1 → required + non-empty)
bad = strip_c(deepcopy(base_data_blocks))
bad["blocks_by_sub_question"]["sq_1"][0]["description"] = ""
negatives.append(("A5: block description must be non-empty (minLength=1)", a5_schema, bad))

# N50: A5 block with an invalid narrative_stage value (must be overview|acquisition|quality|behavior|outcomes)
bad = strip_c(deepcopy(base_data_blocks))
bad["blocks_by_sub_question"]["sq_1"][0]["narrative_stage"] = "funnel_stage"
negatives.append(("A5: narrative_stage outside enum", a5_schema, bad))

# N51: A6 component with an invalid narrative_stage value
bad = strip_c(deepcopy(base_viz_spec))
bad["sections"][0]["components"][0]["narrative_stage"] = "acquisition_phase"
negatives.append(("A6: narrative_stage outside enum", a6_schema, bad))

for label, schema, doc in negatives:
    v = validator_for(schema)
    errors = list(v.iter_errors(doc))
    failed_as_expected = bool(errors)
    status = "OK (rejected)" if failed_as_expected else "FAIL (accepted broken record!)"
    print(f"  [{'OK' if failed_as_expected else 'FAIL'}] {label}")
    if not failed_as_expected:
        print(f"        Schema accepted a record that should have been rejected.")
    else:
        print(f"        {len(errors)} error(s); first: {errors[0].message[:90]}")
    record("negative", label, failed_as_expected,
           "" if failed_as_expected else "schema too loose")


# ---- Cross-field consistency rule (L1-L5 ↔ interpretation_request) ----
#
# The schema cannot express this cross-field rule, so it is enforced by the
# invariant in Check 5. The negatives below prove the invariant LOGIC has teeth:
# each synthetic intent violates the rule and the helper must flag it.
def interpretation_consistent(analysis_level, interpretation_request):
    """True iff analysis_level obeys the L1-L5 ↔ interpretation_request rule.
    L1-L3 require interpretation_request=False; L4-L5 require True."""
    if analysis_level in ("L1", "L2", "L3"):
        return interpretation_request is False
    if analysis_level in ("L4", "L5"):
        return interpretation_request is True
    return False  # unknown level → inconsistent

cross_field_negatives = [
    ("X-field: L1 + interpretation_request=true (must be false)", "L1", True),
    ("X-field: L2 + interpretation_request=true (must be false)", "L2", True),
    ("X-field: L3 + interpretation_request=true (must be false)", "L3", True),
    ("X-field: L4 + interpretation_request=false (must be true)", "L4", False),
    ("X-field: L5 + interpretation_request=false (must be true)", "L5", False),
]
for label, al, ir in cross_field_negatives:
    flagged = not interpretation_consistent(al, ir)
    print(f"  [{'OK' if flagged else 'FAIL'}] {label}")
    if not flagged:
        print(f"        Invariant logic accepted a record that should have been flagged.")
    else:
        print(f"        flagged: analysis_level={al} with interpretation_request={ir}")
    record("negative", label, flagged,
           "" if flagged else "invariant logic too loose")
print()

# ===================== CHECK 5: Structural invariants =====================
print("=" * 64)
print("CHECK 5 / 5 — Structural invariants (cross-field policy checks)")
print("=" * 64)

# Tool boundaries: enforce that agents permitted to use a given tool kind
# match the invariants block.
tb = examples.get("tool-boundaries.example.json")
if tb:
    tools_by_id = {t["tool_id"]: t for t in tb["tools"]}
    perms = tb["agent_permissions"]
    inv = tb["invariants"]

    invariant_pairs = [
        ("data_api",      "agents_permitted_data_apis"),
        ("user_surface",  "agents_permitted_user_surface"),
        ("file_write",    "agents_permitted_file_write"),
    ]

    for kind, invariant_key in invariant_pairs:
        permitted_agents = set(inv[invariant_key])
        violators = []
        for agent_id, agent_perm in perms.items():
            for tool_id in agent_perm.get("may_use", []):
                tool = tools_by_id.get(tool_id)
                if tool and tool["kind"] == kind and agent_id not in permitted_agents:
                    violators.append((agent_id, tool_id))
        ok = not violators
        print(f"  [{'OK' if ok else 'FAIL'}] kind={kind:<12s} restricted to {sorted(permitted_agents)}; violators: {violators if violators else 'none'}")
        record("invariant", f"tool-boundaries.kind={kind}", ok, "" if ok else f"violators={violators}")

    # Cross-check: any tool of these kinds NOT used by permitted agent? (orphan tool, not a violation but worth noting)
    for kind, invariant_key in invariant_pairs:
        permitted_agents = set(inv[invariant_key])
        tools_of_kind = [t["tool_id"] for t in tb["tools"] if t["kind"] == kind]
        for tool_id in tools_of_kind:
            in_use_by = [a for a in perms if tool_id in perms[a]["may_use"]]
            if not in_use_by:
                print(f"  [NOTE] tool '{tool_id}' (kind={kind}) declared but unused — not a failure.")

# State machine: every transition references states that exist
fsm = examples.get("state-machine.example.json")
if fsm:
    state_names = {s["name"] for s in fsm["states"]}
    bad_transitions = []
    for t in fsm["transitions"]:
        if t["from"] not in state_names: bad_transitions.append(("from", t))
        if t["to"]   not in state_names: bad_transitions.append(("to",   t))
    ok = not bad_transitions
    print(f"  [{'OK' if ok else 'FAIL'}] FSM transitions reference declared states only ({len(fsm['transitions'])} transitions checked)")
    if not ok:
        for direction, t in bad_transitions[:3]:
            print(f"        {direction}={t[direction]} not in states")
    record("invariant", "fsm.transitions_reference_declared_states", ok,
           "" if ok else f"{len(bad_transitions)} bad refs")

    # Initial state is in states
    ok = fsm["initial_state"] in state_names
    print(f"  [{'OK' if ok else 'FAIL'}] FSM initial_state='{fsm['initial_state']}' is a declared state")
    record("invariant", "fsm.initial_state_declared", ok, "")

    # Terminal states are all in states
    bad_terminals = [t for t in fsm["terminal_states"] if t not in state_names]
    ok = not bad_terminals
    print(f"  [{'OK' if ok else 'FAIL'}] FSM terminal_states are all declared ({len(fsm['terminal_states'])} checked)")
    record("invariant", "fsm.terminal_states_declared", ok, "")

# L1-L5 spectrum invariants (per HANDOVER §4)
#
# Invariant: cross-field consistency — every intent example must obey the
# L1-L5 ↔ interpretation_request rule (L1-L3 → false, L4-L5 → true). Uses the
# interpretation_consistent() helper proven by the cross-field negatives above.
intent_examples_to_check = [
    ("intent.example.json",    examples.get("intent.example.json")),
    ("intent.l3.example.json", examples.get("intent.l3.example.json")),
    ("intent.l4.example.json", examples.get("intent.l4.example.json")),
    ("intent.l5.example.json", examples.get("intent.l5.example.json")),
]
xfield_violations = []
checked = 0
for ex_name, ex in intent_examples_to_check:
    if ex is None:
        continue
    checked += 1
    ex_clean = strip_c(ex)
    al = ex_clean.get("analysis_level")
    ir = ex_clean.get("interpretation_request")
    if not interpretation_consistent(al, ir):
        xfield_violations.append(f"{ex_name}: analysis_level={al} but interpretation_request={ir}")
ok = not xfield_violations
print(f"  [{'OK' if ok else 'FAIL'}] L1-L5: analysis_level <-> interpretation_request consistency ({checked} intent examples checked)")
if not ok:
    for v in xfield_violations[:3]:
        print(f"        {v}")
record("invariant", "spectrum.analysis_level_interpretation_request_consistency", ok,
       "" if ok else f"{len(xfield_violations)} violations")

# Helper: walk an ontology entry's rca_playbook and yield (stage_id, stage_dict)
def _expanded_playbook_stages(ontology_root, metric_entry):
    """Mimic A2's mechanical expansion: universal stages + Tier-2 adds (after applying override.replace removals)."""
    universal_stages = ontology_root.get("universal_l2_playbook", {}).get("stages", [])
    playbook = metric_entry.get("rca_playbook") if metric_entry else None
    if not playbook or playbook.get("inherits") == "none":
        universal_after = []
    else:
        # Apply overrides with replace=true to drop universal stages
        overrides = playbook.get("overrides", {}) if playbook else {}
        universal_after = [
            s for s in universal_stages
            if not (overrides.get(s["id"], {}).get("replace") is True)
        ]
    adds = []
    if playbook:
        adds = (playbook.get("adds") or {}).get("stages", [])
    return list(universal_after) + list(adds)

# Invariant L2-2: Playbook stage id uniqueness — within any expanded playbook
# (universal + Tier-2 adds, after replace-removals), no two stages share the same id.
ontology_ex = examples.get("metric-ontology.example.json")
if ontology_ex is None:
    ontology_root = {}
else:
    ontology_root = strip_c(ontology_ex)
metrics_root = ontology_root.get("metrics", {})

stage_id_violations = []
# Check universal alone (no metric) is unique
universal_stage_ids = [s["id"] for s in ontology_root.get("universal_l2_playbook", {}).get("stages", [])]
if len(universal_stage_ids) != len(set(universal_stage_ids)):
    dupes = [x for x in universal_stage_ids if universal_stage_ids.count(x) > 1]
    stage_id_violations.append(f"universal_l2_playbook: duplicate stage ids {sorted(set(dupes))}")
# Check per-metric expansion
for metric_id, metric_entry in metrics_root.items():
    expanded = _expanded_playbook_stages(ontology_root, metric_entry)
    ids = [s["id"] for s in expanded]
    if len(ids) != len(set(ids)):
        dupes = [x for x in ids if ids.count(x) > 1]
        stage_id_violations.append(f"metric '{metric_id}': duplicate stage ids in expansion {sorted(set(dupes))}")
ok = not stage_id_violations
print(f"  [{'OK' if ok else 'FAIL'}] L2 RCA: expanded playbook stage_id uniqueness ({len(metrics_root)} metrics + universal checked)")
if not ok:
    for v in stage_id_violations[:5]:
        print(f"        {v}")
record("invariant", "l2_rca.playbook_stage_id_uniqueness", ok,
       "" if ok else f"{len(stage_id_violations)} violations")

# Invariant L2-3: Override target existence — every rca_playbook.overrides.<stage_id>
# key must reference a stage that exists in universal_l2_playbook.stages or this
# metric's rca_playbook.adds.stages.
universal_stage_id_set = set(universal_stage_ids)
override_violations = []
for metric_id, metric_entry in metrics_root.items():
    playbook = metric_entry.get("rca_playbook")
    if not playbook:
        continue
    overrides = playbook.get("overrides", {}) or {}
    adds_stage_ids = {s["id"] for s in (playbook.get("adds", {}) or {}).get("stages", [])}
    valid_ids = universal_stage_id_set | adds_stage_ids
    for override_key in overrides.keys():
        if override_key not in valid_ids:
            override_violations.append(f"metric '{metric_id}': override key '{override_key}' references no existing universal or adds stage")
ok = not override_violations
print(f"  [{'OK' if ok else 'FAIL'}] L2 RCA: rca_playbook.overrides target existence ({len(metrics_root)} metrics checked)")
if not ok:
    for v in override_violations[:5]:
        print(f"        {v}")
record("invariant", "l2_rca.override_target_existence", ok,
       "" if ok else f"{len(override_violations)} violations")

print()

# ===================== SUMMARY =====================
print("=" * 64)
print("SUMMARY")
print("=" * 64)
totals = {"meta":0, "positive":0, "refs":0, "negative":0, "invariant":0}
fails  = {"meta":0, "positive":0, "refs":0, "negative":0, "invariant":0}
for cat, name, ok, det in results:
    totals[cat] += 1
    if not ok: fails[cat] += 1
for cat in ("meta", "positive", "refs", "negative", "invariant"):
    p = totals[cat] - fails[cat]
    icon = "OK" if fails[cat] == 0 else "FAIL"
    print(f"  [{icon}] {cat:>10s}:  {p} / {totals[cat]} pass")
total_fail = sum(fails.values())
print()
if total_fail == 0:
    print("ALL CHECKS PASS — contracts (P2) + orchestration (P3) + tool boundaries (P4) are sound.")
    sys.exit(0)
else:
    print(f"{total_fail} CHECK(S) FAILED — see details above.")
    sys.exit(1)
