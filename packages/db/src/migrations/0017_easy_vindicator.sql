CREATE TABLE "payment_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"engagement_id" text NOT NULL,
	"quote_id" text,
	"order_id" text,
	"contact_id" text NOT NULL,
	"method" varchar(20) NOT NULL,
	"bank_name" varchar(100),
	"operation_type" varchar(100),
	"folio" varchar(64),
	"tracking_key" varchar(64),
	"paid_at" timestamp with time zone NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'MXN' NOT NULL,
	"reference" varchar(255),
	"origin_account_last4" varchar(4),
	"destination_account_last4" varchar(4),
	"beneficiary_name" varchar(255),
	"notes" text,
	"status" varchar(10) DEFAULT 'recorded' NOT NULL,
	"verified_by_user_id" text,
	"verified_at" timestamp with time zone,
	"voided_by_user_id" text,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"source" varchar(10) DEFAULT 'manual' NOT NULL,
	"extraction_confidence" numeric(4, 3),
	"evidence_storage_key" varchar(255),
	"evidence_mime" varchar(50),
	"evidence_sha256" varchar(64),
	"client_visible" boolean DEFAULT true NOT NULL,
	"external_key" varchar(200),
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_evidence_method_check" CHECK ("payment_evidence"."method" in ('spei_transfer', 'card', 'cash', 'other')),
	CONSTRAINT "payment_evidence_status_check" CHECK ("payment_evidence"."status" in ('recorded', 'verified', 'voided')),
	CONSTRAINT "payment_evidence_source_check" CHECK ("payment_evidence"."source" in ('manual', 'extracted')),
	CONSTRAINT "payment_evidence_amount_check" CHECK ("payment_evidence"."amount" > 0),
	CONSTRAINT "payment_evidence_currency_check" CHECK ("payment_evidence"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payment_evidence_origin_last4_check" CHECK ("payment_evidence"."origin_account_last4" is null or "payment_evidence"."origin_account_last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "payment_evidence_destination_last4_check" CHECK ("payment_evidence"."destination_account_last4" is null or "payment_evidence"."destination_account_last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "payment_evidence_sha256_check" CHECK ("payment_evidence"."evidence_sha256" is null or "payment_evidence"."evidence_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "payment_evidence_confidence_check" CHECK ("payment_evidence"."extraction_confidence" is null or ("payment_evidence"."extraction_confidence" >= 0 and "payment_evidence"."extraction_confidence" <= 1)),
	CONSTRAINT "payment_evidence_free_text_check" CHECK (coalesce("reference", '') !~ '[0-9]([ -]?[0-9]){9,}' and coalesce("notes", '') !~ '[0-9]([ -]?[0-9]){9,}' and coalesce("beneficiary_name", '') !~ '[0-9]([ -]?[0-9]){9,}' and coalesce("bank_name", '') !~ '[0-9]([ -]?[0-9]){9,}' and coalesce("operation_type", '') !~ '[0-9]([ -]?[0-9]){9,}')
);
--> statement-breakpoint
ALTER TABLE "payment_evidence" ADD CONSTRAINT "payment_evidence_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_evidence" ADD CONSTRAINT "payment_evidence_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_evidence" ADD CONSTRAINT "payment_evidence_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_evidence" ADD CONSTRAINT "payment_evidence_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_evidence" ADD CONSTRAINT "payment_evidence_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_evidence" ADD CONSTRAINT "payment_evidence_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_evidence_engagement_id_idx" ON "payment_evidence" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "payment_evidence_quote_id_idx" ON "payment_evidence" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "payment_evidence_order_id_idx" ON "payment_evidence" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payment_evidence_client_visible_idx" ON "payment_evidence" USING btree ("engagement_id","client_visible");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_evidence_external_key_uniq" ON "payment_evidence" USING btree ("engagement_id","external_key");