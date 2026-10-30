import { Car, ShieldAlert } from 'lucide-react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ForgotPassword } from '../features/auth/ForgotPassword'
import { Login } from '../features/auth/Login'
import { Register } from '../features/auth/Register'
import { AiAssistance } from '../features/ai/AiAssistance'
import { NavigationPage } from '../features/navigation/NavigationPage'
import { Dashboard } from '../features/dashboard/Dashboard'
import { Profile } from '../features/profile/Profile'
import { Settings as SettingsPage } from '../features/settings/Settings'
import { Devices } from '../features/devices/Devices'
import { History } from '../features/history/History'
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
        <Route path="/ai" element={<AiAssistance />} />
        <Route path="/navigation" element={<NavigationPage />} />
        <Route path="/rides" element={<PagePlaceholder title="Book a Ride" holds="ride requests with fare estimates and ride history" icon={Car} />} />
        <Route path="/devices" element={<Devices />} />
        <Route path="/history" element={<History />} />
        <Route path="/sos" element={<PagePlaceholder title="Emergency SOS" holds="the SOS trigger, guardian alerts, and SOS history" icon={ShieldAlert} />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
