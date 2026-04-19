CREATE TABLE "engagement_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"engagement_id" text NOT NULL,
	"type" varchar(30) NOT NULL,
	"entity_type" varchar(20),
	"entity_id" text,
	"url" text,
	"title" varchar(255),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagement_events" (
	"id" text PRIMARY KEY NOT NULL,
	"engagement_id" text NOT NULL,
	"source" varchar(20) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"status" varchar(20),
	"message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"dedup_key" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagements" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"opportunity_id" text,
	"project_name" varchar(255) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"owner_id" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "engagement_artifacts" ADD CONSTRAINT "engagement_artifacts_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_events" ADD CONSTRAINT "engagement_events_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "engagement_artifacts_engagement_id_idx" ON "engagement_artifacts" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "engagement_artifacts_type_idx" ON "engagement_artifacts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "engagement_events_engagement_id_idx" ON "engagement_events" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "engagement_events_source_idx" ON "engagement_events" USING btree ("source");--> statement-breakpoint
CREATE INDEX "engagement_events_created_at_idx" ON "engagement_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "engagement_events_dedup_idx" ON "engagement_events" USING btree ("engagement_id","dedup_key");--> statement-breakpoint
CREATE INDEX "engagements_contact_id_idx" ON "engagements" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "engagements_opportunity_id_idx" ON "engagements" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "engagements_status_idx" ON "engagements" USING btree ("status");