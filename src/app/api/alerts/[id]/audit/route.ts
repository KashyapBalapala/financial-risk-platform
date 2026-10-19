import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLogs, riskAlerts } from "@/lib/db/schema";
import { enforceSession } from "@/lib/session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const uuidSchema = z.string().uuid();

export async function GET(
  request: NextRequest,
  context: RouteContext,
) {
  const access = await enforceSession(request.headers, [
    "INVESTIGATOR",
    "READ_ONLY",
  ]);
  if (!access.ok) {
    return access.response;
  }

  const { id } = await context.params;

  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json(
      { error: "Invalid alert ID" },
      { status: 400 },
    );
  }

  const params = request.nextUrl.searchParams;
  const limitParam = params.get("limit") ?? "20";
  const offsetParam = params.get("offset") ?? "0";
  const limit = Number(limitParam);
  const offset = Number(offsetParam);

  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    return NextResponse.json(
      {
        error:
          "Invalid query. limit must be 1-100; offset must be non-negative.",
      },
      { status: 400 },
    );
  }

  try {
    const [alert] = await db
      .select({ id: riskAlerts.id })
      .from(riskAlerts)
      .where(eq(riskAlerts.id, id))
      .limit(1);

    if (!alert) {
      return NextResponse.json(
        { error: "Alert not found" },
        { status: 404 },
      );
    }

    const data = await db
      .select({
        id: auditLogs.id,
        alertId: auditLogs.alertId,
        transactionId: auditLogs.transactionId,
        action: auditLogs.action,
        previousStatus: auditLogs.previousStatus,
        newStatus: auditLogs.newStatus,
        actorType: auditLogs.actorType,
        actorId: auditLogs.actorId,
        actorLabel: auditLogs.actorLabel,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(eq(auditLogs.alertId, id))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({
      data,
      pagination: {
        limit,
        offset,
        returned: data.length,
        hasMore: data.length === limit,
      },
    });
  } catch (error) {
    console.error("Failed to list alert audit history", error);

    return NextResponse.json(
      { error: "Unable to retrieve audit history" },
      { status: 500 },
    );
  }
}
