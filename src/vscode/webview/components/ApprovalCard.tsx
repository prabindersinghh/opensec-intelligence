import React from 'react'

export interface ApprovalRequest {
  id: string
  tool: string
  input: unknown
  description?: string
}

interface ApprovalCardProps {
  request: ApprovalRequest
  onApprove: (id: string) => void
  onDeny: (id: string) => void
  onAlwaysApprove: (id: string, tool: string) => void
}

export const ApprovalCard: React.FC<ApprovalCardProps> = ({
  request,
  onApprove,
  onDeny,
  onAlwaysApprove,
}) => {
  const inputStr = typeof request.input === 'string'
    ? request.input
    : JSON.stringify(request.input, null, 2)

  return (
    <div className="approval-card">
      <div className="approval-header">
        <span className="approval-icon">⏸</span>
        <span className="approval-title">Tool requires approval</span>
      </div>
      <div className="approval-tool">
        <span className="approval-tool-name">{request.tool}</span>
        {request.description && (
          <span className="approval-description">{request.description}</span>
        )}
      </div>
      {inputStr && (
        <details className="approval-input-details">
          <summary>Input</summary>
          <pre className="approval-input">{inputStr}</pre>
        </details>
      )}
      <div className="approval-actions">
        <button
          className="approval-btn approve"
          onClick={() => onApprove(request.id)}
          title="Allow this tool execution"
        >
          ✓ Approve
        </button>
        <button
          className="approval-btn always-approve"
          onClick={() => onAlwaysApprove(request.id, request.tool)}
          title="Always allow this tool without asking"
        >
          ✓✓ Always
        </button>
        <button
          className="approval-btn deny"
          onClick={() => onDeny(request.id)}
          title="Block this tool execution"
        >
          ✗ Deny
        </button>
      </div>
    </div>
  )
}
