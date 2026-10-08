// SPDX-License-Identifier: AGPL-3.0-or-later
import { problemSchema } from "@pasalista/core";
import type { Context } from "hono";
import type { ZodError } from "zod";
import { problem } from "../errors.ts";
import type { AppEnv } from "../types.ts";

const problemContent = { "application/problem+json": { schema: problemSchema } };

/** Standard error responses, documented once and reused by every route. */
export const errorResponses = {
  400: { description: "Invalid input", content: problemContent },
  401: { description: "Not signed in", content: problemContent },
  403: { description: "Not allowed", content: problemContent },
  404: { description: "Not found", content: problemContent },
  409: { description: "Conflicts with the current state", content: problemContent },
  429: { description: "Rate limited", content: problemContent },
} as const;

export function pickErrors<K extends keyof typeof errorResponses>(...codes: K[]) {
  return Object.fromEntries(codes.map((code) => [code, errorResponses[code]])) as Pick<
    typeof errorResponses,
    K
  >;
}

/** Turns Zod validation failures into RFC 9457 problems with field issues. */
export function validationHook<E extends AppEnv>(
  result: { success: true } | { success: false; error: ZodError },
  c: Context<E>,
) {
  if (!result.success) {
    return problem(c, 400, "validation_failed", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.filter((p): p is string | number => typeof p !== "symbol"),
        message: issue.message,
      })),
    });
  }
}
