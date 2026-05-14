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
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { useState } from 'react'
import { CreateCampaignDialog } from './create-campaign-dialog'
import { DeleteCampaignDialog } from './delete-campaign-dialog'
import { EditCampaignDialog } from './edit-campaign-dialog'

type CampaignsListOutput = inferRouterOutputs<AppRouter>['campaigns']['list']
type CampaignRow = CampaignsListOutput['items'][number]

interface CampaignsDataTableProps {
  initialData: CampaignsListOutput
}

const statusVariant: Record<string, 'default' | 'success' | 'warning' | 'secondary'> = {
  active: 'success',
  completed: 'default',
  draft: 'secondary',
  paused: 'warning',
}

const channelVariant: Record<string, 'default' | 'secondary' | 'outline'> = {
  direct: 'outline',
  email: 'default',
  organic: 'outline',
  other: 'outline',
  paid_search: 'secondary',
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

export function CampaignsDataTable({ initialData }: CampaignsDataTableProps) {
  const campaignsRouter = trpc.campaigns as NonNullable<typeof trpc.campaigns>
  const listCampaigns = campaignsRouter.list as NonNullable<typeof campaignsRouter.list>
  const { data } = listCampaigns.useQuery(undefined, {
    initialData,
    refetchInterval: 60_000,
  })
  const campaigns: CampaignRow[] = data?.items ?? []

  const [editCampaign, setEditCampaign] = useState<CampaignRow | null>(null)
  const [deleteCampaign, setDeleteCampaign] = useState<CampaignRow | null>(null)

  const columns: ColumnDef<CampaignRow>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (row) => <span className="font-medium">{row.name}</span>,
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
          {row.status}
        </Badge>
      ),
    },
    {
      id: 'budget',
      header: 'Budget',
      cell: (row) => formatBudget(row.budget, row.currency),
    },
    {
      id: 'spend',
      header: 'Spend',
      cell: (row) => formatBudget(row.spend, row.currency),
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
      id: 'endDate',
      header: 'End',
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.endDate)}</span>
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
      <div className="flex justify-end">
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
    </div>
  )
}
