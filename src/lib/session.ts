import "server-only";

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth, revokeDisabledUserSessions } from "./auth";

export type AppRole = "INVESTIGATOR" | "READ_ONLY";

export type AppSession = {
  user: {
    id: string;
    email: string;
    name: string;
    role: AppRole;
  };
};

type ResolvedUser =
  | { state: "anonymous" }
  | { state: "ineligible" }
  | { state: "eligible"; session: AppSession };

async function resolveUser(requestHeaders: Headers): Promise<ResolvedUser> {
  const session = await auth.api.getSession({
    headers: requestHeaders,
  });
  const user = session?.user;

  if (!user?.id || typeof user.email !== "string" || typeof user.name !== "string") {
    return { state: "anonymous" };
  }

  if (user.disabled === true) {
    await revokeDisabledUserSessions(user.id);
    return { state: "anonymous" };
  }

  if (!isAppRole(user.role)) {
    return { state: "ineligible" };
  }

  return {
    state: "eligible",
    session: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    },
  };
}

export async function getSessionFromHeaders(
  requestHeaders: Headers,
): Promise<AppSession | null> {
  const resolved = await resolveUser(requestHeaders);
  return resolved.state === "eligible" ? resolved.session : null;
}

export async function enforceSession(
  requestHeaders: Headers,
  allowedRoles: readonly AppRole[],
): Promise<
  | { ok: true; session: AppSession }
  | { ok: false; response: NextResponse }
> {
  const resolved = await resolveUser(requestHeaders);

  if (resolved.state === "anonymous") {
    return { ok: false, response: denied(401) };
  }

  if (
    resolved.state === "ineligible" ||
    !allowedRoles.includes(resolved.session.user.role)
  ) {
    return { ok: false, response: denied(403) };
  }

  return { ok: true, session: resolved.session };
}

function denied(status: 401 | 403): NextResponse {
  return NextResponse.json(
    {
      error: status === 401 ? "Authentication required" : "Forbidden",
    },
    { status },
  );
}

export async function getRequestSession(): Promise<AppSession | null> {
  return getSessionFromHeaders(await headers());
}

function isAppRole(value: unknown): value is AppRole {
  return value === "INVESTIGATOR" || value === "READ_ONLY";
}
