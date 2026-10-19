import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

const pool = new pg.Pool({ connectionString, max: 2 });

afterAll(async () => {
  await pool.end();
});

async function withDatabase(
  run: (client: pg.PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await run(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

async function expectCheckViolation(
  client: pg.PoolClient,
  statement: string,
  params: unknown[] = [],
): Promise<void> {
  await client.query("SAVEPOINT check_violation");
  let violation: unknown;
  try {
    await client.query(statement, params);
  } catch (error) {
    violation = error;
  }
  await client.query("ROLLBACK TO SAVEPOINT check_violation");
  expect(violation).toMatchObject({ code: "23514" });
}

async function seed(client: pg.PoolClient) {
  const ruleCode = `CONSTRAINT_${randomUUID()}`;
  const idempotencyKey = `constraint-${randomUUID()}`;
  await client.query(
    `insert into risk_rules
      (code, description, rule_type, currency, threshold, severity)
     values ($1, 'Constraint test', 'HIGH_VALUE', 'USD', 1, 'HIGH')`,
    [ruleCode],
  );
  const transaction = await client.query<{ id: string; status: string }>(
    `insert into transactions
      (idempotency_key, account_reference, amount, currency, transaction_type)
     values ($1, 'constraint-account', 10, 'USD', 'PAYMENT')
     returning id, status`,
    [idempotencyKey],
  );
  const alert = await client.query<{ id: string; status: string }>(
    `insert into risk_alerts
      (transaction_id, rule_code, severity, reason, evidence)
     values ($1, $2, 'HIGH', 'Constraint test', '{}'::jsonb)
     returning id, status`,
    [transaction.rows[0].id, ruleCode],
  );
  return {
    transactionId: transaction.rows[0].id,
    transactionStatus: transaction.rows[0].status,
    alertId: alert.rows[0].id,
    alertStatus: alert.rows[0].status,
  };
}

describe("status and audit check constraints", () => {
  it("accepts the transaction, alert, and audit values the application stores", async () => {
    await withDatabase(async (client) => {
      const seeded = await seed(client);
      expect(seeded.transactionStatus).toBe("RECEIVED");
      expect(seeded.alertStatus).toBe("OPEN");

      await client.query(
        `update transactions set status = 'RECEIVED' where id = $1`,
        [seeded.transactionId],
      );
      for (const status of ["INVESTIGATING", "CLOSED", "OPEN"]) {
        await client.query(`update risk_alerts set status = $2 where id = $1`, [
          seeded.alertId,
          status,
        ]);
      }

      for (const actorType of ["USER", "SYSTEM"]) {
        await client.query(
          `insert into audit_logs
            (alert_id, transaction_id, action, previous_status, new_status,
             actor_type, actor_label)
           values ($1, $2, 'ALERT_STATUS_CHANGED', 'OPEN', 'INVESTIGATING',
                   $3, 'Constraint Test')`,
          [seeded.alertId, seeded.transactionId, actorType],
        );
      }

      const audits = await client.query<{ count: string }>(
        `select count(*)::text as count from audit_logs where alert_id = $1`,
        [seeded.alertId],
      );
      expect(audits.rows[0].count).toBe("2");
    });
  });

  it("rejects status and audit values outside the allowed sets", async () => {
    await withDatabase(async (client) => {
      const seeded = await seed(client);

      await expectCheckViolation(
        client,
        `update transactions set status = 'POSTED' where id = $1`,
        [seeded.transactionId],
      );
      await expectCheckViolation(
        client,
        `update risk_alerts set status = 'RESOLVED' where id = $1`,
        [seeded.alertId],
      );
      await expectCheckViolation(
        client,
        `insert into audit_logs
          (alert_id, transaction_id, action, previous_status, new_status,
           actor_type, actor_label)
         values ($1, $2, 'ALERT_DELETED', 'OPEN', 'INVESTIGATING', 'USER',
                 'Constraint Test')`,
        [seeded.alertId, seeded.transactionId],
      );
      await expectCheckViolation(
        client,
        `insert into audit_logs
          (alert_id, transaction_id, action, previous_status, new_status,
           actor_type, actor_label)
         values ($1, $2, 'ALERT_STATUS_CHANGED', 'OPEN', 'INVESTIGATING',
                 'ADMIN', 'Constraint Test')`,
        [seeded.alertId, seeded.transactionId],
      );
      await expectCheckViolation(
        client,
        `insert into audit_logs
          (alert_id, transaction_id, action, previous_status, new_status,
           actor_type, actor_label)
         values ($1, $2, 'ALERT_STATUS_CHANGED', 'PENDING', 'INVESTIGATING',
                 'USER', 'Constraint Test')`,
        [seeded.alertId, seeded.transactionId],
      );
      await expectCheckViolation(
        client,
        `insert into audit_logs
          (alert_id, transaction_id, action, previous_status, new_status,
           actor_type, actor_label)
         values ($1, $2, 'ALERT_STATUS_CHANGED', 'OPEN', 'DONE', 'USER',
                 'Constraint Test')`,
        [seeded.alertId, seeded.transactionId],
      );

      const transaction = await client.query<{ status: string }>(
        `select status from transactions where id = $1`,
        [seeded.transactionId],
      );
      const alert = await client.query<{ status: string }>(
        `select status from risk_alerts where id = $1`,
        [seeded.alertId],
      );
      const audits = await client.query<{ count: string }>(
        `select count(*)::text as count from audit_logs where alert_id = $1`,
        [seeded.alertId],
      );

      expect(transaction.rows[0].status).toBe("RECEIVED");
      expect(alert.rows[0].status).toBe("OPEN");
      expect(audits.rows[0].count).toBe("0");
    });
  });
});
