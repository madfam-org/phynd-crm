import { z } from 'zod'

const envSchema = z.object({
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

  // Federation - Webhook Secrets
  JANUA_WEBHOOK_SECRET: z.string().min(1),
  DHANAM_WEBHOOK_SECRET: z.string().min(1),
  COTIZA_WEBHOOK_SECRET: z.string().min(1),
  PRAVARA_WEBHOOK_SECRET: z.string().min(1),
  FORJ_WEBHOOK_SECRET: z.string().min(1),

  // App
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Observability (optional, Phase 2)
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
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
  return envSchema.partial().parse(process.env)
}
