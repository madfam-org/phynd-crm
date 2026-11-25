/**
 * The creator-census events this CRM reads from `madfam:census-events`, parsed
 * and validated. Fail closed, as the census's consumer contract asks: an
 * unknown payload key, an unknown `schema_version`, a value of the wrong type,
 * length or shape makes the whole event invalid, and an invalid event is never
 * partly applied (the consumer moves it to the dead-letter stream).
 *
 * Envelope (registry `ecosystem/event-schemas.yaml`, census entries): every
 * stream entry carries `event_type`, `source`, `correlation_id`, `timestamp`,
 * `payload` (a JSON string), `event_id` (UUID, the deduplication key) and
 * `schema_version` ('1').
 */

export const CENSUS_STREAM_KEY = 'madfam:census-events'
export const CENSUS_EVENT_SOURCE = 'creator-census'
export const CENSUS_SCHEMA_VERSION = '1'

export const CENSUS_PICK_HANDED_OFF = 'census.pick.handed_off'
export const CENSUS_OPTOUT_COMPLETED = 'census.optout.completed'

/** Platforms a pick can come from. YouTube only for now. */
export const CENSUS_PICK_PLATFORMS = ['youtube'] as const
export type CensusPickPlatform = (typeof CENSUS_PICK_PLATFORMS)[number]

/**
 * Platforms an opt-out can name. The registry lists `youtube`; the census also
 * emits opt-outs for Bluesky channels (its docs/EVENTS.md). Accepting both
 * keeps a Bluesky opt-out from being dead-lettered: it matches no pick, so it
 * changes nothing here.
 */
export const CENSUS_OPTOUT_PLATFORMS = ['youtube', 'bluesky'] as const
export type CensusOptOutPlatform = (typeof CENSUS_OPTOUT_PLATFORMS)[number]

export const CENSUS_PICK_STAGES = [
  'shortlisted',
  'approached',
  'in_talks',
  'allied',
  'passed',
] as const
export type CensusPickStage = (typeof CENSUS_PICK_STAGES)[number]

export const CENSUS_LIST_NAME_MAX = 120
export const CENSUS_NOTE_MAX = 2000
/** Ids (org, list, user) are opaque; this bounds them to what the columns hold. */
const CENSUS_ID_MAX = 255

/** The hosts a YouTube channel URL may use. */
const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'youtube.com'])
/** A YouTube channel id: `UC` plus 22 URL-safe base64 characters. */
const YOUTUBE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** ISO 8601 date-time with seconds and an explicit offset or `Z`. */
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it rejects
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it rejects
const ID_FORBIDDEN = /[\s\u0000-\u001F\u007F]/

export interface CensusEnvelope {
  streamId: string
  eventType: string
  source: string
  eventId: string
  schemaVersion: string
  timestamp: string
  /** The payload, parsed; not yet validated against its event type. */
  payload: Record<string, unknown>
}

export interface CensusPickHandoff {
  eventId: string
  orgId: string
  listId: string
  listName: string
  platform: CensusPickPlatform
  externalId: string
  channelUrl: string
  stage: CensusPickStage
  handedOffBy: string
  note: string | null
  /** As sent (ISO 8601). */
  occurredAt: string
}

export interface CensusOptOut {
  eventId: string
  platform: CensusOptOutPlatform
  externalId: string
  /** As sent (ISO 8601). */
  observedAt: string
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string }

const PICK_KEYS = new Set([
  'org_id',
  'list_id',
  'list_name',
  'platform',
  'external_id',
  'channel_url',
  'stage',
  'handed_off_by',
  'note',
  'occurred_at',
  'event_id',
])
const OPTOUT_KEYS = new Set(['platform', 'external_id', 'observed_at'])

function fail<T>(reason: string): Parsed<T> {
  return { ok: false, reason }
}

function charLength(value: string): number {
  return Array.from(value).length
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An opaque id: a non-empty string without spaces or control characters. */
function readId(value: unknown, max = CENSUS_ID_MAX): string | undefined {
  if (typeof value !== 'string' || value === '' || charLength(value) > max) return undefined
  return ID_FORBIDDEN.test(value) ? undefined : value
}

function readIsoDateTime(value: unknown): string | undefined {
  if (typeof value !== 'string' || !ISO_DATE_TIME.test(value)) return undefined
  return Number.isNaN(Date.parse(value)) ? undefined : value
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined
}

/** Stream entry fields (`[k1, v1, k2, v2, …]`) as a map; later keys win. */
export function streamFieldsToMap(fields: readonly string[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const key = fields[i]
    if (key) map[key] = fields[i + 1] ?? ''
  }
  return map
}

/**
 * The envelope of a stream entry. Invalid when a field is missing, the source
 * is not the census, the schema version is not '1', the event id is not a
 * UUID or the payload is not a JSON object.
 */
export function parseCensusEnvelope(
  streamId: string,
  fields: readonly string[],
): Parsed<CensusEnvelope> {
  const map = streamFieldsToMap(fields)
  const eventType = map.event_type
  if (!eventType) return fail('envelope: event_type is missing')
  if (map.source !== CENSUS_EVENT_SOURCE) return fail('envelope: source is not creator-census')
  if (map.schema_version !== CENSUS_SCHEMA_VERSION) {
    return fail("envelope: schema_version is not '1'")
  }
  const eventId = map.event_id
  if (!eventId || !UUID.test(eventId)) return fail('envelope: event_id is not a UUID')

  let payload: unknown
  try {
    payload = JSON.parse(map.payload ?? '')
  } catch {
    return fail('envelope: payload is not JSON')
  }
  if (!isRecord(payload)) return fail('envelope: payload is not an object')

  return {
    ok: true,
    value: {
      streamId,
      eventType,
      source: map.source,
      eventId,
      schemaVersion: map.schema_version,
      timestamp: map.timestamp ?? '',
      payload,
    },
  }
}

function unknownKey(payload: Record<string, unknown>, allowed: Set<string>): string | undefined {
  return Object.keys(payload).find((key) => !allowed.has(key))
}

/**
 * The channel URL, when it is the channel's own public URL on the platform:
 * `https://www.youtube.com/channel/<external_id>` (or `youtube.com`), with no
 * credentials, port, query or fragment. A handle URL (`/@name`) is refused:
 * a handle is platform data the census does not send.
 */
function readYouTubeChannelUrl(value: unknown, externalId: string): string | undefined {
  if (typeof value !== 'string' || charLength(value) > 500) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || !YOUTUBE_HOSTS.has(url.hostname)) return undefined
  if (url.username || url.password || url.port || url.search || url.hash) return undefined
  const path = url.pathname.replace(/\/$/, '')
  return path === `/channel/${externalId}` ? value : undefined
}

