CREATE TABLE "mcp_call_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"called_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_id" varchar(255) NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"tool" varchar(64),
	"args" jsonb,
	"outcome" varchar(50) NOT NULL,
	"result_count" integer,
	"masked" boolean NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mcp_call_audit_called_at_idx" ON "mcp_call_audit" USING btree ("called_at");--> statement-breakpoint
CREATE INDEX "mcp_call_audit_client_called_at_idx" ON "mcp_call_audit" USING btree ("client_id","called_at");