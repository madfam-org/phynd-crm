/**
 * Hidden email preheader (preview text) support.
 *
 * Email clients show the first visible/hidden text after the subject line.
 * The standard pattern is a visually hidden div immediately after <body>,
 * padded with non-breaking spaces + zero-width non-joiners so clients don't
 * pull visible body copy into the preview after the preheader text.
 */

const HIDDEN_PREHEADER_STYLE =
  'display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;visibility:hidden;color:transparent;'

// Fills the remaining preview space so trailing body text doesn't leak in.
const PREHEADER_PADDING = '&nbsp;&zwnj;'.repeat(60)

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function buildPreheaderHtml(preheader: string): string {
  return `<div class="preheader" style="${HIDDEN_PREHEADER_STYLE}">${escapeHtml(preheader)}${PREHEADER_PADDING}</div>`
}

/**
 * Injects a hidden preheader div right after the opening <body> tag. Returns
 * the HTML unchanged when no preheader text is provided. When the HTML has no
 * <body> tag (fragment templates), the div is prepended.
 */
export function injectPreheader(html: string, preheader?: string | null): string {
  const text = preheader?.trim()
  if (!text) {
    return html
  }

  const div = buildPreheaderHtml(text)
  const bodyTag = html.match(/<body[^>]*>/i)
  if (bodyTag?.index !== undefined) {
    const insertAt = bodyTag.index + bodyTag[0].length
    return `${html.slice(0, insertAt)}${div}${html.slice(insertAt)}`
  }
  return `${div}${html}`
}
