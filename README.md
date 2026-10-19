# RiskLens local development

RiskLens accepts transactions, evaluates configured risk rules, and presents
generated alerts to authenticated investigators.

## Prerequisites

- Node.js 22.6 or newer
- npm
- Docker with Compose
- OpenSSL

## Bootstrap

Install dependencies and create a local environment file:

```bash
npm ci
cp .env.example .env
```

Generate `BETTER_AUTH_SECRET` and `TRANSACTION_INGESTION_TOKEN` independently
with `openssl rand -hex 32`, then replace their placeholders in `.env`. Do not
commit `.env` or the generated values. The provided `DATABASE_URL` matches the
local PostgreSQL service in `compose.yaml`, and `BETTER_AUTH_URL` matches the
development server on port 3002.

Start PostgreSQL, apply the schema migrations, and seed the required development
risk rule:

```bash
docker compose up -d
npm run db:migrate
npm run db:seed:dev
```

The seed command creates `HIGH_VALUE_USD` only when it is absent. Re-running it
is a no-op when the existing rule matches. It exits unsuccessfully without
changing the row if the same code has different settings.

Provision an investigator in an interactive terminal:

```bash
npm run auth:provision -- --email investigator@example.com --name "Ada Lovelace"
```

Start RiskLens at [http://localhost:3002](http://localhost:3002):

```bash
npm run dev
```

## Demonstrate alert generation

In another terminal, load the local environment without printing its values and
submit a transaction above the seeded threshold:

```bash
set -a
. ./.env
set +a
IDEMPOTENCY_KEY="demo-high-value-$(date +%s)"
curl --fail-with-body \
  -X POST http://localhost:3002/api/transactions \
  -H "Authorization: Bearer ${TRANSACTION_INGESTION_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{
    \"idempotencyKey\": \"${IDEMPOTENCY_KEY}\",
    \"accountReference\": \"demo-account-001\",
    \"amount\": \"12500.00\",
    \"currency\": \"USD\",
    \"transactionType\": \"TRANSFER\"
  }"
```

The response should include one alert with rule code `HIGH_VALUE_USD`. Sign in
at [http://localhost:3002/login](http://localhost:3002/login) with the
provisioned investigator to inspect and update the alert.
