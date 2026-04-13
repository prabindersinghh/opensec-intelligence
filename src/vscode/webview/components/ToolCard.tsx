import React from 'react'
import type { ToolExecution } from '../hooks/useMessages'

interface ToolCardProps {
  tool: ToolExecution
}

export const ToolCard: React.FC<ToolCardProps> = ({ tool }) => {
  const icon = {
    start: '⟳',
    done: '✓',
    error: '✗',
  }[tool.status]

  const statusClass = {
    start: 'tool-running',
    done: 'tool-done',
    error: 'tool-error',
  }[tool.status]

  return (
    <div className={`tool-card ${statusClass}`}>
      <span className="tool-icon">{icon}</span>
      <span className="tool-name">{tool.name}</span>
      {tool.duration !== undefined && (
        <span className="tool-duration">{tool.duration}ms</span>
      )}
      {tool.output && (
        <details className="tool-output-details">
          <summary>Output</summary>
          <pre className="tool-output">{tool.output}</pre>
        </details>
      )}
    </div>
  )
}
