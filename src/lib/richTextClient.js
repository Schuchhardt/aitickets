// Utilidades de texto enriquecido para el navegador (editor de descripción del panel).
// La allowlist replica la de src/lib/sanitize.ts (R3); el servidor vuelve a sanitizar al guardar.
import DOMPurify from 'dompurify'
import { marked } from 'marked'

const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a', 'h2', 'h3', 'blockquote']
const HAS_TAG_RE = /<\/?[a-z][^>]*>/i

/** HTML seguro para mostrar con v-html. Solo en el navegador (DOMPurify necesita el DOM). */
export function sanitizeClient(html) {
  if (typeof window === 'undefined') return ''
  return DOMPurify.sanitize(String(html || ''), { ALLOWED_TAGS, ALLOWED_ATTR: ['href', 'target'] })
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Descripciones antiguas en texto plano -> párrafos HTML. Si ya es HTML se deja igual. */
export function toEditorHtml(value) {
  const raw = String(value || '').trim()
  if (!raw || HAS_TAG_RE.test(raw)) return raw
  return raw
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

export function markdownToHtml(md) {
  return sanitizeClient(marked.parse(String(md || ''), { breaks: true }))
}

/** HTML (de la allowlist) a Markdown, para editar una descripción existente en modo Markdown. */
export function htmlToMarkdown(html) {
  if (typeof window === 'undefined') return ''
  const doc = new DOMParser().parseFromString(`<body>${toEditorHtml(html)}</body>`, 'text/html')
  const inline = (node) => [...node.childNodes].map(convert).join('')
  const convert = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/\s+/g, ' ')
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const tag = node.tagName.toLowerCase()
    const inner = inline(node)
    switch (tag) {
      case 'strong': case 'b': return inner.trim() ? `**${inner.trim()}**` : ''
      case 'em': case 'i': return inner.trim() ? `*${inner.trim()}*` : ''
      case 'u': return `<u>${inner}</u>`
      case 'a': return `[${inner}](${node.getAttribute('href') || ''})`
      case 'br': return '\n'
      case 'h2': return `## ${inner.trim()}\n\n`
      case 'h3': return `### ${inner.trim()}\n\n`
      case 'ul': return [...node.children].map((li) => `- ${inline(li).trim()}`).join('\n') + '\n\n'
      case 'ol': return [...node.children].map((li, i) => `${i + 1}. ${inline(li).trim()}`).join('\n') + '\n\n'
      case 'blockquote': return inner.trim().split('\n').map((l) => `> ${l}`).join('\n') + '\n\n'
      case 'p': case 'div': return `${inner.trim()}\n\n`
      default: return inner
    }
  }
  return inline(doc.body).replace(/\n{3,}/g, '\n\n').trim()
}

/** Largo del texto visible (para validar mínimos sin contar etiquetas). */
export function plainTextLength(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().length
}
