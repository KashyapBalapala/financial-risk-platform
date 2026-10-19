ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_action_allowed" CHECK ("audit_logs"."action" in ('ALERT_STATUS_CHANGED'));--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_type_allowed" CHECK ("audit_logs"."actor_type" in ('USER', 'SYSTEM'));--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_previous_status_allowed" CHECK ("audit_logs"."previous_status" in ('OPEN', 'INVESTIGATING', 'CLOSED'));--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_new_status_allowed" CHECK ("audit_logs"."new_status" in ('OPEN', 'INVESTIGATING', 'CLOSED'));--> statement-breakpoint
ALTER TABLE "risk_alerts" ADD CONSTRAINT "risk_alerts_status_allowed" CHECK ("risk_alerts"."status" in ('OPEN', 'INVESTIGATING', 'CLOSED'));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_status_allowed" CHECK ("transactions"."status" in ('RECEIVED'));