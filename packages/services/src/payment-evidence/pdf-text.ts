import zlib from 'node:zlib'

/**
 * Minimal, dependency-free text extraction for text-bearing PDFs (bank
 * receipts). It reads indirect objects and object streams, inflates
 * FlateDecode streams, resolves page fonts and their ToUnicode CMaps, and
 * replays the text operators (Tj, TJ, ', ", Td, TD, Tm, T*). Text that moves
 * to a new baseline starts a new line; a jump along the same baseline is
 * written as two spaces (a column break).
 *
 * Not supported (returns less text, never throws): encrypted PDFs, filters
 * other than FlateDecode, Type3 fonts, font /Differences. Scanned receipts
 * have no text at all; they go through manual entry.
 */

interface PdfObject {
  dict: string
  stream: Buffer | null
}

type Token =
  | { t: 'num'; v: number }
  | { t: 'name'; v: string }
  | { t: 'str'; v: Buffer }
  | { t: 'arr'; v: Token[] }
  | { t: 'op'; v: string }

interface CMap {
  codeLength: number
  map: Map<number, string>
}

const MAX_OBJECTS = 20_000

export function extractPdfText(bytes: Uint8Array): string {
  try {
    const objects = readObjects(Buffer.from(bytes))
    const pages = findPages(objects)
    return pages
      .map((page) => pageText(objects, page))
      .join('\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  } catch {
    return ''
  }
}

// ─── Objects ────────────────────────────────────────────────────────────────

function readObjects(raw: Buffer): Map<number, PdfObject> {
  const text = raw.toString('latin1')
  const objects = new Map<number, PdfObject>()
  const header = /(\d+)\s+(\d+)\s+obj\b/g
  let match = header.exec(text)
  while (match && objects.size < MAX_OBJECTS) {
    const num = Number(match[1])
    const bodyStart = header.lastIndex
    const parsed = readObjectBody(raw, text, bodyStart)
    objects.set(num, parsed.object)
    header.lastIndex = parsed.end
    match = header.exec(text)
  }
  for (const obj of [...objects.values()]) {
    if (/\/Type\s*\/ObjStm\b/.test(obj.dict) && obj.stream) {
      for (const [num, inner] of readObjectStream(obj)) {
        if (!objects.has(num)) objects.set(num, inner)
      }
    }
  }
  return objects
}

function readObjectBody(raw: Buffer, text: string, start: number) {
  const endObj = text.indexOf('endobj', start)
  const limit = endObj === -1 ? text.length : endObj
  const streamAt = text.indexOf('stream', start)
  if (streamAt === -1 || streamAt > limit || text.slice(streamAt - 3, streamAt) === 'end') {
    return { object: { dict: text.slice(start, limit), stream: null }, end: limit }
  }
  const dict = text.slice(start, streamAt)
  let dataStart = streamAt + 'stream'.length
  if (text[dataStart] === '\r') dataStart++
  if (text[dataStart] === '\n') dataStart++
  const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict)
  let dataEnd = length ? dataStart + Number(length[1]) : -1
  if (dataEnd < 0 || !/^\s*endstream/.test(text.slice(dataEnd, dataEnd + 20))) {
    dataEnd = text.indexOf('endstream', dataStart)
  }
  if (dataEnd < 0) return { object: { dict, stream: null }, end: limit }
  const stream = decodeStream(dict, raw.subarray(dataStart, dataEnd))
  const after = text.indexOf('endobj', dataEnd)
  return { object: { dict, stream }, end: after === -1 ? text.length : after }
}

function decodeStream(dict: string, data: Buffer): Buffer | null {
  const filter = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dict)?.[1] ?? ''
  if (!filter) return data
  if (!/^\[?\s*\/FlateDecode\s*\]?$/.test(filter)) return null
  const options = { finishFlush: zlib.constants.Z_SYNC_FLUSH }
  for (const input of [data, stripEol(data)]) {
    for (const inflate of [zlib.inflateSync, zlib.inflateRawSync]) {
      try {
        return inflate(input, options)
      } catch {
        // try the next variant
      }
    }
  }
  return null
}

