# PP.5 webhook batch evidence artifact

Generated: {{GENERATED_AT}}  
Run ID: {{RUN_ID}}  
Batches: {{BATCHES}}  
Base URL: {{BASE_URL}}  
Operator email: {{EMAIL}}  
Parallelism: {{PARALLELISM}}  
Engagement ID: {{ENGAGEMENT_ID}}  
Evidence JSON: `{{OUTPUT_JSON}}`

## Summary

- Total checks: {{TOTAL_CHECKS}}
- Passing checks: {{PASSING_CHECKS}}
- Skipped checks: {{SKIPPED_CHECKS}}
- Failing checks: {{FAILED_CHECKS}}

## Batch results

| Batch | Exit code | OK | Failed checks |
| --- | --- | --- | ---: |
{{BATCH_SUMMARY_TABLE}}

## Per-lane pass/fail

| Lane | Valid path | Invalid path | Notes |
| --- | --- | --- | --- |
{{LANE_TABLE}}

## Re-run command
{{RE_RUN_COMMAND}}

## Notes

- Attach raw provider responses, staging DB evidence, and operator logs from this run.
- Preserve this artifact in the PP.5 handoff packet for audit traceability.
