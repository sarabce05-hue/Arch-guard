# ARCHITECTURE.md

> Source of truth for how this project is built. AI agents: read this file and
> `.arch/constitution.yaml` before changing code. Follow the dependency rules
> in section 4 without exception.

## 1. Purpose

A neutral, tool-agnostic layer that keeps AI-built software coherent as it grows.

- Teams describe their project once in a **Constitution** (modules, boundaries, invariants, decisions).
- The system **emits** the instruction files each AI tool reads (AGENTS.md, CLAUDE.md, Cursor rules, replit.md).
- The system **verifies** every change (PR, hook, CLI) against the Constitution and reports violations.

It works with Claude Code, Cursor, Replit and any agent that pushes to Git.

## 2. Principles

1. **One source of truth.** The Constitution is the only authored artifact. Everything else is generated or checked against it.
2. **Deterministic verification.** The verifier never calls a network or an LLM. Same input, same output.
3. **LLMs propose, humans approve.** Anything an LLM produces (draft Constitution, invariants) is a proposal that is schema-validated and approved before it takes effect.
4. **Neutral by design.** No feature may depend on a specific AI vendor. Adapters are thin and replaceable.
5. **Source code stays local.** Analysis runs on the user's machine or CI. The cloud receives metadata (violations, graph summaries), not source.
6. **Dogfooding.** This repository obeys its own Constitution, checked in CI.

## 3. System overview

```
Constitution (.arch/constitution.yaml)
   |-- Emitters  --> AGENTS.md, CLAUDE.md, .cursor/rules/*.mdc, replit.md
   '-- Verifier  <-- Analyzer <-- code diff
          '-- Adapters: GitHub Check, CLI, Claude/Cursor hooks, MCP server
                  '-- (optional) Cloud: history, dashboard, scoreboard
```

Data flow for one check:

1. Adapter receives a trigger (PR opened, hook fired, CLI run).
2. Analyzer parses changed files and builds a dependency graph (modules, imports, exports).
3. Verifier evaluates the graph against the Constitution's rules and invariant checks.
4. Verifier returns a normalized `CheckReport` (section 7).
5. Adapter presents it (PR check, hook feedback to the agent, terminal output, MCP response).
6. If connected to Cloud, a metadata-only run record is stored.

## 4. Packages and dependency rules

| Package | Responsibility | May depend on |
|---|---|---|
| `spec` | Constitution + report schemas (Zod, JSON Schema export), types, versioning | nothing |
| `analyzer` | Parse TS/JS (tree-sitter), build module graph | `spec` |
| `verifier` | Evaluate rules and invariant checks, produce `CheckReport` | `spec` |
| `emitters` | Render Constitution into tool-specific instruction files | `spec` |
| `packs` | First-party Engineering Packs (declarative data + fixtures) and a pack validation script | `spec` |
| `intent` (closed) | LLM: natural language to proposed rules/invariants | `spec`, `verifier` |
| `cli` | `arch init / check / emit / explain` | `spec`, `analyzer`, `verifier`, `emitters` |
| `mcp-server` | Expose constraints and checks to agents over MCP | `spec`, `analyzer`, `verifier` |
| `github-app` (closed) | PR checks, comments | `spec`, `analyzer`, `verifier` |
| `api` (closed) | Cloud API, persistence | `spec` |
| `web` (closed) | Dashboard | `spec` (via `api`) |

