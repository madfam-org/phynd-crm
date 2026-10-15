import zlib from 'node:zlib'

/**
 * Builds SYNTHETIC receipt PDFs shaped like a BBVA México "Comprobante de la
 * operación". No real client, account or operation: every value is invented.
 *
 * - 'simple': Helvetica (WinAnsi literal strings), uncompressed, label and
 *   value on the same baseline (two columns), full xref table.
 * - 'bank': what bank systems usually emit: a Type0/Identity-H font with a
 *   ToUnicode CMap (2-byte hex glyph ids), FlateDecode content, the font
 *   objects inside an object stream, values on the line below their labels,
 *   a decoy "Importe con letra" line and a destination shown as a full CLABE.
 */

export const SYNTHETIC_RECEIPT = {
  operationType: 'Transferencias SPEI',
  folio: '0012345678',
  date: '15/10/2026',
  time: '10:30:15 h',
  concept: 'Pago anticipo proyecto ejemplo',
  amount: '$11,603.56',
  originAccount: '•1234',
  beneficiary: 'ACME EJEMPLO SA DE CV',
  bank: 'BANCO EJEMPLO',
  destinationAccount: '•5678',
  trackingKey: 'MBAN01002610150012345678',
}

/** A synthetic 18-digit CLABE with a valid check digit (invented bank/branch/account digits). */
export function syntheticClabe(prefix17 = '01218000987655678'): string {
  const weights = [3, 7, 1]
  let sum = 0
  for (let i = 0; i < 17; i++) sum += (Number(prefix17[i]) * (weights[i % 3] ?? 1)) % 10
  return `${prefix17}${(10 - (sum % 10)) % 10}`
}

function receiptRows(variant: 'simple' | 'bank'): Array<[string, string]> {
  const r = SYNTHETIC_RECEIPT
  const rows: Array<[string, string]> = [
    ['Tipo de operación', r.operationType],
    ['Folio de la operación', r.folio],
    ['Fecha de operación', r.date],
    ['Hora', r.time],
    ['Concepto', r.concept],
  ]
  if (variant === 'bank')
    rows.push(['Importe con letra', 'ONCE MIL SEISCIENTOS TRES PESOS 56/100 M.N.'])
  rows.push(
    ['Importe transferido', r.amount],
    ['Cuenta de origen', r.originAccount],
    ['Nombre del beneficiario', r.beneficiary],
    ['Nombre del banco', r.bank],
    ['Cuenta de destino', variant === 'bank' ? syntheticClabe() : r.destinationAccount],
    ['Clave de rastreo', r.trackingKey],
  )
  return rows
}

const winAnsi = (s: string) =>
  Buffer.from(Array.from(s, (ch) => (ch === '•' ? 0x95 : ch.charCodeAt(0) & 0xff)))

function literal(s: string): string {
  return `(${winAnsi(s)
    .toString('latin1')
    .replace(/[\\()]/g, (c) => `\\${c}`)
    .replace(/[\x80-\xff]/g, (c) => `\\${c.charCodeAt(0).toString(8).padStart(3, '0')}`)})`
}

function assemble(
  objects: Array<string | Buffer | null>,
  rootRef: number,
  withXref: boolean,
): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n', 'latin1')]
  const offsets: number[] = []
  let length = parts[0]?.length ?? 0
  objects.forEach((body, i) => {
    offsets.push(length)
    // null: the object lives in an object stream, not at top level.
    if (body === null) return
    const chunk = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`),
      Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'),
      Buffer.from('\nendobj\n'),
    ])
    parts.push(chunk)
    length += chunk.length
  })
  const xrefAt = length
  if (withXref) {
    const rows = offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
    parts.push(
      Buffer.from(
        `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${rows}trailer\n<< /Size ${objects.length + 1} /Root ${rootRef} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`,
      ),
    )
  } else {
    parts.push(Buffer.from(`trailer\n<< /Root ${rootRef} 0 R >>\n%%EOF\n`))
  }
  return Buffer.concat(parts)
}

function streamObject(dict: string, data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`),
    data,
    Buffer.from('\nendstream'),
  ])
}

export function buildSyntheticReceiptPdf(variant: 'simple' | 'bank' = 'simple'): Buffer {
  const rows = receiptRows(variant)
  const header = ['BBVA', 'Comprobante de la operación']
  if (variant === 'simple') {
    const lines: string[] = []
    let y = 760
    for (const h of header) {
      lines.push(`BT /F1 12 Tf 1 0 0 1 50 ${y} Tm ${literal(h)} Tj ET`)
      y -= 24
    }
    for (const [label, value] of rows) {
      lines.push(`BT /F1 10 Tf 1 0 0 1 50 ${y} Tm ${literal(label)} Tj ET`)
      lines.push(`BT /F1 10 Tf 1 0 0 1 300 ${y} Tm ${literal(value)} Tj ET`)
      y -= 18
    }
    const content = Buffer.from(lines.join('\n'), 'latin1')
    return assemble(
      [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
        streamObject('', content),
      ],
      1,
      true,
    )
  }

  // 'bank': glyph ids are positions in a table of the characters used.
  const text = [...header, ...rows.flat()].join('')
  const glyphs = [...new Set(Array.from(text))]
  const gid = (ch: string) => (glyphs.indexOf(ch) + 1).toString(16).toUpperCase().padStart(4, '0')
  const hex = (s: string) => `<${Array.from(s, gid).join('')}>`
  const ops: string[] = ['BT', '/C0 10 Tf', '50 770 Td']
  for (const h of header) ops.push(`${hex(h)} Tj`, '0 -22 Td')
  for (const [label, value] of rows) {
    // TJ with a kerning gap inside the label, value on the next line.
    const cut = Math.ceil(label.length / 2)
    ops.push(`[${hex(label.slice(0, cut))} -40 ${hex(label.slice(cut))}] TJ`, '0 -12 Td')
    ops.push(`${hex(value)} Tj`, '0 -16 Td')
  }
  ops.push('ET')
  const content = zlib.deflateSync(Buffer.from(ops.join('\n'), 'latin1'))
  const bfchar = glyphs
    .map(
      (ch, i) =>
        `<${(i + 1).toString(16).toUpperCase().padStart(4, '0')}> <${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}>`,
    )
    .join('\n')
  const cmap = zlib.deflateSync(
    Buffer.from(
      `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${glyphs.length} beginbfchar\n${bfchar}\nendbfchar\nendcmap\nend\nend`,
    ),
  )
  // Objects 4 (Type0 font) and 5 (descendant) live in object stream 6.
  const inner = [
    '<< /Type /Font /Subtype /Type0 /BaseFont /SyntheticSans /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 7 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /SyntheticSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> >>',
  ]
  let offset = 0
  const index: string[] = []
  inner.forEach((body, i) => {
    index.push(`${4 + i} ${offset}`)
    offset += body.length + 1
  })
  const indexText = `${index.join(' ')}\n`
  const objStm = zlib.deflateSync(Buffer.from(indexText + inner.join('\n'), 'latin1'))
  return assemble(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources 9 0 R /Contents 8 0 R >>',
      null,
      null,
      streamObject(`/Type /ObjStm /N 2 /First ${indexText.length} /Filter /FlateDecode`, objStm),
      streamObject('/Filter /FlateDecode', cmap),
      streamObject('/Filter /FlateDecode', content),
      '<< /Font << /C0 4 0 R >> >>',
    ],
    1,
    false,
  )
}
