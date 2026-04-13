import React, { useState } from 'react'
import { useVSCode } from '../hooks/useVSCode'

interface CodeBlockProps {
  code: string
  language: string
  filePath?: string
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, language, filePath }) => {
  const [copied, setCopied] = useState(false)
  const vscode = useVSCode()

  const handleCopy = () => {
    vscode.postMessage({ type: 'copyCode', code })
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleInsert = () => {
    vscode.postMessage({ type: 'insertCode', code })
  }

  const handleApply = () => {
    if (filePath) {
      vscode.postMessage({ type: 'applyDiff', filePath, code })
    }
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-lang">{language || 'text'}</span>
        <div className="code-block-actions">
          <button onClick={handleCopy} title="Copy code">
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <button onClick={handleInsert} title="Insert at cursor">
            Insert
          </button>
          {filePath && (
            <button onClick={handleApply} title="Apply to file" className="apply-button">
              Apply
            </button>
          )}
        </div>
      </div>
      <pre className="code-block-content">
        <code>{code}</code>
      </pre>
    </div>
  )
}
