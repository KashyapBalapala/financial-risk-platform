CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"action" varchar(50) NOT NULL,
	"previous_status" varchar(30) NOT NULL,
	"new_status" varchar(30) NOT NULL,
	"actor_type" varchar(20) NOT NULL,
	"actor_id" varchar(128),
	"actor_label" varchar(128) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_alert_id_risk_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."risk_alerts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_alert_created_idx" ON "audit_logs" USING btree ("alert_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_transaction_created_idx" ON "audit_logs" USING btree ("transaction_id","created_at");