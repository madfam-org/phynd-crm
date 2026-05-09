import type { ServiceContext } from '@phynd/services'
import { createSchema } from 'graphql-yoga'

const typeDefs = /* GraphQL */ `
  type Query {
    health: HealthStatus!
    clientProfile(id: ID!): ClientProfile
  }

  type HealthStatus {
    status: String!
    version: String!
  }

  type ClientProfile {
    id: ID!
    email: String!
    name: String
    billing: BillingProfile
    manufacturing: ManufacturingProfile
    assets: AssetStorefront
  }

  type BillingProfile {
    customerId: String!
    plan: String!
    status: String!
    currentBalance: Float!
    currency: String!
  }

  type ManufacturingProfile {
    orders: [ManufacturingOrder!]!
    activeQuotes: [ManufacturingQuote!]!
  }

  type ManufacturingOrder {
    id: ID!
    status: String!
    productName: String!
    progress: Float!
  }

  type ManufacturingQuote {
    id: ID!
    status: String!
    totalAmount: Float!
  }

  type AssetStorefront {
    totalCount: Int!
    assets: [DigitalAsset!]!
  }

  type DigitalAsset {
    id: ID!
    name: String!
    type: String!
    modelUrl: String
    nftCertificateUrl: String
  }
`

const resolvers = {
  Query: {
    health: () => ({ status: 'ok', version: '0.1.0' }),
    clientProfile: async (_: unknown, { id }: { id: string }, context: ServiceContext) => {
      // Base CRM Profile
      const user = await context.db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, id),
      })
      if (!user) return null

      // If federation is not available, just return the CRM base
      if (!context.federation) {
        return {
          id: user.id,
          email: user.email,
          name: user.name,
        }
      }

      // Fetch federated context in parallel using Promise.allSettled for partial failure tolerance
      const [billingResult, cotizaResult, forjResult] = await Promise.allSettled([
        context.federation.clients.dhanamClient.fetch(user.email, 'dummy-token', context.tenantId),
        context.federation.clients.cotizaClient.fetch(user.id, 'dummy-token', context.tenantId),
        context.federation.clients.forjClient.fetch(user.id, 'dummy-token', context.tenantId),
      ])

      const billing = billingResult.status === 'fulfilled' ? billingResult.value.data : null
      const manufacturing = cotizaResult.status === 'fulfilled' ? cotizaResult.value.data : null
      const assets = forjResult.status === 'fulfilled' ? forjResult.value.data : null

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        billing,
        manufacturing,
        assets,
      }
    },
  },
}

export const schema = createSchema({
  typeDefs,
  resolvers,
})
