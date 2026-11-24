/** Staff work in Mexico City: the follow-up clock runs on it. */
const STAFF_TIME_ZONE = 'America/Mexico_City'
/** 09:00 in Mexico City, which is UTC-6 all year. */
const FOLLOW_UP_HOUR_UTC = 15

/**
 * 09:00 Mexico City on the next business day (Monday to Friday) after `now`.
 * Public holidays are not considered. Due date of the follow-up task the
 * system opens on a new lead (lead intake, creator-census hand-off).
 */
export function nextBusinessDayDueAt(now: Date = new Date()): Date {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: STAFF_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(now)
    .split('-')
    .map(Number) as [number, number, number]

  const cursor = new Date(Date.UTC(year, month - 1, day))
  do {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  } while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6)

  cursor.setUTCHours(FOLLOW_UP_HOUR_UTC, 0, 0, 0)
  return cursor
}
