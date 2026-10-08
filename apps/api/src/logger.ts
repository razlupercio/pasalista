// SPDX-License-Identifier: AGPL-3.0-or-later
import { pino, type DestinationStream, type Logger } from "pino";

/**
 * Never log tokens, keys, cookies or personal data (CLAUDE.md security rules).
 * Redaction is a safety net: code should not pass these fields to the logger at all.
 */
export const REDACT_PATHS = [
  "password",
  "*.password",
  "token",
  "*.token",
  "secret",
  "*.secret",
  "email",
  "*.email",
  "name",
  "*.name",
  "url",
  "*.url",
  "headers.authorization",
  "headers.cookie",
  'headers["set-cookie"]',
  "*.headers.authorization",
  "*.headers.cookie",
  '*.headers["set-cookie"]',
];

export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      base: { service: "api" },
      redact: { paths: REDACT_PATHS, censor: "[redacted]" },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination,
  );
}
