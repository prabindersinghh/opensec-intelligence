import React, { useState } from 'react'

interface TerminalOutputProps {
  command: string
  output: string
  exitCode?: number
  cwd?: string
}

export const TerminalOutput: React.FC<TerminalOutputProps> = ({
  command,
  output,
  exitCode,
  cwd,
}) => {
  const [expanded, setExpanded] = useState(false)
  const isError = exitCode !== undefined && exitCode !== 0
  const lines = output.split('\n')
  const preview = lines.slice(0, 3).join('\n')
  const hasMore = lines.length > 3

  return (
    <div className={`terminal-output ${isError ? 'terminal-error' : ''}`}>
      <div className="terminal-header" onClick={() => setExpanded(!expanded)}>
        <span className="terminal-icon">{'>'}_</span>
        <span className="terminal-command">{command}</span>
        {cwd && <span className="terminal-cwd">{cwd}</span>}
        {exitCode !== undefined && (
          <span className={`terminal-exit-code ${isError ? 'error' : 'success'}`}>
            {isError ? `exit ${exitCode}` : '✓'}
          </span>
        )}
        <span className="terminal-toggle">{expanded ? '▾' : '▸'}</span>
      </div>
      <pre className={`terminal-content ${expanded ? 'expanded' : ''}`}>
        {expanded ? output : preview}
        {!expanded && hasMore && (
          <span className="terminal-more">... ({lines.length - 3} more lines)</span>
        )}
      </pre>
    </div>
  )
}
