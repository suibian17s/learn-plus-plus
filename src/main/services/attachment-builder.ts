import path from 'path'
import os from 'os'
import fs from 'fs'

export async function buildDocx(markdown: string, opts?: { filename?: string }): Promise<{ buffer: Buffer; filename: string }> {
  const docx = await import('docx')
  const paragraphs = markdown.split('\n').filter((l) => l.trim()).map((line) => {
    if (line.startsWith('# ')) {
      return new docx.Paragraph({
        heading: docx.HeadingLevel.HEADING_1,
        children: [new docx.TextRun(line.slice(2))],
      })
    }
    if (line.startsWith('## ')) {
      return new docx.Paragraph({
        heading: docx.HeadingLevel.HEADING_2,
        children: [new docx.TextRun(line.slice(3))],
      })
    }
    return new docx.Paragraph({
      children: [new docx.TextRun(line)],
    })
  })

  const doc = new docx.Document({
    sections: [{
      properties: {},
      children: paragraphs,
    }],
  })

  const buffer = await docx.Packer.toBuffer(doc)
  const filename = opts?.filename || 'document.docx'
  return { buffer: Buffer.from(buffer), filename }
}

export async function buildPdf(markdown: string, opts?: { filename?: string }): Promise<{ buffer: Buffer; filename: string }> {
  // Dynamic import since pdfkit types are not fully available
  const PDFDocument = require('pdfkit')

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const doc = new PDFDocument({ size: 'A4', margin: 50 })

    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => {
      const buffer = Buffer.concat(chunks)
      resolve({ buffer, filename: opts?.filename || 'document.pdf' })
    })
    doc.on('error', reject)

    // Register Chinese font if available
    const fontPath = path.join(__dirname, '..', '..', 'resources', 'fonts', 'SourceHanSansSC-Regular.ttf')
    if (fs.existsSync(fontPath)) {
      doc.registerFont('HanSans', fontPath)
      doc.font('HanSans')
    }

    const lines = markdown.split('\n')
    for (const line of lines) {
      if (line.startsWith('# ')) {
        doc.fontSize(18).text(line.slice(2), { continued: false })
        doc.moveDown(0.5)
      } else if (line.startsWith('## ')) {
        doc.fontSize(15).text(line.slice(3), { continued: false })
        doc.moveDown(0.3)
      } else if (line.trim()) {
        doc.fontSize(12).text(line, { continued: false })
        doc.moveDown(0.2)
      }
    }

    doc.end()
  })
}
