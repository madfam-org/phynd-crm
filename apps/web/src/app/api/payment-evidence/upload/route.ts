import { checkApiRateLimit } from '@/lib/rate-limiter'
import { createAppContextFromRequest } from '@/lib/trpc/request-context'
import { createLogger } from '@phynd/logging'
import { EngagementsService } from '@phynd/services'
import type { ServiceContext } from '@phynd/services/context'
import {
  MAX_EVIDENCE_BYTES,
  checkEvidenceFile,
} from '@phynd/services/payment-evidence/evidence-file'
import { extractPaymentEvidence } from '@phynd/services/payment-evidence/extractors'
import { evidenceStorageFromEnv } from '@phynd/services/payment-evidence/storage'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const logger = createLogger('web:payment-evidence-upload')

// Staff upload of a payment receipt (JPEG, PNG, WebP, HEIC or PDF, 10 MB max).
// The file goes to private R2 storage under a content-addressed key; the
// response carries the key and an extractor's PREFILL. Nothing is recorded
// until staff confirm the fields (paymentEvidence.create).
export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
  if (!(await checkApiRateLimit(ip)).allowed) return error(429, 'Too many requests')

  const staff = await staffContext(req)
  if ('status' in staff) return error(staff.status, staff.message)

  const upload = await readUpload(req)
  if ('status' in upload) return error(upload.status, upload.message)

  const engagement = await new EngagementsService(staff.ctx).getById(upload.engagementId)
  if (!engagement) return error(404, 'Engagement not found')

  const checked = checkEvidenceFile(upload.bytes)
  if (!checked.ok) {
    const status = checked.reason === 'too_large' ? 413 : checked.reason === 'empty' ? 400 : 415
    return error(status, `Unsupported file (${checked.reason}); use JPEG, PNG, WebP, HEIC or PDF`)
  }

  const storage = evidenceStorageFromEnv()
  if (!storage) return error(503, 'Evidence storage is not configured')
  try {
    if (!(await storage.exists(checked.key))) {
      await storage.put(checked.key, upload.bytes, {
        contentType: checked.mime,
        sha256: checked.sha256,
      })
    }
  } catch (err) {
    logger.error({ err, engagementId: upload.engagementId }, 'evidence upload to storage failed')
    return error(502, 'Could not store the file; try again')
  }

  const extraction = await extractPaymentEvidence({ bytes: upload.bytes, mime: checked.mime })
  return NextResponse.json(
    {
      storageKey: checked.key,
      sha256: checked.sha256,
      mime: checked.mime,
      size: checked.size,
      extraction,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

type Failure = { status: number; message: string }

/** Linked staff only: no service tokens, no demo sessions, no unlinked Janua accounts. */
async function staffContext(req: Request): Promise<{ ctx: ServiceContext } | Failure> {
  const ctx = await createAppContextFromRequest(req, 'trpc')
  const { auth } = ctx
  const isService = auth.roles.includes('service') || auth.userId.startsWith('service:')
  if (!auth.userId || isService) return { status: 401, message: 'Staff sign-in required' }
  if (!auth.crmUserId || auth.tenantId.startsWith('demo-')) {
    return { status: 403, message: 'Your account is not linked to a CRM user' }
  }
  return { ctx }
}

async function readUpload(
  req: Request,
): Promise<{ engagementId: string; bytes: Uint8Array } | Failure> {
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_EVIDENCE_BYTES + 64 * 1024) {
    return { status: 413, message: 'The file is larger than 10 MB' }
  }
  const form = await req.formData().catch(() => null)
  const engagementId = form?.get('engagementId')
  const file = form?.get('file')
  if (typeof engagementId !== 'string' || !engagementId || !(file instanceof Blob)) {
    return { status: 400, message: 'engagementId and file are required' }
  }
  if (file.size > MAX_EVIDENCE_BYTES)
    return { status: 413, message: 'The file is larger than 10 MB' }
  return { engagementId, bytes: new Uint8Array(await file.arrayBuffer()) }
}

function error(status: number, message: string) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
}
