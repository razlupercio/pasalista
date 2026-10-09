// SPDX-License-Identifier: AGPL-3.0-or-later
// Development seed: a verified demo organizer. Refuses to run in production.
import { createDb, schema } from "@pasalista/db";
import { eq } from "drizzle-orm";
import { createAuth } from "../auth.ts";
import { loadEnv } from "../env.ts";

/** Development-only credentials, also documented in README.md. */
export const DEMO_USER = {
  name: "Demo Organizer",
  email: "demo@pasalista.localhost",
  password: "demo-password-123",
  locale: "es-MX",
} as const;

const env = loadEnv();
if (env.NODE_ENV === "production") {
  throw new Error("The seed script is for development only");
}

const { db, pool } = createDb(env.DATABASE_URL);
// The demo password is public anyway; no need to check it against breach lists.
const auth = createAuth({
  db,
  env: { ...env, RATE_LIMIT_ENABLED: false, PASSWORD_BREACH_CHECK: false },
});

const [existing] = await db
  .select({ id: schema.users.id })
  .from(schema.users)
  .where(eq(schema.users.email, DEMO_USER.email));
if (existing) {
  console.log("Demo user already exists");
} else {
  await auth.api.signUpEmail({ body: { ...DEMO_USER } });
  await db
    .update(schema.users)
    .set({ emailVerified: true })
    .where(eq(schema.users.email, DEMO_USER.email));
  // The sign-up queued a verification email; the demo user is already verified.
  await db.delete(schema.emailOutbox).where(eq(schema.emailOutbox.toEmail, DEMO_USER.email));
  console.log(`Demo user created: ${DEMO_USER.email}`);
}
await pool.end();
