import { PanelOrderSettings } from '@/components/settings/panel-order-settings'
import Link from 'next/link'

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Configure your CRM preferences</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/settings/pipelines"
          className="rounded-lg border bg-card p-6 hover:border-primary transition-colors"
        >
          <h3 className="font-semibold">Pipeline Management</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Create and customize pipelines and stages
          </p>
        </Link>
        <Link
          href="/settings/scoring"
          className="rounded-lg border bg-card p-6 hover:border-primary transition-colors"
        >
          <h3 className="font-semibold">Lead Scoring Rules</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Configure scoring rules and conditions
          </p>
        </Link>
        <Link
          href="/settings/users"
          className="rounded-lg border bg-card p-6 hover:border-primary transition-colors"
        >
          <h3 className="font-semibold">User Management</h3>
          <p className="text-sm text-muted-foreground mt-1">Manage team members and roles</p>
        </Link>
      </div>
      <PanelOrderSettings />
    </div>
  )
}
