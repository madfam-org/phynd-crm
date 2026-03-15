# ADR-006: Task Reminders Strategy

## Status
Accepted

## Context
Activities in Phyne have a `dueAt` field, but there is no mechanism to notify users when tasks are approaching their deadlines. Sales reps miss follow-ups because there's no approaching-deadline automation. The notification infrastructure already exists (notifications table, NotificationsService, NotificationBell component with polling).

## Decision
Implement task reminders as a **repeatable BullMQ job** that scans for upcoming activities and creates notifications.

### Architecture
- **Processor**: `apps/worker/src/processors/task-reminders.ts`
- **Queue**: `task-reminders` with `attempts: 1`, auto-cleanup
- **Schedule**: Repeatable job running every 4 hours (`0 */4 * * *`)
- **Lookahead**: 24 hours from current time

### Algorithm
1. Query activities where `dueAt` is within the next 24 hours, `status = 'pending'`, and `ownerId IS NOT NULL`
2. For each matching activity, check for existing `task_reminder` notification for the same `entityId` created in the last 24 hours
3. If no duplicate exists, create a notification with `type: 'task_reminder'`, `entityType: 'activity'`, `entityId`, and `userId: ownerId`
4. Log counts for observability

### Deduplication
Each scan checks for existing notifications of the same type + entity within 24 hours. This prevents duplicate reminders when the same activity falls within the lookahead window across multiple scan cycles.

## Rationale

### Why BullMQ repeatable job (not cron)?
- Already have BullMQ infrastructure with 5 existing workers
- BullMQ handles deduplication of repeatable jobs by name (`check-due-tasks`)
- Worker restart doesn't create duplicate schedules
- Consistent with existing patterns (health-check, lead-scoring)

### Why 4-hour interval?
- Balances timeliness (activities won't be missed for long) with DB load
- 24-hour lookahead means each activity gets checked ~6 times, providing redundancy
- If one scan fails, the next one picks up the slack (fail-open design)

### Why direct DB insert (not NotificationsService)?
- Worker processors run outside the tRPC context
- Direct insert avoids constructing a full ServiceContext for a simple operation
- Follows the same pattern as `health-check.ts` (direct `db.insert`)

### Why not real-time (WebSocket push)?
- Phase 1 uses polling (30s interval on NotificationBell)
- Real-time push is deferred to Phase 2 (`realtimeUpdates` feature flag)
- 4-hour scan + 30s polling means worst-case ~4h + 30s delay, which is acceptable for daily-use deadline reminders

## Consequences

### Positive
- Zero new dependencies
- Follows existing worker patterns (structured logging, event handlers, stalled count)
- Fail-open: if DB is down, next cycle picks up activities
- Dedup prevents notification spam

### Negative
- Up to 4-hour delay between activity creation and first reminder
- Scanning all pending activities is O(n) per cycle; may need indexing on `(status, dueAt)` if activity count grows significantly

### Risks
- **Notification volume**: If many activities are due simultaneously, the worker creates one notification per activity sequentially. This is acceptable for Phase 1 volumes.
- **Clock skew**: The 24h lookahead assumes worker clock is reasonably accurate. NTP is sufficient.
