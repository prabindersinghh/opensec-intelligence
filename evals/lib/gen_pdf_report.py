#!/usr/bin/env python3
"""
Generate a PDF eval report from a JSON EvalRun file.

Usage: python3 gen_pdf_report.py <input.json> <output.pdf>

Requires: pip install reportlab
"""

import json
import sys
from datetime import datetime

def main():
    if len(sys.argv) != 3:
        print("Usage: python3 gen_pdf_report.py <input.json> <output.pdf>")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    with open(input_path, 'r') as f:
        run = json.load(f)

    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.units import inch
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    except ImportError:
        print("reportlab not installed. Install with: pip install reportlab")
        sys.exit(1)

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('Title2', parent=styles['Title'], fontSize=18, spaceAfter=12)
    heading_style = ParagraphStyle('Heading2b', parent=styles['Heading2'], fontSize=14, spaceAfter=6)
    normal_style = styles['Normal']

    doc = SimpleDocTemplate(output_path, pagesize=letter, topMargin=0.5*inch, bottomMargin=0.5*inch)
    elements = []

    # Title
    elements.append(Paragraph("cmdr Eval Report", title_style))
    elements.append(Spacer(1, 12))

    # Metadata
    summary = run.get('summary', {})
    meta_data = [
        ['Model', run.get('model', 'unknown')],
        ['Date', run.get('completedAt', 'unknown')[:19]],
        ['Grade', summary.get('grade', '?')],
        ['Score', f"{summary.get('score', 0)}/{summary.get('maxScore', 0)} ({summary.get('percentage', 0)}%)"],
        ['Passed', f"{summary.get('passed', 0)}/{summary.get('totalTasks', 0)}"],
        ['Duration', f"{summary.get('totalDuration', 0)}s"],
        ['Tokens', f"{summary.get('totalTokensIn', 0):,} in / {summary.get('totalTokensOut', 0):,} out"],
    ]
    meta_table = Table(meta_data, colWidths=[1.5*inch, 4*inch])
    meta_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
    ]))
    elements.append(meta_table)
    elements.append(Spacer(1, 16))

    # By Tier table
    elements.append(Paragraph("Results by Tier", heading_style))
    by_tier = summary.get('byTier', {})
    tier_headers = ['Tier', 'Passed', 'Total', 'Score', 'Max Score', 'Rate']
    tier_rows = [tier_headers]
    tier_order = ['basic', 'intermediate', 'advanced', 'hard', 'expert', 'extreme']
    for tier in tier_order:
        t = by_tier.get(tier)
        if not t:
            continue
        rate = f"{round(t['passed'] / t['total'] * 100)}%" if t['total'] > 0 else "0%"
        tier_rows.append([tier, str(t['passed']), str(t['total']), str(t['score']), str(t['maxScore']), rate])

    if len(tier_rows) > 1:
        tier_table = Table(tier_rows, colWidths=[1.2*inch, 0.8*inch, 0.8*inch, 0.8*inch, 1*inch, 0.8*inch])
        tier_table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e0e0e0')),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
        ]))
        elements.append(tier_table)
    elements.append(Spacer(1, 16))

    # Task results table
    elements.append(Paragraph("Task Results", heading_style))
    task_headers = ['Task ID', 'Status', 'Score', 'Time', 'Error']
    task_rows = [task_headers]
    for task in run.get('tasks', []):
        status = 'PASS' if task.get('passed') else 'FAIL'
        error_text = (task.get('error', '') or '')[:60]
        task_rows.append([
            task.get('taskId', '?')[:25],
            status,
            str(task.get('score', 0)),
            f"{task.get('duration', 0):.1f}s",
            error_text,
        ])

    task_table = Table(task_rows, colWidths=[2*inch, 0.6*inch, 0.6*inch, 0.7*inch, 2.6*inch])
    task_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e0e0e0')),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
    ]))
    # Color pass/fail cells
    for i, task in enumerate(run.get('tasks', []), start=1):
        if task.get('passed'):
            task_table.setStyle(TableStyle([('TEXTCOLOR', (1, i), (1, i), colors.HexColor('#228B22'))]))
        else:
            task_table.setStyle(TableStyle([('TEXTCOLOR', (1, i), (1, i), colors.HexColor('#CC0000'))]))

    elements.append(task_table)

    # Build PDF
    doc.build(elements)
    print(f"PDF report saved to: {output_path}")

if __name__ == '__main__':
    main()
