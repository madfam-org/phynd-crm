// Staff-facing copy of the lead surfaces, in one place. The CRM has no i18n
// framework; recent staff surfaces (Casos, lead tasks) are Spanish and the
// lead pages follow them. Same pattern as `lib/portal/copy.ts`.

import type { LeadQueueView } from './lead-filters'

export const LEAD_STATUS_LABEL: Record<string, string> = {
  new: 'Nuevo',
  contacted: 'Contactado',
  qualified: 'Calificado',
  unqualified: 'Descartado',
  converted: 'Convertido',
}

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted'] as const

export const VIEW_LABEL: Record<LeadQueueView, string> = {
  mine: 'Mis leads',
  tier_a: 'Tier A',
  unassigned: 'Sin asignar',
  overdue: 'Primer contacto vencido',
  all: 'Todos',
}

/** Empty state per view: what is true, and what to do next. */
export const VIEW_EMPTY: Record<LeadQueueView, { title: string; body: string }> = {
  mine: {
    title: 'No tienes leads asignados',
    body: 'Cuando te asignen un lead, o tomes uno sin asignar, aparecerá aquí.',
  },
  tier_a: {
    title: 'No hay leads tier A pendientes',
    body: 'Los leads con puntuación de 7 o más aparecen aquí para llamarse en un día hábil.',
  },
  unassigned: {
    title: 'Todos los leads tienen responsable',
    body: 'Los nuevos leads se asignan solos al responsable predeterminado.',
  },
  overdue: {
    title: 'Ningún primer contacto vencido',
    body: 'Cada lead nuevo recibe una tarea de primer contacto para el siguiente día hábil.',
  },
  all: {
    title: 'Todavía no hay leads',
    body: 'Los leads llegan de Avala, Kalya, el sitio, Cotiza y Nauta.',
  },
}

export const COPY = {
  pageTitle: 'Leads',
  pageLead: 'A quién contactar ahora, y por qué.',
  assignTo: 'Asignar a…',
  assignShortcut: 'Asignar (a)',
  noAssignees: 'No hay personal para asignar',
  unassigned: 'Sin asignar',
  owner: 'Responsable',
  reassigned: 'Lead reasignado',
  reassignFailed: 'No se pudo reasignar el lead',
  bulkAssigned: (n: number) => (n === 1 ? '1 lead reasignado' : `${n} leads reasignados`),
  statusChanged: 'Estado actualizado',
  statusFailed: 'No se pudo cambiar el estado',
  tagged: 'Etiqueta agregada',
  tagFailed: 'No se pudo etiquetar',
  selected: (n: number) => (n === 1 ? '1 seleccionado' : `${n} seleccionados`),
  clearSelection: 'Quitar selección',
  changeStatus: 'Cambiar estado',
  addTag: 'Etiquetar',
  noTags: 'No hay etiquetas. Créalas en un lead.',
  anyTier: 'Cualquier tier',
  tier: 'Tier',
  score: 'Puntuación',
  scoreParts: 'Cómo se calculó',
  noScore: 'Sin puntuación todavía',
  waitlist: 'Avisar cuando esté disponible',
  waitlistHint: 'Lista de espera: avisar cuando esté disponible, no es una venta',
  masked: 'oculto',
  maskedHint: 'Dato personal oculto para esta sesión',
  noMessage: 'Sin mensaje',
  lastActivity: 'Última actividad',
  firstContact: 'Primer contacto',
  status: 'Estado',
  lead: 'Lead',
  channel: 'Origen',
  message: 'Mensaje',
  loadError: 'No se pudieron cargar los leads.',
  retry: 'Reintentar',
  previous: 'Anterior',
  next: 'Siguiente',
  pageOf: (page: number, pages: number, total: number) =>
    `Página ${page} de ${pages} · ${total} leads`,
  keyboardHint: 'Atajos: j/k para moverte, Enter para abrir, a para asignar, x para seleccionar.',
  selectRow: (name: string) => `Seleccionar ${name}`,
  selectAll: 'Seleccionar todos los de esta página',
  openLead: (name: string) => `Abrir ${name}`,
} as const
