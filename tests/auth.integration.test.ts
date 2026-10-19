import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { describe, expect, it } from "vitest";
import { session, user } from "../src/lib/db/auth-schema";
import { db } from "../src/lib/db";
import { auth } from "../src/lib/auth";
import { createInvestigatorAccount } from "../src/lib/provision-investigator";
import { getSessionFromHeaders } from "../src/lib/session";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3002";

function accountInput(confirmInvestigator = true) {
  const email = `investigator-${randomUUID()}@example.com`;
  return {
    email,
    name: "Test Investigator",
    password: `Pw-${randomUUID()}`,
    confirmInvestigator,
  };
}

async function signIn(email: string, password: string) {
  return auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
}

function sessionHeaders(response: Response): Headers {
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .filter(Boolean)
    .join("; ");
  return new Headers({ cookie });
}

async function sessionCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, userId));
  return rows.length;
}

async function authError(email: string, password: string) {
  try {
    await auth.api.signInEmail({
      body: { email, password },
    });
    return null;
  } catch (error) {
    if (!(error instanceof APIError)) {
      throw error;
    }
    const body = error.body;
    const code =
      body && typeof body === "object" && "code" in body
        ? String(body.code)
        : "";
    return { status: error.statusCode, code, message: error.message };
  }
}

describe("investigator authentication", () => {
  it("provisions an investigator and rejects a duplicate email", async () => {
    const input = accountInput();
    const created = await createInvestigatorAccount(input);

    expect(created.email).toBe(input.email.toLowerCase());
    expect(created.name).toBe(input.name);
    expect(created.role).toBe("INVESTIGATOR");

    const [stored] = await db
      .select({
        role: user.role,
        disabled: user.disabled,
        name: user.name,
      })
      .from(user)
      .where(eq(user.email, input.email.toLowerCase()));

    expect(stored).toMatchObject({
      role: "INVESTIGATOR",
      disabled: false,
      name: input.name,
    });

    await expect(createInvestigatorAccount(input)).rejects.toThrow(
      "An account with this email already exists",
    );

    const accounts = await db
      .select({ id: user.id, role: user.role })
      .from(user)
      .where(eq(user.email, input.email.toLowerCase()));

    expect(accounts).toEqual([
      { id: created.id, role: "INVESTIGATOR" },
    ]);
  });

  it("signs in, then invalidates the session on sign-out", async () => {
    const input = accountInput();
    await createInvestigatorAccount(input);
    const response = await signIn(input.email, input.password);
    expect(response.status).toBe(200);

    const headers = sessionHeaders(response);
    const session = await getSessionFromHeaders(headers);
    expect(session?.user.role).toBe("INVESTIGATOR");
    expect(session?.user.email).toBe(input.email.toLowerCase());

    const signedOut = await auth.api.signOut({
      headers,
      asResponse: true,
    });
    expect(signedOut.ok).toBe(true);

    const after = await getSessionFromHeaders(headers);
    expect(after).toBeNull();
  });

  it("returns the same failure for an unknown email and a wrong password", async () => {
    const input = accountInput();
    await createInvestigatorAccount(input);

    const unknown = await authError(
      `missing-${randomUUID()}@example.com`,
      `Pw-${randomUUID()}`,
    );
    const wrongPassword = await authError(
      input.email,
      `Pw-${randomUUID()}`,
    );

    expect(unknown).not.toBeNull();
    expect(wrongPassword).toEqual(unknown);
    expect(`${unknown?.code} ${unknown?.message}`.toLowerCase()).not.toContain(
      "not found",
    );
    expect(`${unknown?.message}`.toLowerCase()).not.toContain(input.email);
  });

  it("does not establish a session for a disabled account", async () => {
    const input = accountInput();
    const created = await createInvestigatorAccount(input);
    await db
      .update(user)
      .set({ disabled: true })
      .where(eq(user.id, created.id));

    const disabledSignIn = await authError(input.email, input.password);
    const unknown = await authError(
      `missing-${randomUUID()}@example.com`,
      `Pw-${randomUUID()}`,
    );

    expect(disabledSignIn).not.toBeNull();
    expect(disabledSignIn).toEqual(unknown);
    expect(await sessionCount(created.id)).toBe(0);
  });

  it("revokes a disabled session and does not restore it on re-enable", async () => {
    const input = accountInput();
    const created = await createInvestigatorAccount(input);
    const response = await signIn(input.email, input.password);
    expect(response.status).toBe(200);

    const headers = sessionHeaders(response);
    const cookie = headers.get("cookie") ?? "";
    expect((await getSessionFromHeaders(headers))?.user.role).toBe(
      "INVESTIGATOR",
    );

    await db
      .update(user)
      .set({ disabled: true })
      .where(eq(user.id, created.id));

    const renamed = await fetch(`${baseUrl}/api/auth/update-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        cookie,
      },
      body: JSON.stringify({ name: "Renamed While Disabled" }),
    });
    const replacement = `Pw-${randomUUID()}`;
    const changed = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        cookie,
      },
      body: JSON.stringify({
        currentPassword: input.password,
        newPassword: replacement,
        revokeOtherSessions: true,
      }),
    });

    const [stored] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, created.id));

    expect(renamed.status).toBe(401);
    expect(changed.status).toBe(401);
    expect(stored?.name).toBe(input.name);
    expect(await getSessionFromHeaders(headers)).toBeNull();
    expect(await sessionCount(created.id)).toBe(0);

    const alerts = await fetch(`${baseUrl}/api/alerts`, {
      headers: { cookie },
    });
    expect(alerts.status).toBe(401);

    await db
      .update(user)
      .set({ disabled: false })
      .where(eq(user.id, created.id));

    expect(await getSessionFromHeaders(headers)).toBeNull();
    expect(await sessionCount(created.id)).toBe(0);
    const alertsAfterReenable = await fetch(`${baseUrl}/api/alerts`, {
      headers: { cookie },
    });
    expect(alertsAfterReenable.status).toBe(401);

    const restored = await signIn(input.email, input.password);
    expect(restored.status).toBe(200);
    expect(
      (await getSessionFromHeaders(sessionHeaders(restored)))?.user.email,
    ).toBe(input.email.toLowerCase());
  });

  it("keeps public sign-up and admin creation closed", async () => {
    const signUp = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
      },
      body: JSON.stringify({
        email: `public-${randomUUID()}@example.com`,
        password: `Pw-${randomUUID()}`,
        name: "Public User",
        role: "INVESTIGATOR",
      }),
    });
    const adminCreate = await fetch(`${baseUrl}/api/auth/admin/create-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `admin-${randomUUID()}@example.com`,
        password: `Pw-${randomUUID()}`,
        name: "Admin User",
        role: "INVESTIGATOR",
      }),
    });

    expect(signUp.status).toBe(400);
    expect(adminCreate.status).toBe(404);
  });

  it("redirects an anonymous dashboard visitor to login", async () => {
    const response = await fetch(`${baseUrl}/`, { redirect: "manual" });
    const body = await response.text();

    expect(body).toContain("NEXT_REDIRECT;replace;/login;307;");
    expect(body).not.toContain("Alert Management");
  });
});
