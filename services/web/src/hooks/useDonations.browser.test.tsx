import { expect, test, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import type { ApiClient, CreateDonationBody } from '../api/client'
import { useDonations } from './useDonations'

// Hook test (ADR-0027): useDonations owns its load-on-mount + create-then-refresh flow. A fake
// ApiClient (`listDonations` + `createDonation`) drives the hook through `renderHook`; we assert the
// hook's own behavior — list on mount, donate writes then re-reads, and a write failure is caught.

const body = {
  donor_id: 'user_1',
  amount_cents: 500,
  currency: 'usd',
} as unknown as CreateDonationBody

test('donations load on mount', async () => {
  const donations = [{ id: 'don_1' }]
  const listDonations = vi.fn(async () => ({ donations }))
  const api = { listDonations } as unknown as ApiClient
  const { result } = await renderHook(() => useDonations(api, 'comm_1'))

  await vi.waitFor(() => expect(result.current.donations).toEqual(donations))
  expect(listDonations).toHaveBeenCalledWith('comm_1')
})

test('donate creates a donation then refreshes the list', async () => {
  const created = { id: 'don_2' }
  const listDonations = vi
    .fn()
    .mockResolvedValueOnce({ donations: [] })
    .mockResolvedValue({ donations: [created] })
  const createDonation = vi.fn(async () => created)
  const api = { listDonations, createDonation } as unknown as ApiClient
  const { result } = await renderHook(() => useDonations(api, 'comm_1'))

  await vi.waitFor(() => expect(result.current.donations).toEqual([]))
  await result.current.donate(body)

  expect(createDonation).toHaveBeenCalledWith('comm_1', body)
  await vi.waitFor(() => expect(result.current.donations).toEqual([created]))
})

test('a donate failure surfaces through error and clears pending', async () => {
  const listDonations = vi.fn(async () => ({ donations: [] }))
  const createDonation = async () => {
    throw new Error('charge declined')
  }
  const api = { listDonations, createDonation } as unknown as ApiClient
  const { result } = await renderHook(() => useDonations(api, 'comm_1'))

  await result.current.donate(body)

  await vi.waitFor(() => expect(result.current.error).toBeTruthy())
  expect(result.current.pending).toBe(false)
})
