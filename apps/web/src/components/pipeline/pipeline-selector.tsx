'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useRouter } from 'next/navigation'

interface Pipeline {
  id: string
  name: string
}

interface PipelineSelectorProps {
  pipelines: Pipeline[]
  selectedId: string
}

export function PipelineSelector({ pipelines, selectedId }: PipelineSelectorProps) {
  const router = useRouter()

  return (
    <Select value={selectedId} onValueChange={(id) => router.push(`/pipeline?pipelineId=${id}`)}>
      <SelectTrigger className="w-[240px]">
        <SelectValue placeholder="Select pipeline" />
      </SelectTrigger>
      <SelectContent>
        {pipelines.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
