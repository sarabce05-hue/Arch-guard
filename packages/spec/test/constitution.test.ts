import { describe, it, expect } from "vitest";
import { parseConstitution } from "../src";

const base = () => ({
  version: 1,
  modules: [
    { id: "ui", path: "src/ui" },
    { id: "db", path: ["src/db", "src/data"] },
  ],
  rules: [{ type: "deny", id: "ui-no-db", from: "ui", to: "db" }],
  invariants: [
    { id: "tenant-isolation", intent: "Users never read another tenant's data" },
  ],
  decisions: [
    { id: "use-postgres", title: "Use Postgres", why: "Relational data fits" },
  ],
});

function errorsOf(input: unknown): string[] {
  const r = parseConstitution(input);
  if (r.ok) throw new Error("expected parsing to fail");
  return r.errors;
}

const hasError = (errors: string[], text: string) =>
  errors.some((e) => e.includes(text));

describe("parseConstitution", () => {
  it("accepts a valid constitution", () => {
    const r = parseConstitution(base());
    expect(r.ok).toBe(true);
  });

  it("applies defaults", () => {
    const r = parseConstitution(base());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rules[0].severity).toBe("error");
      expect(r.value.decisions[0].status).toBe("accepted");
      expect(r.value.packs).toEqual([]);
      expect(r.value.overrides).toEqual([]);
    }
  });

  it("accepts a minimal constitution", () => {
    const r = parseConstitution({
      version: 1,
      modules: [{ id: "app", path: "src" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rules).toEqual([]);
      expect(r.value.invariants).toEqual([]);
    }
  });

  it("rejects an unsupported version", () => {
    const errors = errorsOf({ ...base(), version: 2 });
    expect(errors.some((e) => e.startsWith("version"))).toBe(true);
  });

  it("rejects input that is not an object, with a root path", () => {
    const errors = errorsOf("nope");
    expect(errors[0].startsWith("(root)")).toBe(true);
  });

  it("rejects an empty module list", () => {
    const errors = errorsOf({ ...base(), modules: [] });
    expect(errors.some((e) => e.startsWith("modules"))).toBe(true);
  });

  it("rejects duplicate module ids", () => {
    const input = base();
    input.modules.push({ id: "ui", path: "src/ui2" });
    expect(hasError(errorsOf(input), "duplicate module id: ui")).toBe(true);
  });

  it("rejects duplicate rule ids", () => {
    const input = base();
    input.rules.push({ type: "deny", id: "ui-no-db", from: "db", to: "ui" });
    expect(hasError(errorsOf(input), "duplicate rule id: ui-no-db")).toBe(true);
  });

  it("rejects a rule that references an unknown module", () => {
    const input = base();
    input.rules = [{ type: "deny", id: "ui-no-cache", from: "ui", to: "cache" }];
    expect(hasError(errorsOf(input), 'unknown module "cache"')).toBe(true);
  });

  it("rejects an allow-only rule with an unknown module in mayImport", () => {
    const input = {
      ...base(),
      rules: [
        { type: "allow-only", id: "ui-deps", module: "ui", mayImport: ["ghost"] },
      ],
    };
    expect(hasError(errorsOf(input), 'unknown module "ghost"')).toBe(true);
  });

  it("rejects an invariant that references an unknown rule", () => {
    const input = {
      ...base(),
      invariants: [
        {
          id: "no-db-from-ui",
          intent: "The UI never talks to the database directly",
          check: { type: "rule-ref", ruleIds: ["nope"] },
        },
      ],
    };
    expect(hasError(errorsOf(input), 'unknown rule "nope"')).toBe(true);
  });

  it("accepts an invariant that references an existing rule", () => {
    const input = {
      ...base(),
      invariants: [
        {
          id: "no-db-from-ui",
          intent: "The UI never talks to the database directly",
          check: { type: "rule-ref", ruleIds: ["ui-no-db"] },
        },
      ],
    };
    expect(parseConstitution(input).ok).toBe(true);
  });

  it("rejects ids that are not lowercase-dash, with the path in the message", () => {
    const input = base();
    input.modules[0] = { id: "UI", path: "src/ui" };
    const errors = errorsOf(input);
    expect(errors.some((e) => e.startsWith("modules.0.id"))).toBe(true);
  });

  it("reports the path of a missing field", () => {
    const input = {
      ...base(),
      rules: [{ type: "deny", id: "broken", from: "ui" }],
    };
    const errors = errorsOf(input);
    expect(errors.some((e) => e.startsWith("rules.0"))).toBe(true);
  });

  it("rejects an invariant whose intent is too short", () => {
    const input = {
      ...base(),
      invariants: [{ id: "short", intent: "no" }],
    };
    expect(errorsOf(input).some((e) => e.startsWith("invariants.0"))).toBe(true);
  });

  describe("packs", () => {
    it("accepts packs pinned by major version", () => {
      const r = parseConstitution({ ...base(), packs: ["saas-baseline@1"] });
      expect(r.ok).toBe(true);
    });

    it("rejects a pack without a version", () => {
      const errors = errorsOf({ ...base(), packs: ["saas-baseline"] });
      expect(errors.some((e) => e.startsWith("packs.0"))).toBe(true);
    });

    it("rejects a pack pinned to a full version", () => {
      const errors = errorsOf({ ...base(), packs: ["saas-baseline@1.2.0"] });
      expect(errors.some((e) => e.startsWith("packs.0"))).toBe(true);
    });
  });

  describe("overrides", () => {
    const override = {
      ruleId: "saas-baseline/webhook-verify-signature",
      off: true,
      reason: "We do not accept payment webhooks yet",
    };

    it("accepts an override with a reason", () => {
      const r = parseConstitution({ ...base(), overrides: [override] });
      expect(r.ok).toBe(true);
    });

    it("accepts a severity-only override", () => {
      const r = parseConstitution({
        ...base(),
        overrides: [
          {
            ruleId: "saas-baseline/webhook-verify-signature",
            severity: "warn",
            reason: "Downgraded during migration",
          },
        ],
      });
      expect(r.ok).toBe(true);
    });

    it("rejects an override without a reason", () => {
      const { reason, ...rest } = override;
      void reason;
      const errors = errorsOf({ ...base(), overrides: [rest] });
      expect(errors.some((e) => e.startsWith("overrides.0"))).toBe(true);
    });

    it("rejects an override with a too-short reason", () => {
      const errors = errorsOf({
        ...base(),
        overrides: [{ ...override, reason: "meh" }],
      });
      expect(errors.some((e) => e.startsWith("overrides.0"))).toBe(true);
    });

    it("rejects an override that neither turns the rule off nor sets a severity", () => {
      const errors = errorsOf({
        ...base(),
        overrides: [
          {
            ruleId: "saas-baseline/webhook-verify-signature",
            reason: "Written reason but no effect",
          },
        ],
      });
      expect(hasError(errors, "needs `off: true` or a `severity`")).toBe(true);
    });

    it("rejects an override rule id without a pack namespace", () => {
      const errors = errorsOf({
        ...base(),
        overrides: [{ ...override, ruleId: "webhook-verify-signature" }],
      });
      expect(errors.some((e) => e.startsWith("overrides.0.ruleId"))).toBe(true);
    });
  });
});
