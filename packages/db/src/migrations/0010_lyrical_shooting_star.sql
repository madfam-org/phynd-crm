CREATE TABLE "ai_kanban_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"entity_id" text NOT NULL,
	"suggestion_type" varchar(40) NOT NULL,
	"title" varchar(255) NOT NULL,
	"rationale" text,
	"proposed_stage_id" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"source" varchar(64) DEFAULT 'service:selva' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_kanban_suggestions" ADD CONSTRAINT "ai_kanban_suggestions_proposed_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("proposed_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_kanban_suggestions_entity_idx" ON "ai_kanban_suggestions" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "ai_kanban_suggestions_status_idx" ON "ai_kanban_suggestions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_kanban_suggestions_proposed_stage_idx" ON "ai_kanban_suggestions" USING btree ("proposed_stage_id");