function stripEol(data: Buffer): Buffer {
  let end = data.length
  while (end > 0 && (data[end - 1] === 0x0a || data[end - 1] === 0x0d)) end--
  return data.subarray(0, end)
}

function readObjectStream(obj: PdfObject): Map<number, PdfObject> {
  const out = new Map<number, PdfObject>()
  const n = Number(/\/N\s+(\d+)/.exec(obj.dict)?.[1] ?? 0)
  const first = Number(/\/First\s+(\d+)/.exec(obj.dict)?.[1] ?? 0)
  const content = obj.stream?.toString('latin1') ?? ''
  const pairs = content.slice(0, first).trim().split(/\s+/).map(Number)
  for (let i = 0; i < n; i++) {
    const num = pairs[i * 2]
    const offset = pairs[i * 2 + 1]
    const next = i + 1 < n ? pairs[(i + 1) * 2 + 1] : content.length - first
    if (num === undefined || offset === undefined || next === undefined) continue
    out.set(num, { dict: content.slice(first + offset, first + next), stream: null })
  }
  return out
}

const refOf = (dict: string, key: string): number | null => {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dict)
  return m ? Number(m[1]) : null
}

/** The value of `key`: an inline `<< … >>` dictionary, or the referenced object's dict. */
function dictOf(objects: Map<number, PdfObject>, dict: string, key: string): string | null {
  const at = new RegExp(`/${key}\\s*`).exec(dict)
  if (!at) return null
  const rest = dict.slice(at.index + at[0].length)
  if (rest.startsWith('<<')) return balancedDict(rest)
  const ref = /^(\d+)\s+\d+\s+R/.exec(rest)
  return ref ? (objects.get(Number(ref[1]))?.dict ?? null) : null
}

function balancedDict(text: string): string {
  let depth = 0
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === '<' && text[i + 1] === '<') {
      depth++
      i++
    } else if (text[i] === '>' && text[i + 1] === '>') {
      depth--
      i++
      if (depth === 0) return text.slice(0, i + 1)
    }
  }
  return text
}

function findPages(objects: Map<number, PdfObject>): PdfObject[] {
  const catalog = [...objects.values()].find((o) => /\/Type\s*\/Catalog\b/.test(o.dict))
  const root = catalog ? refOf(catalog.dict, 'Pages') : null
  const ordered: PdfObject[] = []
  const seen = new Set<number>()
  const walk = (num: number) => {
    if (seen.has(num) || seen.size > MAX_OBJECTS) return
    seen.add(num)
    const node = objects.get(num)
    if (!node) return
    if (/\/Type\s*\/Page\b/.test(node.dict)) {
      ordered.push(node)
      return
    }
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(node.dict)?.[1] ?? ''
    for (const m of kids.matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(m[1]))
  }
  if (root !== null) walk(root)
  if (ordered.length > 0) return ordered
  return [...objects.values()].filter((o) => /\/Type\s*\/Page\b/.test(o.dict))
}

function resourcesOf(objects: Map<number, PdfObject>, page: PdfObject): string {
  let node: PdfObject | undefined = page
  for (let depth = 0; node && depth < 32; depth++) {
    const resources = dictOf(objects, node.dict, 'Resources')
    if (resources) return resources
    const parent = refOf(node.dict, 'Parent')
    node = parent === null ? undefined : objects.get(parent)
  }
  return ''
}

function contentsOf(objects: Map<number, PdfObject>, page: PdfObject): Buffer {
  const parts: Buffer[] = []
  const array = /\/Contents\s*\[([^\]]*)\]/.exec(page.dict)?.[1]
  const refs = array
    ? [...array.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]))
    : [refOf(page.dict, 'Contents')].filter((n): n is number => n !== null)
  for (const ref of refs) {
    const stream = objects.get(ref)?.stream
    if (stream) parts.push(stream, Buffer.from('\n'))
  }
  return Buffer.concat(parts)
}

// ─── Fonts ──────────────────────────────────────────────────────────────────

