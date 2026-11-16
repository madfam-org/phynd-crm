ALTER TABLE "contacts" ADD COLUMN "lifecycle_stage_changed_at" timestamp with time zone;--> statement-breakpoint
-- Backfill, by the rule in packages/services/src/contacts/customer-stage.ts:
-- a customer whose history ends in a subscription cancellation or a fully
-- refunded order, with no other active paid relationship and no money
-- received after that end, becomes a former customer as of that end.
WITH ended AS (
	SELECT x."contact_id", max(x."at") AS "ended_at"
	FROM (
		SELECT c."contact_id", c."converted_at" AS "at"
		FROM "conversions" c
		WHERE c."metadata" ->> 'event_type' IN ('customer.subscription.deleted', 'subscription.cancelled', 'subscription.canceled', 'subscription.deleted')
		UNION ALL
		SELECT o."contact_id", o."updated_at"
		FROM "orders" o
		WHERE o."payment_status" = 'refunded' AND o."deleted_at" IS NULL
	) x
	WHERE x."contact_id" IS NOT NULL
	GROUP BY x."contact_id"
)
UPDATE "contacts" SET "lifecycle_stage" = 'former_customer', "lifecycle_stage_changed_at" = ended."ended_at"
FROM ended
WHERE "contacts"."id" = ended."contact_id"
	AND "contacts"."lifecycle_stage" = 'customer'
	AND NOT EXISTS (
		SELECT 1 FROM "orders" o
		WHERE o."contact_id" = "contacts"."id" AND o."deleted_at" IS NULL
			AND o."payment_status" IN ('paid', 'partial', 'partial_refund')
	)
	AND NOT EXISTS (
		SELECT 1 FROM "conversions" s
		WHERE s."contact_id" = "contacts"."id"
			AND s."type" = 'dhanam_subscription_created'
			AND s."metadata" ->> 'subscription_id' IS NOT NULL
			AND NOT EXISTS (
				SELECT 1 FROM "conversions" e
				WHERE e."contact_id" = "contacts"."id"
					AND e."metadata" ->> 'subscription_id' = s."metadata" ->> 'subscription_id'
					AND e."metadata" ->> 'event_type' IN ('customer.subscription.deleted', 'subscription.cancelled', 'subscription.canceled', 'subscription.deleted')
			)
	)
	AND NOT EXISTS (
		SELECT 1 FROM "conversions" p
		WHERE p."contact_id" = "contacts"."id"
			AND p."type" IN ('dhanam_payment_succeeded', 'ecosystem_payment_succeeded')
			AND p."converted_at" > ended."ended_at"
	)
	AND NOT EXISTS (
		SELECT 1 FROM "payment_evidence" v
		WHERE v."contact_id" = "contacts"."id" AND v."status" = 'verified'
			AND v."paid_at" > ended."ended_at"
	);
