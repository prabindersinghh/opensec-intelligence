import { useCallback, useRef, useState } from 'react'
import { useVSCode } from './useVSCode'

export function useStream() {
  const [isStreaming, setIsStreaming] = useState(false)
  const vscode = useVSCode()

  const startStream = useCallback(
    (text: string) => {
      setIsStreaming(true)
      vscode.postMessage({ type: 'send', text })
    },
    [vscode],
  )

  const stopStream = useCallback(() => {
    vscode.postMessage({ type: 'stop' })
    setIsStreaming(false)
  }, [vscode])

  const setStreamingDone = useCallback(() => {
    setIsStreaming(false)
  }, [])

  return { isStreaming, startStream, stopStream, setStreamingDone }
}
