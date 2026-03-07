export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Welcome to Phyne CRM</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <DashboardCard title="Contacts" value="--" description="Total contacts" />
        <DashboardCard title="Leads" value="--" description="Active leads" />
        <DashboardCard title="Opportunities" value="--" description="Open deals" />
        <DashboardCard title="Pipeline Value" value="--" description="Total pipeline" />
      </div>
    </div>
  )
}

function DashboardCard({ title, value, description }: { title: string; value: string; description: string }) {
  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="text-sm font-medium text-muted-foreground">{title}</div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  )
}
