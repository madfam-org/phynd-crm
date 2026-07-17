# Tulana Commercial GA gap queue consumption

Status: active owner queue contract
Date: 2026-06-01
Owner system: PhyndCRM

## Purpose

PhyndCRM polls a Tulana-owned queue of SKUs pending `G4` evidence. For each
returned row, PhyndCRM owns recording that evidence:

- Campaign ID.
- Audience ID.
- Consent basis.
- Suppression result.
- Human send approval.
- Final copy snapshot or hash.

The queue endpoint and query parameters are operational detail; see the
private `madfam-org/internal-devops` runbook or the ops team.

## ROI rule

Process rows in the order Tulana returns them. Do not approve paid-GA sends
unless Tulana reports `campaign_ga_ready`. `candidate` SKUs may only use
controlled pilot, warm pilot, discovery, or waitlist motions.
