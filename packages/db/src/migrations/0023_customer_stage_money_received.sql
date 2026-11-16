-- Corrects the 0020 backfill to the rule in
-- packages/services/src/contacts/customer-stage.ts: only money received makes
-- a customer. 0020 also counted a subscription start
-- (`dhanam_subscription_created`) and any checkout completion
-- (`dhanam_checkout_completed`), including one completed before its payment
-- was collected. A contact whose ONLY such evidence is one of those, with no
-- sign anywhere that money was ever received, was never a customer: it goes
-- back to lead, as if the stage had never moved (and so does a former customer
-- made from that state, since a cancellation of a lead changes nothing).
--
-- Conservative on purpose: any sign of money keeps the contact as it is.
--   - a conversion of a payment, a refund or a dispute (a refund or a dispute
--     means a payment happened), Dhanam or ecosystem;
--   - a checkout completion, unless its stored webhook payload is found and
--     does not say `payment_status: 'paid'` (same test as the webhook);
--   - an order of the contact, deleted or not, that holds or held money
--     (paid, partly paid, refunded, disputed, a paid amount or a paid date);
--   - payment evidence of the contact or of one of its orders, verified or
--     voided.
-- Idempotent: a corrected contact is a lead and is not selected again.
UPDATE "contacts" SET "lifecycle_stage" = 'lead', "lifecycle_stage_changed_at" = NULL
WHERE "contacts"."lifecycle_stage" IN ('customer', 'former_customer')
	AND EXISTS (
		SELECT 1 FROM "conversions" s
		WHERE s."contact_id" = "contacts"."id"
			AND s."type" IN ('dhanam_subscription_created', 'dhanam_checkout_completed')
	)
	AND NOT EXISTS (
		SELECT 1 FROM "conversions" m
		WHERE m."contact_id" = "contacts"."id"
			AND m."type" IN (
				'dhanam_payment_succeeded', 'ecosystem_payment_succeeded', 'ecosystem_payment',
				'dhanam_intent_succeeded', 'dhanam_invoice_paid', 'dhanam_charge_paid',
				'dhanam_charge_refunded', 'dhanam_invoice_refunded', 'dhanam_payment_refunded',
				'dhanam_refund_created', 'dhanam_refund_succeeded',
				'dhanam_charge_dispute_created', 'dhanam_charge_dispute_updated',
				'dhanam_charge_dispute_closed', 'dhanam_dispute_funds_withdrawn',
				'dhanam_dispute_reinstated', 'dhanam_dispute_created',
				'dhanam_payment_dispute_created', 'dhanam_payment_disputed'
			)
	)
	AND NOT EXISTS (
		SELECT 1 FROM "conversions" k
		WHERE k."contact_id" = "contacts"."id"
			AND k."type" = 'dhanam_checkout_completed'
			AND NOT EXISTS (
				SELECT 1 FROM "webhook_events" w
				WHERE w."provider" = 'dhanam'
					AND (
						w."id" = k."metadata" ->> 'webhook_event_id'
						OR (k."metadata" ->> 'webhook_event_id' IS NULL AND w."payload" ->> 'event_id' = k."metadata" ->> 'event_id')
					)
					AND coalesce(w."payload" #>> '{raw,data,object,payment_status}', '') <> 'paid'
					AND coalesce(w."payload" #>> '{raw,data,payment_status}', '') <> 'paid'
			)
	)
	AND NOT EXISTS (
		SELECT 1 FROM "orders" o
		WHERE o."contact_id" = "contacts"."id"
			AND (
				o."payment_status" IN ('paid', 'partial', 'partial_refund', 'refunded', 'disputed')
				OR coalesce(o."paid_amount", 0) > 0
				OR o."paid_at" IS NOT NULL
			)
	)
	AND NOT EXISTS (
		SELECT 1 FROM "payment_evidence" p
		WHERE p."status" IN ('verified', 'voided')
			AND (
				p."contact_id" = "contacts"."id"
				OR p."order_id" IN (SELECT o2."id" FROM "orders" o2 WHERE o2."contact_id" = "contacts"."id")
			)
	);
