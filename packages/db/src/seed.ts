import { seed } from './seed/index'

if (process.env.NODE_ENV === 'production') {
  console.error('Seed script cannot run in production')
  process.exit(1)
}

const tenantId = process.env.TENANT_ID || 'madfam'

seed(tenantId)
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
