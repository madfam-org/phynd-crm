CREATE TABLE "campaign_email_events" (
	"id" text PRIMARY KEY NOT NULL,
	"email_id" varchar(255),
	"recipient" varchar(255) NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"campaign_id" text,
	"contact_id" text,
	"lead_id" text,
	"url" text,
	"dedup_key" varchar(255) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"consent_record_id" text NOT NULL,
	"action" varchar(32) NOT NULL,
	"previous_status" varchar(32),
	"new_status" varchar(32) NOT NULL,
	"source" varchar(128) NOT NULL,
	"evidence" text,
	"actor" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" varchar(255) NOT NULL,
	"channel" varchar(16) NOT NULL,
	"status" varchar(32) DEFAULT 'pending_double_opt_in' NOT NULL,
	"source" varchar(128) NOT NULL,
	"evidence" text,
	"contact_id" text,
	"double_opt_in_token_hash" varchar(64),
	"double_opt_in_expires_at" timestamp with time zone,
	"granted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppression_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" varchar(255) NOT NULL,
	"channel" varchar(16) DEFAULT 'all' NOT NULL,
	"reason" varchar(64) NOT NULL,
	"source" varchar(128) NOT NULL,
	"evidence" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_email_events" ADD CONSTRAINT "campaign_email_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_email_events" ADD CONSTRAINT "campaign_email_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_email_events" ADD CONSTRAINT "campaign_email_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_audit" ADD CONSTRAINT "consent_audit_consent_record_id_consent_records_id_fk" FOREIGN KEY ("consent_record_id") REFERENCES "public"."consent_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_email_events_dedup_key_uniq" ON "campaign_email_events" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "campaign_email_events_campaign_id_idx" ON "campaign_email_events" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_email_events_contact_id_idx" ON "campaign_email_events" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "campaign_email_events_email_id_idx" ON "campaign_email_events" USING btree ("email_id");--> statement-breakpoint
CREATE INDEX "campaign_email_events_recipient_idx" ON "campaign_email_events" USING btree ("recipient");--> statement-breakpoint
CREATE INDEX "campaign_email_events_occurred_at_idx" ON "campaign_email_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "consent_audit_record_id_idx" ON "consent_audit" USING btree ("consent_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_records_identifier_channel_uniq" ON "consent_records" USING btree ("identifier","channel");--> statement-breakpoint
CREATE INDEX "consent_records_contact_id_idx" ON "consent_records" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "consent_records_token_hash_idx" ON "consent_records" USING btree ("double_opt_in_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "suppression_entries_identifier_channel_uniq" ON "suppression_entries" USING btree ("identifier","channel");--> statement-breakpoint
CREATE INDEX "suppression_entries_identifier_idx" ON "suppression_entries" USING btree ("identifier");