CREATE TABLE "data_backfills" (
	"name" varchar(100) PRIMARY KEY NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" jsonb
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "kind" varchar(40);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "tier" varchar(1);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "leads_owner_tier_idx" ON "leads" USING btree ("owner_id","tier");
--> statement-breakpoint
-- Seeded lead-scoring rules (docs/LEAD_INTAKE_GAPS_AND_ENRICHMENT_2026-11-16.md
-- § G2). Fixed ids so a re-run inserts nothing and staff edits in Settings ›
-- Scoring are kept (ON CONFLICT DO NOTHING). A lead's score is the sum of the
-- matching active rules; its tier comes from the score (A >= 7, B 4-6, C <= 3;
-- a waitlist lead is always C), see packages/services/src/leads/lead-qualification.ts.
INSERT INTO "lead_scoring_rules" ("id", "name", "category", "condition", "points", "is_active") VALUES
	('7a5e0c00-2026-4117-8000-000000000001', 'Intent: sales request', 'behavior', '{"field":"intent","operator":"eq","value":"sales-request"}'::jsonb, 4, true),
	('7a5e0c00-2026-4117-8000-000000000002', 'Intent: request access', 'behavior', '{"field":"intent","operator":"eq","value":"request-access"}'::jsonb, 2, true),
	('7a5e0c00-2026-4117-8000-000000000003', 'Intent: request access from a demo or Comply page', 'behavior', '{"field":"intent","operator":"eq","value":"request-access","all":[{"field":"source","operator":"in","value":["demo-home","demo-home-bottom","producto-comply"]}]}'::jsonb, 1, true),
	('7a5e0c00-2026-4117-8000-000000000004', 'Intent: waitlist', 'behavior', '{"field":"intent","operator":"eq","value":"waitlist"}'::jsonb, 1, true),
	('7a5e0c00-2026-4117-8000-000000000005', 'Fit: company email domain (not free-mail)', 'demographic', '{"field":"email_free_mail","operator":"eq","value":false}'::jsonb, 2, true),
	('7a5e0c00-2026-4117-8000-000000000006', 'Fit: interested in DC-3 or compliance', 'demographic', '{"field":"interests","operator":"in","value":["dc3","compliance"]}'::jsonb, 1, true),
	('7a5e0c00-2026-4117-8000-000000000007', 'Recency: older than 30 days', 'engagement', '{"field":"lead_age_days","operator":"gt","value":30}'::jsonb, -1, true),
	('7a5e0c00-2026-4117-8000-000000000008', 'Recency: older than 60 days', 'engagement', '{"field":"lead_age_days","operator":"gt","value":60}'::jsonb, -1, true),
	('7a5e0c00-2026-4117-8000-000000000009', 'Reachability: phone number present', 'engagement', '{"field":"has_phone","operator":"eq","value":true}'::jsonb, 1, true),
	('7a5e0c00-2026-4117-8000-00000000000a', 'Repeat: another submission within 7 days', 'engagement', '{"field":"repeat_submissions_7d","operator":"gte","value":1}'::jsonb, 1, true),
	('7a5e0c00-2026-4117-8000-00000000000b', 'Repeat: a second one within 7 days', 'engagement', '{"field":"repeat_submissions_7d","operator":"gte","value":2}'::jsonb, 1, true)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- G5: tag the synthetic leads already stored, by the rule intake now applies
-- (isTestLead in lead-qualification.ts): a test source, a reserved address
-- (RFC 2606 / 6761: *.invalid, *.test, *.example, *.localhost, example.com|net|org),
-- an end-to-end test address (local part e2e followed by - + . _), or a Nauta
-- end-to-end probe (a [e2e] / [test] / [prueba] label in the contact's name or
-- in a note, or the smoke relay's literal "probe" message). Idempotent.
UPDATE "leads" SET "is_test" = true
WHERE "leads"."is_test" = false
	AND (
		lower(coalesce("leads"."source", '')) IN ('provisioning_smoke', 'synthetic-probe')
		OR EXISTS (
			SELECT 1 FROM "contacts" c
			WHERE c."id" = "leads"."contact_id"
				AND (
					lower(split_part(c."email", '@', 2)) IN ('example.com', 'example.net', 'example.org')
					OR lower(split_part(c."email", '@', 2)) ~ '(^|\.)(invalid|test|example|localhost)$'
					OR lower(c."email") ~ '^e2e([-+._][^@]*)?@'
					OR (
						lower(coalesce("leads"."source", '')) = 'nauta'
						AND (
							c."name" ~* '\[(e2e|test|prueba)\]'
							OR EXISTS (
								SELECT 1 FROM "notes" n
								WHERE n."entity_type" = 'contact' AND n."entity_id" = c."id"
									AND (
										n."content" ~* '\[(e2e|test|prueba)\]'
										OR lower(trim(split_part(n."content", E'\n', 1))) = 'probe'
									)
							)
						)
					)
				)
		)
	);
--> statement-breakpoint
-- The lead-intake route's follow-up task IS the lead's first-contact task:
-- mark the existing ones so reassignment moves them and the backfill does not
-- open a second one. They are the only tasks titled this way on a lead.
UPDATE "activities" SET "kind" = 'first_contact'
WHERE "activities"."kind" IS NULL
	AND "activities"."type" = 'task'
	AND "activities"."entity_type" = 'lead'
	AND ("activities"."title" = 'Dar seguimiento' OR "activities"."title" LIKE 'Dar seguimiento:%');
