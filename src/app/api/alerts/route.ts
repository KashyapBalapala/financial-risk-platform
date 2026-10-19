import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { riskAlerts, transactions } from "@/lib/db/schema";
import { enforceSession } from "@/lib/session";

const alertStatusSchema = z.enum([
  "OPEN",
  "INVESTIGATING",
  "CLOSED",
]);

export async function GET(request: NextRequest) {
  const access = await enforceSession(request.headers, [
    "INVESTIGATOR",
    "READ_ONLY",
  ]);
  if (!access.ok) {
    return access.response;
  }

  const params = request.nextUrl.searchParams;
  const statusParam = params.get("status");
  const limitParam = params.get("limit") ?? "20";
  const offsetParam = params.get("offset") ?? "0";

  const statusResult = statusParam
    ? alertStatusSchema.safeParse(statusParam)
    : null;

  const limit = Number(limitParam);
  const offset = Number(offsetParam);

  if (
    (statusParam && !statusResult?.success) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    return NextResponse.json(
      {
        error:
          "Invalid query. status must be OPEN, INVESTIGATING, or CLOSED; limit must be 1-100; offset must be non-negative.",
      },
      { status: 400 },
    );
  }

  try {
    const filters = statusResult?.success
      ? [eq(riskAlerts.status, statusResult.data)]
      : [];

    const alerts = await db
      .select({
        id: riskAlerts.id,
        transactionId: riskAlerts.transactionId,
        ruleCode: riskAlerts.ruleCode,
        severity: riskAlerts.severity,
        reason: riskAlerts.reason,
        evidence: riskAlerts.evidence,
        status: riskAlerts.status,
        createdAt: riskAlerts.createdAt,
        transaction: {
          accountReference: transactions.accountReference,
          amount: transactions.amount,
          currency: transactions.currency,
          transactionType: transactions.transactionType,
          transactionStatus: transactions.status,
        },
      })
      .from(riskAlerts)
      .innerJoin(
        transactions,
        eq(riskAlerts.transactionId, transactions.id),
      )
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(riskAlerts.createdAt), desc(riskAlerts.id))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({
      data: alerts,
      pagination: {
        limit,
        offset,
        returned: alerts.length,
        hasMore: alerts.length === limit,
      },
    });
  } catch (error) {
    console.error("Failed to list risk alerts", error);

    return NextResponse.json(
      { error: "Unable to retrieve alerts" },
      { status: 500 },
    );
  }
}
