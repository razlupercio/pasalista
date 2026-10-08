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

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

/** Routes behind `requireUser`: the session user is always present. */
export interface AuthedEnv {
  Variables: AppEnv["Variables"] & {
    user: SessionUser;
    activeOrganizationId: string | null;
  };
}
