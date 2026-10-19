import "dotenv/config";

import pg from "pg";

const developmentRule = {
  code: "HIGH_VALUE_USD",
  description: "High-value USD transaction",
  ruleType: "HIGH_VALUE",
  currency: "USD",
  threshold: "10000",
  severity: "HIGH",
  enabled: true,
} as const;

type StoredRule = {
  code: string;
  description: string;
  ruleType: string;
  currency: string;
  threshold: string;
  severity: string;
  enabled: boolean;
};

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new Error("DATABASE_URL is not configured");
  }
  return value;
}

function normalizedDecimal(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    return value;
  }

  const sign = match[1];
  const whole = match[2].replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

function discrepancies(rule: StoredRule): string[] {
  const differences: string[] = [];

  for (const field of [
    "description",
    "ruleType",
    "currency",
    "severity",
    "enabled",
  ] as const) {
    if (rule[field] !== developmentRule[field]) {
      differences.push(
        `${field}: expected ${JSON.stringify(developmentRule[field])}, ` +
          `found ${JSON.stringify(rule[field])}`,
      );
    }
  }

  if (
    normalizedDecimal(rule.threshold) !==
    normalizedDecimal(developmentRule.threshold)
  ) {
    differences.push(
      `threshold: expected ${developmentRule.threshold}, ` +
        `found ${rule.threshold}`,
    );
  }

  return differences;
}

async function main(): Promise<void> {
  const client = new pg.Client({
    connectionString: requiredDatabaseUrl(),
  });

  await client.connect();

  try {
    const inserted = await client.query<StoredRule>(
      `insert into risk_rules
        (code, description, rule_type, currency, threshold, severity, enabled)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (code) do nothing
       returning
         code,
         description,
         rule_type as "ruleType",
         currency,
         threshold::text as threshold,
         severity,
         enabled`,
      [
        developmentRule.code,
        developmentRule.description,
        developmentRule.ruleType,
        developmentRule.currency,
        developmentRule.threshold,
        developmentRule.severity,
        developmentRule.enabled,
      ],
    );

    if (inserted.rowCount === 1) {
      process.stdout.write(`Created development rule ${developmentRule.code}\n`);
      return;
    }

    const existing = await client.query<StoredRule>(
      `select
         code,
         description,
         rule_type as "ruleType",
         currency,
         threshold::text as threshold,
         severity,
         enabled
       from risk_rules
       where code = $1`,
      [developmentRule.code],
    );
    const rule = existing.rows[0];

    if (!rule) {
      throw new Error(
        `Rule ${developmentRule.code} conflicted but could not be read`,
      );
    }

    const differences = discrepancies(rule);
    if (differences.length > 0) {
      throw new Error(
        `Rule ${developmentRule.code} already exists with different settings:\n` +
          differences.map((difference) => `- ${difference}`).join("\n"),
      );
    }

    process.stdout.write(
      `Development rule ${developmentRule.code} already matches; no changes made\n`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown development seed error";
  process.stderr.write(`Development rule seed failed: ${message}\n`);
  process.exitCode = 1;
});
