# ga4-viz-platform

Phase 5 implementation of the agent-first GA4 visualisation platform. Implements the
contracts, orchestration spec, and tool boundaries from `../contracts/`.

## Layout

```
ga4-viz-platform/
├── package.json              workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json        shared TS config
├── packages/
│   ├── contracts/            schemas + codegen'd TS types
│   ├── registry-data/        the registry JSON files (catalog, defaults, etc.)
│   ├── tools/                10 tools from Phase 4 tool catalog
│   ├── orchestrator/         (Phase 5C, not yet present)
│   └── agents/               (Phase 5D, not yet present)
└── apps/
    └── web/                  (Phase 5E, not yet present)
```

## Quick start

```bash
# from this directory:
pnpm install            # install all workspace dependencies
pnpm codegen            # regenerate TypeScript types from JSON Schemas
pnpm test               # run all tests
```

## Phase 5 status

| Sub-phase | Status |
|---|---|
| 5B Tool layer | **In progress** — scaffold + catalog_reader fully implemented |
| 5C Orchestrator core | not started |
| 5D-stubs Agent stubs | not started |
| 5E Frontend | not started |
| 5D-LLM LLM-backed agents | not started |
| 5F Vercel deploy | not started |

## Workflow

1. **Schemas are the source of truth.** They live in `packages/contracts/schemas/`.
2. **Codegen** turns schemas into TypeScript types: `pnpm codegen`.
3. **Runtime validation** uses `ajv` against the same JSON Schemas.
4. **Tool layer** (`packages/tools/`) implements the 10 tools per Phase 4 permissions.

## Cross-reference with `../contracts/`

The `../contracts/` directory is the design-time source of truth. The TypeScript code
in this directory is its implementation. To verify the contracts themselves remain sound:

```bash
pnpm verify-contracts   # runs ../contracts/verify.py
```
