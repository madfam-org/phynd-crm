export interface PanelConfig {
  id: string
  label: string
  provider: import('./crm.js').FederationProviderName | 'local'
  defaultVisible: boolean
  minRole: import('./auth.js').CrmRole
}

export interface CommandPaletteItem {
  id: string
  label: string
  description: string | null
  shortcut: string | null
  action: string
  group: string
}

export interface DataTableColumn<T = unknown> {
  key: keyof T & string
  label: string
  sortable: boolean
  filterable: boolean
  visible: boolean
  width: string | null
}

export interface PipelineBoardColumn {
  stageId: string
  stageName: string
  items: PipelineBoardItem[]
}

export interface PipelineBoardItem {
  id: string
  title: string
  value: number | null
  contactName: string | null
  probability: number | null
  dueDate: Date | null
}

export type ToastVariant = 'default' | 'success' | 'error' | 'warning'

export interface BreadcrumbItem {
  label: string
  href: string | null
}
