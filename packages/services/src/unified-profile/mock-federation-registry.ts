import { getProjectClientFederationData } from './project-client-federation-data'

type BaseContact = {
  id: string
  name: string
  email: string | null
  externalJanuaId: string | null
}

/**
 * Returns mock federation data for known externalJanuaId values.
 * This is the swap point — replace registry entries with real API calls later.
 */
export function tryGetMockFederationData<C extends BaseContact>(contact: C) {
  if (!contact.externalJanuaId) return null

  switch (contact.externalJanuaId) {
    case 'janua-demo-project-001':
      return getProjectClientFederationData(contact)
    default:
      return null
  }
}
