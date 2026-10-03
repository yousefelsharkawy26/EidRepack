import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import React, { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PinPrompt } from '../../src/shared/ui/PinPrompt'

afterEach(cleanup)

describe('PinPrompt', () => {
  it('requires a four-digit PIN and submits the provided PIN and reason', () => {
    const onSubmit = vi.fn()
    function Harness() {
      const [pin, setPin] = useState('')
      const [reason, setReason] = useState('')
      return <PinPrompt title="تأكيد" pin={pin} setPin={setPin} reason={reason} setReason={setReason} onSubmit={onSubmit} onCancel={() => undefined} />
    }
    render(<Harness />)

    const submit = screen.getByRole('button', { name: 'اعتماد' })
    expect((submit as HTMLButtonElement).disabled).toBe(true)
    const pinInput = document.querySelector('input[type="password"]')
    const reasonInput = document.querySelector('.field-spaced input')
    expect(pinInput).toBeTruthy()
    expect(reasonInput).toBeTruthy()
    fireEvent.change(pinInput!, { target: { value: '1234' } })
    fireEvent.change(reasonInput!, { target: { value: 'تسوية' } })
    expect((submit as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledOnce()
  })
})
