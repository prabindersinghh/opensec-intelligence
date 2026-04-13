/**
 * Built-in notebook tool — read, write, and execute Jupyter notebook cells.
 *
 * Works with .ipynb files directly, parsing the notebook JSON format.
 * Execution uses `jupyter nbconvert --execute` or `jupyter run` when available.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { z } from 'zod'
import { defineTool } from '../registry.js'

interface NotebookCell {
  cell_type: 'code' | 'markdown' | 'raw'
  source: string[]
  metadata: Record<string, unknown>
  outputs?: unknown[]
  execution_count?: number | null
}

interface Notebook {
  cells: NotebookCell[]
  metadata: Record<string, unknown>
  nbformat: number
  nbformat_minor: number
}

function formatCell(cell: NotebookCell, index: number): string {
  const type = cell.cell_type.toUpperCase()
  const source = cell.source.join('')
  const exec = cell.execution_count != null ? ` [${cell.execution_count}]` : ''
  let output = `--- Cell ${index + 1} (${type})${exec} ---\n${source}`

  if (cell.outputs && cell.outputs.length > 0) {
    const outputTexts = cell.outputs.map((o: any) => {
      if (o.text) return (Array.isArray(o.text) ? o.text.join('') : o.text)
      if (o.data?.['text/plain']) return Array.isArray(o.data['text/plain']) ? o.data['text/plain'].join('') : o.data['text/plain']
      if (o.ename) return `${o.ename}: ${o.evalue}`
      return ''
    }).filter(Boolean)
    if (outputTexts.length > 0) {
      output += `\n\n>> Output:\n${outputTexts.join('\n')}`
    }
  }
  return output
}

export const notebookReadTool = defineTool({
  name: 'notebook_read',
  description:
    'Read a Jupyter notebook (.ipynb) file. Returns cell contents with their types and outputs. ' +
    'Can read specific cells by index or the entire notebook.',

  inputSchema: z.object({
    path: z.string().describe('Path to the .ipynb file.'),
    cell: z.number().optional().describe('0-based cell index to read. Omit to read all cells.'),
  }),

  execute: async (input, context) => {
    const cwd = context.cwd ?? process.cwd()
    const fullPath = input.path.startsWith('/') ? input.path : `${cwd}/${input.path}`

    try {
      const raw = await readFile(fullPath, 'utf-8')
      const nb = JSON.parse(raw) as Notebook

      if (input.cell != null) {
        if (input.cell < 0 || input.cell >= nb.cells.length) {
          return { data: `Cell index ${input.cell} out of range (0-${nb.cells.length - 1})`, isError: true }
        }
        return { data: formatCell(nb.cells[input.cell], input.cell) }
      }

      const kernelMeta = nb.metadata?.kernelspec as Record<string, unknown> | undefined
      const summary = `Notebook: ${nb.cells.length} cells (${kernelMeta?.display_name ?? 'unknown kernel'})\n\n`
      const cells = nb.cells.map((c, i) => formatCell(c, i)).join('\n\n')
      return { data: summary + cells }
    } catch (err) {
      return { data: `Failed to read notebook: ${err instanceof Error ? err.message : String(err)}`, isError: true }
    }
  },
})

export const notebookEditTool = defineTool({
  name: 'notebook_edit',
  description:
    'Edit a Jupyter notebook cell. Can replace cell content, insert new cells, or delete cells.',

  inputSchema: z.object({
    path: z.string().describe('Path to the .ipynb file.'),
    action: z.enum(['replace', 'insert', 'delete']).describe('Edit action.'),
    cell: z.number().describe('0-based cell index (for replace/delete) or insertion position (for insert).'),
    content: z.string().optional().describe('New cell content (for replace/insert).'),
    cell_type: z.enum(['code', 'markdown', 'raw']).optional().describe('Cell type for insert (default: code).'),
  }),

  execute: async (input, context) => {
    const cwd = context.cwd ?? process.cwd()
    const fullPath = input.path.startsWith('/') ? input.path : `${cwd}/${input.path}`

    try {
      const raw = await readFile(fullPath, 'utf-8')
      const nb = JSON.parse(raw) as Notebook

      switch (input.action) {
        case 'replace': {
          if (input.cell < 0 || input.cell >= nb.cells.length) {
            return { data: `Cell index ${input.cell} out of range`, isError: true }
          }
          if (!input.content) return { data: 'content is required for replace', isError: true }
          nb.cells[input.cell].source = input.content.split('\n').map((l, i, arr) =>
            i < arr.length - 1 ? l + '\n' : l,
          )
          nb.cells[input.cell].outputs = []
          nb.cells[input.cell].execution_count = null
          break
        }
        case 'insert': {
          if (input.cell < 0 || input.cell > nb.cells.length) {
            return { data: `Insertion position ${input.cell} out of range`, isError: true }
          }
          const newCell: NotebookCell = {
            cell_type: input.cell_type ?? 'code',
            source: (input.content ?? '').split('\n').map((l, i, arr) =>
              i < arr.length - 1 ? l + '\n' : l,
            ),
            metadata: {},
            outputs: input.cell_type === 'code' || !input.cell_type ? [] : undefined,
            execution_count: input.cell_type === 'code' || !input.cell_type ? null : undefined,
          }
          nb.cells.splice(input.cell, 0, newCell)
          break
        }
        case 'delete': {
          if (input.cell < 0 || input.cell >= nb.cells.length) {
            return { data: `Cell index ${input.cell} out of range`, isError: true }
          }
          nb.cells.splice(input.cell, 1)
          break
        }
      }

      await writeFile(fullPath, JSON.stringify(nb, null, 1) + '\n', 'utf-8')
      return { data: `Notebook updated: ${input.action} cell ${input.cell} (${nb.cells.length} cells total)` }
    } catch (err) {
      return { data: `Failed to edit notebook: ${err instanceof Error ? err.message : String(err)}`, isError: true }
    }
  },
})

export const notebookRunTool = defineTool({
  name: 'notebook_run',
  description:
    'Execute a Jupyter notebook cell or the entire notebook. Requires jupyter to be installed.',

  inputSchema: z.object({
    path: z.string().describe('Path to the .ipynb file.'),
    cell: z.number().optional().describe('0-based cell index to execute. Omit to run entire notebook.'),
  }),

  execute: async (input, context) => {
    const cwd = context.cwd ?? process.cwd()
    const fullPath = input.path.startsWith('/') ? input.path : `${cwd}/${input.path}`

    if (input.cell != null) {
      // Execute single cell by using jupyter's execute API
      // Read notebook, extract cell, run with python -c, put output back
      try {
        const raw = await readFile(fullPath, 'utf-8')
        const nb = JSON.parse(raw) as Notebook
        const cell = nb.cells[input.cell]
        if (!cell) return { data: `Cell ${input.cell} not found`, isError: true }
        if (cell.cell_type !== 'code') return { data: `Cell ${input.cell} is not a code cell`, isError: true }

        const code = cell.source.join('')

        return new Promise((resolve) => {
          const child = spawn('python3', ['-c', code], {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          const out: Buffer[] = []
          const err: Buffer[] = []
          const timeout = setTimeout(() => {
            child.kill()
            resolve({ data: 'Cell execution timed out after 30s', isError: true })
          }, 30_000)

          child.stdout.on('data', (c: Buffer) => out.push(c))
          child.stderr.on('data', (c: Buffer) => err.push(c))

          child.on('close', (exitCode) => {
            clearTimeout(timeout)
            const stdout = Buffer.concat(out).toString('utf-8').trim()
            const stderr = Buffer.concat(err).toString('utf-8').trim()

            if (exitCode === 0) {
              resolve({ data: stdout || '(no output)' })
            } else {
              resolve({ data: stderr || stdout || 'Cell execution failed', isError: true })
            }
          })

          child.on('error', (e) => {
            clearTimeout(timeout)
            resolve({ data: `Failed to run cell: ${e.message}`, isError: true })
          })
        })
      } catch (err) {
        return { data: `Failed: ${err instanceof Error ? err.message : String(err)}`, isError: true }
      }
    }

    // Execute entire notebook
    return new Promise((resolve) => {
      const child = spawn('jupyter', [
        'nbconvert', '--to', 'notebook', '--execute',
        '--output', fullPath, fullPath,
      ], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })

      const out: Buffer[] = []
      const err: Buffer[] = []
      const timeout = setTimeout(() => {
        child.kill()
        resolve({ data: 'Notebook execution timed out after 120s', isError: true })
      }, 120_000)

      child.stdout.on('data', (c: Buffer) => out.push(c))
      child.stderr.on('data', (c: Buffer) => err.push(c))

      child.on('close', (code) => {
        clearTimeout(timeout)
        if (code === 0) {
          resolve({ data: `Notebook executed successfully.` })
        } else {
          const stderr = Buffer.concat(err).toString('utf-8').trim()
          resolve({ data: stderr || 'Notebook execution failed', isError: true })
        }
      })

      child.on('error', (e) => {
        clearTimeout(timeout)
        resolve({ data: `jupyter not found: ${e.message}. Install with: pip install jupyter`, isError: true })
      })
    })
  },
})
