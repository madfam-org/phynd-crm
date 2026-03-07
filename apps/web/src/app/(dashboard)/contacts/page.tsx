export default function ContactsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Contacts</h1>
          <p className="text-muted-foreground">View and manage contacts</p>
        </div>
      </div>
      <div className="rounded-lg border">
        <div className="p-6 text-center text-muted-foreground">
          Contacts data table will be rendered here
        </div>
      </div>
    </div>
  )
}
