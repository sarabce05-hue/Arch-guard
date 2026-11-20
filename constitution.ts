// packages/spec/src/constitution.ts
// Schema for .arch/constitution.yaml (version 1). Depends on nothing but zod.
import { z } from "zod";

const id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes");

export const ModuleSchema = z.object({
  id,
  path: z.union([z.string(), z.array(z.string()).min(1)]),
  description: z.string().optional(),
});

export const RuleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("deny"),
    id,
    from: id,
    to: id,
    message: z.string().optional(),
    severity: z.enum(["error", "warn"]).default("error"),
  }),
  z.object({
    type: z.literal("allow-only"),
    id,
    module: id,
    mayImport: z.array(id),
    severity: z.enum(["error", "warn"]).default("error"),
  }),
  z.object({
    type: z.literal("no-cycles"),
    id,
    scope: z.enum(["modules", "files"]).default("modules"),
    severity: z.enum(["error", "warn"]).default("error"),
  }),
]);

// An invariant is a human-readable guarantee. `check` makes it executable.
// Without `check` it is advisory and reported as "unverified".
export const InvariantSchema = z.object({
  id,
  intent: z.string().min(10),
  check: z
    .discriminatedUnion("type", [
      z.object({
        type: z.literal("rule-ref"),
        ruleIds: z.array(id).min(1),
      }),
      z.object({
        type: z.literal("forbidden-pattern"),
        paths: z.array(z.string()).min(1),
        pattern: z.string(),
        message: z.string(),
      }),
    ])
    .optional(),
});

export const DecisionSchema = z.object({
  id,
  title: z.string(),
  why: z.string(),
  status: z.enum(["accepted", "superseded", "proposed"]).default("accepted"),
  date: z.string().optional(), // ISO date
});

// Per-rule exception. A written reason is mandatory.
export const OverrideSchema = z
  .object({
    ruleId: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/, "use pack-id/rule-id"),
    severity: z.enum(["error", "warn"]).optional(),
    off: z.boolean().optional(),
    reason: z.string().min(10),
  })
  .refine((o) => o.off === true || o.severity !== undefined, {
    message: "override needs `off: true` or a `severity`",
  });

export const ConstitutionSchema = z
  .object({
    version: z.literal(1),
    modules: z.array(ModuleSchema).min(1),
    rules: z.array(RuleSchema).default([]),
    invariants: z.array(InvariantSchema).default([]),
    decisions: z.array(DecisionSchema).default([]),
    // Engineering Packs, pinned by major version, e.g. "saas-baseline@1".
    packs: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]*@\d+$/)).default([]),
    overrides: z.array(OverrideSchema).default([]),
  })
  .superRefine((c, ctx) => {
    const moduleIds = new Set(c.modules.map((m) => m.id));
    const ruleIds = new Set(c.rules.map((r) => r.id));

    const dupes = (items: string[], label: string) => {
      const seen = new Set<string>();
      for (const x of items) {
        if (seen.has(x)) {
          ctx.addIssue({ code: "custom", message: `duplicate ${label} id: ${x}` });
        }
        seen.add(x);
      }
    };
    dupes(c.modules.map((m) => m.id), "module");
    dupes(c.rules.map((r) => r.id), "rule");
    dupes(c.invariants.map((i) => i.id), "invariant");
    dupes(c.decisions.map((d) => d.id), "decision");

    const needModule = (m: string, where: string) => {
      if (!moduleIds.has(m)) {
        ctx.addIssue({ code: "custom", message: `${where}: unknown module "${m}"` });
      }
    };
    for (const r of c.rules) {
      if (r.type === "deny") {
        needModule(r.from, `rule ${r.id}`);
        needModule(r.to, `rule ${r.id}`);
      } else if (r.type === "allow-only") {
        needModule(r.module, `rule ${r.id}`);
        r.mayImport.forEach((m) => needModule(m, `rule ${r.id}`));
      }
    }
    for (const i of c.invariants) {
      if (i.check?.type === "rule-ref") {
        for (const rid of i.check.ruleIds) {
          if (!ruleIds.has(rid)) {
            ctx.addIssue({
              code: "custom",
              message: `invariant ${i.id}: unknown rule "${rid}"`,
            });
          }
        }
      }
    }
  });

export type Constitution = z.infer<typeof ConstitutionSchema>;

// ---- Verifier output ----

export const ViolationSchema = z.object({
  ruleId: id,
  severity: z.enum(["error", "warn"]),
  message: z.string(),
  file: z.string(),
  line: z.number().int().positive().optional(),
  from: id.optional(),
  to: id.optional(),
  fixHint: z.string(), // written so an AI agent can act on it
  actor: z
    .object({ tool: z.string().optional(), model: z.string().optional() })
    .optional(),
});

export const CheckReportSchema = z.object({
  constitutionVersion: z.literal(1),
  analyzedFiles: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  violations: z.array(ViolationSchema),
  unverifiedInvariants: z.array(id),
});

export type Violation = z.infer<typeof ViolationSchema>;
export type CheckReport = z.infer<typeof CheckReportSchema>;
