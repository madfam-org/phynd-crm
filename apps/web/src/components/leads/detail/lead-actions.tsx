'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreHorizontal } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { DeleteLeadDialog } from '../delete-lead-dialog'
import { EditLeadDialog } from '../edit-lead-dialog'

/** Edit and delete on the lead page (the same dialogs and deletion path as before). */
export function LeadActions({
  lead,
  label,
}: {
  lead: { id: string; status: string; score: number | null; ownerId: string | null }
  label: string
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label="Más acciones del lead">
            <MoreHorizontal aria-hidden className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}>Editar</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onSelect={() => setDeleting(true)}>
            Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editing && (
        <EditLeadDialog
          lead={lead}
          open={editing}
          onOpenChange={(open) => {
            setEditing(open)
            if (!open) router.refresh()
          }}
        />
      )}
      {deleting && (
        <DeleteLeadDialog
          leadId={lead.id}
          leadLabel={label}
          open={deleting}
          onOpenChange={setDeleting}
          onDeleted={() => router.push('/leads')}
        />
      )}
    </>
  )
}
