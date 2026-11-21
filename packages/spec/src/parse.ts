// packages/spec/src/parse.ts
// Pure helpers: parse unknown input and export JSON Schemas.
// No file, network or database access (see ARCHITECTURE.md, section 4).
import { z } from "zod";
import { ConstitutionSchema, CheckReportSchema } from "./constitution";
import { PackSchema } from "./pack";

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

type IssueLike = { path: ReadonlyArray<PropertyKey>; message: string };

// "modules.0.id: <message>" or "(root): <message>"
function formatIssues(issues: ReadonlyArray<IssueLike>): string[] {
  return issues.map((issue) => {
    const path =
      issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}

function parseWith<S extends z.ZodType>(
  schema: S,
  input: unknown,
): ParseResult<z.output<S>> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, errors: formatIssues(result.error.issues) };
}

export const parseConstitution = (input: unknown) =>
  parseWith(ConstitutionSchema, input);

export const parsePack = (input: unknown) => parseWith(PackSchema, input);

export const parseCheckReport = (input: unknown) =>
  parseWith(CheckReportSchema, input);

export const constitutionJsonSchema = () => z.toJSONSchema(ConstitutionSchema);
export const packJsonSchema = () => z.toJSONSchema(PackSchema);
export const checkReportJsonSchema = () => z.toJSONSchema(CheckReportSchema);
