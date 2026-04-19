'use client'

import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { DeleteEngagementDialog } from './delete-engagement-dialog'

interface DeleteEngagementButtonProps {
  engagementId: string
  projectName: string
  contactId: string
}

export function DeleteEngagementButton({
  engagementId,
  projectName,
  contactId,
}: DeleteEngagementButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
        Delete
      </Button>
      <DeleteEngagementDialog
        engagementId={engagementId}
        projectName={projectName}
        contactId={contactId}
        open={open}
        onOpenChange={setOpen}
        onDeleted={() => router.push('/engagements')}
      />
    </>
  )
}
