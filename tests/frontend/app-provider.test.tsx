import { cleanup, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  session: vi.fn(),
  logout: vi.fn(),
  loadSnapshot: vi.fn(),
}))

vi.mock('../../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/api')>()
  return {
    ...actual,
    bridge: () => ({ auth: { status: mocks.status, session: mocks.session, logout: mocks.logout } }),
    loadSnapshot: mocks.loadSnapshot,
  }
})

import { AppProvider, useApp } from '../../src/app/AppProvider'
import { clearQuery } from '../../src/shared/api/queryCache'

function PhaseProbe() {
  const { phase, state } = useApp()
  return <output>{phase}:{state ? 'snapshot' : 'empty'}</output>
}

const authStatus = (needsBootstrap: boolean, importStatus: 'none' | 'failed' = 'none') => ({
  needsBootstrap,
  legacyImport: { status: importStatus, message: importStatus === 'failed' ? 'migration failed' : '' },
})

afterEach(() => {
  cleanup()
  clearQuery('snapshot')
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.status.mockResolvedValue(authStatus(false))
  mocks.session.mockResolvedValue(null)
  mocks.loadSnapshot.mockResolvedValue({})
})

describe('AppProvider authentication phases', () => {
  it('moves a first-run installation to bootstrap without asking for a session', async () => {
    mocks.status.mockResolvedValue(authStatus(true))
    render(<AppProvider><PhaseProbe /></AppProvider>)

    await waitFor(() => expect(screen.getByText('bootstrap:empty')).toBeTruthy())
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.loadSnapshot).not.toHaveBeenCalled()
  })

  it('moves a signed-out installation to login', async () => {
    render(<AppProvider><PhaseProbe /></AppProvider>)

    await waitFor(() => expect(screen.getByText('login:empty')).toBeTruthy())
    expect(mocks.session).toHaveBeenCalledOnce()
    expect(mocks.loadSnapshot).not.toHaveBeenCalled()
  })

  it('loads the snapshot before marking a valid session ready', async () => {
    mocks.session.mockResolvedValue({ id: 'user-1', permissions: { screens: ['dashboard'] } })
    mocks.loadSnapshot.mockResolvedValue({ settings: { companyName: 'Test' } })
    render(<AppProvider><PhaseProbe /></AppProvider>)

    await waitFor(() => expect(screen.getByText('ready:snapshot')).toBeTruthy())
    expect(mocks.loadSnapshot).toHaveBeenCalledOnce()
  })

  it('fails closed when the legacy import reports an error', async () => {
    mocks.status.mockResolvedValue(authStatus(false, 'failed'))
    render(<AppProvider><PhaseProbe /></AppProvider>)

    await waitFor(() => expect(screen.getByText('import-failed:empty')).toBeTruthy())
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.loadSnapshot).not.toHaveBeenCalled()
  })
})
