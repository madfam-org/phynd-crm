'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ColumnDef } from '@/components/ui/data-table'
import { DataTable } from '@/components/ui/data-table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { useMemo, useState } from 'react'
import { CreateCampaignDialog } from './create-campaign-dialog'
import { DeleteCampaignDialog } from './delete-campaign-dialog'
import { EditCampaignDialog } from './edit-campaign-dialog'
import { TulanaCampaignReviewDialog } from './tulana-campaign-review-dialog'
import { TulanaCampaignSendDialog } from './tulana-campaign-send-dialog'

type CampaignsListOutput = inferRouterOutputs<AppRouter>['campaigns']['list']
type CampaignRow = CampaignsListOutput['items'][number]

interface CampaignsDataTableProps {
  initialData: CampaignsListOutput
  initialStatusFilter?: string
}

const statusVariant: Record<string, 'default' | 'success' | 'warning' | 'secondary'> = {
  active: 'success',
  approved: 'success',
  completed: 'default',
  draft: 'secondary',
  draft_imported: 'secondary',
  needs_review: 'warning',
  paused: 'warning',
  rejected: 'secondary',
  scheduled: 'default',
  sent: 'success',
  suppressed: 'secondary',
}

const channelVariant: Record<string, 'default' | 'secondary' | 'outline'> = {
  direct: 'outline',
  email: 'default',
  organic: 'outline',
  other: 'outline',
  paid_search: 'secondary',
  reddit_bot: 'secondary',
  referral: 'outline',
  social: 'secondary',
}

function formatDate(date: Date | string | null): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString()
}

function formatBudget(budget: string | null, currency: string | null): string {
  if (!budget) return '—'
  return `${currency ?? ''} ${budget}`.trim()
}

export function CampaignsDataTable({
  initialData,
  initialStatusFilter = 'all',
}: CampaignsDataTableProps) {
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter)
  const [readinessFilter, setReadinessFilter] = useState<string>('all')
  const [skuSearch, setSkuSearch] = useState('')
  const [tulanaOnly, setTulanaOnly] = useState(false)

  const campaignsRouter = trpc.campaigns as NonNullable<typeof trpc.campaigns>
  const listCampaigns = campaignsRouter.list as NonNullable<typeof campaignsRouter.list>

  const listInput = useMemo(() => {
    const filters: {
      status?: string
      gaReadiness?: string
      skuKey?: string
      tulanaOnly?: boolean
    } = {}
    if (statusFilter !== 'all') filters.status = statusFilter
    if (readinessFilter !== 'all') filters.gaReadiness = readinessFilter
    if (skuSearch.trim()) filters.skuKey = skuSearch.trim()
    if (tulanaOnly) filters.tulanaOnly = true
    return Object.keys(filters).length > 0 ? { filters } : undefined
  }, [statusFilter, readinessFilter, skuSearch, tulanaOnly])

  const { data } = listCampaigns.useQuery(listInput, {
    initialData: listInput ? undefined : initialData,
    refetchInterval: 60_000,
  })
  const campaigns = (data as typeof initialData | undefined)?.items ?? []

  const [editCampaign, setEditCampaign] = useState<CampaignRow | null>(null)
  const [deleteCampaign, setDeleteCampaign] = useState<CampaignRow | null>(null)
  const [reviewCampaign, setReviewCampaign] = useState<CampaignRow | null>(null)
  const [sendCampaign, setSendCampaign] = useState<CampaignRow | null>(null)

  const columns: ColumnDef<CampaignRow>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      id: 'skuKey',
      header: 'SKU',
      cell: (row) => (
        <span className="font-mono text-xs text-muted-foreground">{row.skuKey ?? '—'}</span>
      ),
    },
    {
      id: 'gaReadiness',
      header: 'GA readiness',
      cell: (row) =>
        row.gaReadiness ? (
          <Badge variant="outline" className="capitalize">
            {row.gaReadiness.replace('_', ' ')}
          </Badge>
        ) : (
          '—'
        ),
    },
    {
      id: 'channel',
      header: 'Channel',
      cell: (row) =>
        row.channel ? (
          <Badge variant={channelVariant[row.channel] ?? 'outline'} className="capitalize">
            {row.channel.replace('_', ' ')}
          </Badge>
        ) : (
          '—'
        ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge variant={statusVariant[row.status] ?? 'default'} className="capitalize">
          {row.status.replace('_', ' ')}
        </Badge>
      ),
    },
    {
      id: 'budget',
      header: 'Budget',
      cell: (row) => formatBudget(row.budget, row.currency),
    },
    {
      id: 'utmCampaign',
      header: 'UTM Campaign',
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{row.utmCampaign ?? '—'}</span>
      ),
    },
    {
      id: 'startDate',
      header: 'Start',
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.startDate)}</span>
      ),
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
            {row.skuKey && row.status === 'needs_review' && (
              <DropdownMenuItem onClick={() => setReviewCampaign(row)}>
                Review import
              </DropdownMenuItem>
            )}
            {row.skuKey && (row.status === 'approved' || row.status === 'scheduled') && (
              <DropdownMenuItem onClick={() => setSendCampaign(row)}>
                Dispatch to contact
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setEditCampaign(row)}>Edit</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteCampaign(row)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor="campaign-status-filter"
            >
              Status
            </label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger id="campaign-status-filter">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="needs_review">Needs review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor="campaign-ga-filter"
            >
              GA readiness
            </label>
            <Select value={readinessFilter} onValueChange={setReadinessFilter}>
              <SelectTrigger id="campaign-ga-filter">
                <SelectValue placeholder="All readiness" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All readiness</SelectItem>
                <SelectItem value="not_ready">Not ready</SelectItem>
                <SelectItem value="near_ready">Near ready</SelectItem>
                <SelectItem value="ready">Ready</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor="campaign-sku-filter"
            >
              SKU key
            </label>
            <Input
              id="campaign-sku-filter"
              placeholder="e.g. avala__issuer"
              value={skuSearch}
              onChange={(e) => setSkuSearch(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              variant={tulanaOnly ? 'default' : 'outline'}
              onClick={() => setTulanaOnly((value) => !value)}
            >
              {tulanaOnly ? 'Tulana imports only' : 'All campaigns'}
            </Button>
          </div>
        </div>
        <CreateCampaignDialog />
      </div>
      <DataTable columns={columns} data={campaigns} getRowKey={(row) => row.id} />
      {editCampaign && (
        <EditCampaignDialog
          campaign={editCampaign}
          open={!!editCampaign}
          onOpenChange={(open) => !open && setEditCampaign(null)}
        />
      )}
      {deleteCampaign && (
        <DeleteCampaignDialog
          campaignId={deleteCampaign.id}
          campaignName={deleteCampaign.name}
          open={!!deleteCampaign}
          onOpenChange={(open) => !open && setDeleteCampaign(null)}
        />
      )}
      {reviewCampaign && (
        <TulanaCampaignReviewDialog
          campaign={reviewCampaign}
          open={!!reviewCampaign}
          onOpenChange={(open) => !open && setReviewCampaign(null)}
        />
      )}
      {sendCampaign && (
        <TulanaCampaignSendDialog
          campaign={sendCampaign}
          open={!!sendCampaign}
          onOpenChange={(open) => !open && setSendCampaign(null)}
        />
      )}
    </div>
  )
}