**Hard rules (enforced by this repo's own Constitution):**

- `spec` imports nothing from other packages.
- `verifier` and `analyzer` never import network, filesystem-write, database or LLM modules.
- Only `intent` may call an LLM provider.
- Only `api` may access the database, through repository functions.
- Adapters (`cli`, `mcp-server`, `github-app`) contain no rule logic; they call `verifier`.
- No circular dependencies between packages.
- Engineering Packs are **declarative data only**. A pack may never contain executable code; the verifier interprets it.
- Open-source packages (`spec`, `analyzer`, `verifier`, `emitters`, `packs`, `cli`, `mcp-server`) must not import closed packages.

## 5. The Constitution

File: `.arch/constitution.yaml`. Schema: `packages/spec` (`constitution.ts`).

Sections:

- `modules`: named areas of the codebase (id, path globs, optional description).
- `rules`: structural rules between modules (`deny` or `allow` edges, `no-cycles`).
- `invariants`: statements that must always hold. Each has an `intent` (human text) and an optional `check` that makes it executable. An invariant without a `check` is advisory and is reported as `unverified`.
- `decisions`: short records (id, title, why, status, date).
- `packs`: Engineering Packs applied to this project, pinned by major version (e.g. `saas-baseline@1`). See 5.1.
- `overrides`: per-rule exceptions (`severity` change or `off`). Every override requires a written `reason`.

Versioning: `version` is an integer. Breaking schema changes bump it and ship a migration in `spec`.

### 5.1 Engineering Packs

Goal: encode the lessons experienced engineers learned the hard way (security, data integrity, reliability) as executable rules, so any AI agent is held to them automatically. A pack is a versioned bundle of rules for a stack or concern. Schema: `packages/spec` (`pack.ts`).

**Layout**

```
packs/saas-baseline/
  pack.yaml                  # manifest + rules (or rules/*.yaml)
  fixtures/<rule-id>/pass/   # code that must NOT trigger the rule
  fixtures/<rule-id>/fail/   # code that MUST trigger the rule
```

**Manifest example**

```yaml
id: saas-baseline
version: 1.0.0
title: SaaS baseline (Next.js, Postgres, Stripe)
applies:
  anyOf:
    - { dependency: stripe }
    - { dependency: "@supabase/supabase-js" }
rules:
  - id: webhook-verify-signature
    title: Payment webhooks verify the signature first
    severity: error
    status: stable
    why: >
      Unverified webhooks let anyone fake payment events.
    fixHint: >
      Call stripe.webhooks.constructEvent with the raw body before reading the event.
    check:
      type: required-ast
      language: ts
      paths: ["app/api/**/webhook*/route.ts"]
      query: '(call_expression function: (member_expression property: (property_identifier) @p (#eq? @p "constructEvent")))'
    fixtures:
      pass: ["fixtures/webhook-verify-signature/pass"]
      fail: ["fixtures/webhook-verify-signature/fail"]
```

**Check types (all declarative, interpreted by `verifier`)**

- `forbidden-ast`: a tree-sitter query that must have no match in the selected files.
- `required-ast`: a query that must match at least once in each selected file.
- `text-pattern`: regex with `forbid` or `require` mode, for non-code files (SQL migrations, env files, configs).

**Rules for rules (quality gates)**

1. Every rule has `why` and `fixHint`.
2. `stable` rules must ship pass and fail fixtures; CI runs them.
3. A rule becomes `stable` only after its measured false-positive rate on a corpus of real repos is acceptable. Until then it is `experimental` and reported as `warn`.
4. Rule ids are namespaced when used in reports and overrides: `saas-baseline/webhook-verify-signature`.
5. Rules are written in our own words. Do not copy text from third-party documents.

**Selection and use**

- `arch init` detects dependencies and proposes packs; the user approves.
- `arch check` loads the packs listed in the Constitution (the `cli` reads them from disk and passes parsed data to `verifier`).
- Violations from packs use the same `CheckReport` and include `why` so the output teaches, not just blocks.

**Community model**: the pack format and first-party packs are open. Third-party packs are data, so they can be reviewed and run safely. Distribution (registry or git references) is decided after V1.5.

## 6. Emitters

Input: Constitution. Output (all generated, never hand-edited, header says so):

- `AGENTS.md` (canonical cross-tool instructions)
- `CLAUDE.md` containing an import of `AGENTS.md` plus Claude-specific notes
- `.cursor/rules/*.mdc` (scoped by module globs)
- `replit.md`

Emitters are pure functions. Adding a new tool means adding one emitter.

## 7. Verifier output: `CheckReport`

```
CheckReport {
  constitutionVersion, analyzedFiles, durationMs,
  violations: Violation[],
  unverifiedInvariants: string[]
}
Violation {
  ruleId, severity (error|warn), message,
  file, line, from?, to?,
  fixHint,            // short, written for an AI agent to act on
  actor?              // optional metadata: tool, model (from PR author / commit trailer)
}
```

`fixHint` is a first-class field: agents use it to self-correct.

## 8. Adapters

- **GitHub Check (universal path):** all supported tools end at Git, so this works with Claude Code, Cursor and Replit without their cooperation.
- **CLI:** `arch check` for local and CI use; non-zero exit on errors.
- **Hooks:** Claude Code and Cursor hooks call `arch check` on changed files and return violations to the agent.
- **MCP server:** tools `get_constraints(path)`, `impact_analysis(files)`, `check_diff(diff)`.

Replit Agent is supported through Git/CI first; deeper integration only if/when a native extension point exists.

## 9. Intent compiler (V2, closed)

Natural language requirement to proposed invariant:

1. LLM drafts a rule/invariant as structured output.
2. Output is validated against the `spec` schema; failures retry (max 3).
3. The proposal is shown to the user with plain-language explanation and an example violation.
4. Only after explicit approval does it enter the Constitution (as a new version).

Start with three invariant families: data-access boundaries, layer boundaries, operation idempotency.

## 10. Cloud (V3, closed)

Stores only metadata. Core tables:

- `orgs`, `projects`, `users`
- `constitution_versions` (immutable, one row per version)
- `check_runs` (project, commit, constitutionVersion, tool, model, durationMs)
- `violations` (run, ruleId, severity, file, line)
- `decisions`

The scoreboard aggregates `check_runs` and `violations` by tool/model/rule. It is opt-in and anonymized across organizations.

## 11. Repository layout

```
packages/
  spec/ analyzer/ verifier/ emitters/ intent/ cli/ mcp-server/
packs/
  saas-baseline/ ...
apps/
  api/ web/ github-app/
.arch/
  constitution.yaml      # this repo's own Constitution
ARCHITECTURE.md
AGENTS.md  CLAUDE.md     # generated
```

Tooling: pnpm workspaces, TypeScript strict mode, Vitest, Zod, tree-sitter.

## 12. Open core boundary

- **Open (MIT/Apache-2.0):** `spec`, `analyzer`, `verifier`, `emitters`, `packs`, `cli`, `mcp-server`. Goal: make the Constitution format a shared standard.
- **Closed:** `intent`, `github-app`, `api`, `web`, scoreboard.

## 13. Roadmap

- **V1:** `spec`, `analyzer` (TS/JS only), `verifier`, `emitters`, `cli`, GitHub Action.
- **V1.5:** Engineering Packs (pack format, three check types, first pack `saas-baseline` with 15 to 20 rules for Next.js + Postgres/Supabase + Stripe); guided interview that produces a first Constitution for new projects.
- **V2:** `intent` compiler, MCP server, hooks.
- **V3:** Cloud, dashboard, scoreboard, team features.

V1 definition of done:
- `arch init` drafts a Constitution from an existing TS/JS repo.
- `arch emit` generates all four instruction files.
- `arch check` detects forbidden imports and circular dependencies with correct file/line.
- GitHub Action fails a PR on error-severity violations.
- This repo passes its own check in CI.

## 14. Decisions

| ID | Decision | Why |
|---|---|---|
| D1 | Constitution is YAML, schema in Zod | Readable by humans, validated by code |
| D2 | Verifier is deterministic, no LLM | Trust and reproducibility |
| D3 | Git/PR check is the universal integration | Works with every tool without permission |
| D4 | Open core | Standard adoption, monetize cloud and intent |
| D5 | TS/JS only in V1 | Matches most AI-built projects, limits scope |
| D6 | Source never leaves the user's environment | Adoption and security |
| D7 | Packs are declarative data, never code | Safe community contributions, reviewable, deterministic |
| D8 | Packs start narrow: one stack, 15 to 20 high-value rules | False positives are the main product risk |

## 15. Non-goals (V1)

- Generating application code.
- Replacing Claude Code, Cursor or Replit.
- Multi-language analysis.
- Agent orchestration (planner/implementer roles).

## 16. Testing strategy

- `spec`, `verifier`, `emitters`: unit tests with fixtures, snapshot tests for emitted files.
- `analyzer`: fixture repos with known graphs (including cycles and aliased imports).
- End-to-end: sample AI-built repos with seeded violations; assert exact reports.
- Track false-positive rate on real repos; it is the key quality metric.
