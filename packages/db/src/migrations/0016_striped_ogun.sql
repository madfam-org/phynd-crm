CREATE TABLE "engagement_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"engagement_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"role" varchar(50),
	"portal_access" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagement_items" (
	"id" text PRIMARY KEY NOT NULL,
	"engagement_id" text NOT NULL,
	"kind" varchar(20) NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'planned' NOT NULL,
	"side" varchar(10) DEFAULT 'madfam' NOT NULL,
	"owner_user_id" text,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"client_visible" boolean DEFAULT false NOT NULL,
	"artifact_id" text,
	"external_key" varchar(200),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engagement_items_kind_check" CHECK ("engagement_items"."kind" in ('milestone', 'deliverable', 'actionable', 'decision')),
	CONSTRAINT "engagement_items_status_check" CHECK ("engagement_items"."status" in ('planned', 'in_progress', 'done', 'blocked', 'awaiting_client')),
	CONSTRAINT "engagement_items_side_check" CHECK ("engagement_items"."side" in ('madfam', 'client'))
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "preferred_name" varchar(255);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "spanish_formality" varchar(8);--> statement-breakpoint
ALTER TABLE "engagement_contacts" ADD CONSTRAINT "engagement_contacts_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_contacts" ADD CONSTRAINT "engagement_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_items" ADD CONSTRAINT "engagement_items_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_items" ADD CONSTRAINT "engagement_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_items" ADD CONSTRAINT "engagement_items_artifact_id_engagement_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."engagement_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "engagement_contacts_engagement_contact_uniq" ON "engagement_contacts" USING btree ("engagement_id","contact_id");--> statement-breakpoint
CREATE INDEX "engagement_contacts_contact_id_idx" ON "engagement_contacts" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "engagement_items_engagement_sort_idx" ON "engagement_items" USING btree ("engagement_id","sort_order");--> statement-breakpoint
CREATE INDEX "engagement_items_client_visible_idx" ON "engagement_items" USING btree ("engagement_id","client_visible");--> statement-breakpoint
CREATE UNIQUE INDEX "engagement_items_external_key_uniq" ON "engagement_items" USING btree ("engagement_id","external_key");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_spanish_formality_check" CHECK ("contacts"."spanish_formality" is null or "contacts"."spanish_formality" in ('tu', 'usted'));