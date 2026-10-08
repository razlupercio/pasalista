// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  database: z.enum(["ok", "unavailable"]),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
