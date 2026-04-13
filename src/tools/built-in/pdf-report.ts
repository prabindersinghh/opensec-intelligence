/**
 * Built-in pdf_report tool — generate structured multi-page PDF reports.
 *
 * Provides a high-level JSON API so the LLM doesn't need to write raw
 * reportlab/Python code. The tool takes structured sections and produces
 * a professional PDF with title page, TOC, headers, tables, and page numbers.
 */

import { writeFile, mkdir } from 'fs/promises'
import { resolve, dirname } from 'path'
import { spawn } from 'child_process'
import { z } from 'zod'
import { defineTool } from '../registry.js'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const tableSchema = z.object({
  type: z.literal('table'),
  headers: z.array(z.string()).describe('Column headers'),
  rows: z.array(z.array(z.string())).describe('Row data'),
})

const textSchema = z.object({
  type: z.literal('text'),
  body: z.string().describe('Paragraph text (supports \\n for line breaks)'),
})

const bulletSchema = z.object({
  type: z.literal('bullets'),
  items: z.array(z.string()).describe('Bullet point items'),
})

const codeSchema = z.object({
  type: z.literal('code'),
  language: z.string().optional().describe('Language label'),
  body: z.string().describe('Code block content'),
})

const keyValueSchema = z.object({
  type: z.literal('key_value'),
  pairs: z.array(z.object({
    key: z.string(),
    value: z.string(),
  })).describe('Key-value pairs displayed as a two-column layout'),
})

const contentBlock = z.discriminatedUnion('type', [
  tableSchema, textSchema, bulletSchema, codeSchema, keyValueSchema,
])

const sectionSchema = z.object({
  title: z.string().describe('Section heading'),
  content: z.array(contentBlock).describe('Content blocks in this section'),
})

const reportInput = z.object({
  title: z.string().describe('Report title for the cover page'),
  subtitle: z.string().optional().describe('Subtitle or project name'),
  author: z.string().optional().describe('Author name'),
  date: z.string().optional().describe('Date string (defaults to today)'),
  sections: z.array(sectionSchema).min(1).describe('Report sections in order'),
  outputPath: z.string().describe('Output file path for the PDF'),
})

// ---------------------------------------------------------------------------
// Python generator template
// ---------------------------------------------------------------------------

