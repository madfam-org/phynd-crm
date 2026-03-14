'use client'

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
import { useMemo, useState } from 'react'

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
  getRowKey?: (row: T, index: number) => string | number
  onRowClick?: (row: T) => void
  searchKey?: keyof T & string
  searchPlaceholder?: string
  filterKey?: keyof T & string
  filterOptions?: FilterOption[]
}

export function DataTable<T>({
  columns,
  data,
  getRowKey,
  onRowClick,
  searchKey,
  searchPlaceholder,
  filterKey,
  filterOptions,
}: DataTableProps<T>) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')

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

  const showToolbar = searchKey || filterOptions

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
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            ) : (
              filteredData.map((row, i) => (
                <TableRow
                  key={getRowKey ? getRowKey(row, i) : i}
                  className={onRowClick ? 'cursor-pointer' : undefined}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((col) => (
                    <TableCell key={col.id} className={col.className}>
                      {col.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
