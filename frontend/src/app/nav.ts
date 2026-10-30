import {
  Bot,
  CalendarClock,
  Car,
  Cpu,
  LayoutDashboard,
  Navigation as NavigationIcon,
  Settings,
  ShieldAlert,
  UserRound,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

/** Spec section 14: exact sidebar order. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/ai', label: 'AI Assistance', icon: Bot },
  { to: '/navigation', label: 'Navigation', icon: NavigationIcon },
  { to: '/rides', label: 'Book a Ride', icon: Car },
  { to: '/devices', label: 'Device Management', icon: Cpu },
  { to: '/history', label: 'Activity History', icon: CalendarClock },
  { to: '/sos', label: 'Emergency SOS', icon: ShieldAlert },
  { to: '/profile', label: 'Profile', icon: UserRound },
  { to: '/settings', label: 'Settings', icon: Settings },
]
