import { describe, it, expect } from "vitest";
import { parseCheckReport } from "../src";

const violation = () => ({
  ruleId: "ui-no-db",
  severity: "error",
  message: "UI must not import from the database module",
  file: "src/ui/Profile.tsx",
  line: 3,
  from: "ui",
  to: "db",
  fixHint: "Call the domain layer instead of importing the database module.",
});

const report = () => ({
  constitutionVersion: 1,
  analyzedFiles: 12,
  durationMs: 35,
  violations: [violation()],
  unverifiedInvariants: ["tenant-isolation"],
});

function errorsOf(input: unknown): string[] {
  const r = parseCheckReport(input);
  if (r.ok) throw new Error("expected parsing to fail");
  return r.errors;
}

describe("parseCheckReport", () => {
  it("accepts a valid report", () => {
    expect(parseCheckReport(report()).ok).toBe(true);
  });

  it("accepts a report with no violations", () => {
    const r = parseCheckReport({ ...report(), violations: [], unverifiedInvariants: [] });
    expect(r.ok).toBe(true);
  });

  it("accepts a pack-namespaced rule id", () => {
    const v = { ...violation(), ruleId: "saas-baseline/webhook-verify-signature" };
    expect(parseCheckReport({ ...report(), violations: [v] }).ok).toBe(true);
  });

  it("accepts actor metadata (tool and model)", () => {
    const v = { ...violation(), actor: { tool: "cursor", model: "some-model" } };
    expect(parseCheckReport({ ...report(), violations: [v] }).ok).toBe(true);
  });

  it("rejects a rule id with two slashes", () => {
    const v = { ...violation(), ruleId: "a/b/c" };
    const errors = errorsOf({ ...report(), violations: [v] });
    expect(errors.some((e) => e.startsWith("violations.0.ruleId"))).toBe(true);
  });

  it("rejects a line number of zero", () => {
    const v = { ...violation(), line: 0 };
    const errors = errorsOf({ ...report(), violations: [v] });
    expect(errors.some((e) => e.startsWith("violations.0.line"))).toBe(true);
  });

  it("rejects a negative file count", () => {
    const errors = errorsOf({ ...report(), analyzedFiles: -1 });
    expect(errors.some((e) => e.startsWith("analyzedFiles"))).toBe(true);
  });

  it("rejects a violation without a fixHint", () => {
    const { fixHint, ...rest } = violation();
    void fixHint;
    const errors = errorsOf({ ...report(), violations: [rest] });
    expect(errors.some((e) => e.startsWith("violations.0.fixHint"))).toBe(true);
  });

  it("rejects an unknown severity", () => {
    const v = { ...violation(), severity: "fatal" };
    const errors = errorsOf({ ...report(), violations: [v] });
    expect(errors.some((e) => e.startsWith("violations.0.severity"))).toBe(true);
  });

  it("rejects an unsupported constitution version", () => {
    const errors = errorsOf({ ...report(), constitutionVersion: 2 });
    expect(errors.some((e) => e.startsWith("constitutionVersion"))).toBe(true);
  });
});
