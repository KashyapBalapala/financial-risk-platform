import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auth } from "../src/lib/auth";
import { db } from "../src/lib/db";
import { session, user } from "../src/lib/db/auth-schema";
import { provisioningAuth } from "../src/lib/provision-auth";
import { createInvestigatorAccount } from "../src/lib/provision-investigator";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3002";

type TransactionRequest = {
  idempotencyKey: string;
  accountReference: string;
  amount: string;
  currency: string;
  transactionType: string;
};

type TransactionResponse = {
  transaction: { id: string };
  replayed: boolean;
  alerts?: Array<{
    id: string;
    ruleCode: string;
    severity: string;
  }>;
};

type AlertResponse = {
  alert?: { status: string };
};

type AlertListResponse = {
  data: Array<{ status: string }>;
};

function transactionRequest(
  amount: string,
  idempotencyKey = randomUUID(),
): TransactionRequest {
  return {
    idempotencyKey,
    accountReference: `ACC-${randomUUID()}`,
    amount,
    currency: "USD",
    transactionType: "PAYMENT",
  };
}

type SignedInAccount = {
  id: string;
  name: string;
  cookie: string;
};

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function signInAccount(
  role: "INVESTIGATOR" | "READ_ONLY",
  name: string,
): Promise<SignedInAccount> {
  const email = `${role.toLowerCase()}-${randomUUID()}@example.com`;
  const password = `Pw-${randomUUID()}`;
  const created =
    role === "INVESTIGATOR"
      ? await createInvestigatorAccount({
          email,
          name,
          password,
          confirmInvestigator: true,
        })
      : await provisioningAuth.api.createUser({
          body: { email, name, password, role: "READ_ONLY" },
        });
  const account =
    "user" in created
      ? {
          id: created.user.id,
          email: created.user.email,
          name: created.user.name,
        }
      : created;
  const response = await auth.api.signInEmail({
    body: { email: account.email, password },
    asResponse: true,
  });

  return {
    id: account.id,
    name: account.name,
    cookie: cookieHeader(response),
  };
}

function requestHeaders(cookie?: string, json = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (json) {
    headers["Content-Type"] = "application/json";
  }
  if (cookie) {
    headers.cookie = cookie;
  }
  return headers;
}

function requiredIngestionToken(): string {
  const token = process.env.TRANSACTION_INGESTION_TOKEN?.trim();
  if (!token) {
    throw new Error("TRANSACTION_INGESTION_TOKEN is not configured");
  }
  return token;
}

function differentIngestionToken(configured: string): string {
  const replacement = configured.startsWith("a") ? "b" : "a";
  return replacement.repeat(configured.length);
}

async function postTransaction(
  body: TransactionRequest,
  options: {
    authorization?: string | null;
    cookie?: string;
  } = {},
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.cookie) {
    headers.cookie = options.cookie;
  }
  const authorization =
    options.authorization === undefined
      ? `Bearer ${requiredIngestionToken()}`
      : options.authorization;
  if (authorization) {
    headers.Authorization = authorization;
  }

  const response = await fetch(`${baseUrl}/api/transactions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as TransactionResponse & {
    error?: string;
  };

  return { response, json };
}

async function patchAlert(
  id: string,
  status: string,
  cookie?: string,
  options: {
    origin?: string | null;
    headers?: Record<string, string>;
  } = {},
) {
  const headers = requestHeaders(cookie, true);
  if (options.origin !== null) {
    headers.Origin = options.origin ?? baseUrl;
  }
  Object.assign(headers, options.headers);

  const response = await fetch(`${baseUrl}/api/alerts/${id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status }),
  });
  const json = (await response.json()) as AlertResponse;

  return { response, json };
}

async function getAlert(id: string, cookie?: string) {
  const response = await fetch(`${baseUrl}/api/alerts/${id}`, {
    headers: requestHeaders(cookie),
  });
  const json = (await response.json()) as AlertResponse;

  return { response, json };
}

