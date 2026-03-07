export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Configure your CRM preferences</p>
      </div>
      <div className="rounded-lg border p-6">
        <h2 className="text-lg font-semibold">Panel Order</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Customize the order of federation panels in client profiles
        </p>
      </div>
    </div>
  )
}
