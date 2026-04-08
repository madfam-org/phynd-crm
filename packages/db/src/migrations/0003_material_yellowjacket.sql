CREATE TABLE "grant_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"grant_opportunity_id" text NOT NULL,
	"contact_id" text,
	"pipeline_id" text NOT NULL,
	"stage_id" text NOT NULL,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"hitl_approved_by" text,
	"hitl_approved_at" timestamp with time zone,
	"hitl_notes" text,
	"requested_amount" numeric(18, 2),
	"awarded_amount" numeric(18, 2),
	"application_draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"compliance_checks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"owner_id" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grant_opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"fortuna_grant_id" varchar(255),
	"title" varchar(500) NOT NULL,
	"granting_body" varchar(255),
	"category" varchar(100),
	"funding_type" varchar(50),
	"min_amount" numeric(18, 2),
	"max_amount" numeric(18, 2),
	"currency" varchar(5) DEFAULT 'MXN' NOT NULL,
	"source_url" varchar(2048),
	"closes_at" timestamp with time zone,
	"relevance_score" numeric(5, 3),
	"requirements_summary" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grant_signal_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"grant_opportunity_id" text NOT NULL,
	"grant_application_id" text,
	"event_type" varchar(50) NOT NULL,
	"actor" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grant_applications" ADD CONSTRAINT "grant_applications_grant_opportunity_id_grant_opportunities_id_fk" FOREIGN KEY ("grant_opportunity_id") REFERENCES "public"."grant_opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_applications" ADD CONSTRAINT "grant_applications_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_applications" ADD CONSTRAINT "grant_applications_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_applications" ADD CONSTRAINT "grant_applications_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_applications" ADD CONSTRAINT "grant_applications_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_signal_audit" ADD CONSTRAINT "grant_signal_audit_grant_opportunity_id_grant_opportunities_id_fk" FOREIGN KEY ("grant_opportunity_id") REFERENCES "public"."grant_opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_signal_audit" ADD CONSTRAINT "grant_signal_audit_grant_application_id_grant_applications_id_fk" FOREIGN KEY ("grant_application_id") REFERENCES "public"."grant_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grant_applications_grant_opportunity_id_idx" ON "grant_applications" USING btree ("grant_opportunity_id");--> statement-breakpoint
CREATE INDEX "grant_applications_status_idx" ON "grant_applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "grant_applications_pipeline_stage_idx" ON "grant_applications" USING btree ("pipeline_id","stage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grant_opportunities_fortuna_grant_id_uniq" ON "grant_opportunities" USING btree ("fortuna_grant_id");--> statement-breakpoint
CREATE INDEX "grant_opportunities_closes_at_idx" ON "grant_opportunities" USING btree ("closes_at");--> statement-breakpoint
CREATE INDEX "grant_signal_audit_grant_opportunity_id_idx" ON "grant_signal_audit" USING btree ("grant_opportunity_id");--> statement-breakpoint
CREATE INDEX "grant_signal_audit_grant_application_id_idx" ON "grant_signal_audit" USING btree ("grant_application_id");