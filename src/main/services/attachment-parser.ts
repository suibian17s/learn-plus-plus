import fs from 'fs'
import path from 'path'

interface ParseResult {
  text: string
  tokenEstimate: number
  warnings: string[]
}

type ParseKind = 'text' | 'pdf' | 'docx' | 'office' | 'unknown'

function extToKind(ext: string): ParseKind {
  if (ext === '.txt' || ext === '.md') return 'text'
  if (ext === '.pdf') return 'pdf'
  if (ext === '.docx') return 'docx'
  if (['.pptx', '.ppt', '.xlsx', '.xls', '.doc'].includes(ext)) return 'office'
  return 'unknown'
}

// 扩展名缺失/不可信时，用文件头 magic bytes 兜底判断类型
function sniffKind(filePath: string): ParseKind {
  try {
    const fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(8)
    const n = fs.readSync(fd, buf, 0, 8, 0)
    fs.closeSync(fd)
    if (n >= 4 && buf.toString('latin1', 0, 4) === '%PDF') return 'pdf'
    if (n >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) return 'office' // PK → docx/pptx/xlsx (zip)
    if (n >= 4 && buf.toString('hex', 0, 4) === 'd0cf11e0') return 'office' // OLE → doc/ppt/xls
  } catch { /* ignore */ }
  return 'unknown'
}

async function parsePdf(filePath: string): Promise<string> {
  // 绕过 pdf-parse 包入口：其 index.js 在打包环境下 module.parent 为空会误判 debug 模式，
  // 尝试读取包内测试 PDF 而 ENOENT，导致所有 PDF 解析失败
  // @ts-expect-error pdf-parse 内部实现文件无类型声明
  const pdfParse: any = await import('pdf-parse/lib/pdf-parse.js')
  const parseFn = pdfParse.default || pdfParse
  const buf = fs.readFileSync(filePath)
  const data = await parseFn(buf)
  return data.text || ''
}

async function parseDocx(filePath: string): Promise<string> {
  const mammoth = await import('mammoth')
  const buf = fs.readFileSync(filePath)
  const result = await mammoth.extractRawText({ buffer: buf })
  return result.value || ''
}

async function parseOffice(filePath: string, hasExt: boolean): Promise<string> {
  const officeparser = await import('officeparser')
  // officeparser 依赖扩展名判断格式；文件无扩展名时补一份带 .docx 后缀的临时副本
  let target = filePath
  let temp = false
  if (!hasExt) {
    target = `${filePath}.docx`
    fs.copyFileSync(filePath, target)
    temp = true
  }
  try {
    return await officeparser.parseOfficeAsync(target)
  } finally {
    if (temp) { try { fs.unlinkSync(target) } catch { /* ignore */ } }
  }
}

const MAX_PARSE_BYTES = 40 * 1024 * 1024 // 超过 40MB 不解析：避免 OOM，且这类文件多为含大量音视频的超大课件或损坏文件

export async function parseAttachment(filePath: string): Promise<ParseResult> {
  const ext = path.extname(filePath).toLowerCase()
  const warnings: string[] = []
  let text = ''

  try {
    const size = fs.statSync(filePath).size
    if (size > MAX_PARSE_BYTES) {
      return { text: '', tokenEstimate: 0, warnings: ['OVERSIZED'] }
    }
  } catch { /* stat 失败继续尝试解析 */ }

  let kind = extToKind(ext)
  if (kind === 'unknown') {
    const sniffed = sniffKind(filePath)
    if (sniffed !== 'unknown') {
      kind = sniffed
      warnings.push(`文件名缺少扩展名，已按文件头识别为 ${kind === 'pdf' ? 'PDF' : 'Office 文档'}`)
    }
  }

  try {
    switch (kind) {
      case 'text':
        text = fs.readFileSync(filePath, 'utf-8')
        break
      case 'pdf':
        text = await parsePdf(filePath)
        if (!text.trim()) warnings.push('PDF 可能为扫描版，无法提取文本')
        break
      case 'docx':
        text = await parseDocx(filePath)
        break
      case 'office':
        text = await parseOffice(filePath, !!ext)
        break
      default:
        warnings.push(`不支持的文件类型: ${ext || '(无扩展名，且无法识别文件头)'}`)
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
