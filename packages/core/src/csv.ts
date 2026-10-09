// SPDX-License-Identifier: AGPL-3.0-or-later
// Minimal RFC 4180 CSV reader for guest lists. Runs in the browser (preview) and the API.

export type CsvDelimiter = "," | ";" | "\t";

/**
 * Guesses the delimiter from the header line. Spreadsheet apps in Spanish locales export with
 * semicolons because the comma is the decimal separator.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const header = text.slice(0, text.search(/\r?\n|$/));
  const counts = ([",", ";", "\t"] as const).map((d) => [d, header.split(d).length - 1] as const);
  const [best] = [...counts].sort((a, b) => b[1] - a[1]);
  return best && best[1] > 0 ? best[0] : ",";
}

/**
 * Parses CSV text into rows of cells. Handles quoted fields, escaped quotes (`""`), delimiters
 * and line breaks inside quotes, CRLF/LF endings and a leading UTF-8 BOM. Blank lines are skipped.
 */
export function parseCsv(
  input: string,
  delimiter: CsvDelimiter = detectDelimiter(input),
): string[][] {
  const text = input.startsWith("\uFEFF") ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const endRow = () => {
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
    cell = "";
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === "") {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

const HEADER_ALIASES: Record<"name" | "email" | "locale", string[]> = {
  name: ["name", "nombre", "nombre completo", "full name"],
  email: ["email", "e-mail", "correo", "correo electronico", "mail"],
  locale: ["locale", "idioma", "language", "lang"],
};

function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036F]/g, "")
    .trim()
    .toLowerCase();
}

export interface GuestListColumns {
  name: number;
  email: number;
  locale: number | null;
}

/** Finds the name, email and (optional) locale columns in a header row, in Spanish or English. */
export function mapGuestListColumns(header: readonly string[]): GuestListColumns | null {
  const normalized = header.map(normalizeHeader);
  const find = (key: keyof typeof HEADER_ALIASES) => {
    const index = normalized.findIndex((h) => HEADER_ALIASES[key].includes(h));
    return index === -1 ? null : index;
  };
  const name = find("name");
  const email = find("email");
  if (name === null || email === null) return null;
  return { name, email, locale: find("locale") };
}

export interface RawGuest {
  /** 1-based line in the file, counting the header as line 1 (what users see in a spreadsheet). */
  line: number;
  name: string;
  email: string;
  locale: string | null;
}

/** Reads a guest list file. Returns null when the name or email column is missing. */
export function readGuestList(text: string): RawGuest[] | null {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const columns = mapGuestListColumns(header);
  if (!columns) return null;
  return rows.map((cells, index) => ({
    line: index + 2,
    name: (cells[columns.name] ?? "").trim(),
    email: (cells[columns.email] ?? "").trim(),
    locale: columns.locale === null ? null : (cells[columns.locale] ?? "").trim() || null,
  }));
}

/**
 * Serializes rows as RFC 4180 CSV (CRLF, quotes when needed) with a UTF-8 BOM so spreadsheet
 * apps detect the encoding. Cells that a spreadsheet would run as a formula (`=`, `+`, `-`,
 * `@`, tab, CR) are prefixed with `'` to prevent CSV injection.
 */
export function toCsv(rows: readonly (readonly string[])[]): string {
  const cell = (raw: string) => {
    const value = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return /[",\r\n;]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  };
  return "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
