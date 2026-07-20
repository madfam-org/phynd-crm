CREATE TABLE "campaign_authorizations" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"requested_by" varchar(255) NOT NULL,
	"decided_by" varchar(255),
	"decided_via" varchar(32),
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_authorizations" ADD CONSTRAINT "campaign_authorizations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_authorizations_campaign_id_idx" ON "campaign_authorizations" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_authorizations_status_idx" ON "campaign_authorizations" USING btree ("status");