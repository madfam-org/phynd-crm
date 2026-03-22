import { z } from 'zod'

const envSchemaBase = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // Auth (Janua OIDC)
  AUTH_SECRET: z.string().min(16),
  AUTH_JANUA_ISSUER: z.string().url(),
  AUTH_JANUA_CLIENT_ID: z.string().min(1),
  AUTH_JANUA_CLIENT_SECRET: z.string().min(1),

  // Federation - External Service URLs
  JANUA_API_URL: z.string().url(),
  DHANAM_API_URL: z.string().url(),
  COTIZA_API_URL: z.string().url(),
  PRAVARA_BASE_URL: z.string().url(),
  FORJ_API_URL: z.string().url(),

  // Federation - API Keys
  PRAVARA_API_KEY: z.string().min(1),

  // Federation - Webhook Secrets (optional — routes return 503 when unconfigured)
  JANUA_WEBHOOK_SECRET: z.string().min(1).optional(),
  DHANAM_WEBHOOK_SECRET: z.string().min(1).optional(),
  COTIZA_WEBHOOK_SECRET: z.string().min(1).optional(),
  PRAVARA_WEBHOOK_SECRET: z.string().min(1).optional(),
  FORJ_WEBHOOK_SECRET: z.string().min(1).optional(),

  // App
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Dev bypass (must not be true in production)
  AUTH_BYPASS: z.string().optional(),

  // Observability (optional, Phase 2)
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
})

const envSchema = envSchemaBase.superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production' && data.AUTH_BYPASS === 'true') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'AUTH_BYPASS cannot be enabled in production',
      path: ['AUTH_BYPASS'],
    })
  }
})

export type Env = z.infer<typeof envSchema>

let cachedEnv: Env | null = null

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const formatted = parsed.error.flatten().fieldErrors
    const message = Object.entries(formatted)
      .map(([key, errors]) => `  ${key}: ${errors?.join(', ')}`)
      .join('\n')
    throw new Error(`Invalid environment variables:\n${message}`)
  }
  cachedEnv = parsed.data
  return cachedEnv
}

export function getEnvUnsafe(): Partial<Env> {
  return envSchemaBase.partial().parse(process.env)
}
