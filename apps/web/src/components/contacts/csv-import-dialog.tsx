'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  type ColumnMapping,
  type ContactField,
  mapColumnsToContacts,
  parseCsvFile,
} from '@/lib/csv-import'
import { trpc } from '@/lib/trpc/client'
import { Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

const FIELD_OPTIONS: { value: ContactField; label: string }[] = [
  { label: 'Skip', value: 'skip' },
  { label: 'Name', value: 'name' },
  { label: 'Email', value: 'email' },
  { label: 'Phone', value: 'phone' },
  { label: 'Company', value: 'company' },
]

function autoDetectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]?.toLowerCase().trim() ?? ''
    if (header.includes('name')) mapping[i] = 'name'
    else if (header.includes('email')) mapping[i] = 'email'
    else if (header.includes('phone')) mapping[i] = 'phone'
    else if (header.includes('company') || header.includes('org')) mapping[i] = 'company'
    else mapping[i] = 'skip'
  }
  return mapping
}

export function CsvImportDialog() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'upload' | 'map' | 'confirm'>('upload')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  const utils = trpc.useUtils()
  const contactsRouter = trpc.contacts as NonNullable<typeof trpc.contacts>
  const bulkCreateContacts = contactsRouter.bulkCreate as NonNullable<typeof contactsRouter.bulkCreate>
  const contactsUtils = utils.contacts as NonNullable<typeof utils.contacts>
  const listContactsUtils = contactsUtils.list as NonNullable<typeof contactsUtils.list>
  const bulkCreateMutation = bulkCreateContacts.useMutation({
    onSuccess: (created) => {
      listContactsUtils.invalidate()
      toast.success(`Imported ${created.length} contacts`)
      handleClose()
    },
    onError: (err) => toast.error('Import failed', { description: err.message }),
  })

  function handleClose() {
    setOpen(false)
    setStep('upload')
    setHeaders([])
    setRows([])
    setMapping({})
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const parsed = await parseCsvFile(file)
      setHeaders(parsed.headers)
      setRows(parsed.rows)
      setMapping(autoDetectMapping(parsed.headers))
      setStep('map')
    } catch {
      toast.error('Failed to parse CSV file')
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function handleMappingChange(colIdx: number, field: ContactField) {
    setMapping((prev) => ({ ...prev, [colIdx]: field }))
  }

  function getMappedContacts() {
    return mapColumnsToContacts(rows, mapping)
  }

  function handleImport() {
    const contacts = getMappedContacts()
    if (contacts.length === 0) {
      toast.error('No valid rows to import (every row needs a name)')
      return
    }
    bulkCreateMutation.mutate(contacts)
  }

  const hasNameMapping = Object.values(mapping).includes('name')
  const previewRows = rows.slice(0, 5)
  const mappedCount = hasNameMapping ? getMappedContacts().length : 0

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : handleClose())}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="mr-2 h-4 w-4" />
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Contacts from CSV</DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Upload a CSV file to import contacts.'}
            {step === 'map' && 'Map CSV columns to contact fields.'}
            {step === 'confirm' && `Ready to import ${mappedCount} contacts.`}
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="py-8">
            <label
              htmlFor="csv-file-input"
              className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 hover:border-primary transition-colors"
            >
              <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Click to select a CSV file</span>
              <input
                id="csv-file-input"
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>
          </div>
        )}

        {step === 'map' && (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              {headers.map((header, idx) => (
                <div key={header} className="flex items-center gap-3">
                  <span className="w-32 truncate text-sm font-medium">{header}</span>
                  <Select
                    value={mapping[idx] ?? 'skip'}
                    onValueChange={(v) => handleMappingChange(idx, v as ContactField)}
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELD_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {previewRows.length > 0 && (
              <div>
                <Label className="text-xs">Preview (first {previewRows.length} rows)</Label>
                <div className="mt-1 max-h-40 overflow-auto rounded border text-xs">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        {headers.map((h) => (
                          <th key={h} className="p-1 text-left font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, rIdx) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: preview rows have no stable key
                        <tr key={rIdx} className="border-b">
                          {row.map((cell, cIdx) => (
                            // biome-ignore lint/suspicious/noArrayIndexKey: preview cells have no stable key
                            <td key={cIdx} className="p-1 truncate max-w-[150px]">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('upload')}>
                Back
              </Button>
              <Button onClick={() => setStep('confirm')} disabled={!hasNameMapping}>
                Next
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'confirm' && (
          <div className="space-y-4 py-4">
            <p className="text-sm">
              <strong>{mappedCount}</strong> contacts will be imported from{' '}
              <strong>{rows.length}</strong> rows.
              {rows.length - mappedCount > 0 && (
                <span className="text-muted-foreground">
                  {' '}
                  ({rows.length - mappedCount} rows skipped — missing name)
                </span>
              )}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('map')}>
                Back
              </Button>
              <Button
                onClick={handleImport}
                disabled={bulkCreateMutation.isPending || mappedCount === 0}
              >
                {bulkCreateMutation.isPending ? 'Importing...' : `Import ${mappedCount} Contacts`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
