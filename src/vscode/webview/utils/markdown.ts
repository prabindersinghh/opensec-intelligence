/**
 * Lightweight markdown to HTML converter for chat messages.
 * Handles: headings, bold, italic, inline code, code blocks, links, lists, paragraphs.
 */

export function renderMarkdown(text: string): string {
  if (!text) return ''

  let html = escapeHtml(text)

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const langAttr = lang ? ` data-lang="${lang}"` : ''
    return `<div class="code-block-wrapper" data-language="${lang || 'text'}"><pre class="code-block-content"${langAttr}><code>${code.trim()}</code></pre></div>`
  })

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" class="chat-link">$1</a>',
  )

  // Paragraphs: wrap remaining lines
  html = html.replace(/^(?!<[hluoad]|<\/)(.*\S.*)$/gm, '<p>$1</p>')

  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, '')

  return html
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Extract code blocks from markdown for action buttons.
 */
export function extractCodeBlocks(
  markdown: string,
): { language: string; code: string; filePath?: string }[] {
  const blocks: { language: string; code: string; filePath?: string }[] = []
  const regex = /```(\w*)\n([\s\S]*?)```/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(markdown)) !== null) {
    blocks.push({
      language: match[1] || 'text',
      code: match[2].trim(),
    })
  }

  return blocks
}
