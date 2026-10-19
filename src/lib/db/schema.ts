import {
  pgTable,
  uuid,
  varchar,
  numeric,
  timestamp,
  boolean,
  jsonb,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    // Unique identifier supplied by the transaction source.
    idempotencyKey: varchar("idempotency_key", {
      length: 128,
    }).notNull(),

    accountReference: varchar("account_reference", {
      length: 100,
    }).notNull(),

    amount: numeric("amount", {
      precision: 19,
      scale: 4,
    }).notNull(),

    currency: varchar("currency", {
      length: 3,
    }).notNull(),

    transactionType: varchar("transaction_type", {
      length: 30,
    }).notNull(),

    status: varchar("status", {
      length: 20,
    }).notNull().default("RECEIVED"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("transactions_idempotency_key_uq")
      .on(table.idempotencyKey),

    index("transactions_account_created_idx")
      .on(table.accountReference, table.createdAt),

    check(
      "transactions_amount_positive",
      sql`${table.amount} > 0`,
    ),

    check(
      "transactions_status_allowed",
      sql`${table.status} in ('RECEIVED')`,
    ),
  ],
);

export const riskRules = pgTable(
  "risk_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    code: varchar("code", { length: 100 })
      .notNull()
      .unique(),

    description: varchar("description", {
      length: 500,
    }).notNull(),

    ruleType: varchar("rule_type", {
      length: 50,
    }).notNull(),

    currency: varchar("currency", {
      length: 3,
    }).notNull(),

    threshold: numeric("threshold", {
      precision: 19,
      scale: 4,
    }).notNull(),

    severity: varchar("severity", {
      length: 20,
    }).notNull(),

    enabled: boolean("enabled")
      .notNull()
      .default(true),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "risk_rules_threshold_positive",
      sql`${table.threshold} > 0`,
    ),
  ],
);

export const riskAlerts = pgTable(
  "risk_alerts",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id),

    ruleCode: varchar("rule_code", {
      length: 100,
    }).notNull()
      .references(() => riskRules.code),

    severity: varchar("severity", {
      length: 20,
    }).notNull(),

    reason: varchar("reason", {
      length: 1000,
    }).notNull(),

    evidence: jsonb("evidence")
      .$type<Record<string, unknown>>()
      .notNull(),

    status: varchar("status", {
      length: 30,
    }).notNull()
      .default("OPEN"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("risk_alerts_transaction_rule_uq")
      .on(table.transactionId, table.ruleCode),

    index("risk_alerts_status_created_idx")
      .on(table.status, table.createdAt),

    check(
      "risk_alerts_status_allowed",
      sql`${table.status} in ('OPEN', 'INVESTIGATING', 'CLOSED')`,
    ),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    alertId: uuid("alert_id")
      .notNull()
      .references(() => riskAlerts.id, { onDelete: "no action" }),

    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "no action" }),

    action: varchar("action", { length: 50 }).notNull(),

    previousStatus: varchar("previous_status", {
      length: 30,
    }).notNull(),

    newStatus: varchar("new_status", {
      length: 30,
    }).notNull(),

    actorType: varchar("actor_type", {
      length: 20,
    }).notNull(),

    actorId: varchar("actor_id", {
      length: 128,
    }),

    actorLabel: varchar("actor_label", {
      length: 128,
    }).notNull(),

    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_alert_created_idx")
      .on(table.alertId, table.createdAt),

    index("audit_logs_transaction_created_idx")
      .on(table.transactionId, table.createdAt),

    check(
      "audit_logs_action_allowed",
      sql`${table.action} in ('ALERT_STATUS_CHANGED')`,
    ),

    check(
      "audit_logs_actor_type_allowed",
      sql`${table.actorType} in ('USER', 'SYSTEM')`,
    ),

    check(
      "audit_logs_previous_status_allowed",
      sql`${table.previousStatus} in ('OPEN', 'INVESTIGATING', 'CLOSED')`,
    ),

    check(
      "audit_logs_new_status_allowed",
      sql`${table.newStatus} in ('OPEN', 'INVESTIGATING', 'CLOSED')`,
    ),
  ],
);

export {
  account,
  accountRelations,
  session,
  sessionRelations,
  user,
  userRelations,
  verification,
} from "./auth-schema.ts";
