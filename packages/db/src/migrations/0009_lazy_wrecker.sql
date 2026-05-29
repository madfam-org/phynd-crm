CREATE TABLE "campaign_buyer_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"contact_id" text,
	"sku_key" varchar(128) NOT NULL,
	"contact_segment" varchar(255),
	"event_type" varchar(64) NOT NULL,
	"signal_strength" varchar(16),
	"notes_redacted" text,
	"dedup_key" varchar(255) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_buyer_signals_dedup_key_unique" UNIQUE("dedup_key")
);
--> statement-breakpoint
ALTER TABLE "campaign_buyer_signals" ADD CONSTRAINT "campaign_buyer_signals_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_buyer_signals" ADD CONSTRAINT "campaign_buyer_signals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_buyer_signals_campaign_id_idx" ON "campaign_buyer_signals" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_buyer_signals_sku_key_idx" ON "campaign_buyer_signals" USING btree ("sku_key");--> statement-breakpoint
CREATE INDEX "campaign_buyer_signals_occurred_at_idx" ON "campaign_buyer_signals" USING btree ("occurred_at");