function buildPythonScript(): string {
  return `#!/usr/bin/env python3
"""Auto-generated PDF report script. Reads data from a JSON file."""
import json, sys, os

try:
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import inch
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.colors import HexColor
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
        PageBreak, Preformatted, ListFlowable, ListItem,
    )
    from reportlab.lib import colors
except ImportError:
    print("ERROR: reportlab not installed. Run: pip install reportlab", file=sys.stderr)
    sys.exit(1)

if len(sys.argv) < 3:
    print("Usage: python3 report.py <data.json> <output.pdf>", file=sys.stderr)
    sys.exit(1)

with open(sys.argv[1], 'r', encoding='utf-8') as f:
    data = json.load(f)
output_path = sys.argv[2]

# ── Styles ──────────────────────────────────────────────
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name='CoverTitle', fontSize=28, leading=34,
    alignment=TA_CENTER, spaceAfter=12,
    textColor=HexColor('#1a1a2e'),
))
styles.add(ParagraphStyle(
    name='CoverSubtitle', fontSize=16, leading=20,
    alignment=TA_CENTER, spaceAfter=8,
    textColor=HexColor('#4a4a6a'),
))
styles.add(ParagraphStyle(
    name='CoverMeta', fontSize=12, leading=16,
    alignment=TA_CENTER, spaceAfter=4,
    textColor=HexColor('#6a6a8a'),
))
styles.add(ParagraphStyle(
    name='SectionHead', fontSize=18, leading=22,
    spaceAfter=12, spaceBefore=20,
    textColor=HexColor('#1a1a2e'),
    borderWidth=1, borderColor=HexColor('#e0e0e0'),
    borderPadding=(0, 0, 4, 0),
))
styles.add(ParagraphStyle(
    name='BodyText2', fontSize=10, leading=14,
    spaceAfter=8, spaceBefore=4,
))
styles.add(ParagraphStyle(
    name='CodeBlock', fontName='Courier', fontSize=8, leading=10,
    spaceAfter=8, spaceBefore=4, backColor=HexColor('#f5f5f5'),
    borderWidth=0.5, borderColor=HexColor('#cccccc'),
    borderPadding=6, leftIndent=12, rightIndent=12,
))
styles.add(ParagraphStyle(
    name='BulletText', fontSize=10, leading=14,
    spaceAfter=3, leftIndent=20, bulletIndent=10,
))
styles.add(ParagraphStyle(
    name='TOCEntry', fontSize=11, leading=16,
    spaceAfter=4, leftIndent=20,
    textColor=HexColor('#333366'),
))

# ── Page numbering ──────────────────────────────────────
def add_page_number(canvas, doc):
    page_num = canvas.getPageNumber()
    text = f"Page {page_num}"
    canvas.saveState()
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(HexColor('#888888'))
    canvas.drawCentredString(letter[0] / 2, 0.5 * inch, text)
    canvas.restoreState()

# ── Build story ─────────────────────────────────────────
story = []

# Cover page
story.append(Spacer(1, 2 * inch))
story.append(Paragraph(data['title'], styles['CoverTitle']))
if data.get('subtitle'):
    story.append(Paragraph(data['subtitle'], styles['CoverSubtitle']))
story.append(Spacer(1, 0.5 * inch))
if data.get('author'):
    story.append(Paragraph(f"Author: {data['author']}", styles['CoverMeta']))
story.append(Paragraph(f"Date: {data['date']}", styles['CoverMeta']))
story.append(PageBreak())

# Table of Contents
story.append(Paragraph("Table of Contents", styles['SectionHead']))
story.append(Spacer(1, 0.2 * inch))
for i, section in enumerate(data['sections'], 1):
    story.append(Paragraph(f"{i}. {section['title']}", styles['TOCEntry']))
story.append(PageBreak())

# Sections
for section in data['sections']:
    story.append(Paragraph(section['title'], styles['SectionHead']))

    for block in section.get('content', []):
        btype = block['type']

        if btype == 'text':
            for para in block['body'].split('\\n\\n'):
                if para.strip():
                    story.append(Paragraph(para.strip().replace('\\n', '<br/>'), styles['BodyText2']))

        elif btype == 'bullets':
            items = []
            for item in block['items']:
                items.append(ListItem(Paragraph(item, styles['BodyText2']), bulletColor=HexColor('#333366')))
            story.append(ListFlowable(items, bulletType='bullet', start='bulletchar'))
            story.append(Spacer(1, 0.1 * inch))

        elif btype == 'table':
            headers = block['headers']
            rows = block['rows']
            all_data = [headers] + rows
            t = Table(all_data, repeatRows=1)
            t.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), HexColor('#1a1a2e')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 9),
                ('FONTSIZE', (0, 1), (-1, -1), 8),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#cccccc')),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, HexColor('#f8f8ff')]),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ('LEFTPADDING', (0, 0), (-1, -1), 6),
                ('RIGHTPADDING', (0, 0), (-1, -1), 6),
            ]))
            story.append(t)
            story.append(Spacer(1, 0.15 * inch))

        elif btype == 'code':
            label = block.get('language', '')
            if label:
                story.append(Paragraph(f"<i>{label}</i>", styles['BodyText2']))
            story.append(Preformatted(block['body'], styles['CodeBlock']))

        elif btype == 'key_value':
            kv_data = [[p['key'], p['value']] for p in block['pairs']]
            t = Table(kv_data, colWidths=[2.2 * inch, 4.3 * inch])
            t.setStyle(TableStyle([
                ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 9),
                ('ALIGN', (0, 0), (0, -1), 'RIGHT'),
                ('ALIGN', (1, 0), (1, -1), 'LEFT'),
                ('GRID', (0, 0), (-1, -1), 0.3, HexColor('#e0e0e0')),
                ('ROWBACKGROUNDS', (0, 0), (-1, -1), [colors.white, HexColor('#f8f8ff')]),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ('LEFTPADDING', (0, 0), (-1, -1), 6),
                ('RIGHTPADDING', (0, 0), (-1, -1), 6),
            ]))
            story.append(t)
            story.append(Spacer(1, 0.15 * inch))

    story.append(Spacer(1, 0.3 * inch))

# ── Generate ────────────────────────────────────────────
doc = SimpleDocTemplate(
    output_path,
    pagesize=letter,
    topMargin=0.75 * inch,
    bottomMargin=0.75 * inch,
    leftMargin=0.75 * inch,
    rightMargin=0.75 * inch,
    title=data['title'],
    author=data.get('author', ''),
)
doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)
print(f"Generated: {output_path} ({len(data['sections'])} sections, {sum(len(s.get('content',[])) for s in data['sections'])} content blocks)")
`
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const pdfReportTool = defineTool({
  name: 'pdf_report',
  description:
    'Generate a professional multi-page PDF report with structured sections. ' +
    'Provide a title, sections (each with content blocks: text, bullets, tables, code, key_value), ' +
    'and an output path. The tool handles formatting, cover page, table of contents, and page numbers. ' +
    'Requires Python 3 and reportlab (auto-installs if missing).',

  inputSchema: reportInput,

  execute: async (input, context) => {
    const cwd = context.cwd ?? process.cwd()
    const outputPath = resolve(cwd, input.outputPath)

    // Generate the Python script and write data as separate JSON file (avoids escaping issues)
    const script = buildPythonScript()
    const scriptPath = resolve(cwd, '.cmdr_report_gen.py')
    const dataPath = resolve(cwd, '.cmdr_report_data.json')

    try {
      await mkdir(dirname(outputPath), { recursive: true })
      await writeFile(scriptPath, script, 'utf-8')
      await writeFile(dataPath, JSON.stringify({
        title: input.title,
        subtitle: input.subtitle || '',
        author: input.author || '',
        date: input.date || new Date().toISOString().split('T')[0],
        sections: input.sections,
      }), 'utf-8')

      // Ensure reportlab is installed (try with --break-system-packages for macOS PEP 668)
      const check = await runPython(cwd, ['-c', 'import reportlab'])
      if (check.exitCode !== 0) {
        const install = await runPython(cwd, ['-m', 'pip', 'install', '--break-system-packages', 'reportlab', '-q'])
        if (install.exitCode !== 0) {
          // Fallback without --break-system-packages
          await runPython(cwd, ['-m', 'pip', 'install', 'reportlab', '-q'])
        }
      }

      // Generate PDF
      const result = await runPython(cwd, [scriptPath, dataPath, outputPath])

      // Clean up temp files
      try {
        const { unlink } = await import('fs/promises')
        await unlink(scriptPath).catch(() => {})
        await unlink(dataPath).catch(() => {})
      } catch { /* best effort */ }

      if (result.exitCode !== 0) {
        return { data: `PDF generation failed:\n${result.stderr || result.stdout}`, isError: true }
      }

      return { data: result.stdout.trim() || `Generated PDF: ${input.outputPath}` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { data: `PDF generation error: ${msg}`, isError: true }
    }
  },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ProcResult { stdout: string; stderr: string; exitCode: number }

function runPython(cwd: string, args: string[]): Promise<ProcResult> {
  return new Promise<ProcResult>((resolve) => {
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    const child = spawn('python3', args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000)

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        exitCode: code ?? 1,
      })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ stdout: '', stderr: err.message, exitCode: 1 })
    })
  })
}
