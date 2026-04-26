import fs from 'fs'
import path from 'path'

interface ParseResult {
  text: string
  tokenEstimate: number
  warnings: string[]
}

export async function parseAttachment(filePath: string): Promise<ParseResult> {
  const ext = path.extname(filePath).toLowerCase()
  const warnings: string[] = []
  let text = ''

  try {
    switch (ext) {
      case '.txt':
      case '.md': {
        text = fs.readFileSync(filePath, 'utf-8')
        break
      }
      case '.pdf': {
        const pdfParse = await import('pdf-parse')
        const buf = fs.readFileSync(filePath)
        const data = await pdfParse.default(buf)
        text = data.text || ''
        if (!text.trim()) {
          warnings.push('PDF 可能为扫描版，无法提取文本')
        }
        break
      }
      case '.docx': {
        const mammoth = await import('mammoth')
        const buf = fs.readFileSync(filePath)
        const result = await mammoth.extractRawText({ buffer: buf })
        text = result.value || ''
        if (result.messages.length > 0) {
          warnings.push(`DOCX 解析警告: ${result.messages.join('; ')}`)
        }
        break
      }
      case '.pptx': {
        const officeparser = await import('officeparser')
        text = await officeparser.parseOfficeAsync(filePath)
        break
      }
      default: {
        warnings.push(`不支持的文件类型: ${ext}`)
      }
    }
  } catch (err) {
    warnings.push(`解析失败: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Rough token estimate: ~2 chars per token for Chinese
  const tokenEstimate = Math.ceil(text.length / 2)

  return { text, tokenEstimate, warnings }
}

export async function parseAttachments(
  filePaths: string[],
  maxTokens: number = 100000,
  priorityKeywords: string[] = ['模板', '要求', '题目', '说明'],
): Promise<{ name: string; text: string; tokenEstimate: number }[]> {
  // Sort: files with priority keywords first
  const sorted = [...filePaths].sort((a, b) => {
    const aName = path.basename(a).toLowerCase()
    const bName = path.basename(b).toLowerCase()
    const aScore = priorityKeywords.filter((k) => aName.includes(k)).length
    const bScore = priorityKeywords.filter((k) => bName.includes(k)).length
    return bScore - aScore
  })

  const results: { name: string; text: string; tokenEstimate: number }[] = []
  let totalTokens = 0

  for (const fp of sorted) {
    if (totalTokens >= maxTokens) break

    const parsed = await parseAttachment(fp)
    const truncated = totalTokens + parsed.tokenEstimate > maxTokens
      ? parsed.text.slice(0, (maxTokens - totalTokens) * 2)
      : parsed.text

    results.push({
      name: path.basename(fp),
      text: truncated,
      tokenEstimate: Math.ceil(truncated.length / 2),
    })
    totalTokens += Math.ceil(truncated.length / 2)
  }

  return results
}
