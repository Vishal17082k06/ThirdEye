import { Bot, CalendarClock, Car, Cpu, KeyRound, LayoutDashboard, LogIn, Navigation, Settings, ShieldAlert, UserPlus, UserRound, Waypoints } from 'lucide-react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { PagePlaceholder } from './PagePlaceholder'
import { Shell } from './Shell'

/** Every route in the app. Pages from later tasks are placeholders that say what they will hold. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PagePlaceholder title="Log in" holds="the sign-in form" icon={LogIn} />} />
      <Route path="/register" element={<PagePlaceholder title="Create account" holds="the registration form" icon={UserPlus} />} />
      <Route path="/forgot-password" element={<PagePlaceholder title="Forgot password" holds="the password reset request form" icon={KeyRound} />} />
      <Route path="/portal" element={<PagePlaceholder title="Choose a portal" holds="Simulation Mode and Live Camera Mode cards" icon={Waypoints} />} />

      <Route element={<Shell />}>
        <Route path="/dashboard" element={<PagePlaceholder title="Dashboard" holds="status cards and recent activity" icon={LayoutDashboard} />} />
        <Route path="/ai" element={<PagePlaceholder title="AI Assistance" holds="live camera or image analysis with obstacle detection and spoken announcements" icon={Bot} />} />
        <Route path="/navigation" element={<PagePlaceholder title="Navigation" holds="a Coimbatore map with search, routes, and turn-by-turn steps" icon={Navigation} />} />
        <Route path="/rides" element={<PagePlaceholder title="Book a Ride" holds="ride requests with fare estimates and ride history" icon={Car} />} />
        <Route path="/devices" element={<PagePlaceholder title="Device Management" holds="connection status and configuration for the camera, distance sensor, ESP32-CAM, vibration motor, and battery monitor" icon={Cpu} />} />
        <Route path="/history" element={<PagePlaceholder title="Activity History" holds="a searchable, filterable log of detections, navigation, rides, and emergencies" icon={CalendarClock} />} />
        <Route path="/sos" element={<PagePlaceholder title="Emergency SOS" holds="the SOS trigger, guardian alerts, and SOS history" icon={ShieldAlert} />} />
        <Route path="/profile" element={<PagePlaceholder title="Profile" holds="your account details and guardian contact" icon={UserRound} />} />
        <Route path="/settings" element={<PagePlaceholder title="Settings" holds="camera, hardware, AI, voice, accessibility, and emergency preferences" icon={Settings} />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
