import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockApi } from '../../test-api'
import { renderApp } from '../../test-utils'
import { Devices } from './Devices'
import { validateHost } from './validation'

const device = (key: string, name: string, status: string, extra: object = {}) => ({
  key,
  name,
  status,
  last_seen: null,
  config: {},
  error: null,
  ...extra,
})

const INITIAL = {
  items: [
    device('laptop_camera', 'Laptop/USB Camera', 'unknown'),
    device('esp32_cam', 'ESP32-CAM', 'not_integrated'),
    device('vl53l0x', 'VL53L0X Distance Sensor', 'disconnected'),
    device('vibration_motor', 'Vibration Motor', 'not_integrated'),
    device('battery', 'Battery Monitoring', 'not_integrated'),
  ],
}

afterEach(() => vi.unstubAllGlobals())

function card(name: string) {
  return screen.getByRole('article', { name })
}

describe('validateHost', () => {
  it('accepts IPv4 and hostnames, rejects the rest', () => {
    expect(validateHost('')).toBeUndefined()
    expect(validateHost('192.168.1.50')).toBeUndefined()
    expect(validateHost('esp32-cam.local')).toBeUndefined()
    expect(validateHost('300.1.1.1')).toBeDefined()
    expect(validateHost('1.2.3')).toBeDefined()
    expect(validateHost('bad host!')).toBeDefined()
  })
})

describe('Devices page', () => {
  it('renders five cards with the exact honest initial statuses', async () => {
    mockApi({ 'GET /devices': INITIAL })
    renderApp(<Devices />)
    await screen.findByRole('article', { name: 'ESP32-CAM' })
    expect(screen.getAllByRole('article')).toHaveLength(5)
    expect(within(card('Laptop/USB Camera')).getByText('Unknown')).toBeInTheDocument()
    expect(within(card('ESP32-CAM')).getByText('Not integrated')).toBeInTheDocument()
    expect(within(card('VL53L0X Distance Sensor')).getByText('Disconnected')).toBeInTheDocument()
    expect(within(card('Vibration Motor')).getByText('Not integrated')).toBeInTheDocument()
    expect(within(card('Battery Monitoring')).getByText('Not integrated')).toBeInTheDocument()
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
    expect(within(card('ESP32-CAM')).getByText('Never')).toBeInTheDocument()
  })

  it('shows the simulation banner only in simulation mode', async () => {
    mockApi({ 'GET /devices': INITIAL })
    renderApp(<Devices />, { mode: 'simulation' })
    expect(await screen.findByText(/simulated data never changes device status/i)).toBeInTheDocument()
  })

  it('Check camera opens then stops the camera and reports connected', async () => {
    const stop = vi.fn()
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] })
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } })
    const api = mockApi({
      'GET /devices': INITIAL,
      'POST /devices/laptop_camera/report': (b: unknown) => device('laptop_camera', 'Laptop/USB Camera', (b as { status: string }).status, { last_seen: new Date().toISOString() }),
    })
    renderApp(<Devices />)
    await userEvent.click(await screen.findByRole('button', { name: 'Check camera' }))
    expect(await within(card('Laptop/USB Camera')).findByText('Connected')).toBeInTheDocument()
    expect(getUserMedia).toHaveBeenCalledWith({ video: true })
    expect(stop).toHaveBeenCalled()
    expect(api.callsTo('POST', '/devices/laptop_camera/report')[0].body).toEqual({ status: 'connected' })
  })

  it('Check camera reports an error when permission is denied', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }))
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } })
    const api = mockApi({
      'GET /devices': INITIAL,
      'POST /devices/laptop_camera/report': (b: unknown) => {
        const body = b as { status: string; error: string }
        return device('laptop_camera', 'Laptop/USB Camera', body.status, { error: body.error })
      },
    })
    renderApp(<Devices />)
    await userEvent.click(await screen.findByRole('button', { name: 'Check camera' }))
    expect(await within(card('Laptop/USB Camera')).findByText('Error')).toBeInTheDocument()
    expect(api.callsTo('POST', '/devices/laptop_camera/report')[0].body).toEqual({
      status: 'error',
      error: 'Camera permission was denied in the browser.',
    })
  })

  it('Check camera reports disconnected when no camera exists', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'NotFoundError' }))
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } })
    const api = mockApi({
      'GET /devices': INITIAL,
      'POST /devices/laptop_camera/report': device('laptop_camera', 'Laptop/USB Camera', 'disconnected'),
    })
    renderApp(<Devices />)
    await userEvent.click(await screen.findByRole('button', { name: 'Check camera' }))
    await within(card('Laptop/USB Camera')).findByText('Disconnected')
    expect(api.callsTo('POST', '/devices/laptop_camera/report')[0].body).toMatchObject({ status: 'disconnected' })
  })

  it('saves a device IP through PUT and validates first', async () => {
    const api = mockApi({
      'GET /devices': INITIAL,
      'PUT /devices/esp32_cam': (b: unknown) => device('esp32_cam', 'ESP32-CAM', 'not_integrated', { config: (b as { config: object }).config }),
    })
    renderApp(<Devices />)
    await screen.findByRole('article', { name: 'ESP32-CAM' })
    const c = within(card('ESP32-CAM'))
    await userEvent.type(c.getByLabelText('Device IP or hostname'), '999.1.1.1')
    await userEvent.click(c.getByRole('button', { name: 'Save address' }))
    expect(api.callsTo('PUT', '/devices/esp32_cam')).toHaveLength(0)
    await userEvent.clear(c.getByLabelText('Device IP or hostname'))
    await userEvent.type(c.getByLabelText('Device IP or hostname'), '192.168.1.50')
    await userEvent.click(c.getByRole('button', { name: 'Save address' }))
    expect(await screen.findByText('ESP32-CAM address saved')).toBeInTheDocument()
    expect(api.callsTo('PUT', '/devices/esp32_cam')[0].body).toEqual({ config: { ip: '192.168.1.50' } })
    expect(c.getByText('Not integrated')).toBeInTheDocument()
  })

  it('renders heartbeat info from config.lastInfo under "Last reported", JSON for non-scalars', async () => {
    mockApi({
      'GET /devices': {
        items: INITIAL.items.map((d) =>
          d.key === 'vl53l0x'
            ? { ...d, status: 'connected', last_seen: new Date().toISOString(), config: { lastInfo: { fw: '1.0', range: { min: 30, max: 2000 } } } }
            : d,
        ),
      },
    })
    renderApp(<Devices />)
    await screen.findByRole('article', { name: 'VL53L0X Distance Sensor' })
    const c = within(card('VL53L0X Distance Sensor'))
    expect(c.getByText('Last reported')).toBeInTheDocument()
    const info = c.getByText(/fw: 1\.0/)
    expect(info).toHaveTextContent('range: {"min":30,"max":2000}')
    expect(info).not.toHaveTextContent('[object Object]')
  })
})
