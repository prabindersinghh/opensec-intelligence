/**
 * Benchmark utilities — dataset loading, code extraction, syntax validation.
 */

import { readFileSync } from 'fs'
import { execFileSync } from 'child_process'

// ---------------------------------------------------------------------------
// Dataset types
// ---------------------------------------------------------------------------

export interface HumanEvalTask {
  task_id: string
  prompt: string
  canonical_solution: string
  test: string
  entry_point: string
}

export interface MBPPTask {
  task_id: number
  text: string
  code: string
  test_list: string[]
  test_setup_code?: string
}

// ---------------------------------------------------------------------------
// Dataset loading
// ---------------------------------------------------------------------------

/** Load HumanEval tasks from a JSONL file. */
export function loadHumanEvalDataset(path: string): HumanEvalTask[] {
  const lines = readFileSync(path, 'utf-8').trim().split('\n')
  return lines
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as HumanEvalTask)
}

/** Load MBPP tasks from a JSONL file. */
export function loadMBPPDataset(path: string): MBPPTask[] {
  const lines = readFileSync(path, 'utf-8').trim().split('\n')
  return lines
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as MBPPTask)
}

/** Extract function name from a Python code snippet. */
export function extractFunctionName(code: string): string | undefined {
  const match = /^def\s+(\w+)\s*\(/m.exec(code)
  return match?.[1]
}

// ---------------------------------------------------------------------------
// Code extraction
// ---------------------------------------------------------------------------

/**
 * Extract Python code from LLM output.
 *
 * Strategy:
 *  1. Prefer ```python fenced blocks
 *  2. Fallback to ``` generic fenced blocks
 *  3. Fallback to lines that look like Python code (def, import, etc.)
 *  4. Last resort: return stripped raw output
 */
export function extractPythonCode(output: string): string {
  // 1. ```python ... ```
  const pythonFenceRe = /```python\s*\n([\s\S]*?)```/g
  const pythonBlocks: string[] = []
  let match: RegExpExecArray | null
  while ((match = pythonFenceRe.exec(output)) !== null) {
    pythonBlocks.push(match[1])
  }
  if (pythonBlocks.length > 0) {
    return pythonBlocks.join('\n\n').trim()
  }

  // 2. ``` ... ```
  const genericFenceRe = /```\s*\n([\s\S]*?)```/g
  const genericBlocks: string[] = []
  while ((match = genericFenceRe.exec(output)) !== null) {
    genericBlocks.push(match[1])
  }
  if (genericBlocks.length > 0) {
    return genericBlocks.join('\n\n').trim()
  }

  // 3. Extract contiguous code-looking lines
  const lines = output.split('\n')
  const codeLines: string[] = []
  let inCode = false

  for (const line of lines) {
    const trimmed = line.trim()
    const isCodeStart =
      trimmed.startsWith('def ') ||
      trimmed.startsWith('class ') ||
      trimmed.startsWith('import ') ||
      trimmed.startsWith('from ')

    if (isCodeStart) inCode = true

    if (inCode) {
      // Stop if we hit an obvious non-code line after code started
      if (
        trimmed.length > 0 &&
        !trimmed.startsWith('#') &&
        !trimmed.startsWith('def ') &&
        !trimmed.startsWith('class ') &&
        !trimmed.startsWith('import ') &&
        !trimmed.startsWith('from ') &&
        !trimmed.startsWith('return ') &&
        !trimmed.startsWith('if ') &&
        !trimmed.startsWith('elif ') &&
        !trimmed.startsWith('else') &&
        !trimmed.startsWith('for ') &&
        !trimmed.startsWith('while ') &&
        !trimmed.startsWith('try') &&
        !trimmed.startsWith('except') &&
        !trimmed.startsWith('finally') &&
        !trimmed.startsWith('with ') &&
        !trimmed.startsWith('raise ') &&
        !trimmed.startsWith('assert ') &&
        !trimmed.startsWith('yield ') &&
        !trimmed.startsWith('pass') &&
        !trimmed.startsWith('break') &&
        !trimmed.startsWith('continue') &&
        !trimmed.startsWith('print(') &&
        !trimmed.startsWith('@') &&
        !/^\s/.test(line) &&
        !line.startsWith(' ') &&
        !line.startsWith('\t')
      ) {
        // Non-indented, non-keyword line after code — likely prose
        break
      }
      codeLines.push(line)
    }
  }

  if (codeLines.length > 0) {
    return codeLines.join('\n').trim()
  }

  // 4. Last resort
  return output
    .replace(/^(Here's|Here is|The|This|I'll|I will|Sure|Certainly|Below).*?\n/gim, '')
    .trim()
}

// ---------------------------------------------------------------------------
// Syntax validation
// ---------------------------------------------------------------------------

/** Validate that the code is syntactically valid Python. */
export function validateSyntax(code: string): boolean {
  if (!code.trim()) return false

  try {
    execFileSync('python3', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], {
      timeout: 5000,
      input: code,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Code & test builders
// ---------------------------------------------------------------------------

/**
 * Build the complete function code for a HumanEval task.
 *
 * HumanEval prompts contain the function signature + docstring.
 * The model either completes the body or re-outputs the full function.
 * This ensures the returned code has imports + complete function.
 */
export function buildHumanEvalCode(task: HumanEvalTask, extractedCode: string): string {
  const hasSignature = extractedCode.includes(`def ${task.entry_point}`)

  if (hasSignature) {
    // Model output includes the function — extract imports from prompt
    const importLines = task.prompt
      .split('\n')
      .filter(l => l.startsWith('import ') || l.startsWith('from '))
      .join('\n')
    return importLines ? importLines + '\n\n' + extractedCode : extractedCode
  }

  // Model output is just the function body — prepend prompt (signature + docstring)
  return task.prompt + extractedCode
}

/** Return just the test harness for a HumanEval task. */
export function buildHumanEvalTest(task: HumanEvalTask): string {
  return task.test
}

/**
 * Build the test assertions for an MBPP task.
 * Does NOT include the generated code — that goes in the code file.
 */
export function buildMBPPTest(task: MBPPTask): string {
  const setup = task.test_setup_code ?? ''
  const tests = task.test_list.join('\n')
  const parts = [setup, tests].filter(p => p.trim().length > 0)
  return parts.join('\n\n')
}
