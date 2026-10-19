import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  riskAlerts,
  riskRules,
  transactions,
} from "@/lib/db/schema";
import { authorizeTransactionIngestion } from "@/lib/ingestion-auth";

const transactionSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(128),
  accountReference: z.string().trim().min(1).max(100),
  amount: z
    .string()
    .regex(
      /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/,
      "Amount must be a positive decimal with at most 4 decimal places",
    )
    .refine((value) => /[1-9]/.test(value), {
      message: "Amount must be greater than zero",
    }),
  currency: z.string().regex(/^[A-Z]{3}$/),
  transactionType: z.enum([
    "PAYMENT",
    "TRANSFER",
    "DEPOSIT",
    "WITHDRAWAL",
  ]),
});

// Convert a decimal amount into integer units of 0.0001.
// This avoids floating-point arithmetic when comparing money.
function toScaledUnits(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(10000) +
    BigInt(fraction.padEnd(4, "0"));
}

export async function POST(request: NextRequest) {
  const access = authorizeTransactionIngestion(
    request.headers.get("authorization"),
  );
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
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

  const parsed = transactionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const input = parsed.data;

  try {
    const result = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(transactions)
        .values(input)
        .onConflictDoNothing({
          target: transactions.idempotencyKey,
        })
        .returning();

      if (created) {
        const rules = await tx
          .select()
          .from(riskRules)
          .where(
            and(
              eq(riskRules.enabled, true),
              eq(riskRules.currency, created.currency),
            ),
          );

        const generatedAlerts: (typeof riskAlerts.$inferSelect)[] =
          [];

        for (const rule of rules) {
          // Implement the first rule type: high-value transactions.
          if (rule.ruleType !== "HIGH_VALUE") {
            continue;
          }

          if (
            toScaledUnits(created.amount) <
            toScaledUnits(rule.threshold)
          ) {
            continue;
          }

          const [alert] = await tx
            .insert(riskAlerts)
            .values({
              transactionId: created.id,
              ruleCode: rule.code,
              severity: rule.severity,
              reason:
                `${rule.description}. Transaction amount ` +
                `${created.amount} ${created.currency} meets or ` +
                `exceeds the threshold of ${rule.threshold} ` +
                `${rule.currency}.`,
              evidence: {
                accountReference: created.accountReference,
                amount: created.amount,
                currency: created.currency,
                threshold: rule.threshold,
                transactionType: created.transactionType,
                ruleCode: rule.code,
              },
            })
            .returning();

          if (alert) {
            generatedAlerts.push(alert);
          }
        }

        return {
          status: 201,
          body: {
            transaction: created,
            replayed: false,
            alerts: generatedAlerts,
          },
        };
      }

      // The idempotency key already exists.
      const [existing] = await tx
        .select()
        .from(transactions)
        .where(
          eq(
            transactions.idempotencyKey,
            input.idempotencyKey,
          ),
        )
        .limit(1);

      if (!existing) {
        return {
          status: 503,
          body: {
            error: "Unable to resolve transaction conflict",
          },
        };
      }

      const sameRequest =
        existing.accountReference === input.accountReference &&
        toScaledUnits(existing.amount) ===
          toScaledUnits(input.amount) &&
        existing.currency === input.currency &&
        existing.transactionType === input.transactionType;

      if (!sameRequest) {
        return {
          status: 409,
          body: {
            error:
              "Idempotency key was already used for a different transaction",
          },
        };
      }

      return {
        status: 200,
        body: {
          transaction: existing,
          replayed: true,
        },
      };
    });

    return NextResponse.json(result.body, {
      status: result.status,
    });
  } catch (error) {
    console.error("Transaction ingestion failed", error);

    return NextResponse.json(
      { error: "Unable to process transaction" },
      { status: 500 },
    );
  }
}
