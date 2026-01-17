'use client'

import { HTMLTable, Checkbox, Spinner, NonIdealState } from '@blueprintjs/core'
import { ReactNode } from 'react'

interface Column<T> {
  key: string
  header: string
  width?: number | string
  render?: (item: T) => ReactNode
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  loading?: boolean
  emptyIcon?: string
  emptyTitle?: string
  emptyDescription?: string
  onRowClick?: (item: T) => void
  selectable?: boolean
  keyField?: string
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  loading = false,
  emptyIcon = 'database',
  emptyTitle = 'No Data',
  emptyDescription = 'No records found.',
  onRowClick,
  selectable = false,
  keyField = 'id'
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="data-table-container">
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Spinner size={30} />
        </div>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="data-table-container">
        <NonIdealState
          icon={emptyIcon as 'database' | 'search' | 'inbox'}
          title={emptyTitle}
          description={emptyDescription}
        />
      </div>
    )
  }

  return (
    <div className="data-table-container">
      <HTMLTable striped interactive style={{ width: '100%' }}>
        <thead>
          <tr>
            {selectable && (
              <th style={{ width: 40 }}>
                <Checkbox />
              </th>
            )}
            {columns.map((col) => (
              <th key={col.key} style={col.width ? { width: col.width } : undefined}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr 
              key={String(item[keyField])} 
              onClick={() => onRowClick?.(item)}
              style={onRowClick ? { cursor: 'pointer' } : undefined}
            >
              {selectable && (
                <td onClick={(e) => e.stopPropagation()}>
                  <Checkbox />
                </td>
              )}
              {columns.map((col) => (
                <td key={col.key}>
                  {col.render ? col.render(item) : String(item[col.key] ?? '-')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </HTMLTable>
    </div>
  )
}
