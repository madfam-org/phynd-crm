CREATE TABLE "campaign_draft_variants" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"variant_id" varchar(64),
	"format" varchar(16) DEFAULT 'structured' NOT NULL,
	"language" varchar(16),
	"subject" varchar(500),
	"preheader" varchar(500),
	"body" text NOT NULL,
	"cta" varchar(500),
	"claim_keys_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" varchar(32) DEFAULT 'tulana' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_draft_variants" ADD CONSTRAINT "campaign_draft_variants_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_draft_variants_campaign_id_idx" ON "campaign_draft_variants" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_draft_variants_variant_id_idx" ON "campaign_draft_variants" USING btree ("variant_id");