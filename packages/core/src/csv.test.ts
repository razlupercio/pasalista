// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { detectDelimiter, mapGuestListColumns, parseCsv, readGuestList } from "./csv.ts";

describe("parseCsv", () => {
  it("parses simple rows with CRLF or LF endings", () => {
    expect(parseCsv("a,b\r\n1,2\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("handles quotes, escaped quotes, delimiters and line breaks inside quotes", () => {
    expect(parseCsv('name,note\n"López, Ana","She said ""hi""\nthen left"')).toEqual([
      ["name", "note"],
      ["López, Ana", 'She said "hi"\nthen left'],
    ]);
  });

  it("strips a UTF-8 BOM and skips blank lines", () => {
    expect(parseCsv("\uFEFFa,b\n\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps empty cells", () => {
    expect(parseCsv("a,,c\n,,")).toEqual([
      ["a", "", "c"],
      ["", "", ""],
    ]);
  });
});

describe("detectDelimiter", () => {
  it("detects semicolons exported by spreadsheets in Spanish", () => {
    expect(detectDelimiter("nombre;correo\nAna;ana@example.com")).toBe(";");
    expect(detectDelimiter("name,email")).toBe(",");
    expect(detectDelimiter("name\temail")).toBe("\t");
    expect(detectDelimiter("email")).toBe(",");
  });
});

describe("guest lists", () => {
  it("maps Spanish or English headers regardless of case and accents", () => {
    expect(mapGuestListColumns(["Correo Electrónico", "NOMBRE", "Idioma"])).toEqual({
      name: 1,
      email: 0,
      locale: 2,
    });
    expect(mapGuestListColumns(["email", "name"])).toEqual({ name: 1, email: 0, locale: null });
    expect(mapGuestListColumns(["email", "phone"])).toBeNull();
  });

  it("reads rows with the spreadsheet line number", () => {
    const text = "nombre;correo;idioma\nAna López;ANA@example.com;en\n Sam ; sam@example.com ;\n";
    expect(readGuestList(text)).toEqual([
      { line: 2, name: "Ana López", email: "ANA@example.com", locale: "en" },
      { line: 3, name: "Sam", email: "sam@example.com", locale: null },
    ]);
  });

  it("returns null when required columns are missing", () => {
    expect(readGuestList("phone\n123")).toBeNull();
  });
});
