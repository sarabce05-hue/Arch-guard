import { describe, it, expect } from "vitest";
import { parsePack } from "../src";

const rule = () => ({
  id: "webhook-verify-signature",
  title: "Payment webhooks verify the signature first",
  severity: "error",
  status: "stable",
  why: "Unverified webhooks let anyone fake payment events.",
  fixHint: "Call constructEvent with the raw body before reading the event.",
  check: {
    type: "required-ast",
    language: "ts",
    paths: ["app/api/**/route.ts"],
    query: "(call_expression) @call",
  },
  fixtures: {
    pass: ["fixtures/webhook-verify-signature/pass"],
    fail: ["fixtures/webhook-verify-signature/fail"],
  },
});

const pack = () => ({
  id: "saas-baseline",
  version: "1.0.0",
  title: "SaaS baseline (Next.js, Postgres, Stripe)",
  applies: { anyOf: [{ dependency: "stripe" }] },
  rules: [rule()],
});

function errorsOf(input: unknown): string[] {
  const r = parsePack(input);
  if (r.ok) throw new Error("expected parsing to fail");
  return r.errors;
}

const hasError = (errors: string[], text: string) =>
  errors.some((e) => e.includes(text));

describe("parsePack", () => {
  it("accepts a valid pack", () => {
    expect(parsePack(pack()).ok).toBe(true);
  });

  it("applies defaults for severity, status and fixtures", () => {
    const { severity, status, fixtures, ...bare } = rule();
    void severity;
    void status;
    void fixtures;
    const r = parsePack({ ...pack(), rules: [bare] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rules[0].severity).toBe("error");
      expect(r.value.rules[0].status).toBe("experimental");
      expect(r.value.rules[0].fixtures).toEqual({ pass: [], fail: [] });
    }
  });

  it("rejects a version that is not MAJOR.MINOR.PATCH", () => {
    const errors = errorsOf({ ...pack(), version: "1.0" });
    expect(errors.some((e) => e.startsWith("version"))).toBe(true);
  });

  it("rejects a pack without rules", () => {
    const errors = errorsOf({ ...pack(), rules: [] });
    expect(errors.some((e) => e.startsWith("rules"))).toBe(true);
  });

  it("rejects duplicate rule ids", () => {
    const input = { ...pack(), rules: [rule(), rule()] };
    expect(hasError(errorsOf(input), "duplicate rule id")).toBe(true);
  });

  it("rejects a stable rule without fixtures", () => {
    const stable = { ...rule(), fixtures: { pass: [], fail: [] } };
    const errors = errorsOf({ ...pack(), rules: [stable] });
    expect(hasError(errors, "stable rules need pass and fail fixtures")).toBe(true);
  });

  it("rejects a stable rule with only pass fixtures", () => {
    const stable = {
      ...rule(),
      fixtures: { pass: ["fixtures/x/pass"], fail: [] },
    };
    const errors = errorsOf({ ...pack(), rules: [stable] });
    expect(hasError(errors, "stable rules need pass and fail fixtures")).toBe(true);
  });

  it("accepts an experimental rule without fixtures", () => {
    const experimental = {
      ...rule(),
      status: "experimental",
      fixtures: { pass: [], fail: [] },
    };
    expect(parsePack({ ...pack(), rules: [experimental] }).ok).toBe(true);
  });

  it("requires why and fixHint", () => {
    const { why, ...noWhy } = rule();
    void why;
    const { fixHint, ...noHint } = rule();
    void fixHint;
    expect(errorsOf({ ...pack(), rules: [noWhy] }).some((e) => e.includes("why"))).toBe(true);
    expect(errorsOf({ ...pack(), rules: [noHint] }).some((e) => e.includes("fixHint"))).toBe(true);
  });

  it("rejects an unknown check type", () => {
    const bad = { ...rule(), check: { type: "run-script", script: "rm -rf /" } };
    const errors = errorsOf({ ...pack(), rules: [bad] });
    expect(errors.some((e) => e.startsWith("rules.0.check"))).toBe(true);
  });

  it("rejects an invalid regular expression in a text-pattern check", () => {
    const bad = {
      ...rule(),
      check: {
        type: "text-pattern",
        paths: ["migrations/**/*.sql"],
        pattern: "(unclosed",
        mode: "forbid",
      },
    };
    const errors = errorsOf({ ...pack(), rules: [bad] });
    expect(hasError(errors, "invalid regular expression")).toBe(true);
  });

  it("accepts a valid text-pattern check", () => {
    const good = {
      ...rule(),
      check: {
        type: "text-pattern",
        paths: ["migrations/**/*.sql"],
        pattern: "DROP\\s+TABLE",
        mode: "forbid",
      },
    };
    expect(parsePack({ ...pack(), rules: [good] }).ok).toBe(true);
  });

  it("accepts a forbidden-ast check", () => {
    const good = {
      ...rule(),
      check: {
        type: "forbidden-ast",
        language: "tsx",
        paths: ["src/**/*.tsx"],
        query: "(call_expression) @call",
      },
    };
    expect(parsePack({ ...pack(), rules: [good] }).ok).toBe(true);
  });

  it("rejects an unsupported language in an AST check", () => {
    const bad = {
      ...rule(),
      check: {
        type: "forbidden-ast",
        language: "python",
        paths: ["src/**/*.py"],
        query: "(call) @c",
      },
    };
    const errors = errorsOf({ ...pack(), rules: [bad] });
    expect(errors.some((e) => e.startsWith("rules.0.check"))).toBe(true);
  });

  it("rejects a detector with neither dependency nor file", () => {
    const errors = errorsOf({ ...pack(), applies: { anyOf: [{}] } });
    expect(hasError(errors, "detector needs a dependency or a file")).toBe(true);
  });

  it("accepts a detector with a file glob", () => {
    const r = parsePack({ ...pack(), applies: { allOf: [{ file: "next.config.*" }] } });
    expect(r.ok).toBe(true);
  });

  it("rejects too-short why and fixHint text", () => {
    const bad = { ...rule(), why: "short", fixHint: "short" };
    const errors = errorsOf({ ...pack(), rules: [bad] });
    expect(errors.length).toBeGreaterThan(1);
  });

  it("rejects an invalid reference URL", () => {
    const bad = { ...rule(), references: ["not a url"] };
    const errors = errorsOf({ ...pack(), rules: [bad] });
    expect(errors.some((e) => e.startsWith("rules.0.references"))).toBe(true);
  });
});