function fontsOf(objects: Map<number, PdfObject>, resources: string): Map<string, CMap | null> {
  const fonts = new Map<string, CMap | null>()
  const fontDict = dictOf(objects, resources, 'Font')
  if (!fontDict) return fonts
  for (const m of fontDict.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
    const font = objects.get(Number(m[2]))
    const toUnicode = font ? refOf(font.dict, 'ToUnicode') : null
    const stream = toUnicode === null ? null : objects.get(toUnicode)?.stream
    fonts.set(m[1] ?? '', stream ? parseCMap(stream.toString('latin1')) : null)
  }
  return fonts
}

const hexToInt = (hex: string) => Number.parseInt(hex, 16)
const hexToUnicode = (hex: string) => {
  const units: number[] = []
  for (let i = 0; i + 4 <= hex.length; i += 4) units.push(hexToInt(hex.slice(i, i + 4)))
  if (hex.length === 2) units.push(hexToInt(hex))
  return String.fromCharCode(...units)
}

export function parseCMap(text: string): CMap {
  const map = new Map<number, string>()
  const space = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(text)
  const codeLength = space?.[1] ? Math.max(1, space[1].length / 2) : 2
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of (block[1] ?? '').matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      map.set(hexToInt(m[1] ?? '0'), hexToUnicode(m[2] ?? ''))
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = block[1] ?? ''
    const entry = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([^\]]*)\])/g
    for (const m of body.matchAll(entry)) {
      const lo = hexToInt(m[1] ?? '0')
      const hi = Math.min(hexToInt(m[2] ?? '0'), lo + 0xffff)
      if (m[3] !== undefined) {
        const base = hexToInt(m[3])
        for (let c = lo; c <= hi; c++) map.set(c, String.fromCharCode(base + (c - lo)))
      } else {
        const items = [...(m[4] ?? '').matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => x[1] ?? '')
        items.forEach((hex, i) => map.set(lo + i, hexToUnicode(hex)))
      }
    }
  }
  return { codeLength, map }
}

// WinAnsi codes 0x80–0x9F that differ from Latin-1.
const WIN_ANSI: Record<number, string> = {
  128: '€',
  133: '…',
  145: '‘',
  146: '’',
  147: '“',
  148: '”',
  149: '•',
  150: '–',
  151: '—',
}

function decodeString(bytes: Buffer, cmap: CMap | null | undefined): string {
  if (!cmap) {
    return Array.from(bytes, (b) => WIN_ANSI[b] ?? String.fromCharCode(b)).join('')
  }
  let out = ''
  for (let i = 0; i + cmap.codeLength <= bytes.length; i += cmap.codeLength) {
    let code = 0
    for (let j = 0; j < cmap.codeLength; j++) code = code * 256 + (bytes[i + j] ?? 0)
    out += cmap.map.get(code) ?? ''
  }
  return out
}

// ─── Content streams ────────────────────────────────────────────────────────

function pageText(objects: Map<number, PdfObject>, page: PdfObject): string {
  const fonts = fontsOf(objects, resourcesOf(objects, page))
  const tokens = tokenize(contentsOf(objects, page))
  let out = ''
  let font: CMap | null | undefined = null
  let y: number | null = null
  let x: number | null = null
  const operands: Token[] = []
  const newline = () => {
    if (out && !out.endsWith('\n')) out += '\n'
  }
  const moveTo = (nx: number, ny: number) => {
    if (y !== null && Math.abs(ny - y) > 1) newline()
    else if (x !== null && nx > x + 1 && out && !out.endsWith('\n')) out += '  '
    x = nx
    y = ny
  }
  const num = (i: number) => {
    const t = operands[operands.length - i]
    return t?.t === 'num' ? t.v : 0
  }
  for (const token of tokens) {
    if (token.t !== 'op') {
      operands.push(token)
      continue
    }
    switch (token.v) {
      case 'Tf': {
        const name = operands[operands.length - 2]
        font = name?.t === 'name' ? fonts.get(name.v) : null
        break
      }
      case 'Tm':
        moveTo(num(2), num(1))
        break
      case 'Td':
      case 'TD':
        moveTo((x ?? 0) + num(2), (y ?? 0) + num(1))
        break
      case 'T*':
        newline()
        break
      case "'":
      case '"':
      case 'Tj': {
        if (token.v !== 'Tj') newline()
        const s = operands[operands.length - 1]
        if (s?.t === 'str') out += decodeString(s.v, font)
        break
      }
      case 'TJ': {
        const arr = operands[operands.length - 1]
        if (arr?.t === 'arr') {
          for (const item of arr.v) {
            if (item.t === 'str') out += decodeString(item.v, font)
            else if (item.t === 'num' && item.v < -200) out += ' '
          }
        }
        break
      }
    }
    operands.length = 0
  }
  return out
}