type AuditRecord = {
  id: string;
  alertId: string;
  transactionId: string;
  action: string;
  previousStatus: string;
  newStatus: string;
  actorType: string;
  actorId: string | null;
  actorLabel: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type AuditListResponse = {
  data: AuditRecord[];
  pagination: {
    limit: number;
    offset: number;
    returned: number;
    hasMore: boolean;
  };
};

async function getAudit(
  id: string,
  query: { limit?: number; offset?: number } = {},
  cookie?: string,
) {
  const params = new URLSearchParams();
  if (query.limit !== undefined) {
    params.set("limit", String(query.limit));
  }
  if (query.offset !== undefined) {
    params.set("offset", String(query.offset));
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const response = await fetch(
    `${baseUrl}/api/alerts/${id}/audit${suffix}`,
    { headers: requestHeaders(cookie) },
  );
  const json = (await response.json()) as AuditListResponse & {
    error?: string;
  };

  return { response, json };
}

async function createInvestigatingAlert() {
  const investigator = await signInAccount(
    "INVESTIGATOR",
    `Investigator ${randomUUID().slice(0, 8)}`,
  );
  const created = await postTransaction(transactionRequest("12500.00"));
  const alertId = created.json.alerts?.[0]?.id;
  const transactionId = created.json.transaction.id;

  if (!alertId) {
    throw new Error("High-value transaction did not create an alert");
  }

  const patched = await patchAlert(
    alertId,
    "INVESTIGATING",
    investigator.cookie,
  );

  return { created, patched, alertId, transactionId, investigator };
}

let transitionAlertId = "";

describe("transaction risk API", () => {
  it("creates a high-value USD transaction with one HIGH_VALUE_USD alert", async () => {
    const { response, json } = await postTransaction(
      transactionRequest("12500.00"),
    );

    expect(response.status).toBe(201);
    expect(json.replayed).toBe(false);
    expect(json.alerts).toHaveLength(1);
    expect(json.alerts?.[0]?.ruleCode).toBe("HIGH_VALUE_USD");
    expect(json.alerts?.[0]?.severity).toBe("HIGH");
  });

  it("creates a low-value USD transaction with no alerts", async () => {
    const { response, json } = await postTransaction(
      transactionRequest("1250.00"),
    );

    expect(response.status).toBe(201);
    expect(json.alerts).toEqual([]);
  });

  it("replays an identical transaction with the same idempotency key", async () => {
    const request = transactionRequest("1250.00");
    const created = await postTransaction(request);
    const replayed = await postTransaction(request);

    expect(created.response.status).toBe(201);
    expect(replayed.response.status).toBe(200);
    expect(replayed.json.replayed).toBe(true);
    expect(replayed.json.transaction.id).toBe(
      created.json.transaction.id,
    );
  });

  it("rejects reuse of an idempotency key with a different amount", async () => {
    const idempotencyKey = randomUUID();
    const accountReference = `ACC-${randomUUID()}`;
    const created = await postTransaction({
      ...transactionRequest("1250.00", idempotencyKey),
      accountReference,
    });
    const conflict = await postTransaction({
      ...transactionRequest("12500.00", idempotencyKey),
      accountReference,
    });

    expect(created.response.status).toBe(201);
    expect(conflict.response.status).toBe(409);
  });

  it("lists only OPEN alerts", async () => {
    const investigator = await signInAccount(
      "INVESTIGATOR",
      "List Investigator",
    );
    const response = await fetch(
      `${baseUrl}/api/alerts?status=OPEN`,
      { headers: requestHeaders(investigator.cookie) },
    );
    const json = (await response.json()) as AlertListResponse;

    expect(response.status).toBe(200);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.every((alert) => alert.status === "OPEN")).toBe(
      true,
    );
  });

  it("rejects an invalid alert status filter", async () => {
    const investigator = await signInAccount(
      "INVESTIGATOR",
      "Filter Investigator",
    );
    const response = await fetch(
      `${baseUrl}/api/alerts?status=NOT_A_STATUS`,
      { headers: requestHeaders(investigator.cookie) },
    );

    expect(response.status).toBe(400);
  });

  it("rejects an invalid alert id", async () => {
    const investigator = await signInAccount(
      "INVESTIGATOR",
      "Detail Investigator",
    );
    const response = await fetch(`${baseUrl}/api/alerts/not-a-uuid`, {
      headers: requestHeaders(investigator.cookie),
    });

    expect(response.status).toBe(400);
  });

  it("rejects an unsupported transaction type", async () => {
    const { response } = await postTransaction({
      ...transactionRequest("1250.00"),
      transactionType: "REFUND",
    });

    expect(response.status).toBe(400);
  });

  it("rejects an invalid currency", async () => {
    const { response } = await postTransaction({
      ...transactionRequest("1250.00"),
      currency: "US",
    });

    expect(response.status).toBe(400);
  });

  it("rejects zero and negative amounts", async () => {
    const zero = await postTransaction(transactionRequest("0"));
    const negative = await postTransaction(transactionRequest("-1"));

    expect(zero.response.status).toBe(400);
    expect(negative.response.status).toBe(400);
  });

  it("rejects ingestion without a service credential", async () => {
    const request = transactionRequest("1250.00");
    const missing = await postTransaction(request, { authorization: null });
    const created = await postTransaction(request);

    expect(missing.response.status).toBe(401);
    expect(missing.json.error).toBe("Authentication required");
    expect(created.response.status).toBe(201);
    expect(created.json.replayed).toBe(false);
  });

  it("rejects an invalid service credential", async () => {
    const request = transactionRequest("1250.00");
    const invalid = await postTransaction(request, {
      authorization: `Bearer ${differentIngestionToken(requiredIngestionToken())}`,
    });
    const created = await postTransaction(request);

    expect(invalid.response.status).toBe(401);
    expect(invalid.json).toEqual({ error: "Authentication required" });
    expect(created.response.status).toBe(201);
    expect(created.json.replayed).toBe(false);
  });

  it("does not accept an investigator session as ingestion authorization", async () => {
    const investigator = await signInAccount(
      "INVESTIGATOR",
      "Ingestion Investigator",
    );
    const request = transactionRequest("12500.00");
    const denied = await postTransaction(request, {
      authorization: null,
      cookie: investigator.cookie,
    });
    const created = await postTransaction(request);

    expect(denied.response.status).toBe(401);
    expect(created.response.status).toBe(201);
    expect(created.json.replayed).toBe(false);
    expect(created.json.alerts).toHaveLength(1);
    expect(created.json.alerts?.[0]?.ruleCode).toBe("HIGH_VALUE_USD");
  });

  it("rejects an amount with more than four decimal places", async () => {
    const { response } = await postTransaction(
      transactionRequest("12.12345"),
    );

    expect(response.status).toBe(400);
  });

  it("moves a new high-value alert from OPEN to INVESTIGATING", async () => {
    const { response, json } = await postTransaction(
      transactionRequest("12500.00"),
    );
    const alertId = json.alerts?.[0]?.id;

    expect(response.status).toBe(201);
    expect(alertId).toEqual(expect.any(String));

    const investigator = await signInAccount(
      "INVESTIGATOR",
      "Transition Investigator",
    );
    const patched = await patchAlert(
      alertId as string,
      "INVESTIGATING",
      investigator.cookie,
    );

    expect(patched.response.status).toBe(200);
    expect(patched.json.alert?.status).toBe("INVESTIGATING");
    transitionAlertId = alertId as string;
  });

  it("rejects an invalid status and leaves the alert INVESTIGATING", async () => {
    expect(transitionAlertId).not.toBe("");

    const investigator = await signInAccount(
      "INVESTIGATOR",
      "Invalid Status Investigator",
    );
    const rejected = await patchAlert(
      transitionAlertId,
      "INVALID",
      investigator.cookie,
    );
    const current = await getAlert(transitionAlertId, investigator.cookie);

    expect(rejected.response.status).toBe(400);
    expect(current.response.status).toBe(200);
    expect(current.json.alert?.status).toBe("INVESTIGATING");
  });

  it("records one audit event when an alert status changes", async () => {
    const { created, patched, alertId, transactionId, investigator } =
      await createInvestigatingAlert();
    const audit = await getAudit(alertId, {}, investigator.cookie);

    expect(created.response.status).toBe(201);
    expect(patched.response.status).toBe(200);
    expect(patched.json.alert?.status).toBe("INVESTIGATING");
    expect(audit.response.status).toBe(200);
    expect(audit.json.data).toHaveLength(1);

    const event = audit.json.data[0];
    expect(event?.action).toBe("ALERT_STATUS_CHANGED");
    expect(event?.previousStatus).toBe("OPEN");
    expect(event?.newStatus).toBe("INVESTIGATING");
    expect(event?.actorType).toBe("USER");
    expect(event?.actorId).toBe(investigator.id);
    expect(event?.actorLabel).toBe(investigator.name);

    await db
      .update(user)
      .set({ name: "Renamed After Audit" })
      .where(eq(user.id, investigator.id));
    const snapshot = await getAudit(alertId, {}, investigator.cookie);
    expect(snapshot.json.data[0]?.actorLabel).toBe(investigator.name);
    expect(event?.alertId).toBe(alertId);
    expect(event?.transactionId).toBe(transactionId);
    expect(Number.isNaN(Date.parse(event?.createdAt ?? ""))).toBe(false);
  });

  it("does not record another audit event when the status is unchanged", async () => {
    const { alertId, investigator } = await createInvestigatingAlert();
    const before = await getAudit(alertId, {}, investigator.cookie);
    const repeated = await patchAlert(
      alertId,
      "INVESTIGATING",
      investigator.cookie,
    );
    const after = await getAudit(alertId, {}, investigator.cookie);

    expect(repeated.response.status).toBe(200);
    expect(repeated.json).toMatchObject({
      message: "Alert already has this status",
      status: "INVESTIGATING",
    });
    expect(before.json.data).toHaveLength(1);
    expect(after.json.data).toHaveLength(before.json.data.length);
  });

  it("does not record an audit event for a rejected status", async () => {
    const { alertId, investigator } = await createInvestigatingAlert();
    const before = await getAudit(alertId, {}, investigator.cookie);
    const rejected = await patchAlert(
      alertId,
      "INVALID",
      investigator.cookie,
    );
    const current = await getAlert(alertId, investigator.cookie);
    const after = await getAudit(alertId, {}, investigator.cookie);

    expect(rejected.response.status).toBe(400);
    expect(current.response.status).toBe(200);
    expect(current.json.alert?.status).toBe("INVESTIGATING");
    expect(before.json.data).toHaveLength(1);
    expect(after.json.data).toHaveLength(before.json.data.length);
  });

  it("validates audit history requests", async () => {
    const reader = await signInAccount("INVESTIGATOR", "Audit Validator");
    const missingId = randomUUID();
    const invalidId = await getAudit("not-a-uuid", {}, reader.cookie);
    const missing = await getAudit(missingId, {}, reader.cookie);
    const badLimit = await getAudit(missingId, { limit: 0 }, reader.cookie);
    const badOffset = await getAudit(
      missingId,
      { offset: -1 },
      reader.cookie,
    );

    expect(invalidId.response.status).toBe(400);
    expect(missing.response.status).toBe(404);
    expect(badLimit.response.status).toBe(400);
    expect(badOffset.response.status).toBe(400);
  });

  it("paginates audit history newest first", async () => {
    const { alertId, investigator } = await createInvestigatingAlert();
    const reopened = await patchAlert(alertId, "OPEN", investigator.cookie);
    const investigatingAgain = await patchAlert(
      alertId,
      "INVESTIGATING",
      investigator.cookie,
    );
    const closed = await patchAlert(alertId, "CLOSED", investigator.cookie);

    expect(reopened.response.status).toBe(200);
    expect(investigatingAgain.response.status).toBe(200);
    expect(closed.response.status).toBe(200);

    const firstPage = await getAudit(
      alertId,
      { limit: 3, offset: 0 },
      investigator.cookie,
    );
    const secondPage = await getAudit(
      alertId,
      { limit: 3, offset: 3 },
      investigator.cookie,
    );

    expect(firstPage.response.status).toBe(200);
    expect(firstPage.json.data).toHaveLength(3);
    expect(firstPage.json.pagination).toEqual({
      limit: 3,
      offset: 0,
      returned: 3,
      hasMore: true,
    });
    expect(firstPage.json.data[0]?.newStatus).toBe("CLOSED");
    expect(firstPage.json.data[0]?.previousStatus).toBe("INVESTIGATING");
    expect(firstPage.json.data[1]?.newStatus).toBe("INVESTIGATING");
    expect(firstPage.json.data[1]?.previousStatus).toBe("OPEN");

    expect(secondPage.response.status).toBe(200);
    expect(secondPage.json.data).toHaveLength(1);
    expect(secondPage.json.pagination).toEqual({
      limit: 3,
      offset: 3,
      returned: 1,
      hasMore: false,
    });
    expect(
      Date.parse(firstPage.json.data[0]?.createdAt ?? ""),
    ).toBeGreaterThanOrEqual(
      Date.parse(secondPage.json.data[0]?.createdAt ?? ""),
    );
  });

  it("rejects anonymous reads and updates without changing the alert", async () => {
    const created = await postTransaction(transactionRequest("12500.00"));
    const alertId = created.json.alerts?.[0]?.id;

    expect(alertId).toEqual(expect.any(String));

    const list = await fetch(`${baseUrl}/api/alerts`);
    const detail = await fetch(`${baseUrl}/api/alerts/${alertId}`);
    const audit = await fetch(`${baseUrl}/api/alerts/${alertId}/audit`);
    const invalidSession = await fetch(`${baseUrl}/api/alerts`, {
      headers: { cookie: "better-auth.session_token=invalid" },
    });
    const patched = await patchAlert(alertId as string, "INVESTIGATING");

    expect(list.status).toBe(401);
    expect(detail.status).toBe(401);
    expect(audit.status).toBe(401);
    expect(invalidSession.status).toBe(401);
    expect(patched.response.status).toBe(401);

    const investigator = await signInAccount(
      "INVESTIGATOR",
      "Anonymous Checker",
    );
    const current = await getAlert(alertId as string, investigator.cookie);
    const history = await getAudit(alertId as string, {}, investigator.cookie);

    expect(current.response.status).toBe(200);
    expect(current.json.alert?.status).toBe("OPEN");
    expect(history.json.data).toHaveLength(0);
  });

  it("lets a read-only user read alerts but not change them", async () => {
    const created = await postTransaction(transactionRequest("12500.00"));
    const alertId = created.json.alerts?.[0]?.id as string;
    const reader = await signInAccount("READ_ONLY", "Read Only Analyst");

    const list = await fetch(`${baseUrl}/api/alerts?status=OPEN`, {
      headers: requestHeaders(reader.cookie),
    });
    const detail = await getAlert(alertId, reader.cookie);
    const audit = await getAudit(alertId, {}, reader.cookie);
    const patched = await patchAlert(alertId, "INVESTIGATING", reader.cookie);
    const after = await getAlert(alertId, reader.cookie);
    const history = await getAudit(alertId, {}, reader.cookie);

    expect(list.status).toBe(200);
    const listed = (await list.json()) as AlertListResponse;
    expect(listed.data.every((alert) => alert.status === "OPEN")).toBe(true);
    expect(detail.response.status).toBe(200);
    expect(detail.json.alert?.status).toBe("OPEN");
    expect(audit.response.status).toBe(200);
    expect(patched.response.status).toBe(403);
    expect(after.json.alert?.status).toBe("OPEN");
    expect(history.json.data).toHaveLength(0);
  });

  it("does not record an audit event for a rejected transition", async () => {
    const created = await postTransaction(transactionRequest("12500.00"));
    const alertId = created.json.alerts?.[0]?.id as string;
    const investigator = await signInAccount(
      "INVESTIGATOR",
      "Rejected Transition Investigator",
    );
    const rejected = await patchAlert(alertId, "CLOSED", investigator.cookie);
    const current = await getAlert(alertId, investigator.cookie);
    const history = await getAudit(alertId, {}, investigator.cookie);

    expect(rejected.response.status).toBe(409);
    expect(current.json.alert?.status).toBe("OPEN");
    expect(history.json.data).toHaveLength(0);
  });

  it("revokes a disabled investigator session without changing the alert", async () => {
    const created = await postTransaction(transactionRequest("12500.00"));
    const alertId = created.json.alerts?.[0]?.id as string;
    const email = `disabled-${randomUUID()}@example.com`;
    const password = `Pw-${randomUUID()}`;
    const disabled = await createInvestigatorAccount({
      email,
      name: "Disabled Investigator",
      password,
      confirmInvestigator: true,
    });
    const signedIn = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    const cookie = cookieHeader(signedIn);

    await db
      .update(user)
      .set({ disabled: true })
      .where(eq(user.id, disabled.id));

    const list = await fetch(`${baseUrl}/api/alerts`, {
      headers: requestHeaders(cookie),
    });
    const detail = await getAlert(alertId, cookie);
    const audit = await getAudit(alertId, {}, cookie);
    const patched = await patchAlert(alertId, "INVESTIGATING", cookie);
    const remainingSessions = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, disabled.id));

    expect(list.status).toBe(401);
    expect(detail.response.status).toBe(401);
    expect(audit.response.status).toBe(401);
    expect(patched.response.status).toBe(401);
    expect(remainingSessions).toEqual([]);

    await db
      .update(user)
      .set({ disabled: false })
      .where(eq(user.id, disabled.id));

    const afterReenable = await fetch(`${baseUrl}/api/alerts`, {
      headers: requestHeaders(cookie),
    });
    expect(afterReenable.status).toBe(401);

    const restored = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    const restoredCookie = cookieHeader(restored);
    const updated = await patchAlert(
      alertId,
      "INVESTIGATING",
      restoredCookie,
    );
    const current = await getAlert(alertId, restoredCookie);

    expect(restored.status).toBe(200);
    expect(updated.response.status).toBe(200);
    expect(current.json.alert?.status).toBe("INVESTIGATING");
  });

  it("does not change an alert when the actor display name is invalid", async () => {
    const created = await postTransaction(transactionRequest("12500.00"));
    const alertId = created.json.alerts?.[0]?.id as string;
    const investigator = await signInAccount(
      "INVESTIGATOR",
      "Audit Investigator",
    );

    const moved = await patchAlert(
      alertId,
      "INVESTIGATING",
      investigator.cookie,
    );
    const history = await getAudit(alertId, {}, investigator.cookie);

    expect(moved.response.status).toBe(200);
    expect(moved.json.alert?.status).toBe("INVESTIGATING");
    expect(history.json.data).toHaveLength(1);
    expect(history.json.data[0]?.actorLabel).toBe(investigator.name);
    expect(history.json.data[0]?.actorId).toBe(investigator.id);

    await db
      .update(user)
      .set({ name: "n".repeat(129) })
      .where(eq(user.id, investigator.id));

    const rejected = await patchAlert(alertId, "OPEN", investigator.cookie);
    const afterLongName = await getAlert(alertId, investigator.cookie);
    const historyAfterLongName = await getAudit(
      alertId,
      {},
      investigator.cookie,
    );

    expect(rejected.response.status).toBe(400);
    expect(rejected.json).toMatchObject({
      error: "Display name must be at most 128 characters",
    });
    expect(afterLongName.json.alert?.status).toBe("INVESTIGATING");
    expect(historyAfterLongName.json.data).toHaveLength(1);
    expect(historyAfterLongName.json.data[0]?.actorLabel).toBe(
      investigator.name,
    );

    await db
      .update(user)
      .set({ name: "   " })
      .where(eq(user.id, investigator.id));

    const blank = await patchAlert(alertId, "OPEN", investigator.cookie);
    const afterBlank = await getAlert(alertId, investigator.cookie);
    const historyAfterBlank = await getAudit(alertId, {}, investigator.cookie);

    expect(blank.response.status).toBe(400);
    expect(blank.json).toMatchObject({
      error: "A display name is required",
    });
    expect(afterBlank.json.alert?.status).toBe("INVESTIGATING");
    expect(historyAfterBlank.json.data).toHaveLength(1);
  });

  it("accepts a same-origin alert update and rejects a mismatched or cross-site one", async () => {
    const created = await postTransaction(transactionRequest("12500.00"));
    const alertId = created.json.alerts?.[0]?.id as string;
    const investigator = await signInAccount(
      "INVESTIGATOR",
      "Origin Investigator",
    );

    const moved = await patchAlert(
      alertId,
      "INVESTIGATING",
      investigator.cookie,
    );
    const history = await getAudit(alertId, {}, investigator.cookie);

    expect(moved.response.status).toBe(200);
    expect(moved.json.alert?.status).toBe("INVESTIGATING");
    expect(history.json.data).toHaveLength(1);
    expect(history.json.data[0]?.action).toBe("ALERT_STATUS_CHANGED");
    expect(history.json.data[0]?.newStatus).toBe("INVESTIGATING");
    expect(history.json.data[0]?.actorId).toBe(investigator.id);
    expect(history.json.data[0]?.actorLabel).toBe(investigator.name);

    const mismatched = await patchAlert(alertId, "OPEN", investigator.cookie, {
      origin: "https://evil.example",
    });
    const afterMismatch = await getAlert(alertId, investigator.cookie);
    const historyAfterMismatch = await getAudit(
      alertId,
      {},
      investigator.cookie,
    );

    expect(mismatched.response.status).toBe(403);
    expect(afterMismatch.json.alert?.status).toBe("INVESTIGATING");
    expect(historyAfterMismatch.json.data).toHaveLength(1);

    const crossSite = await patchAlert(alertId, "OPEN", investigator.cookie, {
      origin: null,
      headers: {
        "Sec-Fetch-Site": "cross-site",
        "X-Forwarded-Host": new URL(baseUrl).host,
      },
    });
    const afterCrossSite = await getAlert(alertId, investigator.cookie);
    const historyAfterCrossSite = await getAudit(
      alertId,
      {},
      investigator.cookie,
    );

    expect(crossSite.response.status).toBe(403);
    expect(afterCrossSite.json.alert?.status).toBe("INVESTIGATING");
    expect(historyAfterCrossSite.json.data).toHaveLength(1);
  });
});

describe("clickjacking headers", () => {
  it("denies framing on the login page and alert API", async () => {
    const login = await fetch(`${baseUrl}/login`, { redirect: "manual" });
    const alerts = await fetch(`${baseUrl}/api/alerts`, { redirect: "manual" });

    for (const response of [login, alerts]) {
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("content-security-policy")).toContain(
        "frame-ancestors 'none'",
      );
    }
  });
});
