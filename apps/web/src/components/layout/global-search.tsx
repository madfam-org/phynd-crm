'use client'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { trpc } from '@/lib/trpc/client'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

const DEBOUNCE_MS = 300
const BLUR_DELAY_MS = 200

const ENTITY_BADGE_VARIANTS: Record<string, { label: string; className: string }> = {
  contact: {
    label: 'Contact',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  },
  lead: {
    label: 'Lead',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  },
  opportunity: {
    label: 'Opportunity',
    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  },
}

function getEntityRoute(entityType: string, id: string): string {
  switch (entityType) {
    case 'contact':
      return `/clients/${id}`
    case 'lead':
      return '/leads'
    case 'opportunity':
      return '/opportunities'
    default:
      return '/'
  }
}

export function GlobalSearch() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)

  // Debounce the query value
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim())
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  // Cmd+K / Ctrl+K keyboard shortcut to focus
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const { data: results } = trpc.search.search.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.length > 0 },
  )

  const handleSelect = useCallback(
    (entityType: string, id: string) => {
      setQuery('')
      setDebouncedQuery('')
      setIsOpen(false)
      router.push(getEntityRoute(entityType, id))
    },
    [router],
  )

  const handleBlur = useCallback(() => {
    // Slight delay so click on result registers before dropdown closes
    setTimeout(() => {
      setIsOpen(false)
    }, BLUR_DELAY_MS)
  }, [])

  const showDropdown = isOpen && debouncedQuery.length > 0

  return (
    <div className="relative w-full max-w-sm">
      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          placeholder="Search contacts, leads, opportunities..."
          aria-label="Global search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIsOpen(true)
          }}
          onFocus={() => {
            if (query.trim().length > 0) setIsOpen(true)
          }}
          onBlur={handleBlur}
          className="pr-12"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-input bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          <span className="text-xs">&#8984;K</span>
        </kbd>
      </div>

      {showDropdown && (
        <div
          className="absolute top-full z-50 mt-1 w-full rounded-md border bg-popover shadow-lg"
          aria-label="Search results"
        >
          {results && results.length > 0 ? (
            <ul className="max-h-64 overflow-y-auto py-1">
              {results.map((result) => {
                const badgeConfig = ENTITY_BADGE_VARIANTS[result.entityType]
                return (
                  <li key={`${result.entityType}-${result.id}`}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
                      onMouseDown={(e) => {
                        // Prevent blur from firing before click
                        e.preventDefault()
                        handleSelect(result.entityType, result.id)
                      }}
                    >
                      <Badge variant="outline" className={badgeConfig?.className}>
                        {badgeConfig?.label ?? result.entityType}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{result.title}</p>
                        {result.subtitle && (
                          <p className="truncate text-xs text-muted-foreground">
                            {result.subtitle}
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : results && results.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">No results found.</p>
          ) : (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">Searching...</p>
          )}
        </div>
      )}
    </div>
  )
}
