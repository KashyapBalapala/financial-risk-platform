import "server-only";

import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { db } from "./db/index.ts";
import { user } from "./db/auth-schema.ts";
import { acceptedDisplayName } from "./display-name.ts";
import { provisioningAuth } from "./provision-auth.ts";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Better Auth 1.7.10 rejects passwords longer than its default maximum of 128.
const minimumPasswordLength = 12;
const maximumPasswordLength = 128;

export type ProvisionedInvestigator = {
  id: string;
  email: string;
  name: string;
  role: string;
};

export async function createInvestigatorAccount(input: {
  email: string;
  name: string;
  password: string;
  confirmInvestigator: boolean;
}): Promise<ProvisionedInvestigator> {
  if (input.confirmInvestigator !== true) {
    throw new Error("Investigator role was not confirmed");
  }

  const email = input.email.trim().toLowerCase();
  const name = acceptedDisplayName(input.name);

  if (!email || !emailPattern.test(email)) {
    throw new Error("A valid email address is required");
  }
  if (input.password.length < minimumPasswordLength) {
    throw new Error("Password must be at least 12 characters");
  }
  if (input.password.length > maximumPasswordLength) {
    throw new Error("Password must be at most 128 characters");
  }

  const existing = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  if (existing.length > 0) {
    throw new Error("An account with this email already exists");
  }

  try {
    const result = await provisioningAuth.api.createUser({
      body: {
        email,
        name,
        password: input.password,
        role: "INVESTIGATOR",
      },
    });

    return {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: result.user.role ?? "",
    };
  } catch (error) {
    if (error instanceof APIError && error.body?.code === "USER_ALREADY_EXISTS") {
      throw new Error("An account with this email already exists");
    }
    if (isDuplicateEmail(error)) {
      throw new Error("An account with this email already exists");
    }
    throw new Error("Unable to create the investigator account");
  }
}

function isDuplicateEmail(error: unknown): boolean {
  if (!(error instanceof APIError)) {
    return false;
  }
  const body = error.body;
  if (!body || typeof body !== "object") {
    return false;
  }
  return (
    "code" in body &&
    body.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
  );
}
