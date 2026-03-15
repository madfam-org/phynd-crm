/**
 * Parse a CSV file following RFC 4180 (handles quoted commas and escaped quotes).
 */
export function parseCsvFile(file: File): Promise<{ headers: string[]; rows: string[][] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = reader.result as string
        // Strip BOM if present
        const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
        const parsed = parseCsvText(clean)
        if (parsed.length === 0) {
          resolve({ headers: [], rows: [] })
          return
        }
        const [headers, ...rows] = parsed
        resolve({ headers: headers ?? [], rows })
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CSV parsing requires nested conditionals for RFC 4180 compliance
function parseCsvText(text: string): string[][] {
  const rows: string[][] = []
  let current: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const next = text[i + 1]

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"'
        i++ // skip escaped quote
      } else if (char === '"') {
        inQuotes = false
      } else {
        field += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        current.push(field)
        field = ''
      } else if (char === '\r' && next === '\n') {
        current.push(field)
        field = ''
        rows.push(current)
        current = []
        i++ // skip \n
      } else if (char === '\n') {
        current.push(field)
        field = ''
        rows.push(current)
        current = []
      } else {
        field += char
      }
    }
  }

  // Last field/row
  if (field || current.length > 0) {
    current.push(field)
    rows.push(current)
  }

  return rows
}

export type ContactField = 'company' | 'email' | 'name' | 'phone' | 'skip'

export interface ColumnMapping {
  [columnIndex: number]: ContactField
}

export function mapColumnsToContacts(
  rows: string[][],
  mapping: ColumnMapping,
): Array<{ name: string; email?: string; phone?: string; company?: string }> {
  const results: Array<{ name: string; email?: string; phone?: string; company?: string }> = []

  for (const row of rows) {
    const record: Record<string, string> = {}
    for (const [colIdx, field] of Object.entries(mapping)) {
      if (field === 'skip') continue
      const value = row[Number(colIdx)]?.trim()
      if (value) {
        record[field] = value
      }
    }
    // Skip rows without a name
    if (!record.name) continue
    results.push({
      company: record.company || undefined,
      email: record.email || undefined,
      name: record.name,
      phone: record.phone || undefined,
    })
  }

  return results
}
