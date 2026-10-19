CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"account_reference" varchar(100) NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"transaction_type" varchar(30) NOT NULL,
	"status" varchar(20) DEFAULT 'RECEIVED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_amount_positive" CHECK ("transactions"."amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_idempotency_key_uq" ON "transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "transactions_account_created_idx" ON "transactions" USING btree ("account_reference","created_at");