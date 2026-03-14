'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useCallback, useMemo, useState } from 'react'

export interface ColumnDef<T> {
  id: string
  header: string
  cell: (row: T) => React.ReactNode
  className?: string
}

export interface FilterOption {
  label: string
  value: string
}

interface DataTableProps<T> {
  columns: ColumnDef<T>[]
  data: T[]
  filterKey?: keyof T & string
  filterOptions?: FilterOption[]
  getRowKey?: (row: T, index: number) => string | number
  onRowClick?: (row: T) => void
  onSelectionChange?: (selectedKeys: Set<string | number>) => void
  searchKey?: keyof T & string
  searchPlaceholder?: string
  selectable?: boolean
}

export function DataTable<T>({
  columns,
  data,
  filterKey,
  filterOptions,
  getRowKey,
  onRowClick,
  onSelectionChange,
  searchKey,
  searchPlaceholder,
  selectable = false,
}: DataTableProps<T>) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedKeys, setSelectedKeys] = useState<Set<string | number>>(new Set())

  const filteredData = useMemo(() => {
    let result = data

    if (searchKey && search) {
      const lower = search.toLowerCase()
      result = result.filter((row) => {
        const val = row[searchKey]
        return typeof val === 'string' && val.toLowerCase().includes(lower)
      })
    }

    if (filterKey && filter && filter !== 'all') {
      result = result.filter((row) => String(row[filterKey]) === filter)
    }

    return result
  }, [data, search, searchKey, filter, filterKey])

  const resolveRowKey = useCallback(
    (row: T, index: number): string | number => {
      return getRowKey ? getRowKey(row, index) : index
    },
    [getRowKey],
  )

  const filteredKeys = useMemo(() => {
    if (!selectable) return new Set<string | number>()
    return new Set(filteredData.map((row, i) => resolveRowKey(row, i)))
  }, [selectable, filteredData, resolveRowKey])

  const allFilteredSelected = useMemo(() => {
    if (filteredKeys.size === 0) return false
    for (const key of filteredKeys) {
      if (!selectedKeys.has(key)) return false
    }
    return true
  }, [filteredKeys, selectedKeys])

  const someFilteredSelected = useMemo(() => {
    if (allFilteredSelected) return false
    for (const key of filteredKeys) {
      if (selectedKeys.has(key)) return true
    }
    return false
  }, [filteredKeys, selectedKeys, allFilteredSelected])

  const updateSelection = useCallback(
    (next: Set<string | number>) => {
      setSelectedKeys(next)
      onSelectionChange?.(next)
    },
    [onSelectionChange],
  )

  const handleSelectAll = useCallback(() => {
    if (allFilteredSelected) {
      // Deselect all filtered rows (keep selections from non-visible rows)
      const next = new Set(selectedKeys)
      for (const key of filteredKeys) {
        next.delete(key)
      }
      updateSelection(next)
    } else {
      // Select all filtered rows
      const next = new Set(selectedKeys)
      for (const key of filteredKeys) {
        next.add(key)
      }
      updateSelection(next)
    }
  }, [allFilteredSelected, filteredKeys, selectedKeys, updateSelection])

  const handleSelectRow = useCallback(
    (key: string | number) => {
      const next = new Set(selectedKeys)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      updateSelection(next)
    },
    [selectedKeys, updateSelection],
  )

  const showToolbar = searchKey || filterOptions
  const colSpan = selectable ? columns.length + 1 : columns.length

  return (
    <div className="space-y-4">
      {showToolbar && (
        <div className="flex items-center gap-4">
          {searchKey && (
            <Input
              placeholder={searchPlaceholder ?? 'Search...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
          )}
          {filterOptions && filterKey && (
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {filterOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {selectable && (
                <TableHead className="w-12">
                  <Checkbox
                    aria-label="Select all rows"
                    checked={
                      allFilteredSelected ? true : someFilteredSelected ? 'indeterminate' : false
                    }
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
              )}
              {columns.map((col) => (
                <TableHead key={col.id} className={col.className}>
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            ) : (
              filteredData.map((row, i) => {
                const rowKey = resolveRowKey(row, i)
                const isSelected = selectedKeys.has(rowKey)
                return (
                  <TableRow
                    key={rowKey}
                    className={onRowClick ? 'cursor-pointer' : undefined}
                    data-state={isSelected ? 'selected' : undefined}
                    onClick={() => onRowClick?.(row)}
                  >
                    {selectable && (
                      <TableCell className="w-12">
                        <Checkbox
                          aria-label={`Select row ${rowKey}`}
                          checked={isSelected}
                          onClick={(e) => e.stopPropagation()}
                          onCheckedChange={() => handleSelectRow(rowKey)}
                        />
                      </TableCell>
                    )}
                    {columns.map((col) => (
                      <TableCell key={col.id} className={col.className}>
                        {col.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
