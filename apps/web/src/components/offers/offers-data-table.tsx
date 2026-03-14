'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ColumnDef } from '@/components/ui/data-table'
import { DataTable } from '@/components/ui/data-table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phyne/api'
import type { inferRouterOutputs } from '@trpc/server'
import { useState } from 'react'
import { toast } from 'sonner'
import { DeleteOfferDialog } from './delete-offer-dialog'
import { EditOfferDialog } from './edit-offer-dialog'

type OffersListOutput = inferRouterOutputs<AppRouter>['offers']['list']
type OfferRow = OffersListOutput['items'][number]

interface OffersDataTableProps {
  initialData: OffersListOutput
}

const statusVariant: Record<string, 'default' | 'success' | 'warning' | 'secondary'> = {
  draft: 'secondary',
  active: 'success',
  paused: 'warning',
  expired: 'default',
}

export function OffersDataTable({ initialData }: OffersDataTableProps) {
  const { data: offers } = trpc.offers.list.useQuery(undefined, {
    initialData,
    refetchInterval: 60_000,
  })
  const [createOpen, setCreateOpen] = useState(false)
  const [editOffer, setEditOffer] = useState<OfferRow | null>(null)
  const [deleteOffer, setDeleteOffer] = useState<OfferRow | null>(null)
  const [createName, setCreateName] = useState('')
  const [createType, setCreateType] = useState<string>('custom')
  const [createDescription, setCreateDescription] = useState('')
  const [createValue, setCreateValue] = useState('')
  const [createCurrency, setCreateCurrency] = useState('')
  const [createValidFrom, setCreateValidFrom] = useState('')
  const [createValidUntil, setCreateValidUntil] = useState('')
  const [createMaxRedemptions, setCreateMaxRedemptions] = useState('')

  const utils = trpc.useUtils()

  function resetCreateForm() {
    setCreateName('')
    setCreateType('custom')
    setCreateDescription('')
    setCreateValue('')
    setCreateCurrency('')
    setCreateValidFrom('')
    setCreateValidUntil('')
    setCreateMaxRedemptions('')
  }

  const createMutation = trpc.offers.create.useMutation({
    onSuccess: () => {
      utils.offers.list.invalidate()
      setCreateOpen(false)
      resetCreateForm()
    },
    onError: (err) => toast.error('Failed to create offer', { description: err.message }),
  })

  const columns: ColumnDef<OfferRow>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      id: 'type',
      header: 'Type',
      cell: (row) => <Badge variant="outline">{row.type}</Badge>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => <Badge variant={statusVariant[row.status] ?? 'default'}>{row.status}</Badge>,
    },
    {
      id: 'redemptions',
      header: 'Redemptions',
      cell: (row) =>
        row.maxRedemptions
          ? `${row.currentRedemptions}/${row.maxRedemptions}`
          : String(row.currentRedemptions),
    },
    {
      id: 'value',
      header: 'Value',
      cell: (row) => (row.value ? `${row.currency ?? ''} ${row.value}`.trim() : '—'),
    },
    {
      id: 'actions',
      header: '',
      className: 'w-[50px]',
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              ...
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditOffer(row)}>Edit</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteOffer(row)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>Create Offer</Button>
          </DialogTrigger>
          <DialogContent>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                createMutation.mutate({
                  name: createName,
                  type: createType as 'discount' | 'bundle' | 'free_trial' | 'custom',
                  description: createDescription || undefined,
                  value: createValue || undefined,
                  currency: createCurrency || undefined,
                  validFrom: createValidFrom ? new Date(createValidFrom) : undefined,
                  validUntil: createValidUntil ? new Date(createValidUntil) : undefined,
                  maxRedemptions: createMaxRedemptions ? Number(createMaxRedemptions) : undefined,
                })
              }}
            >
              <DialogHeader>
                <DialogTitle>Create Offer</DialogTitle>
                <DialogDescription>Add a new offer for Cotiza and Forj products.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="create-offer-name">Name *</Label>
                  <Input
                    id="create-offer-name"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Type</Label>
                  <Select value={createType} onValueChange={setCreateType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="custom">Custom</SelectItem>
                      <SelectItem value="discount">Discount</SelectItem>
                      <SelectItem value="bundle">Bundle</SelectItem>
                      <SelectItem value="free_trial">Free Trial</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="create-offer-description">Description</Label>
                  <Textarea
                    id="create-offer-description"
                    value={createDescription}
                    onChange={(e) => setCreateDescription(e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="create-offer-value">Value</Label>
                    <Input
                      id="create-offer-value"
                      value={createValue}
                      onChange={(e) => setCreateValue(e.target.value)}
                      placeholder="e.g. 10.00"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="create-offer-currency">Currency</Label>
                    <Input
                      id="create-offer-currency"
                      value={createCurrency}
                      onChange={(e) => setCreateCurrency(e.target.value)}
                      placeholder="e.g. USD"
                      maxLength={3}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="create-offer-valid-from">Valid From</Label>
                    <Input
                      id="create-offer-valid-from"
                      type="date"
                      value={createValidFrom}
                      onChange={(e) => setCreateValidFrom(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="create-offer-valid-until">Valid Until</Label>
                    <Input
                      id="create-offer-valid-until"
                      type="date"
                      value={createValidUntil}
                      onChange={(e) => setCreateValidUntil(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="create-offer-max-redemptions">Max Redemptions</Label>
                  <Input
                    id="create-offer-max-redemptions"
                    type="number"
                    min={1}
                    value={createMaxRedemptions}
                    onChange={(e) => setCreateMaxRedemptions(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending || !createName}>
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <DataTable columns={columns} data={offers?.items ?? []} getRowKey={(row) => row.id} />
      {editOffer && (
        <EditOfferDialog
          offer={editOffer}
          open={!!editOffer}
          onOpenChange={(open) => !open && setEditOffer(null)}
        />
      )}
      {deleteOffer && (
        <DeleteOfferDialog
          offerId={deleteOffer.id}
          offerName={deleteOffer.name}
          open={!!deleteOffer}
          onOpenChange={(open) => !open && setDeleteOffer(null)}
        />
      )}
    </div>
  )
}
