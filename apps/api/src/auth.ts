// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  defaultLocale,
  isLocale,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  uuidv7,
} from "@pasalista/core";
import { schema, type Database } from "@pasalista/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { haveIBeenPwned, magicLink, organization } from "better-auth/plugins";
import { asc, eq } from "drizzle-orm";
import { enqueueEmail } from "./email/outbox.ts";
import type { Env } from "./env.ts";
import { CLIENT_IP_HEADER } from "./middleware/request-context.ts";

export const AUTH_BASE_PATH = "/api/v1/auth";

const { users, organizations, organizationMembers } = schema;

function localeOf(value: unknown): string {
  return isLocale(value) ? value : defaultLocale;
}

function randomSlugSuffix(): string {
  return uuidv7().replaceAll("-", "").slice(-10);
}

/** Creates the user's personal organization (owner role) if they do not belong to any yet. */
export async function ensurePersonalOrganization(
  db: Database,
  user: { id: string; name: string },
): Promise<string> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, user.id))
      .orderBy(asc(organizationMembers.createdAt))
      .limit(1);
    if (existing) return existing.organizationId;

    const [org] = await tx
      .insert(organizations)
      .values({ name: user.name, slug: `personal-${randomSlugSuffix()}`, isPersonal: true })
      .returning({ id: organizations.id });
    if (!org) throw new Error("Failed to create personal organization");
    await tx
      .insert(organizationMembers)
      .values({ organizationId: org.id, userId: user.id, role: "owner" });
    return org.id;
  });
}

export function createAuth(options: { db: Database; env: Env }) {
  const { db, env } = options;

  return betterAuth({
    appName: "PasaLista",
    baseURL: env.PUBLIC_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.PUBLIC_URL],
    telemetry: { enabled: false },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        organization: schema.organizations,
        member: schema.organizationMembers,
        invitation: schema.organizationInvitations,
      },
    }),
    advanced: {
      cookiePrefix: "pasalista",
      useSecureCookies: env.PUBLIC_URL.startsWith("https://"),
      database: { generateId: () => uuidv7() },
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    user: {
      additionalFields: {
        locale: { type: "string", required: false, defaultValue: defaultLocale, input: true },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        await enqueueEmail(db, {
          kind: "reset_password",
          to: user.email,
          locale: localeOf((user as { locale?: unknown }).locale),
          payload: { name: user.name, url },
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        await enqueueEmail(db, {
          kind: "verify_email",
          to: user.email,
          locale: localeOf((user as { locale?: unknown }).locale),
          payload: { name: user.name, url },
        });
      },
    },
    rateLimit: {
      enabled: env.RATE_LIMIT_ENABLED,
      storage: "memory",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/sign-in/magic-link": { window: 60, max: 3 },
        "/request-password-reset": { window: 60, max: 3 },
        "/send-verification-email": { window: 60, max: 3 },
        // Read-only session lookups are also made server-side by Next.js on every page render.
        "/get-session": false,
        "/organization/get-full-organization": false,
        "/organization/list": false,
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await ensurePersonalOrganization(db, user);
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const [user] = await db
              .select({ id: users.id, name: users.name })
              .from(users)
              .where(eq(users.id, session.userId));
            if (!user) return { data: session };
            const activeOrganizationId = await ensurePersonalOrganization(db, user);
            return { data: { ...session, activeOrganizationId } };
          },
        },
      },
    },
    plugins: [
      haveIBeenPwned({ enabled: env.PASSWORD_BREACH_CHECK }),
      organization({
        creatorRole: "owner",
        organizationLimit: 20,
        // Deleting an organization cascades to its events; data purge is designed in Phase 5.
        disableOrganizationDeletion: true,
        invitationExpiresIn: 7 * 24 * 60 * 60,
        cancelPendingInvitationsOnReInvite: true,
        // Invitations are bound to the invited email; it must be verified to accept (ADR-0008).
        requireEmailVerificationOnInvitation: true,
        sendInvitationEmail: async ({ id, email, organization, inviter }) => {
          const [inviterRow] = await db
            .select({ locale: users.locale })
            .from(users)
            .where(eq(users.id, inviter.user.id));
          const locale = localeOf(inviterRow?.locale);
          await enqueueEmail(db, {
            kind: "team_invitation",
            to: email,
            locale,
            organizationId: organization.id,
            payload: {
              inviterName: inviter.user.name,
              organizationName: organization.name,
              url: `${env.PUBLIC_URL}/${locale}/invitations/team/${id}`,
            },
          });
        },
        schema: {
          organization: {
            additionalFields: {
              isPersonal: { type: "boolean", required: false, defaultValue: false, input: false },
            },
          },
        },
      }),
      magicLink({
        expiresIn: 5 * 60,
        disableSignUp: true,
        sendMagicLink: async ({ email, url }) => {
          // Only existing accounts get an email; the response is identical either way, so
          // this does not reveal whether an account exists.
          const [user] = await db
            .select({ locale: users.locale })
            .from(users)
            .where(eq(users.email, email.toLowerCase()));
          if (!user) return;
          await enqueueEmail(db, {
            kind: "magic_link",
            to: email,
            locale: localeOf(user.locale),
            payload: { url },
          });
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
