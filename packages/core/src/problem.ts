// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";

/**
 * Stable error codes returned by the API. Clients map them to i18n messages
 * (`errors.<code>` in @pasalista/i18n); never show `detail` as-is to end users.
 */
export const errorCodes = [
  "bad_request",
  "validation_failed",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "invalid_origin",
  "internal_error",
  "invalid_state",
  "registration_closed",
  "event_full",
  "already_registered",
] as const;
export type ErrorCode = (typeof errorCodes)[number];

/** RFC 9457 problem details, extended with `code` and optional field `issues`. */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.enum(errorCodes),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string().optional(),
  issues: z
    .array(
      z.object({
        path: z.array(z.union([z.string(), z.number()])),
        message: z.string(),
      }),
    )
    .optional(),
});
export type Problem = z.infer<typeof problemSchema>;
