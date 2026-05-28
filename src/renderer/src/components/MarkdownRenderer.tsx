import React from 'react'

type InlinePart =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; label: string; href: string }

function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = []
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    if (match[2]) parts.push({ type: 'bold', value: match[2] })
    else if (match[3]) parts.push({ type: 'code', value: match[3] })
    else if (match[4] && match[5]) parts.push({ type: 'link', label: match[4], href: match[5] })
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
    return <React.Fragment key={key}>{part.value}</React.Fragment>
  })
}

export default function MarkdownRenderer({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const nodes: React.ReactNode[] = []
  let listItems: React.ReactNode[] = []
  let orderedItems: React.ReactNode[] = []
  let codeLines: string[] = []
  let inCode = false

  function flushLists() {
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

    const reference = line.match(/^<span class="lp2-reference-note">([\s\S]*)<\/span>$/)
    if (reference) {
      flushLists()
      nodes.push(
        <span key={`ref-${index}`} className="lp2-reference-note">
          {reference[1]}
        </span>,
      )
      return
    }

    const trimmed = line.trim()
    if (!trimmed) {
      flushLists()
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

  flushCode()
  flushLists()

  return <div className="lp2-markdown">{nodes}</div>
}
