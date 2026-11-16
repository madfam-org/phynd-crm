'use client'

import { Input } from '@/components/ui/input'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { useCallback, useEffect, useState } from 'react'

// Same search-as-you-type pattern as the global search (layout/global-search).
const DEBOUNCE_MS = 300
const BLUR_DELAY_MS = 200
const SEARCH_LIMIT = 50

type SearchOutput = inferRouterOutputs<AppRouter>['search']['search']
type SearchResult = SearchOutput[number]

export interface PickedContact {
  id: string
  name: string
}

interface ContactPickerProps {
  id?: string
  value: PickedContact | null
  onChange: (contact: PickedContact | null) => void
}

/** Pick a contact by typing part of its name, email or company. */
export function ContactPicker({ id, value, onChange }: ContactPickerProps) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const searchRouter = trpc.search as NonNullable<typeof trpc.search>
  const searchQuery = searchRouter.search as NonNullable<typeof searchRouter.search>
  const { data } = searchQuery.useQuery(
    { query: debouncedQuery, limit: SEARCH_LIMIT },
    { enabled: debouncedQuery.length > 0 },
  )
  const contacts = ((data as SearchOutput | undefined) ?? []).filter(
    (result: SearchResult) => result.entityType === 'contact',
  )

  const handleBlur = useCallback(() => {
    setTimeout(() => setIsOpen(false), BLUR_DELAY_MS)
  }, [])

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
        <span className="font-medium">{value.name}</span>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:underline"
          onClick={() => {
            onChange(null)
            setQuery('')
            setDebouncedQuery('')
          }}
        >
          Cambiar
        </button>
      </div>
    )
  }

  const showDropdown = isOpen && debouncedQuery.length > 0

  return (
    <div className="relative">
      <Input
        id={id}
        type="text"
        placeholder="Escribe un nombre, correo o empresa"
        aria-label="Buscar contacto"
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setIsOpen(true)
        }}
        onFocus={() => {
          if (query.trim().length > 0) setIsOpen(true)
        }}
        onBlur={handleBlur}
      />
      {showDropdown && (
        <div className="absolute top-full z-50 mt-1 w-full rounded-md border bg-popover shadow-lg">
          {contacts.length > 0 ? (
            <ul className="max-h-64 overflow-y-auto py-1">
              {contacts.map((result: SearchResult) => (
                <li key={result.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
                    onMouseDown={(e) => {
                      // Keep the blur from closing the list before the click lands.
                      e.preventDefault()
                      onChange({ id: result.id, name: result.title })
                      setIsOpen(false)
                    }}
                  >
                    <span className="truncate font-medium">{result.title}</span>
                    {result.subtitle && (
                      <span className="truncate text-xs text-muted-foreground">
                        {result.subtitle}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {data === undefined ? 'Buscando…' : 'Sin contactos que coincidan'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
