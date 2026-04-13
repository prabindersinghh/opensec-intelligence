import React from 'react'
import { renderMarkdown } from '../utils/markdown'
import { ToolCard } from './ToolCard'
import type { ChatMessage } from '../hooks/useMessages'
import { useVSCode } from '../hooks/useVSCode'

interface MessageBubbleProps {
  message: ChatMessage
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === 'user'
  const vscode = useVSCode()

  const handleCodeAction = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'BUTTON' && target.dataset.action) {
      const codeEl = target.closest('.code-block-wrapper')?.querySelector('code')
      const code = codeEl?.textContent || ''
      switch (target.dataset.action) {
        case 'copy':
          vscode.postMessage({ type: 'copyCode', code })
          break
        case 'insert':
          vscode.postMessage({ type: 'insertCode', code })
          break
      }
    }
  }

  const html = renderMarkdown(message.content)

  // Post-process: add action buttons to code blocks
  const processedHtml = html.replace(
    /<div class="code-block-wrapper"(.*?)>/g,
    `<div class="code-block-wrapper"$1><div class="code-block-header"><span class="code-block-lang"></span><div class="code-block-actions"><button data-action="copy">Copy</button><button data-action="insert">Insert</button></div></div>`,
  )

  return (
    <div className={`message-bubble ${isUser ? 'user' : 'assistant'}`}>
      <div className="message-avatar">{isUser ? '👤' : '⌘'}</div>
      <div className="message-body">
        {/* Context badge */}
        {message.context?.file && (
          <div className="message-context">
            <span className="context-badge" title={message.context.file}>
              📄 {message.context.file}
              {message.context.selection ? ' (selection)' : ''}
            </span>
          </div>
        )}

        {/* Tool cards */}
        {message.tools.map((tool, i) => (
          <ToolCard key={i} tool={tool} />
        ))}

        {/* Content */}
        <div
          className="message-content"
          onClick={handleCodeAction}
          dangerouslySetInnerHTML={{ __html: processedHtml }}
        />

        {/* Streaming indicator */}
        {message.isStreaming && <span className="streaming-cursor">▊</span>}
      </div>
    </div>
  )
}
