export default function ClientsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Clients</h1>
          <p className="text-muted-foreground">Manage your client relationships</p>
        </div>
      </div>
      <div className="rounded-lg border">
        <div className="p-6 text-center text-muted-foreground">
          Client data table will be rendered here
        </div>
      </div>
    </div>
  )
}
