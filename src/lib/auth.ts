import "server-only";

import { eq } from "drizzle-orm";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { nextCookies } from "better-auth/next-js";
import {
  applicationOrigin,
  applicationProtocol,
  secureCookiesEnabled,
} from "./application-origin.ts";
import { acceptedDisplayName } from "./display-name.ts";
import * as authSchema from "./db/auth-schema.ts";
import { db } from "./db/index.ts";

// There is no application endpoint for disabling an account. An operator sets
// `user.disabled` in the database. These hooks are what make that flag take
// effect: a disabled user cannot be given a new session, and the next time
// one of their existing sessions is presented, every session row for that
// user is deleted. Turning `disabled` back to false does not recreate those
// rows, so the old cookie cannot be used again. The rows remain until that
// presentation if the flag is set and then cleared with no request in between.
const invalidCredentials = {
  code: "INVALID_EMAIL_OR_PASSWORD",
  message: "Invalid email or password",
} as const;

export async function revokeDisabledUserSessions(userId: string): Promise<void> {
  await db.delete(authSchema.session).where(eq(authSchema.session.userId, userId));
}

function validatedDisplayName(name: unknown): string | undefined {
  if (name === undefined) {
    return undefined;
  }
  if (typeof name !== "string") {
    throw APIError.from("BAD_REQUEST", {
      message: "A display name is required",
      code: "INVALID_DISPLAY_NAME",
    });
  }

  try {
    return acceptedDisplayName(name);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "A display name is required";
    throw APIError.from("BAD_REQUEST", {
      message,
      code: "INVALID_DISPLAY_NAME",
    });
  }
}

function accountIsDisabled(account: object): boolean {
  return "disabled" in account && account.disabled === true;
}

const rejectDisabledSessions = createAuthMiddleware(async (ctx) => {
  const sessionToken = await ctx.getSignedCookie(
    ctx.context.authCookies.sessionToken.name,
    ctx.context.secret,
  );
  if (!sessionToken) {
    return;
  }

  const found = await ctx.context.internalAdapter.findSession(sessionToken);
  if (!found || !accountIsDisabled(found.user)) {
    return;
  }

  await revokeDisabledUserSessions(found.user.id);
  ctx.context.session = null;
  deleteSessionCookie(ctx);
});

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

const secret = requiredEnv("BETTER_AUTH_SECRET");

if (secret.length < 32) {
  throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
}

const trustedOrigin = applicationOrigin;
const secureCookies = secureCookiesEnabled(
  applicationProtocol,
  process.env.NODE_ENV,
);

export function createRiskLensAuth<Plugins extends BetterAuthPlugin[]>(
  plugins: Plugins,
) {
  return betterAuth({
    secret,
    baseURL: trustedOrigin,
    trustedOrigins: [trustedOrigin],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
    },
    user: {
      additionalFields: {
        role: {
          type: ["INVESTIGATOR", "READ_ONLY"],
          required: true,
          defaultValue: "READ_ONLY",
          input: false,
        },
        disabled: {
          type: "boolean",
          required: true,
          defaultValue: false,
          input: false,
        },
      },
    },
    advanced: {
      useSecureCookies: secureCookies,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookies,
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (createdUser) => {
            const name = validatedDisplayName(createdUser.name);
            if (!name) {
              throw APIError.from("BAD_REQUEST", {
                message: "A display name is required",
                code: "INVALID_DISPLAY_NAME",
              });
            }
            if (name !== createdUser.name) {
              return { data: { name } };
            }
          },
        },
        update: {
          before: async (updatedUser) => {
            if (!Object.hasOwn(updatedUser, "name")) {
              return;
            }
            const name = validatedDisplayName(updatedUser.name);
            if (name !== undefined && name !== updatedUser.name) {
              return { data: { name } };
            }
          },
        },
      },
      session: {
        create: {
          before: async (createdSession) => {
            const [account] = await db
              .select({ disabled: authSchema.user.disabled })
              .from(authSchema.user)
              .where(eq(authSchema.user.id, createdSession.userId))
              .limit(1);

            if (account?.disabled !== true) {
              return;
            }

            await revokeDisabledUserSessions(createdSession.userId);
            throw APIError.from("UNAUTHORIZED", invalidCredentials);
          },
        },
      },
    },
    hooks: {
      before: rejectDisabledSessions,
    },
    plugins,
  });
}

export const auth = createRiskLensAuth([nextCookies()]);
