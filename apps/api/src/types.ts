// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Logger } from "pino";

/** Hono context variables shared by every route and middleware. */
export interface AppEnv {
  Variables: {
    requestId: string;
    logger: Logger;
    clientIp: string;
  };
}
