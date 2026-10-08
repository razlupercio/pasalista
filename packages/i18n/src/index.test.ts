// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { format, messages } from "./index.ts";

function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function placeholders(value: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const walk = (node: unknown, path: string) => {
    if (typeof node === "string") {
      out[path] = [...node.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
    } else if (typeof node === "object" && node !== null) {
      for (const [key, child] of Object.entries(node)) walk(child, path ? `${path}.${key}` : key);
    }
  };
  walk(value, "");
  return out;
}

describe("message catalogs", () => {
  it("have the same keys in every locale", () => {
    const reference = keyPaths(messages["es-MX"]).sort();
    expect(keyPaths(messages.en).sort()).toEqual(reference);
  });

  it("use the same placeholders in every locale", () => {
    expect(placeholders(messages.en)).toEqual(placeholders(messages["es-MX"]));
  });

  it("contain no empty strings", () => {
    for (const catalog of Object.values(messages)) {
      expect(JSON.stringify(catalog)).not.toContain('""');
    }
  });
});

describe("format", () => {
  it("replaces known placeholders and keeps unknown ones", () => {
    expect(format("Hola, {name} {missing}", { name: "Ana" })).toBe("Hola, Ana {missing}");
  });
});
