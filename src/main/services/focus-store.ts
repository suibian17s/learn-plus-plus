import fs from 'fs'
import { focusItemsFile } from '../utils/paths'
import type { ManualFocusItem, TodayFocusItem } from '../types'

interface FocusStoreData {
  items: ManualFocusItem[]
}

function load(): FocusStoreData {
  try {
    const raw = fs.readFileSync(focusItemsFile, 'utf-8')
    const parsed = JSON.parse(raw)
    return { items: Array.isArray(parsed.items) ? parsed.items : [] }
  } catch {
    return { items: [] }
  }
}

function save(data: FocusStoreData): void {
  fs.writeFileSync(focusItemsFile, JSON.stringify(data, null, 2))
}

export function addFocusItem(item: ManualFocusItem): void {
  const data = load()
  if (!data.items.some((i) => i.id === item.id)) {
    data.items.push(item)
    save(data)
  }
}

export function removeFocusItem(id: string): void {
  const data = load()
  data.items = data.items.filter((i) => i.id !== id)
  save(data)
}

export function getFocusItems(): ManualFocusItem[] {
  return load().items
}

export function convertToTodayFocus(items: ManualFocusItem[]): TodayFocusItem[] {
  return items.map((item) => ({
    priority: 'P0' as const,
    courseName: item.type === 'email' ? '邮箱' : (item.description || '手动添加'),
    courseId: '',
    title: item.title,
    tag: '手动添加',
    deadline: undefined,
    targetTab: 'mailbox' as const,
    targetId: item.mailId || '',
  }))
}
