'use client'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Textarea } from '@/components/ui/textarea'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { Rocket } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

type ProjectKind = 'digital' | 'physical' | 'phygital'
type DeliveryTrack = 'digital_experience' | 'digital_twin' | 'fabrication' | 'fulfillment' | 'kiosk'
type RouterOutputs = inferRouterOutputs<AppRouter>
type PipelinesListOutput = RouterOutputs['pipelines']['list']
type PipelineStagesOutput = RouterOutputs['pipelines']['getStages']
type PipelineRow = PipelinesListOutput['items'][number]

function getOnboardedEngagementId(row: unknown): string | undefined {
  if (!row || typeof row !== 'object') return undefined
  const engagement = (row as { engagement?: { id?: unknown } }).engagement
  return typeof engagement?.id === 'string' ? engagement.id : undefined
}

const DELIVERY_TRACKS: Array<{ label: string; value: DeliveryTrack }> = [
  { label: 'Digital experience', value: 'digital_experience' },
  { label: 'Digital twin', value: 'digital_twin' },
  { label: 'Fabrication', value: 'fabrication' },
  { label: 'Fulfillment', value: 'fulfillment' },
  { label: 'Kiosk', value: 'kiosk' },
]

const KIND_DEFAULT_TRACKS: Record<ProjectKind, DeliveryTrack[]> = {
  digital: ['digital_experience'],
  physical: ['fabrication', 'fulfillment'],
  phygital: ['fabrication', 'digital_twin', 'kiosk'],
}

