// packages/spec/src/pack.ts
// Schema for Engineering Packs. Packs are declarative data, never code.
import { z } from "zod";

const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes");

const semver = z.string().regex(/^\d+\.\d+\.\d+$/, "use MAJOR.MINOR.PATCH");

const validRegex = z.string().refine(
  (s) => {
    try {
      new RegExp(s);
      return true;
    } catch {
      return false;
    }
  },
  { message: "invalid regular expression" },
);

const globs = z.array(z.string()).min(1);

export const CheckSchema = z.discriminatedUnion("type", [
  // Tree-sitter query that must have NO match in the selected files.
  z.object({
    type: z.literal("forbidden-ast"),
    language: z.enum(["ts", "tsx", "js", "jsx"]),
    paths: globs,
    query: z.string().min(1),
  }),
  // Tree-sitter query that must match AT LEAST ONCE in each selected file.
  z.object({
    type: z.literal("required-ast"),
    language: z.enum(["ts", "tsx", "js", "jsx"]),
    paths: globs,
    query: z.string().min(1),
  }),
  // Regex for non-code files (SQL migrations, env files, configs).
  z.object({
    type: z.literal("text-pattern"),
    paths: globs,
    pattern: validRegex,
    mode: z.enum(["forbid", "require"]),
  }),
]);

export const PackRuleSchema = z
  .object({
    id: slug,
    title: z.string().min(5),
    severity: z.enum(["error", "warn"]).default("error"),
    status: z.enum(["experimental", "stable"]).default("experimental"),
    why: z.string().min(20), // the lesson behind the rule
    fixHint: z.string().min(10), // written so an AI agent can act on it
    check: CheckSchema,
    examples: z
      .object({ bad: z.string().optional(), good: z.string().optional() })
      .optional(),
    references: z.array(z.string().url()).default([]),
    fixtures: z
      .object({
        pass: z.array(z.string()).default([]),
        fail: z.array(z.string()).default([]),
      })
      .default({ pass: [], fail: [] }),
  })
  .superRefine((r, ctx) => {
    if (r.status === "stable") {
      if (r.fixtures.pass.length === 0 || r.fixtures.fail.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: `rule ${r.id}: stable rules need pass and fail fixtures`,
        });
      }
    }
  });

const Detector = z
  .object({
    dependency: z.string().optional(), // package.json dependency name
    file: z.string().optional(), // glob that must exist
  })
  .refine((d) => d.dependency || d.file, {
    message: "detector needs a dependency or a file",
  });

export const PackSchema = z
  .object({
    id: slug,
    version: semver,
    title: z.string().min(5),
    description: z.string().optional(),
    applies: z
      .object({
        anyOf: z.array(Detector).default([]),
        allOf: z.array(Detector).default([]),
      })
      .default({ anyOf: [], allOf: [] }),
    rules: z.array(PackRuleSchema).min(1),
  })
  .superRefine((p, ctx) => {
    const seen = new Set<string>();
    for (const r of p.rules) {
      if (seen.has(r.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate rule id: ${r.id}` });
      }
      seen.add(r.id);
    }
  });

export type Pack = z.infer<typeof PackSchema>;
export type PackRule = z.infer<typeof PackRuleSchema>;
export type Check = z.infer<typeof CheckSchema>;
