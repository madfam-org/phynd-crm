ALTER TABLE "contacts" ADD COLUMN "coforma_cab_membership_id" varchar(255);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "coforma_cab_id" varchar(255);--> statement-breakpoint
CREATE INDEX "contacts_coforma_cab_membership_id_idx" ON "contacts" USING btree ("coforma_cab_membership_id");