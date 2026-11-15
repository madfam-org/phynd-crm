CREATE TABLE "cases" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"type" varchar(30) NOT NULL,
	"summary" text NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"owner_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cases_type_check" CHECK ("cases"."type" in ('support', 'refund', 'data_rights', 'invoice_correction')),
	CONSTRAINT "cases_status_check" CHECK ("cases"."status" in ('open', 'in_progress', 'resolved')),
	CONSTRAINT "cases_resolved_at_check" CHECK (("cases"."status" = 'resolved') = ("cases"."resolved_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cases_contact_id_idx" ON "cases" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "cases_status_due_at_idx" ON "cases" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "cases_owner_id_idx" ON "cases" USING btree ("owner_id");