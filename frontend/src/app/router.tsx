import { Bot, CalendarClock, Car, Cpu, Navigation, Settings, ShieldAlert, UserRound } from 'lucide-react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ForgotPassword } from '../features/auth/ForgotPassword'
import { Login } from '../features/auth/Login'
import { Register } from '../features/auth/Register'
import { Dashboard } from '../features/dashboard/Dashboard'
import { PortalSelect } from '../features/portal/PortalSelect'
import { PagePlaceholder } from './PagePlaceholder'
import { ProtectedRoute, PublicOnlyRoute } from './ProtectedRoute'
import { Shell } from './Shell'

/** Every route in the app. Pages from later tasks are placeholders that say what they will hold. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route path="/portal" element={<PortalSelect />} />
        <Route element={<ProtectedRoute requireMode />}>

          <Route element={<Shell />}>
            <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/ai" element={<PagePlaceholder title="AI Assistance" holds="live camera or image analysis with obstacle detection and spoken announcements" icon={Bot} />} />
        <Route path="/navigation" element={<PagePlaceholder title="Navigation" holds="a Coimbatore map with search, routes, and turn-by-turn steps" icon={Navigation} />} />
        <Route path="/rides" element={<PagePlaceholder title="Book a Ride" holds="ride requests with fare estimates and ride history" icon={Car} />} />
        <Route path="/devices" element={<PagePlaceholder title="Device Management" holds="connection status and configuration for the camera, distance sensor, ESP32-CAM, vibration motor, and battery monitor" icon={Cpu} />} />
        <Route path="/history" element={<PagePlaceholder title="Activity History" holds="a searchable, filterable log of detections, navigation, rides, and emergencies" icon={CalendarClock} />} />
        <Route path="/sos" element={<PagePlaceholder title="Emergency SOS" holds="the SOS trigger, guardian alerts, and SOS history" icon={ShieldAlert} />} />
        <Route path="/profile" element={<PagePlaceholder title="Profile" holds="your account details and guardian contact" icon={UserRound} />} />
        <Route path="/settings" element={<PagePlaceholder title="Settings" holds="camera, hardware, AI, voice, accessibility, and emergency preferences" icon={Settings} />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
