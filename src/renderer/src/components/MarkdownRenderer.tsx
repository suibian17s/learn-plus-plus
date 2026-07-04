import React from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

type InlinePart =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; label: string; href: string }
  | { type: 'math'; value: string }

// LaTeX 特征：含反斜杠命令 / 上下标 / 花括号。用于把 $x^2$ 当公式，$350 当货币。
function isLatexLike(s: string): boolean {
  return /[\\^_{}]/.test(s)
}

function renderMath(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex.trim(), { throwOnError: false, displayMode: display, output: 'html' })
  } catch {
    return ''
  }
}

function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = []
  // 顺序：粗体 / 行内代码 / 链接 / \(...\) 数学 / $...$ 数学（货币保护）
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    if (match[2]) parts.push({ type: 'bold', value: match[2] })
    else if (match[3]) parts.push({ type: 'code', value: match[3] })
    else if (match[4] && match[5]) parts.push({ type: 'link', label: match[4], href: match[5] })
    else if (match[6] != null) parts.push({ type: 'math', value: match[6] })
    else if (match[7] != null) {
      if (isLatexLike(match[7])) parts.push({ type: 'math', value: match[7] })
      else parts.push({ type: 'text', value: match[0] }) // 货币等，原样保留
    }
    lastIndex = pattern.lastIndex
  }

  if (lastIndex < text.length) parts.push({ type: 'text', value: text.slice(lastIndex) })
  return parts
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  return parseInline(text).map((part, index) => {
    const key = `${keyPrefix}-${index}`
    if (part.type === 'bold') return <strong key={key}>{part.value}</strong>
    if (part.type === 'code') return <code key={key}>{part.value}</code>
    if (part.type === 'link') {
      return (
        <a key={key} href={part.href} target="_blank" rel="noreferrer">
          {part.label}
        </a>
      )
    }
    if (part.type === 'math') {
      const html = renderMath(part.value, false)
      if (html) return <span key={key} className="lp2-md-math-inline" dangerouslySetInnerHTML={{ __html: html }} />
      return <code key={key}>{part.value}</code>
    }
    return <React.Fragment key={key}>{part.value}</React.Fragment>
  })
}

export default function MarkdownRenderer({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const nodes: React.ReactNode[] = []
  let listItems: React.ReactNode[] = []
  let orderedItems: React.ReactNode[] = []
  let codeLines: string[] = []
  let tableRows: string[][] = []
  let mathLines: string[] = []
  let inCode = false
  let inMath = false

  function pushMathBlock(tex: string) {
    const html = renderMath(tex, true)
    if (html) {
      nodes.push(<div key={`math-${nodes.length}`} className="lp2-md-math-block" dangerouslySetInnerHTML={{ __html: html }} />)
    } else {
      nodes.push(<pre key={`math-${nodes.length}`}><code>{tex}</code></pre>)
    }
  }

  function flushTable() {
    if (!tableRows.length) return
    const [head, ...body] = tableRows
    nodes.push(
      <div key={`tw-${nodes.length}`} className="lp2-md-table-wrap">
        <table className="lp2-md-table">
          <thead>
            <tr>{head.map((cell, ci) => <th key={ci}>{renderInline(cell, `th-${nodes.length}-${ci}`)}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{renderInline(cell, `td-${nodes.length}-${ri}-${ci}`)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>,
    )
    tableRows = []
  }

  function flushLists() {
    flushTable()
    if (listItems.length) {
      nodes.push(<ul key={`ul-${nodes.length}`}>{listItems}</ul>)
      listItems = []
    }
    if (orderedItems.length) {
      nodes.push(<ol key={`ol-${nodes.length}`}>{orderedItems}</ol>)
      orderedItems = []
    }
  }

  function flushCode() {
    if (codeLines.length || inCode) {
      nodes.push(<pre key={`pre-${nodes.length}`}><code>{codeLines.join('\n')}</code></pre>)
      codeLines = []
      inCode = false
    }
  }

  lines.forEach((line, index) => {
    if (/^```/.test(line.trim())) {
      if (inCode) flushCode()
      else {
        flushLists()
        inCode = true
        codeLines = []
      }
      return
    }

    if (inCode) {
      codeLines.push(line)
      return
    }

    const trimmed = line.trim()

    // 块级数学：$$...$$ 或 \[...\]（可跨行）
    if (inMath) {
      if (trimmed.endsWith('$$') || trimmed.endsWith('\\]')) {
        mathLines.push(trimmed.replace(/(\$\$|\\\])\s*$/, ''))
        pushMathBlock(mathLines.join('\n'))
        inMath = false
        mathLines = []
      } else {
        mathLines.push(line)
      }
      return
    }
    if (trimmed === '$$' || trimmed === '\\[') {
      flushLists()
      inMath = true
      mathLines = []
      return
    }
    const singleLineMath = trimmed.match(/^\$\$([\s\S]+)\$\$$/) || trimmed.match(/^\\\[([\s\S]+)\\\]$/)
    if (singleLineMath) {
      flushLists()
      pushMathBlock(singleLineMath[1])
      return
    }
    if (trimmed.startsWith('$$')) {
      flushLists()
      inMath = true
      mathLines = [trimmed.slice(2)]
      return
    }

    if (!trimmed) {
      flushLists()
      return
    }

    // GFM 表格：| a | b | 行；分隔行（|---|---|）跳过
    if (/^\|.*\|$/.test(trimmed)) {
      if (/^\|[\s:\-|]+\|$/.test(trimmed)) return // header separator
      const cells = trimmed.slice(1, -1).split('|').map((c) => c.trim())
      tableRows.push(cells)
      return
    }
    flushTable()

    // 水平分割线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushLists()
      nodes.push(<hr key={`hr-${index}`} className="lp2-md-hr" />)
      return
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      flushLists()
      const level = Math.min(heading[1].length, 4)
      const Tag = `h${level}` as keyof JSX.IntrinsicElements
      nodes.push(<Tag key={`h-${index}`}>{renderInline(heading[2], `h-${index}`)}</Tag>)
      return
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/)
    if (bullet) {
      if (orderedItems.length) {
        nodes.push(<ol key={`ol-${nodes.length}`}>{orderedItems}</ol>)
        orderedItems = []
      }
      listItems.push(<li key={`li-${index}`}>{renderInline(bullet[1], `li-${index}`)}</li>)
      return
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/)
    if (ordered) {
      if (listItems.length) {
        nodes.push(<ul key={`ul-${nodes.length}`}>{listItems}</ul>)
        listItems = []
      }
      orderedItems.push(<li key={`oli-${index}`}>{renderInline(ordered[1], `oli-${index}`)}</li>)
      return
    }

    flushLists()
    nodes.push(<p key={`p-${index}`}>{renderInline(trimmed, `p-${index}`)}</p>)
  })

  if (inMath && mathLines.length) pushMathBlock(mathLines.join('\n'))
  flushCode()
  flushLists()

  return <div className="lp2-markdown">{nodes}</div>
}