const DELIMITERS = new Set('()<>[]{}/%'.split(''))
const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 0

function tokenize(data: Buffer): Token[] {
  const tokens: Token[] = []
  const stack: Token[][] = []
  const push = (t: Token) => (stack.length ? stack[stack.length - 1]?.push(t) : tokens.push(t))
  let i = 0
  while (i < data.length) {
    const c = data[i] ?? 0
    const ch = String.fromCharCode(c)
    if (isSpace(c)) {
      i++
    } else if (ch === '%') {
      while (i < data.length && data[i] !== 10 && data[i] !== 13) i++
    } else if (ch === '(') {
      const { value, end } = readLiteral(data, i + 1)
      push({ t: 'str', v: value })
      i = end
    } else if (ch === '<' && data[i + 1] === 60) {
      i += 2 // dictionary open: operands of inline dicts are ignored
    } else if (ch === '>' && data[i + 1] === 62) {
      i += 2
    } else if (ch === '<') {
      const end = data.indexOf(62, i)
      const hex = data.toString('latin1', i + 1, end === -1 ? data.length : end).replace(/\s/g, '')
      push({ t: 'str', v: Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex') })
      i = end === -1 ? data.length : end + 1
    } else if (ch === '[') {
      stack.push([])
      i++
    } else if (ch === ']') {
      const items = stack.pop() ?? []
      push({ t: 'arr', v: items })
      i++
    } else if (ch === '/') {
      let j = i + 1
      while (
        j < data.length &&
        !isSpace(data[j] ?? 0) &&
        !DELIMITERS.has(String.fromCharCode(data[j] ?? 0))
      )
        j++
      push({ t: 'name', v: data.toString('latin1', i + 1, j) })
      i = j
    } else {
      let j = i
      while (
        j < data.length &&
        !isSpace(data[j] ?? 0) &&
        !DELIMITERS.has(String.fromCharCode(data[j] ?? 0))
      )
        j++
      if (j === i) j = i + 1
      const word = data.toString('latin1', i, j)
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) push({ t: 'num', v: Number(word) })
      else if (word === 'BI') j = skipInlineImage(data, j)
      else push({ t: 'op', v: word })
      i = j
    }
  }
  return tokens
}

function skipInlineImage(data: Buffer, from: number): number {
  const end = data.indexOf('EI', data.indexOf('ID', from))
  return end === -1 ? data.length : end + 2
}

function readLiteral(data: Buffer, start: number): { value: Buffer; end: number } {
  const out: number[] = []
  let depth = 1
  let i = start
  while (i < data.length) {
    const c = data[i] ?? 0
    if (c === 92) {
      const n = data[i + 1] ?? 0
      const escapes: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 }
      if (escapes[n] !== undefined) {
        out.push(escapes[n] as number)
        i += 2
      } else if (n >= 48 && n <= 55) {
        let j = i + 1
        let oct = ''
        while (j < data.length && oct.length < 3 && (data[j] ?? 0) >= 48 && (data[j] ?? 0) <= 55) {
          oct += String.fromCharCode(data[j] ?? 0)
          j++
        }
        out.push(Number.parseInt(oct, 8) & 0xff)
        i = j
      } else if (n === 13 || n === 10) {
        i += n === 13 && data[i + 2] === 10 ? 3 : 2
      } else {
        out.push(n)
        i += 2
      }
    } else if (c === 40) {
      depth++
      out.push(c)
      i++
    } else if (c === 41) {
      depth--
      if (depth === 0) return { value: Buffer.from(out), end: i + 1 }
      out.push(c)
      i++
    } else {
      out.push(c)
      i++
    }
  }
  return { value: Buffer.from(out), end: data.length }
}
