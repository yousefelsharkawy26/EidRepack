import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useSaleDraft } from '../../src/features/sales/useSaleDraft'
import { useCollectionDraft } from '../../src/features/collections/useCollectionDraft'

afterEach(cleanup)

describe('feature draft hooks', () => {
  it('initializes a sale with the first finished item and clears elevated approval after draft changes', () => {
    const { result } = renderHook(() => useSaleDraft([
      { id: 'finished-1', salePrice: 12.5 } as never,
    ]))

    expect(result.current.payment).toBe('credit')
    expect(result.current.lines).toEqual([{ itemId: 'finished-1', qty: 1, price: 12.5 }])
    act(() => result.current.setOverrideGranted({ reason: 'approved' }))
    expect(result.current.overrideGranted).toEqual({ reason: 'approved' })
    act(() => result.current.setPaid(5))
    expect(result.current.overrideGranted).toBeNull()
  })

  it('starts a collection draft with no selected sale and exposes return/payment state', () => {
    const { result } = renderHook(() => useCollectionDraft())

    expect(result.current.selected).toBeNull()
    expect(result.current.amount).toBe(0)
    expect(result.current.paymentMethod).toBe('cash')
    expect(result.current.returnQty).toBe(1)
    expect(result.current.returnReason).toBe('بضاعة مرتجعة صالحة')
  })
})
