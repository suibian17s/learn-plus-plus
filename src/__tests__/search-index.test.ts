import { describe, it, expect, beforeEach } from 'vitest'
import { indexEmails, indexItems, query } from '../main/services/search-index'

// search-index 内部维护模块级倒排索引（按 type clear+rebuild）。每个 it 重新建索引以隔离用例。

describe('search-index query', () => {
  beforeEach(() => {
    // 先用空数组把 email 类型清干净，避免跨文件残留
    indexEmails([])
  })

  it('matches emails by subject token', () => {
    indexEmails([
      { id: '1', subject: '关于期末考试安排', from: '教务处', preview: '' },
      { id: '2', subject: '会议通知', from: '院办', preview: '' },
    ])
    const results = query('考试') as any[]
    expect(results.some((r) => r.targetId === '1')).toBe(true)
    expect(results.some((r) => r.targetId === '2')).toBe(false)
  })

  it('matches emails by sender and preview', () => {
    indexEmails([
      { id: '3', subject: '通知', from: '图书馆', preview: ' overdue 借书超期' },
    ])
    const bySender = query('图书馆') as any[]
    const byPreview = query('超期') as any[]
    expect(bySender.some((r) => r.targetId === '3')).toBe(true)
    expect(byPreview.some((r) => r.targetId === '3')).toBe(true)
  })

  it('respects typeFilter', () => {
    indexItems('homework', [{ id: 'h1', title: '作业 期中', courseName: '数学' }], 'homework')
    indexEmails([{ id: 'e1', subject: '期中', from: '' }])
    const onlyMail = query('期中', 'email') as any[]
    const onlyHw = query('期中', 'homework') as any[]
    expect(onlyMail.every((r) => r.type === 'email')).toBe(true)
    expect(onlyHw.every((r) => r.type === 'homework')).toBe(true)
  })

  it('returns empty for no matches', () => {
    indexEmails([{ id: 'x', subject: '不相关', from: '' }])
    expect(query('zzzznomatch')).toEqual([])
  })

  it('tokenizes CJK by 1- and 2-gram (substring hit works)', () => {
    indexEmails([{ id: '9', subject: '实验报告提交', from: '' }])
    const hits = query('实验报告') as any[]
    expect(hits.some((r) => r.targetId === '9')).toBe(true)
  })
})