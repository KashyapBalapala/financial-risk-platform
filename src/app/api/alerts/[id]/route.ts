import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLogs, riskAlerts, transactions, user } from "@/lib/db/schema";
import { storedDisplayNameError } from "@/lib/display-name";
import { stateChangingRequestAllowed } from "@/lib/same-origin";
import { enforceSession } from "@/lib/session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const uuidSchema = z.string().uuid();

const statusSchema = z.enum([
  "OPEN",
  "INVESTIGATING",
  "CLOSED",
]);

type AlertStatus = z.infer<typeof statusSchema>;

const allowedTransitions: Record<AlertStatus, AlertStatus[]> = {
  OPEN: ["INVESTIGATING"],
  INVESTIGATING: ["OPEN", "CLOSED"],
  CLOSED: [],
};

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

  try {
    const [result] = await db
      .select({
        alert: riskAlerts,
        transaction: transactions,
      })
      .from(riskAlerts)
      .innerJoin(
        transactions,
        eq(riskAlerts.transactionId, transactions.id),
      )
      .where(eq(riskAlerts.id, id))
      .limit(1);

    if (!result) {
      return NextResponse.json(
        { error: "Alert not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to retrieve risk alert", error);

    return NextResponse.json(
      { error: "Unable to retrieve alert" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  if (!stateChangingRequestAllowed(request.headers)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const access = await enforceSession(request.headers, ["INVESTIGATOR"]);
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

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = z
    .object({ status: statusSchema })
    .strict()
    .safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request body",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const actorUserId = access.session.user.id;

  try {
    const result = await db.transaction(async (tx) => {
      const [actor] = await tx
        .select({
          id: user.id,
          name: user.name,
          role: user.role,
          disabled: user.disabled,
        })
        .from(user)
        .where(eq(user.id, actorUserId))
        .limit(1)
        .for("update");

      if (!actor || actor.disabled || actor.role !== "INVESTIGATOR") {
        return {
          status: 403,
          body: { error: "Forbidden" },
        };
      }

      const nameError = storedDisplayNameError(actor.name);
      if (nameError) {
        return {
          status: 400,
          body: { error: nameError },
        };
      }

      const [current] = await tx
        .select({
          status: riskAlerts.status,
          transactionId: riskAlerts.transactionId,
        })
        .from(riskAlerts)
        .where(eq(riskAlerts.id, id))
        .limit(1);

      if (!current) {
        return {
          status: 404,
          body: { error: "Alert not found" },
        };
      }

      const currentStatus = statusSchema.safeParse(current.status);

      if (!currentStatus.success) {
        return {
          status: 409,
          body: { error: "Alert has an unsupported current status" },
        };
      }

      const nextStatus = parsed.data.status;

      if (currentStatus.data === nextStatus) {
        return {
          status: 200,
          body: {
            message: "Alert already has this status",
            status: nextStatus,
          },
        };
      }

      if (
        !allowedTransitions[currentStatus.data].includes(nextStatus)
      ) {
        return {
          status: 409,
          body: {
            error: "Invalid status transition",
            currentStatus: currentStatus.data,
            requestedStatus: nextStatus,
            allowedStatuses: allowedTransitions[currentStatus.data],
          },
        };
      }

      // Compare-and-set prevents overwriting a concurrent status change.
      const [updated] = await tx
        .update(riskAlerts)
        .set({ status: nextStatus })
        .where(
          and(
            eq(riskAlerts.id, id),
            eq(riskAlerts.status, currentStatus.data),
          ),
        )
        .returning();

      if (!updated) {
        return {
          status: 409,
          body: {
            error: "Alert changed concurrently; reload and retry",
          },
        };
      }

      await tx.insert(auditLogs).values({
        alertId: updated.id,
        transactionId: current.transactionId,
        action: "ALERT_STATUS_CHANGED",
        previousStatus: currentStatus.data,
        newStatus: nextStatus,
        actorType: "USER",
        actorId: actor.id,
        actorLabel: actor.name,
        metadata: {},
      });

      return {
        status: 200,
        body: { alert: updated },
      };
    });

    return NextResponse.json(result.body, {
      status: result.status,
    });
  } catch (error) {
    console.error("Failed to update risk alert", error);

    return NextResponse.json(
      { error: "Unable to update alert" },
      { status: 500 },
    );
  }
}
