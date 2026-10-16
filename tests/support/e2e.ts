// Browser-test helpers: the site's path prefix and email-code sign-in.
import { expect, type Page } from "@playwright/test";
import { apiUrl, localStatus, serviceRoleKey } from "./local-supabase.ts";

export const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** page.goto() for a path inside the app, e.g. go(page, "/reminders/"). */
export function go(page: Page, path: string) {
  return page.goto(`${base}${path}`);
}

/**
 * A valid 6-digit sign-in code for `email`, issued through the Auth admin API
 * of the LOCAL Supabase (the local mailbox only gets the default link email;
 * the hosted project uses supabase/templates, which also show the code).
 */
export async function latestCode(email: string): Promise<string> {
  const res = await fetch(`${apiUrl()}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: serviceRoleKey(), Authorization: `Bearer ${serviceRoleKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const body = await res.json();
  const code = body.email_otp ?? body.properties?.email_otp;
  if (!res.ok || !/^\d{6}$/.test(code ?? "")) throw new Error(`Could not get a sign-in code for ${email}: ${JSON.stringify(body).slice(0, 200)}`);
  return code;
}

/** Signs in (creating the account on first use) through the real sign-in page. */
export async function signIn(page: Page, email = `e2e-${crypto.randomUUID()}@example.test`) {
  await go(page, "/login/");
  const main = page.getByRole("main");
  await main.getByLabel("Email").fill(email);
  await main.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(main.getByRole("status")).toContainText(email);
  await main.getByLabel("Code").fill(await latestCode(email));
  await main.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/reminders\/$/);
  return email;
}

/** The sign-in link from the newest email to `email` in the local mailbox (Mailpit). */
export async function latestEmailLink(email: string): Promise<string> {
  const mail = localStatus().MAILPIT_URL ?? "http://127.0.0.1:54324";
  for (let i = 0; i < 20; i++) {
    const search = await fetch(`${mail}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`).then((r) => r.json());
    const id = search.messages?.[0]?.ID;
    if (id) {
      const msg = await fetch(`${mail}/api/v1/message/${id}`).then((r) => r.json());
      const link = /href="([^"]+\/auth\/v1\/verify[^"]+)"/.exec(msg.HTML ?? "")?.[1];
      if (link) return link.replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No sign-in email arrived for ${email}`);
}