/** The list name, trimmed: 1 to 120 characters on one line, else undefined. */
function readListName(value: unknown): string | undefined {
  const name = typeof value === 'string' ? value.trim() : ''
  if (name === '' || charLength(name) > CENSUS_LIST_NAME_MAX) return undefined
  return CONTROL_CHARACTERS.test(name) || /[\r\n\t]/.test(name) ? undefined : name
}

/** The optional note: absent, null or blank is no note. */
function readNote(value: unknown): Parsed<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== 'string') return fail('pick: note is not a string')
  if (charLength(value) > CENSUS_NOTE_MAX) {
    return fail(`pick: note is longer than ${CENSUS_NOTE_MAX} characters`)
  }
  if (CONTROL_CHARACTERS.test(value)) return fail('pick: note has control characters')
  const trimmed = value.trim()
  return { ok: true, value: trimmed === '' ? null : trimmed }
}

/** Platform, channel id and the channel's own URL, checked against each other. */
function readPickChannel(
  p: Record<string, unknown>,
): Parsed<{ platform: CensusPickPlatform; externalId: string; channelUrl: string }> {
  const platform = readEnum(p.platform, CENSUS_PICK_PLATFORMS)
  if (!platform) return fail('pick: platform is not supported')
  const externalId = typeof p.external_id === 'string' ? p.external_id : ''
  if (!YOUTUBE_CHANNEL_ID.test(externalId)) return fail('pick: external_id is not a channel id')
  const channelUrl = readYouTubeChannelUrl(p.channel_url, externalId)
  if (!channelUrl) return fail("pick: channel_url is not the channel's own platform URL")
  return { ok: true, value: { platform, externalId, channelUrl } }
}

/** `census.pick.handed_off`: every field checked; any failure rejects the event. */
export function parseCensusPickHandoff(envelope: CensusEnvelope): Parsed<CensusPickHandoff> {
  const p = envelope.payload
  const extra = unknownKey(p, PICK_KEYS)
  if (extra !== undefined) return fail(`pick: unknown payload key '${extra.slice(0, 40)}'`)

  const eventId = readId(p.event_id)
  if (!eventId || !UUID.test(eventId)) return fail('pick: event_id is not a UUID')
  if (eventId !== envelope.eventId) return fail('pick: event_id differs from the envelope')

  const orgId = readId(p.org_id)
  if (!orgId) return fail('pick: org_id is missing or malformed')
  const listId = readId(p.list_id)
  if (!listId) return fail('pick: list_id is missing or malformed')

  const listName = readListName(p.list_name)
  if (!listName) {
    return fail(`pick: list_name must be 1-${CENSUS_LIST_NAME_MAX} characters on one line`)
  }

  const channel = readPickChannel(p)
  if (!channel.ok) return channel
  const { platform, externalId, channelUrl } = channel.value

  const stage = readEnum(p.stage, CENSUS_PICK_STAGES)
  if (!stage) return fail('pick: stage is not one of the known stages')
  const handedOffBy = readId(p.handed_off_by)
  if (!handedOffBy) return fail('pick: handed_off_by is missing or malformed')

  const note = readNote(p.note)
  if (!note.ok) return note

  const occurredAt = readIsoDateTime(p.occurred_at)
  if (!occurredAt) return fail('pick: occurred_at is not an ISO 8601 date-time')

  return {
    ok: true,
    value: {
      eventId,
      orgId,
      listId,
      listName,
      platform,
      externalId,
      channelUrl,
      stage,
      handedOffBy,
      note: note.value,
      occurredAt,
    },
  }
}

/** `census.optout.completed` (registry payload: platform, external_id, observed_at). */
export function parseCensusOptOut(envelope: CensusEnvelope): Parsed<CensusOptOut> {
  const p = envelope.payload
  const extra = unknownKey(p, OPTOUT_KEYS)
  if (extra !== undefined) return fail(`optout: unknown payload key '${extra.slice(0, 40)}'`)

  const platform = readEnum(p.platform, CENSUS_OPTOUT_PLATFORMS)
  if (!platform) return fail('optout: platform is not supported')
  const externalId = readId(p.external_id)
  if (!externalId) return fail('optout: external_id is missing or malformed')
  if (platform === 'youtube' && !YOUTUBE_CHANNEL_ID.test(externalId)) {
    return fail('optout: external_id is not a channel id')
  }
  const observedAt = readIsoDateTime(p.observed_at)
  if (!observedAt) return fail('optout: observed_at is not an ISO 8601 date-time')

  return { ok: true, value: { eventId: envelope.eventId, platform, externalId, observedAt } }
}
