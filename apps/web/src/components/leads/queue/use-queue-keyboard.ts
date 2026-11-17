'use client'

import { useEffect, useState } from 'react'

/** True from the `md` breakpoint (768 px) up; false on the server and on phones. */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)')
    const update = () => setDesktop(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return desktop
}

/** Keys the queue answers to, ignored while typing or with a modifier held. */
export function queueKeyAction(
  event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey'> & {
    target: EventTarget | null
  },
): 'next' | 'previous' | 'open' | 'assign' | 'toggle' | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null
  const target = event.target as HTMLElement | null
  const tag = target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
    return null
  }
  // Inside an open menu or dialog the keys belong to it.
  if (target?.closest?.('[role="menu"],[role="dialog"],[role="listbox"]')) return null
  switch (event.key) {
    case 'j':
    case 'ArrowDown':
      return 'next'
    case 'k':
    case 'ArrowUp':
      return 'previous'
    case 'Enter':
      return target?.closest?.('[data-lead-row]') ? 'open' : null
    case 'a':
      return 'assign'
    case 'x':
      return 'toggle'
    default:
      return null
  }
}

/**
 * Whether a key acts here. Arrows and row actions need a focused row (so page
 * scrolling keeps working); j/k also bring focus into the list.
 */
function appliesOutsideRow(action: string, key: string, inRow: boolean): boolean {
  if (inRow) return true
  return (
    action !== 'open' &&
    action !== 'assign' &&
    action !== 'toggle' &&
    key !== 'ArrowDown' &&
    key !== 'ArrowUp'
  )
}

/** The row to focus next; the first j only brings focus to the current row. */
export function nextFocusIndex(
  action: 'next' | 'previous',
  current: number,
  rowCount: number,
  inRow: boolean,
): number {
  if (action === 'previous') return Math.max(0, current - 1)
  return Math.min(rowCount - 1, current + (inRow ? 1 : 0))
}

/**
 * j/k (or arrows) move the focused row, Enter opens it, `a` opens its «Asignar a…»
 * menu, `x` selects it. Roving tabindex: only the focused row is in the tab order.
 */
export function useQueueKeyboard({
  rowCount,
  enabled,
  onOpen,
  onAssign,
  onToggle,
}: {
  rowCount: number
  enabled: boolean
  onOpen: (index: number) => void
  onAssign: (index: number) => void
  onToggle: (index: number) => void
}) {
  const [focusedIndex, setFocusedIndex] = useState(0)

  useEffect(() => {
    if (focusedIndex >= rowCount) setFocusedIndex(Math.max(0, rowCount - 1))
  }, [focusedIndex, rowCount])

  useEffect(() => {
    if (!enabled || rowCount === 0) return
    function focusRow(index: number) {
      const row = document.querySelector<HTMLElement>(
        `[data-lead-row="${index}"]:not([aria-hidden])`,
      )
      row?.focus()
    }
    const handlers = { open: onOpen, assign: onAssign, toggle: onToggle }
    function onKeyDown(event: KeyboardEvent) {
      const action = queueKeyAction(event)
      const inRow = Boolean((event.target as HTMLElement | null)?.closest?.('[data-lead-row]'))
      if (!action || !appliesOutsideRow(action, event.key, inRow)) return
      event.preventDefault()
      if (action === 'next' || action === 'previous') {
        const next = nextFocusIndex(action, focusedIndex, rowCount, inRow)
        setFocusedIndex(next)
        focusRow(next)
        return
      }
      handlers[action](focusedIndex)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, rowCount, focusedIndex, onOpen, onAssign, onToggle])

  return { focusedIndex, setFocusedIndex }
}
