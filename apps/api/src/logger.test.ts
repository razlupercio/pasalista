// SPDX-License-Identifier: AGPL-3.0-or-later
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.ts";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, stream };
}

describe("logger redaction", () => {
  it("never writes passwords, tokens, emails, names, links or auth headers", () => {
    const { lines, stream } = capture();
    const logger = createLogger("info", stream);
    logger.info(
      {
        password: "hunter2-hunter2",
        token: "PL1.secret-token",
        email: "ana@example.com",
        name: "Ana López",
        url: "https://x/verify?token=abc",
        headers: { authorization: "Bearer abc", cookie: "pasalista.session_token=abc" },
        user: { email: "ana@example.com", password: "p" },
      },
      "event",
    );
    const output = lines.join("");
    for (const secret of [
      "hunter2",
      "PL1.secret",
      "ana@example.com",
      "Ana López",
      "token=abc",
      "Bearer abc",
      "session_token",
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain("[redacted]");
  });
});
