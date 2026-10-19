CREATE TABLE "risk_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"rule_code" varchar(100) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"reason" varchar(1000) NOT NULL,
	"evidence" jsonb NOT NULL,
	"status" varchar(30) DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(100) NOT NULL,
	"description" varchar(500) NOT NULL,
	"rule_type" varchar(50) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"threshold" numeric(19, 4) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_rules_code_unique" UNIQUE("code"),
	CONSTRAINT "risk_rules_threshold_positive" CHECK ("risk_rules"."threshold" > 0)
);
--> statement-breakpoint
ALTER TABLE "risk_alerts" ADD CONSTRAINT "risk_alerts_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_alerts" ADD CONSTRAINT "risk_alerts_rule_code_risk_rules_code_fk" FOREIGN KEY ("rule_code") REFERENCES "public"."risk_rules"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "risk_alerts_transaction_rule_uq" ON "risk_alerts" USING btree ("transaction_id","rule_code");--> statement-breakpoint
CREATE INDEX "risk_alerts_status_created_idx" ON "risk_alerts" USING btree ("status","created_at");