/**
 * Contract test for ForjProvider.
 * Guards ForjRawData shape (digital assets + NFT certs) from forj/index.ts.
 */
import { describe, expect, it } from 'vitest'

import {
  type JsonSchema,
  assertSchemaValid,
  validateAgainstSchema,
} from '../../../__tests__/contract-helpers'
import { ForjProvider } from '../index'

type ForjRawData = Parameters<ForjProvider['map']>[0]

function expectDefined<T>(value: T | undefined): T {
  expect(value).toBeDefined()
  return value as T
}

const schema: JsonSchema = {
  type: 'object',
  required: ['assets', 'total_count'],
  additionalProperties: false,
  properties: {
    assets: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'asset_type', 'created_at', 'updated_at'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1 },
          name: { type: 'string' },
          asset_type: { type: 'string' },
          thumbnail_url: { type: ['string', 'null'] },
          model_url: { type: ['string', 'null'] },
          format: { type: ['string', 'null'] },
          nft_certificate_url: { type: ['string', 'null'] },
          created_at: { type: 'string' },
          updated_at: { type: 'string' },
        },
      },
    },
    total_count: { type: 'integer', minimum: 0 },
  },
}

const fixture: ForjRawData = {
  assets: [
    {
      id: 'forj-1',
      name: 'Solarpunk Lily',
      asset_type: '3d_model',
      thumbnail_url: 'https://forj.madfam.io/thumb/1.png',
      model_url: 'https://forj.madfam.io/models/1.glb',
      format: 'glb',
      nft_certificate_url: 'https://forj.madfam.io/nft/1',
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-04-10T00:00:00Z',
    },
    {
      id: 'forj-2',
      name: 'Draft asset (no mint)',
      asset_type: 'draft',
      thumbnail_url: null,
      model_url: null,
      format: null,
      nft_certificate_url: null,
      created_at: '2026-04-15T00:00:00Z',
      updated_at: '2026-04-15T00:00:00Z',
    },
  ],
  total_count: 2,
}

describe('ForjRawData contract', () => {
  it('typical fixture conforms', () => {
    assertSchemaValid(fixture, schema)
  })

  it('empty fixture conforms', () => {
    assertSchemaValid({ assets: [], total_count: 0 }, schema)
  })

  it('rejects missing asset_type', () => {
    const firstAsset = fixture.assets[0] as ForjRawData['assets'][number]
    const { asset_type: _assetType, ...invalidAsset } = firstAsset
    const invalid = { ...fixture, assets: [invalidAsset] }
    const errors = validateAgainstSchema(invalid, schema)
    expect(errors.some((e) => e.path.includes('asset_type'))).toBe(true)
  })

  it('rejects additional properties on asset', () => {
    const invalid = {
      ...fixture,
      assets: [{ ...fixture.assets[0], surprise_field: 'oops' }],
    }
    const errors = validateAgainstSchema(invalid, schema)
    expect(errors.some((e) => e.message.includes('additional'))).toBe(true)
  })
})

describe('ForjProvider.map()', () => {
  const provider = new ForjProvider('https://api.forj.madfam.io')

  it('renames snake_case fields on each asset', () => {
    const result = provider.map(fixture)
    const firstAsset = expectDefined(result.assets[0])
    expect(result.assets).toHaveLength(2)
    expect(firstAsset).toMatchObject({
      id: 'forj-1',
      name: 'Solarpunk Lily',
      type: '3d_model',
      thumbnailUrl: 'https://forj.madfam.io/thumb/1.png',
      modelUrl: 'https://forj.madfam.io/models/1.glb',
      format: 'glb',
      nftCertificateUrl: 'https://forj.madfam.io/nft/1',
    })
    expect(result.assets[0]).not.toHaveProperty('asset_type')
  })

  it('converts created_at + updated_at to Date', () => {
    const result = provider.map(fixture)
    const firstAsset = expectDefined(result.assets[0])
    expect(result.assets).toHaveLength(2)
    expect(firstAsset.createdAt).toBeInstanceOf(Date)
    expect(firstAsset.updatedAt).toBeInstanceOf(Date)
  })

  it('maps totalCount', () => {
    const result = provider.map(fixture)
    expect(result.totalCount).toBe(2)
  })

  it('handles null urls on draft assets', () => {
    const result = provider.map(fixture)
    const draftAsset = expectDefined(result.assets[1])
    expect(result.assets).toHaveLength(2)
    expect(draftAsset.thumbnailUrl).toBeNull()
    expect(draftAsset.modelUrl).toBeNull()
  })
})
