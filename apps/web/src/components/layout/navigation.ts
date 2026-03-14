import {
  Activity,
  BarChart3,
  Contact,
  Eye,
  Filter,
  Gift,
  Kanban,
  LayoutDashboard,
  Megaphone,
  Settings,
  Target,
  TrendingUp,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface NavigationItem {
  name: string
  href: string
  icon: LucideIcon
}

export const navigation: NavigationItem[] = [
  { name: 'Dashboard', href: '/overview', icon: LayoutDashboard },
  { name: 'Contacts', href: '/contacts', icon: Contact },
  { name: 'Leads', href: '/leads', icon: Target },
  { name: 'Opportunities', href: '/opportunities', icon: TrendingUp },
  { name: 'Pipeline', href: '/pipeline', icon: Kanban },
  { name: 'Activities', href: '/activities', icon: Activity },
  { name: 'Visitors', href: '/visitors', icon: Eye },
  { name: 'Offers', href: '/offers', icon: Gift },
  { name: 'Campaigns', href: '/campaigns', icon: Megaphone },
  { name: 'Funnel', href: '/funnel', icon: Filter },
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
  { name: 'Settings', href: '/settings', icon: Settings },
]
