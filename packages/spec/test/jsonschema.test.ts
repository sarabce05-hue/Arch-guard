import { describe, it, expect } from "vitest";
import {
  constitutionJsonSchema,
  packJsonSchema,
  checkReportJsonSchema,
} from "../src";

describe("JSON Schema export", () => {
  it("exports the Constitution schema", () => {
    const schema = constitutionJsonSchema();
    expect(schema).toHaveProperty("properties.modules");
    expect(schema).toHaveProperty("properties.rules");
  });

  it("exports the Pack schema", () => {
    const schema = packJsonSchema();
    expect(schema).toHaveProperty("properties.rules");
    expect(schema).toHaveProperty("properties.version");
  });

  it("exports the CheckReport schema", () => {
    const schema = checkReportJsonSchema();
    expect(schema).toHaveProperty("properties.violations");
  });

  it("produces plain JSON", () => {
    const text = JSON.stringify(constitutionJsonSchema());
    expect(JSON.parse(text)).toEqual(constitutionJsonSchema());
  });
});
