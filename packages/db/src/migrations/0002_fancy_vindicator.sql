CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"order_number" varchar(50) NOT NULL,
	"opportunity_id" text,
	"quote_id" text,
	"contact_id" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"total_amount" numeric(12, 2),
	"currency" varchar(10) DEFAULT 'USD' NOT NULL,
	"estimated_completion" timestamp with time zone,
	"actual_completion" timestamp with time zone,
	"owner_id" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"quote_number" varchar(50) NOT NULL,
	"opportunity_id" text,
	"contact_id" text,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"total_amount" numeric(12, 2),
	"currency" varchar(10) DEFAULT 'USD' NOT NULL,
	"valid_until" timestamp with time zone,
	"owner_id" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_opportunity_id_idx" ON "orders" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "orders_contact_id_idx" ON "orders" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "orders_quote_id_idx" ON "orders" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quotes_opportunity_id_idx" ON "quotes" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "quotes_contact_id_idx" ON "quotes" USING btree ("contact_id");