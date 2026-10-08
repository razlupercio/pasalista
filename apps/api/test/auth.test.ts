// SPDX-License-Identifier: AGPL-3.0-or-later
import { schema } from "@pasalista/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  cookiesFrom,
  createTestContext,
  jsonRequest,
  latestEmail,
  PASSWORD,
  pathOf,
  randomIp,
  signUp,
  signUpAndVerify,
  uniqueEmail,
} from "./helpers.ts";

const ctx = createTestContext();
afterAll(() => ctx.close());

async function userByEmail(email: string) {
  const [user] = await ctx.db.select().from(schema.users).where(eq(schema.users.email, email));
  return user;
}

function signIn(email: string, password = PASSWORD, ip = randomIp()) {
  return ctx.app.request(
    "/api/v1/auth/sign-in/email",
    jsonRequest("POST", { email, password }, { ip }),
  );
}

describe("sign-up", () => {
  it("creates an unverified user with their locale and a personal organization they own", async () => {
    const email = uniqueEmail();
    const response = await signUp(ctx, email, "en");
    expect(response.status).toBe(200);

    const user = await userByEmail(email);
    expect(user).toMatchObject({ emailVerified: false, locale: "en" });

    const memberships = await ctx.db
      .select({
        role: schema.organizationMembers.role,
        isPersonal: schema.organizations.isPersonal,
      })
      .from(schema.organizationMembers)
      .innerJoin(
        schema.organizations,
        eq(schema.organizations.id, schema.organizationMembers.organizationId),
      )
      .where(eq(schema.organizationMembers.userId, user!.id));
    expect(memberships).toEqual([{ role: "owner", isPersonal: true }]);
  });

  it("queues a verification email in the user's locale instead of sending it inline", async () => {
    const email = uniqueEmail();
    await signUp(ctx, email, "en");
    const mail = await latestEmail(ctx, email);
    expect(mail).toMatchObject({ kind: "verify_email", locale: "en", status: "pending" });
    expect(String(mail?.payload.url)).toMatch(
      /^http:\/\/localhost:3000\/api\/v1\/auth\/verify-email\?token=/,
    );
  });

  it("rejects passwords shorter than 12 characters", async () => {
    const response = await ctx.app.request(
      "/api/v1/auth/sign-up/email",
      jsonRequest("POST", {
        name: "Ana",
        email: uniqueEmail(),
        password: "short-pass",
        locale: "es-MX",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects requests from untrusted origins", async () => {
    const response = await ctx.app.request(
      "/api/v1/auth/sign-up/email",
      jsonRequest(
        "POST",
        { name: "Ana", email: uniqueEmail(), password: PASSWORD, locale: "es-MX" },
        { origin: "https://evil.example" },
      ),
    );
    expect(response.status).toBe(403);
  });
});

describe("sign-in", () => {
  it("is refused until the email is verified", async () => {
    const email = uniqueEmail();
    await signUp(ctx, email);
    const response = await signIn(email);
    expect(response.status).toBe(403);
  });

  it("works after verification and sets the personal organization as active", async () => {
    const email = uniqueEmail();
    await signUpAndVerify(ctx, email);

    const response = await signIn(email);
    expect(response.status).toBe(200);
    const cookie = cookiesFrom(response);
    expect(cookie).toContain("pasalista.session_token=");

    const session = await ctx.app.request("/api/v1/auth/get-session", { headers: { cookie } });
    const body = (await session.json()) as {
      user: { email: string };
      session: { activeOrganizationId: string | null };
    };
    expect(body.user.email).toBe(email);
    expect(body.session.activeOrganizationId).toBeTruthy();
  });

  it("sets HttpOnly, SameSite=Lax session cookies", async () => {
    const email = uniqueEmail();
    await signUpAndVerify(ctx, email);
    const response = await signIn(email);
    const sessionCookie = response.headers
      .getSetCookie()
      .find((c) => c.startsWith("pasalista.session_token="));
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/SameSite=Lax/i);
  });

  it("does not reveal whether the email or the password was wrong", async () => {
    const email = uniqueEmail();
    await signUpAndVerify(ctx, email);
    const wrongPassword = await signIn(email, "wrong password here");
    const unknownUser = await signIn(uniqueEmail(), "wrong password here");
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownUser.json());
  });

  it("is rate limited per client IP", async () => {
    const ip = randomIp();
    const email = uniqueEmail();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++)
      statuses.push((await signIn(email, "wrong password here", ip)).status);
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("password reset", () => {
  it("queues a reset email only for existing accounts and accepts the new password", async () => {
    const email = uniqueEmail();
    await signUpAndVerify(ctx, email);

    const request = await ctx.app.request(
      "/api/v1/auth/request-password-reset",
      jsonRequest("POST", { email, redirectTo: "/es-MX/reset-password" }),
    );
    expect(request.status).toBe(200);
    const mail = await latestEmail(ctx, email);
    expect(mail?.kind).toBe("reset_password");

    // The emailed link redirects to the web page with the token in the query string.
    const redirect = await ctx.app.request(pathOf(mail?.payload.url), {
      headers: { "x-forwarded-for": randomIp() },
    });
    const location = new URL(redirect.headers.get("location") ?? "", "http://localhost:3000");
    const token = location.searchParams.get("token");
    expect(token).toBeTruthy();

    const newPassword = "a brand new passphrase";
    const reset = await ctx.app.request(
      "/api/v1/auth/reset-password",
      jsonRequest("POST", { token, newPassword }),
    );
    expect(reset.status).toBe(200);
    expect((await signIn(email, newPassword)).status).toBe(200);
  });

  it("answers the same for unknown emails without queuing anything", async () => {
    const email = uniqueEmail("ghost");
    const response = await ctx.app.request(
      "/api/v1/auth/request-password-reset",
      jsonRequest("POST", { email, redirectTo: "/es-MX/reset-password" }),
    );
    expect(response.status).toBe(200);
    expect(await latestEmail(ctx, email)).toBeUndefined();
  });
});

describe("magic link", () => {
  it("emails existing users only, with an identical response", async () => {
    const existing = uniqueEmail();
    await signUpAndVerify(ctx, existing);
    const unknown = uniqueEmail("ghost");

    const send = (email: string) =>
      ctx.app.request(
        "/api/v1/auth/sign-in/magic-link",
        jsonRequest("POST", { email, callbackURL: "/es-MX/dashboard" }),
      );
    const a = await send(existing);
    const b = await send(unknown);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await a.json()).toEqual(await b.json());
    expect((await latestEmail(ctx, existing))?.kind).toBe("magic_link");
    expect(await latestEmail(ctx, unknown)).toBeUndefined();
  });
});
