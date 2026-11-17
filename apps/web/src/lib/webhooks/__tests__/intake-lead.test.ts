import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockResolveOwner = vi.fn()
vi.mock('../system-task-owner', () => ({
  resolveSystemTaskOwner: (...args: unknown[]) => mockResolveOwner(...args),
}))

const mockApplyDefaults = vi.fn()
vi.mock('@phynd/services/leads/lead-intake-defaults', () => ({
  applyLeadIntakeDefaults: (...args: unknown[]) => mockApplyDefaults(...args),
}))

import { finishIntakeLead } from '../intake-lead'

function fakeDb() {
  const savepoint = { kind: 'savepoint' }
  return {
    savepoint,
    db: { transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(savepoint)) },
  }
}

describe('finishIntakeLead', () => {
  beforeEach(() => {
    mockResolveOwner.mockReset().mockResolvedValue('user-default')
    mockApplyDefaults
      .mockReset()
      .mockResolvedValue({ ownerId: 'user-default', taskId: 't', dueAt: new Date(0) })
  })

  it('resolves the owner (contact owner, else default) and applies it with the task', async () => {
    const { db, savepoint } = fakeDb()
    const logger = { warn: vi.fn() }
    const result = await finishIntakeLead(db as never, logger, {
      leadId: 'lead-1',
      contactOwnerId: null,
      displayName: 'Persona Ficticia',
      feed: 'nauta',
    })
    expect(result).toEqual({ ownerId: 'user-default', dueAt: new Date(0) })
    expect(mockResolveOwner).toHaveBeenCalledWith(
      savepoint,
      logger,
      expect.objectContaining({ contactOwnerId: null }),
    )
    expect(mockApplyDefaults).toHaveBeenCalledWith(
      { db: savepoint },
      expect.objectContaining({ leadId: 'lead-1', ownerId: 'user-default' }),
    )
  })

  it('does nothing for a test lead', async () => {
    const { db } = fakeDb()
    const result = await finishIntakeLead(
      db as never,
      { warn: vi.fn() },
      {
        leadId: 'lead-1',
        contactOwnerId: null,
        isTest: true,
        displayName: 'x',
        feed: 'avala',
      },
    )
    expect(result).toBeNull()
    expect(db.transaction).not.toHaveBeenCalled()
  })

  it('logs and keeps the lead when the step fails', async () => {
    mockApplyDefaults.mockRejectedValueOnce(new Error('boom'))
    const { db } = fakeDb()
    const logger = { warn: vi.fn() }
    const result = await finishIntakeLead(db as never, logger, {
      leadId: 'lead-1',
      contactOwnerId: 'user-c',
      displayName: 'x',
      feed: 'avala',
    })
    expect(result).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'lead-1', feed: 'avala' }),
      expect.any(String),
    )
  })
})
