/**
 * Simple diff computation for showing inline diffs.
 */

export interface DiffLine {
  type: 'add' | 'remove' | 'unchanged'
  content: string
  lineNumber?: number
}

export function computeDiff(original: string, modified: string): DiffLine[] {
  const origLines = original.split('\n')
  const modLines = modified.split('\n')
  const result: DiffLine[] = []

  // Simple LCS-based diff
  const lcs = buildLCS(origLines, modLines)
  let i = 0
  let j = 0
  let k = 0

  while (k < lcs.length) {
    while (i < origLines.length && origLines[i] !== lcs[k]) {
      result.push({ type: 'remove', content: origLines[i], lineNumber: i + 1 })
      i++
    }
    while (j < modLines.length && modLines[j] !== lcs[k]) {
      result.push({ type: 'add', content: modLines[j], lineNumber: j + 1 })
      j++
    }
    result.push({ type: 'unchanged', content: lcs[k], lineNumber: i + 1 })
    i++
    j++
    k++
  }

  while (i < origLines.length) {
    result.push({ type: 'remove', content: origLines[i], lineNumber: i + 1 })
    i++
  }
  while (j < modLines.length) {
    result.push({ type: 'add', content: modLines[j], lineNumber: j + 1 })
    j++
  }

  return result
}

function buildLCS(a: string[], b: string[]): string[] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const lcs: string[] = []
  let i = m
  let j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1])
      i--
      j--
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }

  return lcs
}
