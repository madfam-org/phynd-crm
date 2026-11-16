ALTER TABLE "contacts" ADD COLUMN "lifecycle_stage" varchar(20) DEFAULT 'lead' NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_lifecycle_stage_check" CHECK ("contacts"."lifecycle_stage" in ('lead', 'customer', 'former_customer'));--> statement-breakpoint
-- Backfill: a contact with a recorded successful payment is a customer; every
-- other contact keeps the default, lead. A recorded successful payment is a
-- paid Dhanam or ecosystem conversion, an order that is (partly) paid and not
-- fully refunded, or verified payment evidence.
UPDATE "contacts" SET "lifecycle_stage" = 'customer'
WHERE EXISTS (
	SELECT 1 FROM "conversions" c
	WHERE c."contact_id" = "contacts"."id"
		AND c."type" IN ('dhanam_checkout_completed', 'dhanam_subscription_created', 'dhanam_payment_succeeded', 'ecosystem_payment_succeeded')
) OR EXISTS (
	SELECT 1 FROM "orders" o
	WHERE o."contact_id" = "contacts"."id"
		AND o."deleted_at" IS NULL
		AND o."payment_status" IN ('paid', 'partial', 'partial_refund')
) OR EXISTS (
	SELECT 1 FROM "payment_evidence" p
	WHERE p."contact_id" = "contacts"."id"
		AND p."status" = 'verified'
);
