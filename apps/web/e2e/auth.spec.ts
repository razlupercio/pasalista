// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "@playwright/test";
import { latestLinkFor } from "./mailpit.ts";

const PASSWORD = "pasalista e2e velero-mango-7f3k";

// Each test acts as a different client so per-IP rate limits do not interfere. The stack must
// run with TRUSTED_PROXY_HOPS=1 for the API to honour this header (see README).
test.beforeEach(async ({ page }) => {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.18.${octet()}.${octet()}` });
});

function uniqueEmail(testInfo: { project: { name: string } }): string {
  return `e2e-${testInfo.project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

test("sign up, verify email, sign out and sign in again (es-MX)", async ({ page }, testInfo) => {
  const email = uniqueEmail(testInfo);

  // The browser locale is English; es-MX is reached explicitly.
  await page.goto("/es-MX");
  await expect(page).toHaveURL(/\/es-MX$/);
  await page.getByRole("link", { name: "Comenzar" }).click();

  await page.getByLabel("Nombre").fill("Ana López");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("status")).toContainText("Revisa tu correo");

  const { subject, link } = await latestLinkFor(email);
  expect(subject).toBe("Verifica tu correo en PasaLista");
  await page.goto(link);

  await expect(page).toHaveURL(/\/es-MX\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Hola, Ana López" })).toBeVisible();
  await expect(page.getByText("Organización: Ana López")).toBeVisible();

  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page.getByRole("link", { name: "Iniciar sesión" }).first()).toBeVisible();

  await page.goto("/es-MX/sign-in");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/es-MX\/dashboard$/);
});

test("sign in is refused until the email is verified (en)", async ({ page }, testInfo) => {
  const email = uniqueEmail(testInfo);

  await page.goto("/en/sign-up");
  await page.getByLabel("Name").fill("Sam Doe");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText("Check your inbox");

  await page.goto("/en/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "Your email is not verified yet.",
  );
  await expect(page.getByRole("button", { name: "Resend verification email" })).toBeVisible();
});

test("passwords found in data breaches are rejected", async ({ page }, testInfo) => {
  test.skip(process.env.PASSWORD_BREACH_CHECK === "false", "Breach check disabled for this stack");
  await page.goto("/es-MX/sign-up");
  await page.getByLabel("Nombre").fill("Ana López");
  await page.getByLabel("Correo electrónico").fill(uniqueEmail(testInfo));
  await page.getByLabel("Contraseña").fill("password1234");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "Esta contraseña apareció en una filtración de datos. Elige otra.",
  );
});

test("protected pages redirect to sign in", async ({ page }) => {
  await page.goto("/en/dashboard");
  await expect(page).toHaveURL(/\/en\/sign-in$/);
});

test("language and theme can be switched", async ({ page }) => {
  await page.goto("/es-MX");
  await page.getByLabel("Idioma").selectOption("en");
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Take attendance without paper");

  await page.getByLabel("Theme").selectOption("dark");
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test.describe("locale detection", () => {
  test.use({ locale: "es-MX" });

  test("redirects the root to the browser's language", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/es-MX$/);
  });
});
