import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { parseConstitution } from "../src";

// Tests run from packages/spec, so the repo root is two levels up.
const file = resolve(process.cwd(), "../../.arch/constitution.yaml");

function load() {
  const r = parseConstitution(parse(readFileSync(file, "utf8")));
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.value;
}

describe("this repository's own constitution", () => {
  it("is valid", () => {
    const c = load();
    expect(c.modules.length).toBeGreaterThan(0);
  });

  it("declares every package from ARCHITECTURE.md section 4", () => {
    const ids = load().modules.map((m) => m.id);
    for (const id of [
      "spec",
      "analyzer",
      "verifier",
      "emitters",
      "packs",
      "intent",
      "cli",
      "mcp-server",
      "github-app",
      "api",
      "web",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("forbids spec from importing any other module", () => {
    const rule = load().rules.find((r) => r.id === "spec-imports-nothing");
    expect(rule?.type).toBe("allow-only");
    if (rule?.type === "allow-only") {
      expect(rule.mayImport).toEqual([]);
    }
  });

  it("forbids module cycles", () => {
    const rule = load().rules.find((r) => r.type === "no-cycles");
    expect(rule?.type).toBe("no-cycles");
  });

  it("makes the open-never-imports-closed invariant executable", () => {
    const inv = load().invariants.find((i) => i.id === "open-never-imports-closed");
    expect(inv?.check?.type).toBe("rule-ref");
  });
});
