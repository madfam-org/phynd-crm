import { PanelOrderSettings } from '@/components/settings/panel-order-settings'

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Configure your CRM preferences</p>
      </div>
      <PanelOrderSettings />
    </div>
  )
}
