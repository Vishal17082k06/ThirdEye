import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockApi } from '../../test-api'
import { renderApp } from '../../test-utils'
import { Dashboard } from '../dashboard/Dashboard'
import { NotificationBell } from './NotificationBell'

const N = (id: number, read: boolean, extra: object = {}) => ({
  id,
  kind: 'device',
  title: `Alert ${id}`,
  body: 'Something happened',
  source: 'live',
  read,
  created_at: '2026-10-30T10:00:00Z',
  ...extra,
})

afterEach(() => vi.unstubAllGlobals())

describe('NotificationBell', () => {
  it('shows the real unread count from the API', async () => {
    mockApi({ 'GET /notifications': { items: [N(1, false), N(2, true)], unread_count: 1 } })
    renderApp(<NotificationBell />)
    expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument()
  })

  it('lists items, labels simulation ones, and marks one as read', async () => {
    let read = false
    const api = mockApi({
      'GET /notifications': () => ({
        items: [N(1, read, { source: 'simulation' }), N(2, true)],
        unread_count: read ? 0 : 1,
      }),
      'POST /notifications/1/read': () => {
        read = true
        return N(1, true)
      },
    })
    renderApp(<NotificationBell />)
    await userEvent.click(await screen.findByRole('button', { name: /Notifications, 1 unread/ }))
    const dialog = screen.getByRole('dialog', { name: 'Notifications' })
    expect(within(dialog).getByText('Simulation')).toBeInTheDocument()
    expect(within(dialog).getByText(/Unread:/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as read: Alert 1' }))
    expect(await screen.findByRole('button', { name: 'Notifications, none unread' })).toBeInTheDocument()
    expect(api.callsTo('POST', '/notifications/1/read')).toHaveLength(1)
  })

  it('Mark all read calls the API', async () => {
    const api = mockApi({
      'GET /notifications': { items: [N(1, false), N(2, false)], unread_count: 2 },
      'POST /notifications/read-all': { updated: 2 },
    })
    renderApp(<NotificationBell />)
    await userEvent.click(await screen.findByRole('button', { name: /Notifications, 2 unread/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    await vi.waitFor(() => expect(api.callsTo('POST', '/notifications/read-all')).toHaveLength(1))
  })

  it('Clear all asks for confirmation before deleting', async () => {
    const api = mockApi({
      'GET /notifications': { items: [N(1, false)], unread_count: 1 },
      'DELETE /notifications': { deleted: 1 },
    })
    renderApp(<NotificationBell />)
    await userEvent.click(await screen.findByRole('button', { name: /Notifications, 1 unread/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    const confirm = await screen.findByRole('dialog', { name: 'Clear all notifications?' })
    expect(api.callsTo('DELETE', '/notifications')).toHaveLength(0)

    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(api.callsTo('DELETE', '/notifications')).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: /Notifications, 1 unread/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Clear all notifications?' })).getByRole('button', { name: 'Clear all' }))
    await vi.waitFor(() => expect(api.callsTo('DELETE', '/notifications')).toHaveLength(1))
  })

  it('shows an empty state when there are none', async () => {
    mockApi({ 'GET /notifications': { items: [], unread_count: 0 } })
    renderApp(<NotificationBell />)
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, none unread' }))
    expect(await screen.findByText(/You have no notifications/)).toBeInTheDocument()
  })
})

describe('Dashboard wiring', () => {
  const dev = (key: string, name: string, status: string) => ({ key, name, status, last_seen: null, config: {}, error: null })

  it('shows real device statuses, guardian state and recent events', async () => {
    mockApi({
      'GET /devices': {
        items: [
          dev('laptop_camera', 'Laptop/USB Camera', 'connected'),
          dev('esp32_cam', 'ESP32-CAM', 'not_integrated'),
          dev('vl53l0x', 'VL53L0X Distance Sensor', 'disconnected'),
          dev('vibration_motor', 'Vibration Motor', 'not_integrated'),
          dev('battery', 'Battery Monitoring', 'not_integrated'),
        ],
      },
      'GET /guardian': { name: 'Ravi', email: 'r@b.co', phone: '9876543210', relationship: 'Parent' },
      'GET /events': (_b: unknown, url: URL) =>
        url.searchParams.get('type') === 'obstacle'
          ? {
              items: [{ id: 1, type: 'obstacle', source: 'simulation', title: 'Chair ahead', details: {}, status: 'ok', created_at: '2026-10-30T10:00:00Z' }],
              total: 1,
              limit: 5,
              offset: 0,
            }
          : { items: [], total: 0, limit: 5, offset: 0 },
    })
    renderApp(<Dashboard />, { mode: 'simulation' })
    expect(await screen.findByText('Guardian set')).toBeInTheDocument()
    expect(await screen.findByText('Chair ahead')).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('No navigation sessions yet')).toBeInTheDocument()
  })
})
