CREATE TABLE "campaign_imports" (
	"idempotency_key" varchar(255) PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"source" varchar(32) NOT NULL,
	"orchestrator" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sku_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"sku_key" varchar(128) NOT NULL,
	"platform" varchar(64) NOT NULL,
	"audience" varchar(255),
	"ga_readiness" varchar(32) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sku_catalog_sku_key_unique" UNIQUE("sku_key")
);
--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "status" SET DATA TYPE varchar(30);--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "sku_key" varchar(128);--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "import_source" varchar(32);--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "orchestrator" varchar(32);--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "ga_readiness" varchar(32);--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "tulana_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "campaign_imports" ADD CONSTRAINT "campaign_imports_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;