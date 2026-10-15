'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { trpc } from '@/lib/trpc/client'
import { useState } from 'react'
import { toast } from 'sonner'

interface EditContactDialogProps {
  contact: {
    id: string
    name: string
    email: string | null
    phone: string | null
    company: string | null
    preferredName?: string | null
    spanishFormality?: string | null
  }
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditContactDialog({ contact, open, onOpenChange }: EditContactDialogProps) {
  const [name, setName] = useState(contact.name)
  const [email, setEmail] = useState(contact.email ?? '')
  const [phone, setPhone] = useState(contact.phone ?? '')
  const [company, setCompany] = useState(contact.company ?? '')
  const [preferredName, setPreferredName] = useState(contact.preferredName ?? '')
  // 'unset' = not asked yet; portals and mail then use usted.
  const [formality, setFormality] = useState<'tu' | 'usted' | 'unset'>(
    contact.spanishFormality === 'tu' || contact.spanishFormality === 'usted'
      ? contact.spanishFormality
      : 'unset',
  )

  const utils = trpc.useUtils()
  const contactsRouter = trpc.contacts as NonNullable<typeof trpc.contacts>
  const updateContact = contactsRouter.update as NonNullable<typeof contactsRouter.update>
  const contactsUtils = utils.contacts as NonNullable<typeof utils.contacts>
  const listContactsUtils = contactsUtils.list as NonNullable<typeof contactsUtils.list>
  const updateMutation = updateContact.useMutation({
    onSuccess: () => {
      listContactsUtils.invalidate()
      onOpenChange(false)
    },
    onError: (err) => toast.error('Failed to update contact', { description: err.message }),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    updateMutation.mutate({
      id: contact.id,
      name,
      email: email || null,
      phone: phone || null,
      company: company || null,
      preferredName: preferredName.trim() || null,
      spanishFormality: formality === 'unset' ? null : formality,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Contact</DialogTitle>
            <DialogDescription>Update contact information.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Name *</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-phone">Phone</Label>
              <Input id="edit-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-company">Company</Label>
              <Input
                id="edit-company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-preferred-name">Preferred name</Label>
              <Input
                id="edit-preferred-name"
                value={preferredName}
                onChange={(e) => setPreferredName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Spanish register (tú / usted)</Label>
              <Select
                value={formality}
                onValueChange={(v) => setFormality(v as 'tu' | 'usted' | 'unset')}
              >
                <SelectTrigger aria-label="Spanish register">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">Not asked yet (usted)</SelectItem>
                  <SelectItem value="tu">Tú</SelectItem>
                  <SelectItem value="usted">Usted</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateMutation.isPending || !name}>
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
