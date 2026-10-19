import "server-only";

import { timingSafeEqual } from "node:crypto";

const unauthorized = {
  ok: false as const,
  status: 401 as const,
  error: "Authentication required",
};

const unconfigured = {
  ok: false as const,
  status: 503 as const,
  error: "Transaction ingestion is unavailable",
};

export function authorizeTransactionIngestion(
  authorizationHeader: string | null,
):
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string } {
  const configured = process.env.TRANSACTION_INGESTION_TOKEN?.trim() ?? "";
  if (!configured) {
    return unconfigured;
  }

  const presented = bearerToken(authorizationHeader);
  if (presented === null || !tokensMatch(presented, configured)) {
    return unauthorized;
  }

  return { ok: true };
}

function bearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorizationHeader.slice("Bearer ".length);
  if (!token || /\s/.test(token)) {
    return null;
  }

  return token;
}

function tokensMatch(presented: string, expected: string): boolean {
  const presentedBytes = Buffer.from(presented);
  const expectedBytes = Buffer.from(expected);

  // timingSafeEqual throws when the buffers have different lengths.
  if (presentedBytes.length !== expectedBytes.length) {
    return false;
  }

  return timingSafeEqual(presentedBytes, expectedBytes);
}