export function CreateClientProjectDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [clientCompany, setClientCompany] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [projectName, setProjectName] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<ProjectKind>('phygital')
  const [deliveryTracks, setDeliveryTracks] = useState<DeliveryTrack[]>(
    KIND_DEFAULT_TRACKS.phygital,
  )
  const [pipelineId, setPipelineId] = useState('')
  const [stageId, setStageId] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [quoteNumber, setQuoteNumber] = useState('')
  const [createProductionOrder, setCreateProductionOrder] = useState(false)
  const [orderNumber, setOrderNumber] = useState('')
  const [estimatedCompletion, setEstimatedCompletion] = useState('')

  const pipelinesRouter = trpc.pipelines as NonNullable<typeof trpc.pipelines>
  const engagementsRouter = trpc.engagements as NonNullable<typeof trpc.engagements>
  const listPipelines = pipelinesRouter.list as NonNullable<typeof pipelinesRouter.list>
  const getStages = pipelinesRouter.getStages as NonNullable<typeof pipelinesRouter.getStages>
  const onboardClientProject = engagementsRouter.onboardClientProject as NonNullable<
    typeof engagementsRouter.onboardClientProject
  >

  const { data: pipelinesData } = listPipelines.useQuery(undefined, { enabled: open })
  const { data: stagesData } = getStages.useQuery({ pipelineId }, { enabled: open && !!pipelineId })
  const pipelines = (pipelinesData as PipelinesListOutput | undefined)?.items ?? []
  const stages = (stagesData as PipelineStagesOutput | undefined) ?? []

  useEffect(() => {
    if (!open || pipelineId || !pipelines.length) return
    const defaultPipeline = pipelines.find((p: PipelineRow) => p.isDefault) ?? pipelines[0]
    if (defaultPipeline) setPipelineId(defaultPipeline.id)
  }, [open, pipelineId, pipelines])

  useEffect(() => {
    if (!open || !pipelineId || stageId || !stages?.length) return
    setStageId(stages[0]?.id ?? '')
  }, [open, pipelineId, stageId, stages])

  const utils = trpc.useUtils()
  const contactsUtils = utils.contacts as NonNullable<typeof utils.contacts>
  const opportunitiesUtils = utils.opportunities as NonNullable<typeof utils.opportunities>
  const engagementsUtils = utils.engagements as NonNullable<typeof utils.engagements>
  const quotesUtils = utils.quotes as NonNullable<typeof utils.quotes>
  const ordersUtils = utils.orders as NonNullable<typeof utils.orders>
  const createMutation = onboardClientProject.useMutation({
    onSuccess: (row) => {
      contactsUtils.list.invalidate()
      opportunitiesUtils.list.invalidate()
      engagementsUtils.list.invalidate()
      quotesUtils.list.invalidate()
      ordersUtils.list.invalidate()
      toast.success('Client project onboarded')
      setOpen(false)
      resetForm()
      const engagementId = getOnboardedEngagementId(row)
      if (engagementId) {
        router.push(`/engagements/${engagementId}`)
      }
    },
    onError: (err) => toast.error('Failed to onboard client project', { description: err.message }),
  })

  function resetForm() {
    setClientName('')
    setClientEmail('')
    setClientCompany('')
    setClientPhone('')
    setProjectName('')
    setDescription('')
    setKind('phygital')
    setDeliveryTracks(KIND_DEFAULT_TRACKS.phygital)
    setPipelineId('')
    setStageId('')
    setAmount('')
    setCurrency('USD')
    setQuoteNumber('')
    setCreateProductionOrder(false)
    setOrderNumber('')
    setEstimatedCompletion('')
  }

  function handleKindChange(value: ProjectKind) {
    setKind(value)
    setDeliveryTracks(KIND_DEFAULT_TRACKS[value])
  }

  function toggleTrack(track: DeliveryTrack, checked: boolean) {
    setDeliveryTracks((current) =>
      checked ? [...new Set([...current, track])] : current.filter((item) => item !== track),
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    createMutation.mutate({
      client: buildClientInput(),
      project: buildProjectInput(),
      commercial: buildCommercialInput(),
      intakeSource: 'crm',
    })
  }

  const canSubmit = Boolean(clientName.trim() && projectName.trim() && pipelineId && stageId)

  function buildClientInput() {
    return {
      name: clientName.trim(),
      email: clientEmail.trim() || undefined,
      phone: clientPhone.trim() || undefined,
      company: clientCompany.trim() || undefined,
    }
  }

  function buildProjectInput() {
    return {
      name: projectName.trim(),
      description: description.trim() || undefined,
      kind,
      deliveryTracks: deliveryTracks.length > 0 ? deliveryTracks : undefined,
    }
  }

  function buildCommercialInput() {
    return {
      pipelineId,
      stageId,
      amount: amount || undefined,
      currency: currency || undefined,
      quoteNumber: quoteNumber.trim() || undefined,
      createProductionOrder,
      orderNumber: createProductionOrder ? orderNumber.trim() || undefined : undefined,
      estimatedCompletion: parseOptionalDate(estimatedCompletion, createProductionOrder),
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) resetForm()
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Rocket className="mr-2 h-4 w-4" />
          Onboard Client Project
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Onboard Client Project</DialogTitle>
            <DialogDescription>
              Create the client, opportunity, engagement, quote, and optional production order.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-4">
            <section className="grid gap-3">
              <h2 className="text-sm font-semibold">Client</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="onboard-client-name">Name *</Label>
                  <Input
                    id="onboard-client-name"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    maxLength={255}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="onboard-client-email">Email</Label>
                  <Input
                    id="onboard-client-email"
                    type="email"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="onboard-client-company">Company</Label>
                  <Input
                    id="onboard-client-company"
                    value={clientCompany}
                    onChange={(e) => setClientCompany(e.target.value)}
                    maxLength={255}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="onboard-client-phone">Phone</Label>
                  <Input
                    id="onboard-client-phone"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    maxLength={50}
                  />
                </div>
              </div>
            </section>

            <section className="grid gap-3">
              <h2 className="text-sm font-semibold">Project</h2>
              <div className="grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="onboard-project-name">Project Name *</Label>
                  <Input
                    id="onboard-project-name"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    maxLength={255}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="onboard-description">Description</Label>
                  <Textarea
                    id="onboard-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={2000}
                    rows={3}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>Project Type *</Label>
                    <Select
                      value={kind}
                      onValueChange={(value) => handleKindChange(value as ProjectKind)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select project type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="digital">Digital</SelectItem>
                        <SelectItem value="physical">Physical</SelectItem>
                        <SelectItem value="phygital">Phygital</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Delivery Tracks</Label>
                    <div className="grid gap-2">
                      {DELIVERY_TRACKS.map((track) => (
                        <div key={track.value} className="flex items-center gap-2">
                          <Checkbox
                            id={`delivery-track-${track.value}`}
                            checked={deliveryTracks.includes(track.value)}
                            onCheckedChange={(checked) =>
                              toggleTrack(track.value, checked === true)
                            }
                          />
                          <Label htmlFor={`delivery-track-${track.value}`} className="text-sm">
                            {track.label}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="grid gap-3">
              <h2 className="text-sm font-semibold">Quote and Pipeline</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Pipeline *</Label>
                  <Select
                    value={pipelineId}
                    onValueChange={(value) => {
                      setPipelineId(value)
                      setStageId('')
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select pipeline" />
                    </SelectTrigger>
                    <SelectContent>
                      {pipelines.map((pipeline) => (
                        <SelectItem key={pipeline.id} value={pipeline.id}>
                          {pipeline.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Stage *</Label>
                  <Select value={stageId} onValueChange={setStageId} disabled={!pipelineId}>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={pipelineId ? 'Select stage' : 'Select pipeline first'}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(stages ?? []).map((stage) => (
                        <SelectItem key={stage.id} value={stage.id}>
                          {stage.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="onboard-amount">Quote Amount</Label>
                  <Input
                    id="onboard-amount"
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="onboard-currency">Currency</Label>
                  <Input
                    id="onboard-currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    maxLength={10}
                  />
                </div>
                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="onboard-quote-number">Quote Number</Label>
                  <Input
                    id="onboard-quote-number"
                    value={quoteNumber}
                    onChange={(e) => setQuoteNumber(e.target.value)}
                    maxLength={50}
                    placeholder="Auto-generated if blank"
                  />
                </div>
              </div>
            </section>

            <section className="grid gap-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="create-production-order"
                  checked={createProductionOrder}
                  onCheckedChange={(checked) => setCreateProductionOrder(checked === true)}
                />
                <Label htmlFor="create-production-order" className="text-sm font-medium">
                  Create production order
                </Label>
              </div>
              {createProductionOrder && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="onboard-order-number">Order Number</Label>
                    <Input
                      id="onboard-order-number"
                      value={orderNumber}
                      onChange={(e) => setOrderNumber(e.target.value)}
                      maxLength={50}
                      placeholder="Auto-generated if blank"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="onboard-estimated-completion">Estimated Completion</Label>
                    <Input
                      id="onboard-estimated-completion"
                      type="date"
                      value={estimatedCompletion}
                      onChange={(e) => setEstimatedCompletion(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </section>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !canSubmit}>
              {createMutation.isPending ? 'Onboarding...' : 'Onboard'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function parseOptionalDate(value: string, enabled: boolean): Date | undefined {
  if (!enabled || !value) return undefined
  return new Date(value)
}
