import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auth } from "../src/lib/auth";
import { user } from "../src/lib/db/auth-schema";
import { db } from "../src/lib/db";
import { createInvestigatorAccount } from "../src/lib/provision-investigator";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3002";

function password(): string {
  return `Pw-${randomUUID()}`;
}

async function storedName(userId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, userId));
  return row?.name;
}

async function rejectProvisioning(name: string, message: string) {
  const email = `name-${randomUUID()}@example.com`;
  await expect(
    createInvestigatorAccount({
      email,
      name,
      password: password(),
      confirmInvestigator: true,
    }),
  ).rejects.toThrow(message);

  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email));
  expect(rows).toEqual([]);
}

describe("display name provisioning", () => {
  it("accepts a 128-character display name", async () => {
    const name = "n".repeat(128);
    const created = await createInvestigatorAccount({
      email: `max-name-${randomUUID()}@example.com`,
      name,
      password: password(),
      confirmInvestigator: true,
    });

    expect(created.name).toBe(name);
    expect(await storedName(created.id)).toBe(name);
  });

  it("rejects a 129-character display name", async () => {
    await rejectProvisioning(
      "n".repeat(129),
      "Display name must be at most 128 characters",
    );
  });

  it("rejects empty and whitespace-only display names", async () => {
    await rejectProvisioning("", "A display name is required");
    await rejectProvisioning("   ", "A display name is required");
    await rejectProvisioning(" \t\n ", "A display name is required");
  });

  it("stores a trimmed display name without truncating it", async () => {
    const created = await createInvestigatorAccount({
      email: `trim-${randomUUID()}@example.com`,
      name: "  Ada Lovelace  ",
      password: password(),
      confirmInvestigator: true,
    });

    expect(created.name).toBe("Ada Lovelace");
    expect(await storedName(created.id)).toBe("Ada Lovelace");
  });
});

describe("display name account updates", () => {
  async function investigator(name: string) {
    const email = `rename-${randomUUID()}@example.com`;
    const accountPassword = password();
    const created = await createInvestigatorAccount({
      email,
      name,
      password: accountPassword,
      confirmInvestigator: true,
    });
    const response = await auth.api.signInEmail({
      body: { email, password: accountPassword },
      asResponse: true,
    });
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .filter(Boolean)
      .join("; ");

    return { id: created.id, name: created.name, cookie };
  }

  async function updateName(cookie: string, name: string) {
    return fetch(`${baseUrl}/api/auth/update-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        cookie,
      },
      body: JSON.stringify({ name }),
    });
  }

  it("accepts a 128-character display name", async () => {
    const account = await investigator("Original Name");
    const name = "u".repeat(128);
    const response = await updateName(account.cookie, name);

    expect(response.status).toBe(200);
    expect(await storedName(account.id)).toBe(name);
  });

  it("rejects a 129-character display name without changing the stored name", async () => {
    const account = await investigator("Original Name");
    const response = await updateName(account.cookie, "u".repeat(129));
    const body = (await response.json()) as { message?: string };

    expect(response.status).toBe(400);
    expect(body.message).toBe("Display name must be at most 128 characters");
    expect(await storedName(account.id)).toBe("Original Name");
  });

  it("rejects empty and whitespace-only names without changing the stored name", async () => {
    const account = await investigator("Original Name");

    for (const name of ["", "   ", " \t\n "]) {
      const response = await updateName(account.cookie, name);
      const body = (await response.json()) as { message?: string };

      expect(response.status).toBe(400);
      expect(body.message).toBe("A display name is required");
      expect(await storedName(account.id)).toBe("Original Name");
    }
  });
});
