import React from 'react'
import { computeDiff } from '../utils/diff'
import { useVSCode } from '../hooks/useVSCode'

interface DiffViewProps {
  filePath: string
  original: string
  modified: string
}

export const DiffView: React.FC<DiffViewProps> = ({ filePath, original, modified }) => {
  const vscode = useVSCode()
  const diffLines = computeDiff(original, modified)

  const handleApply = () => {
    vscode.postMessage({ type: 'applyDiff', filePath, code: modified })
  }

  return (
    <div className="diff-view">
      <div className="diff-header">
        <span className="diff-file-path">{filePath}</span>
        <div className="diff-actions">
          <button className="diff-accept" onClick={handleApply}>
            ✓ Accept
          </button>
          <button className="diff-reject" onClick={() => {}}>
            ✗ Reject
          </button>
        </div>
      </div>
      <div className="diff-content">
        {diffLines.map((line, i) => (
          <div key={i} className={`diff-line diff-${line.type}`}>
            <span className="diff-line-number">{line.lineNumber ?? ''}</span>
            <span className="diff-line-marker">
              {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
            </span>
            <span className="diff-line-content">{line.content}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
