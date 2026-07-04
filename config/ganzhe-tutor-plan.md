# 甘蔗 Tutor 专项优化 — 实施计划

> **For agentic workers:** 使用 subagent-driven-development 逐任务实施。步骤使用 `- [ ]` checkbox 语法追踪。

**Goal:** 系统优化甘蔗 Tutor 的状态检测、UI、一键完成作业（多代理并行）、全局辅助、课件总结、按钮布局

**Architecture:** 新增 homework-orchestrator/subagent/reviewer/style-learner 四个服务模块组成多代理流水线；Tutor 页精简为纯聊天界面；课程页全局 tuto 按钮改为按条目触发

**Tech Stack:** Electron 31 + React 18 + TypeScript 5 + Zustand + Ant Design 5 + node-imap + nodemailer + mailparser + pdf-parse + mammoth + officeparser

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/main/services/homework-orchestrator.ts` | **新建** | 主编排器：拆题、派发子代理、组装、触发审查 |
| `src/main/services/homework-subagent.ts` | **新建** | 单题子代理：接收题目+课件片段→生成答案 |
| `src/main/services/homework-reviewer.ts` | **新建** | 甘蔗 Tutor 审查代理：漏题/公式/方法/复核点 |
| `src/main/services/homework-style-learner.ts` | **新建** | 往期风格学习：抓取已批阅作业→提取格式特征 |
| `src/main/ipc/ai.ts` | 修改 | 新增 health-check、orchestrate、summarize-file handlers |
| `src/main/services/homework-ai.ts` | 修改 | analyze 增强：扫描课件/代码/往期提交 |
| `src/main/services/tutor.ts` | 修改 | 新增 summarizeSingleFile 函数 |
| `src/renderer/src/pages/Tutor.tsx` | 修改 | 在线检测 + 移除右侧面板 + 按钮美化 |
| `src/renderer/src/pages/HomeworkAutoComplete.tsx` | 修改 | 新流水线：orchestrate + 进度 UI + 审查批注 |
| `src/renderer/src/pages/Files.tsx` | 修改 | 删除全局 tuto 按钮 + 单文件总结 |
| `src/renderer/src/pages/Notifications.tsx` | 修改 | 删除全局 tuto 按钮 + 每行 tuto 按钮 |
| `src/renderer/src/pages/Discussion.tsx` | 修改 | 删除全局 tuto 按钮 + 每行 tuto 按钮 |
| `src/renderer/src/pages/Homework.tsx` | 修改 | 提交/tuto 按钮加大加圆 + tuto 浅绿色 |
| `src/renderer/src/styles/tsinghua.css` | 修改 | 按钮动画、新布局样式、Tutor 页面样式 |
| `src/preload/index.ts` | 修改 | 新 IPC 方法暴露 |
| `src/preload/api.d.ts` | 修改 | 新 IPC 类型声明 |
| `src/renderer/src/env.d.ts` | 修改 | Renderer 侧类型声明 |

---

### Task 1: Tutor 页在线/离线状态检测

**Files:**
- Modify: `src/main/ipc/ai.ts`
- Modify: `src/renderer/src/pages/Tutor.tsx`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/api.d.ts`
- Modify: `src/renderer/src/env.d.ts`

- [ ] **Step 1: 新增 `hwai:health-check` IPC handler**

在 `src/main/ipc/ai.ts` 的 `registerAiIpc()` 函数末尾（`}` 之前）添加：

```ts
ipcMain.handle('hwai:health-check', async () => {
  try {
    const settings = loadAiSettings()
    if (!settings.apiKey) return { ok: false, error: 'API Key 未配置' }
    if (!settings.endpoint) return { ok: false, error: 'API Endpoint 未配置' }

    const headers = buildAiHeaders(settings.apiKey, settings.provider, settings.apiFormat)
    const body = settings.apiFormat === 'anthropic'
      ? JSON.stringify({ model: settings.model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })
      : JSON.stringify({ model: settings.model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)

    const resp = await fetch(settings.endpoint, {
      method: 'POST', headers, body, signal: ctrl.signal,
    })
    clearTimeout(timer)

    if (!resp.ok) {
      const text = await resp.text()
      return { ok: false, error: `API 返回 ${resp.status}: ${text.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message || '连接失败' }
  }
})
```

- [ ] **Step 2: Preload 三文件同步 — `hwai:healthCheck`**

在 `src/preload/api.d.ts` 的 `hwai` 接口中添加：
```ts
healthCheck: () => Promise<{ ok: boolean; error?: string }>
```

在 `src/preload/index.ts` 的 `hwai` 对象中添加：
```ts
healthCheck: () => ipcRenderer.invoke('hwai:health-check'),
```

在 `src/renderer/src/env.d.ts` 的 `hwai` 接口中添加：
```ts
healthCheck: () => Promise<{ ok: boolean; error?: string }>
```

- [ ] **Step 3: Tutor 页添加在线检测逻辑**

在 `src/renderer/src/pages/Tutor.tsx` 中：

导入 Modal（已导入）、添加状态：
```tsx
const [online, setOnline] = useState<boolean | null>(null)
const [healthModalOpen, setHealthModalOpen] = useState(false)
const [healthError, setHealthError] = useState('')
```

在已有的 `useEffect` 区块附近新增：
```tsx
useEffect(() => {
  window.learn.hwai.healthCheck().then((r) => {
    setOnline(r.ok)
    if (!r.ok) {
      setHealthError(r.error || '未知错误')
      setHealthModalOpen(true)
    }
  }).catch(() => {
    setOnline(false)
    setHealthError('无法连接到 AI 服务')
    setHealthModalOpen(true)
  })
}, [])
```

在聊天区域的合适位置（输入栏上方或顶部）添加在线状态指示：
```tsx
{online !== null && (
  <div style={{
    textAlign: 'center', padding: '4px 0',
    color: online ? '#52C41A' : '#8C8C8C', fontSize: 12,
  }}>
    <Tag color={online ? 'green' : 'default'}>
      {online ? '在线' : '离线'}
    </Tag>
  </div>
)}
```

在 JSX 末尾（`</div>` 之前）添加健康检查失败 Modal：
```tsx
<Modal
  title="甘蔗 Tutor 当前离线"
  open={healthModalOpen}
  onOk={() => setHealthModalOpen(false)}
  onCancel={() => setHealthModalOpen(false)}
  okText="知道了"
  cancelButtonProps={{ style: { display: 'none' } }}
>
  <p>甘蔗 Tutor 当前无法连接到 AI 服务。</p>
  <p style={{ color: '#888' }}>错误信息：{healthError}</p>
  <p>请检查：</p>
  <ul>
    <li>设置页中是否已配置 API Key</li>
    <li>网络连接是否正常</li>
    <li>所选模型服务是否可用</li>
  </ul>
</Modal>
```

- [ ] **Step 4: Typecheck 验证**

```bash
npm run typecheck
```

---

### Task 2: Tutor 页 UI 清理 + 按钮美化

**Files:**
- Modify: `src/renderer/src/pages/Tutor.tsx`
- Modify: `src/renderer/src/styles/tsinghua.css`

- [ ] **Step 1: 移除右侧面板**

在 `Tutor.tsx` 中删除整个 `<aside className="lp2-ai-side-panel">...</aside>` 块（约 50 行）。

- [ ] **Step 2: 聊天面板全宽**

将 `<main className="lp2-ai-chat-panel">` 的外层容器样式从 grid 两栏改为单栏。删除 `.lp2-tutor-chat-layout` 的 grid 定义，使聊天面板自然占满。

在 tsinghua.css 末尾追加：
```css
.lp2-tutor-chat-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.lp2-ai-chat-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  max-width: 900px;
  margin: 0 auto;
  width: 100%;
}
```

- [ ] **Step 3: 按钮美化 CSS**

在 tsinghua.css 末尾追加按钮动画和样式：
```css
.lp2-ai-quick-row button,
.lp2-ai-input-bar button {
  border-radius: 10px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  font-weight: 500;
}
.lp2-ai-quick-row button:hover,
.lp2-ai-input-bar button:hover {
  transform: scale(1.03);
  box-shadow: 0 4px 12px rgba(107, 70, 193, 0.15);
}
.lp2-ai-quick-row button:active,
.lp2-ai-input-bar button:active {
  transform: scale(0.97);
}
.lp2-ai-input-bar .ant-btn-primary {
  background: linear-gradient(135deg, #6B46C1, #4C1D95);
  border: none;
}
.lp2-ai-input-bar .ant-btn-primary:hover {
  background: linear-gradient(135deg, #7B56D1, #5C2DA5);
}
```

- [ ] **Step 4: Tutor 页快捷操作行**

确保快捷操作行保留 4 个常用快捷词 + "一键完成作业"按钮（warning 样式），所有按钮 class 使用 `.lp2-ai-quick-row button` 匹配上面的 CSS。

- [ ] **Step 5: Typecheck 验证**

```bash
npm run typecheck
```

---

### Task 3: 取消全局 Tuto 按钮 + 按条目 Tuto

**Files:**
- Modify: `src/renderer/src/pages/Notifications.tsx`
- Modify: `src/renderer/src/pages/Discussion.tsx`
- Modify: `src/renderer/src/pages/Files.tsx`
- Modify: `src/renderer/src/styles/tsinghua.css`

- [ ] **Step 1: Notifications 页 — 删除全局按钮 + 每行 tuto**

在 `Notifications.tsx` 中：

a) 删除顶部工具栏中的全局"甘蔗 Tutor 总结"按钮（搜索 `甘蔗 Tutor 总结` 定位）。

b) 在每条公告渲染的行内添加 tuto 按钮。找到渲染 `filteredNotices` 列表的部分（使用 `List` 组件或 `map`），在每行操作区添加：

```tsx
<Button
  className="lp2-green-button"
  size="small"
  icon={<RobotOutlined />}
  onClick={async () => {
    const plainContent = (notice.content || '').replace(/<[^>]+>/g, ' ')
    const prompt = `请总结以下课程公告：\n标题：${notice.title || ''}\n发布人：${notice.publisher || ''}\n时间：${notice.publishTime || ''}\n内容：${plainContent.slice(0, 3000)}`
    setSummaryLoading(true)
    setSummaryOpen(true)
    setSummaryText('')
    try {
      const result = await window.learn.hwai.tutorAsk(courseId!, prompt)
      setSummaryText(result.content || '总结生成失败')
    } catch (err: any) {
      setSummaryText('总结生成失败：' + (err.message || '未知错误'))
    }
    setSummaryLoading(false)
  }}
>
  甘蔗 Tutor
</Button>
```

c) 保留现有的 summary Modal（`setSummaryOpen`/`summaryText` 等 state 已经在 Notifications 页面中存在）。

d) 删除原来全局 tuto 按钮相关联的 `handleTutorSummary` 函数（如果只被全局按钮使用）。

- [ ] **Step 2: Discussion 页 — 删除全局按钮 + 每行 tuto**

同样操作 Discussion.tsx：

a) 删除顶部全局"甘蔗 Tutor 总结"按钮。

b) 在每条讨论行添加 tuto 按钮（同上模式，prompt 针对讨论内容）。

c) 保留现有 summary Modal。

- [ ] **Step 3: Files 页 — 删除顶部全局按钮，保留右侧面板按钮**

在 `Files.tsx` 中：

a) 删除顶部工具栏 `<Button className="lp2-green-button" icon={<RobotOutlined />} onClick={handleTutorSummary}>甘蔗 Tutor 总结</Button>`。

b) 右侧详情面板中的"甘蔗 Tutor 总结"按钮保留。将其 `onClick` 改为调用新的单文件总结逻辑（Task 4 实现）。

c) 删除 `handleTutorSummary` 函数（如果只被全局按钮使用）。

- [ ] **Step 4: CSS — 绿色 tuto 按钮统一样式**

在 tsinghua.css 末尾追加：
```css
.lp2-green-button {
  background: #f6ffed;
  border: 1px solid #b7eb8f;
  color: #4F8A10;
  border-radius: 10px;
  font-weight: 500;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.lp2-green-button:hover {
  background: #d9f7be;
  border-color: #85ce61;
  color: #3E6E0C;
  transform: scale(1.03);
}
.lp2-green-button:active {
  transform: scale(0.97);
}
```

- [ ] **Step 5: Typecheck 验证**

```bash
npm run typecheck
```

---

### Task 4: 课件单文件总结（格式识别）

**Files:**
- Modify: `src/main/services/tutor.ts`
- Modify: `src/main/ipc/ai.ts`
- Modify: `src/renderer/src/pages/Files.tsx`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/api.d.ts`
- Modify: `src/renderer/src/env.d.ts`

- [ ] **Step 1: 新增 `summarizeSingleFile` 函数**

在 `src/main/services/tutor.ts` 末尾添加：

```ts
import { downloadUrlToBuffer } from './downloader'
import { parseAttachment } from './attachment-parser'
import { complete } from './ai'
import os from 'os'
import path from 'path'
import fs from 'fs'

export async function summarizeSingleFile(file: { name: string; url: string; fileType?: string }): Promise<string> {
  // Download
  const buffer = await downloadUrlToBuffer(file.url)
  const tmpDir = path.join(os.tmpdir(), 'learnpp-tutor-files')
  fs.mkdirSync(tmpDir, { recursive: true })
  const tmpPath = path.join(tmpDir, `${Date.now()}_${file.name}`)
  fs.writeFileSync(tmpPath, buffer)

  try {
    const parsed = await parseAttachment(tmpPath)
    if (!parsed.text.trim()) {
      return `文件 "${file.name}" 无法提取文本内容（可能为扫描版 PDF 或纯图片），请下载后手动查看。`
    }

    const summary = await complete({
      system: '你是 learn++ 的甘蔗 tutor。请用中文总结以下课件内容，输出简洁有条理的摘要，突出关键概念和学习重点。',
      messages: [{
        role: 'user' as const,
        content: `课件名称：${file.name}\n\n课件内容：\n${parsed.text.slice(0, 15000)}\n\n请总结该课件的：\n1. 核心知识点\n2. 重点概念\n3. 学习建议`,
      }],
      maxTokens: 2000,
    })

    // Cleanup
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
    return summary
  } catch (err: any) {
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
    if (err.message?.includes('不支持的文件类型')) {
      return `文件类型 ".${path.extname(file.name)}" 暂不支持内容解析，请下载后手动查看。`
    }
    throw err
  }
}
```

- [ ] **Step 2: 新增 `hwai:summarize-file` IPC handler**

在 `src/main/ipc/ai.ts` 的 `registerAiIpc()` 中添加：

```ts
ipcMain.handle('hwai:summarize-file', async (_e, file: { name: string; url: string; fileType?: string }) => {
  try {
    const content = await summarizeSingleFile(file)
    return { ok: true, content }
  } catch (err) {
    return { ok: false, error: formatError(err) }
  }
})
```

导入 `summarizeSingleFile`：
```ts
import { askTutor, summarizeCourseArea, summarizeSingleFile } from '../services/tutor'
```

- [ ] **Step 3: Preload 三文件同步 — `hwai:summarizeFile`**

在 `src/preload/api.d.ts` 的 `hwai` 接口中添加：
```ts
summarizeFile: (file: { name: string; url: string; fileType?: string }) => Promise<{ ok: boolean; content?: string; error?: string }>
```

在 `src/preload/index.ts` 的 `hwai` 对象中添加：
```ts
summarizeFile: (file: { name: string; url: string; fileType?: string }) =>
  ipcRenderer.invoke('hwai:summarize-file', file),
```

在 `src/renderer/src/env.d.ts` 的 `hwai` 接口中添加同 `api.d.ts` 的方法声明。

- [ ] **Step 4: Files.tsx 右侧面板按钮改为单文件总结**

修改 Files.tsx 中右侧详情面板的"甘蔗 Tutor 总结"按钮的 onClick：

```tsx
async function handleSingleFileSummary() {
  if (!selectedFile) return
  setSummaryOpen(true)
  setSummaryLoading(true)
  setSummaryText('')
  try {
    const result = await window.learn.hwai.summarizeFile({
      name: selectedFile.name,
      url: selectedFile.downloadUrl,
      fileType: selectedFile.fileType,
    })
    if (!result.ok) {
      setSummaryText(result.error || '总结生成失败')
    } else {
      setSummaryText(result.content || '暂无内容')
    }
  } catch (err: any) {
    setSummaryText('总结生成失败：' + (err.message || '未知错误'))
  }
  setSummaryLoading(false)
}
```

按钮的 onClick 从 `handleTutorSummary` 改为 `handleSingleFileSummary`。

- [ ] **Step 5: Typecheck 验证**

```bash
npm run typecheck
```

---

### Task 5: 作业页按钮布局优化

**Files:**
- Modify: `src/renderer/src/pages/Homework.tsx`
- Modify: `src/renderer/src/styles/tsinghua.css`

- [ ] **Step 1: 读取当前 Homework.tsx 中提交按钮和 tutor 按钮的位置**

文件已读。在 rendering 部分找到提交按钮（`hw:submit` 相关）和 tutor 按钮（`甘蔗 Tutor 辅助`）。

- [ ] **Step 2: 修改按钮样式和布局**

在 Homework.tsx 中找到操作按钮区域，tuto 按钮改用 `lp2-green-button` class + 更大尺寸：

```tsx
<Button
  className="lp2-green-button"
  size="large"
  icon={<RobotOutlined />}
  onClick={() => navigate(`/course/${courseId}/homework/auto`)}
>
  甘蔗 Tutor 辅助
</Button>
```

提交按钮也改为 `size="large"`，圆角通过 CSS 全局覆盖。

在 tsinghua.css 末尾追加作业页按钮样式：
```css
.lp2-homework-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.lp2-homework-actions .ant-btn {
  border-radius: 10px;
  font-weight: 500;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.lp2-homework-actions .ant-btn:hover {
  transform: scale(1.03);
}
.lp2-homework-actions .ant-btn:active {
  transform: scale(0.97);
}
```

- [ ] **Step 3: Typecheck 验证**

```bash
npm run typecheck
```

---

### Task 6: 一键完成作业重写 — 风格学习模块

**Files:**
- Create: `src/main/services/homework-style-learner.ts`

- [ ] **Step 1: 创建 homework-style-learner.ts**

```ts
import { withAuth } from './learn'

export interface StyleProfile {
  confidence: number
  patterns: {
    titleFormat: string       // e.g. "第X次作业_姓名_学号" or "HW1_张三"
    usesLatexFormulas: boolean
    usesTables: boolean
    headingHierarchy: string  // e.g. "## → ### → ####" or "一、→ 1. → (1)"
    answerLength: 'brief' | 'moderate' | 'detailed'
    formatNotes: string
  }
  rawSample: string           // truncated sample text for AI context
}

export async function learnStyle(courseId: string, courseName: string): Promise<StyleProfile | null> {
  return withAuth(async (h) => {
    const list = await h.getHomeworkList(courseId)
    const submitted = list.filter((hw: any) => hw.submitted)
    if (submitted.length === 0) return null

    // Try to get detail for the most recent submitted homework
    let sampleText = ''
    let detailFound = false

    for (const hw of submitted.slice(-5).reverse()) {
      try {
        const detail = await h.getHomeworkDetail(hw.id)
        const content = detail?.studentContent || detail?.content || ''
        const plain = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        if (plain.length > 100) {
          sampleText = plain.slice(0, 3000)
          detailFound = true
          break
        }
      } catch { /* try next */ }
    }

    if (!detailFound) return null

    // Analyze patterns heuristically
    const patterns = {
      titleFormat: sampleText.match(/第[一二三四五六七八九十\d]+次/) ? '第X次作业格式'
        : sampleText.match(/HW\d+/i) ? 'HW编号格式'
        : '标准格式',
      usesLatexFormulas: /\$\$|\$|\\begin\{equation\}|\\frac|\\sum/.test(sampleText),
      usesTables: /(\|.+\|[\r\n]+\|[-|]+\|)/.test(sampleText) || /<table/i.test(sampleText),
      headingHierarchy: sampleText.includes('###') ? 'Markdown ## → ###'
        : sampleText.includes('一、') ? '中文数字 → 阿拉伯数字'
        : '段落式',
      answerLength: sampleText.length > 2000 ? 'detailed'
        : sampleText.length > 800 ? 'moderate'
        : 'brief',
      formatNotes: '',
    }

    return {
      confidence: 0.6,
      patterns,
      rawSample: sampleText,
    }
  })
}

export function buildStyleGuide(profile: StyleProfile, fallbackFormat?: string): string {
  const lines: string[] = ['【往期作业风格指南】']
  lines.push(`标题格式：${profile.patterns.titleFormat}`)
  lines.push(`公式环境：${profile.patterns.usesLatexFormulas ? '使用 LaTeX 公式' : '不使用 LaTeX 公式'}`)
  lines.push(`表格使用：${profile.patterns.usesTables ? '频繁使用表格' : '不使用表格'}`)
  lines.push(`层级结构：${profile.patterns.headingHierarchy}`)
  lines.push(`答案长度：${profile.patterns.answerLength === 'detailed' ? '详细展开' : profile.patterns.answerLength === 'moderate' ? '适中' : '简洁'}`)

  if (fallbackFormat) {
    lines.push(`输出格式：${fallbackFormat}`)
  }

  lines.push('\n请严格按照以上风格生成答案，避免长篇大论，只踩采分点。')
  return lines.join('\n')
}
```

- [ ] **Step 2: Typecheck 验证**

```bash
npm run typecheck
```

---

### Task 7: 一键完成作业重写 — 子代理模块

**Files:**
- Create: `src/main/services/homework-subagent.ts`

- [ ] **Step 1: 创建 homework-subagent.ts**

```ts
import { complete } from './ai'
import type { AiMessage } from './ai'

export interface SubAgentInput {
  index: number
  total: number
  questionText: string
  coursewareContext: string
  styleGuide: string
  courseName: string
  homeworkTitle: string
  type: string  // 'text' | 'report' | 'code' | 'lab' | 'ppt' | 'unknown'
}

export interface SubAgentOutput {
  index: number
  content: string
  tokensUsed: number
}

export async function runSubAgent(input: SubAgentInput): Promise<SubAgentOutput> {
  const system = `你在协助一名清华大学本科生完成作业的第 ${input.index}/${input.total} 部分。
课程：${input.courseName}
作业：${input.homeworkTitle}

${input.styleGuide}

${input.coursewareContext ? `【相关课件内容】\n${input.coursewareContext}\n\n优先使用课件中讲过的方法解决问题。` : ''}

输出要求：
- 只回答本部分的题目，不要输出其他部分
- 语言精简，只踩采分点，不写长篇讲义
- 不确定的内容用 [需要学生补充: ...] 标明
- 中文 + 学术语气`

  const messages: AiMessage[] = [
    { role: 'user', content: input.questionText },
  ]

  const startTime = Date.now()
  const content = await complete({ system, messages, maxTokens: 4096 })
  const tokensUsed = Math.ceil(content.length / 2)

  return { index: input.index, content, tokensUsed }
}
```

- [ ] **Step 2: Typecheck 验证**

```bash
npm run typecheck
```

---

### Task 8: 一键完成作业重写 — 审查代理模块

**Files:**
- Create: `src/main/services/homework-reviewer.ts`

- [ ] **Step 1: 创建 homework-reviewer.ts**

```ts
import { complete } from './ai'
import type { AiMessage } from './ai'

export interface ReviewInput {
  homeworkTitle: string
  homeworkDescription: string
  assembledContent: string
  coursewareUsed: string
  styleGuide: string
}

export interface ReviewOutput {
  passed: boolean
  issues: { severity: 'critical' | 'warning' | 'info'; description: string }[]
  correctedContent: string
  needsManualReview: string[]
}

export async function runReview(input: ReviewInput): Promise<ReviewOutput> {
  const system = `你是 learn++ 的甘蔗 Tutor 审查代理。你的任务是审查一份 AI 生成的作业草稿，检查以下方面：

1. 漏题：是否所有题目都回答了
2. 公式/数值：计算结果是否正确、公式是否合理
3. 方法匹配：是否使用了课件中讲过的方法
4. 格式一致：是否符合作业要求的输出格式
5. 人工复核：标记需要学生自行检查的部分

请返回 JSON 格式（不要包含 markdown 代码块标记）：
{
  "passed": true/false,
  "issues": [{ "severity": "critical/warning/info", "description": "..." }],
  "correctedContent": "修正后的完整内容（如果无需修改则返回原文）",
  "needsManualReview": ["需人工复核的具体项1", "项2"]
}`

  const prompt = `作业：${input.homeworkTitle}
作业描述：${input.homworkDescription.slice(0, 2000)}

${input.coursewareUsed ? `参考课件：${input.coursewareUsed.slice(0, 2000)}` : ''}

${input.styleGuide}

待审查草稿：
${input.assembledContent.slice(0, 15000)}

请进行甘蔗 Tutor 审查。`

  const messages: AiMessage[] = [{ role: 'user', content: prompt }]

  try {
    const raw = await complete({ system, messages, maxTokens: 4096 })
    const trimmed = raw.trim()
    const json = JSON.parse(trimmed)
    return {
      passed: !!json.passed,
      issues: json.issues || [],
      correctedContent: json.correctedContent || input.assembledContent,
      needsManualReview: json.needsManualReview || [],
    }
  } catch {
    return {
      passed: true,
      issues: [],
      correctedContent: input.assembledContent,
      needsManualReview: ['审查代理无法完成自动审查，请人工通读全文'],
    }
  }
}
```

- [ ] **Step 2: Typecheck 验证**

```bash
npm run typecheck
```

---

### Task 9: 一键完成作业重写 — 主编排器

**Files:**
- Create: `src/main/services/homework-orchestrator.ts`

- [ ] **Step 1: 创建 homework-orchestrator.ts**

```ts
import { withAuth } from './learn'
import { complete } from './ai'
import { downloadUrlToBuffer } from './downloader'
import { parseAttachment } from './attachment-parser'
import { learnStyle, buildStyleGuide, type StyleProfile } from './homework-style-learner'
import { runSubAgent, type SubAgentOutput } from './homework-subagent'
import { runReview, type ReviewOutput } from './homework-reviewer'
import type { AiMessage } from './ai'
import type { AnalyzedHomework, ParsedAttachment } from '../types'
import os from 'os'
import path from 'path'
import fs from 'fs'

export type OrchestratePhase =
  | 'analyzing'
  | 'learning-style'
  | 'decomposing'
  | { type: 'generating'; current: number; total: number }
  | 'assembling'
  | 'reviewing'
  | 'done'

export interface OrchestrateCallback {
  (chunk: { phase: OrchestratePhase; detail?: string; content?: string }): void
}

export interface OrchestrateRequest {
  analyzed: AnalyzedHomework
  sessionId: string
  outputFormat?: string  // 'latex' | 'docx' | 'pdf'
  signal?: AbortSignal
  onProgress: OrchestrateCallback
}

export interface OrchestrateResult {
  contentMarkdown: string
  review: ReviewOutput | null
  styleProfile: StyleProfile | null
}

export async function orchestrate(req: OrchestrateRequest): Promise<OrchestrateResult> {
  const { analyzed, signal, onProgress } = req

  // Phase 1: Analyze course materials
  onProgress({ phase: 'analyzing', detail: '扫描课件和课程资料...' })
  const coursewareText = await matchCourseware(analyzed, signal)

  // Phase 2: Learn style
  onProgress({ phase: 'learning-style', detail: '学习往期作业风格...' })
  let styleProfile: StyleProfile | null = null
  try {
    styleProfile = await learnStyle(analyzed.hw.courseId, analyzed.hw.courseName || '')
  } catch { /* best-effort */ }
  const styleGuide = styleProfile
    ? buildStyleGuide(styleProfile, req.outputFormat)
    : `使用${req.outputFormat || '标准学术'}格式输出。`

  // Phase 3: Decompose
  onProgress({ phase: 'decomposing', detail: '分析题目结构...' })
  const questions = await decomposeHomework(analyzed, coursewareText, styleGuide, signal)
  if (questions.length === 0) {
    // Single piece
    questions.push({
      index: 1, total: 1,
      questionText: `${analyzed.hw.title}\n\n${analyzed.hw.description || ''}`,
      coursewareContext: coursewareText,
    })
  }

  // Phase 4: Parallel sub-agents
  const subResults: SubAgentOutput[] = await Promise.all(
    questions.map(async (q) => {
      if (signal?.aborted) throw new Error('Aborted')
      onProgress({ phase: { type: 'generating', current: q.index, total: questions.length }, detail: `生成第 ${q.index}/${questions.length} 部分...` })
      return runSubAgent({
        index: q.index,
        total: q.total,
        questionText: q.questionText,
        coursewareContext: q.coursewareContext,
        styleGuide,
        courseName: analyzed.hw.courseName || '',
        homeworkTitle: analyzed.hw.title || '',
        type: analyzed.type,
      })
    })
  )

  // Sort by index
  subResults.sort((a, b) => a.index - b.index)

  // Phase 5: Assemble
  onProgress({ phase: 'assembling', detail: '组装答案...' })
  const assembled = await assembleResults(analyzed, subResults, styleGuide, signal)

  // Phase 6: Review
  onProgress({ phase: 'reviewing', detail: '甘蔗 Tutor 审查中...' })
  let review: ReviewOutput | null = null
  try {
    review = await runReview({
      homeworkTitle: analyzed.hw.title || '',
      homeworkDescription: analyzed.hw.description || '',
      assembledContent: assembled,
      coursewareUsed: coursewareText,
      styleGuide,
    })
  } catch { /* best-effort */ }

  onProgress({ phase: 'done', detail: '完成', content: review?.correctedContent || assembled })
  return { contentMarkdown: review?.correctedContent || assembled, review, styleProfile }
}

// ── Courseware matching ──

async function matchCourseware(analyzed: AnalyzedHomework, signal?: AbortSignal): Promise<string> {
  return withAuth(async (h) => {
    const files = await h.getFileList(analyzed.hw.courseId)
    if (!files.length) return ''

    const hwText = `${analyzed.hw.title || ''} ${analyzed.hw.description || ''}`.toLowerCase()
    const keywords = hwText.replace(/[^一-龥a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 1)
    if (keywords.length === 0) return ''

    // Score files by keyword match
    const scored = files
      .filter((f: any) => {
        const ext = (f.fileType || '').toLowerCase()
        return ['.pdf', '.pptx', '.ppt', '.docx', '.doc', '.txt', '.md'].some(e => ext === e || (f.name || '').toLowerCase().endsWith(e))
      })
      .map((f: any) => {
        const name = (f.title || f.name || '').toLowerCase()
        const score = keywords.filter(k => name.includes(k)).length
        return { file: f, score }
      })
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

    if (scored.length === 0) return ''

    const parts: string[] = []
    for (const { file } of scored) {
      if (signal?.aborted) break
      try {
        const url = file.downloadUrl || file.url
        if (!url) continue
        const buf = await downloadUrlToBuffer(url)
        const tmp = path.join(os.tmpdir(), `learnpp-match-${Date.now()}-${file.name || 'file'}`)
        fs.mkdirSync(path.dirname(tmp), { recursive: true })
        fs.writeFileSync(tmp, buf)
        const parsed = await parseAttachment(tmp)
        try { fs.unlinkSync(tmp) } catch { /* ignore */ }
        if (parsed.text.trim()) {
          parts.push(`【课件：${file.title || file.name}】\n${parsed.text.slice(0, 3000)}`)
        }
      } catch { /* skip this file */ }
    }

    return parts.join('\n\n')
  })
}

// ── Decomposition ──

async function decomposeHomework(
  analyzed: AnalyzedHomework,
  coursewareText: string,
  styleGuide: string,
  signal?: AbortSignal,
): Promise<{ index: number; total: number; questionText: string; coursewareContext: string }[]> {
  const prompt = `请分析以下作业，判断是否可以按题目或实验模块拆分。

作业标题：${analyzed.hw.title || ''}
作业描述：${analyzed.hw.description || ''}

如果可以拆分，请返回 JSON 数组（不要写 markdown 代码块标记）：
[
  { "index": 1, "questionText": "第1题完整题面（含题干数据）", "coursewareContext": "匹配的课件内容摘录" },
  ...
]

如果无法拆分（只有一道大题或各题高度耦合），返回空数组 []。`

  try {
    const raw = await complete({
      system: '你是一个作业分析助手。只返回 JSON 数组，不写其他文字。',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2000,
    })
    const trimmed = raw.trim()
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed) && parsed.length > 0) {
      const total = parsed.length
      return parsed.map((q: any) => ({
        index: q.index || 1,
        total,
        questionText: q.questionText || `${analyzed.hw.title}\n${analyzed.hw.description}`,
        coursewareContext: q.coursewareContext || coursewareText,
      }))
    }
  } catch { /* fall through */ }

  return []
}

// ── Assembly ──

async function assembleResults(
  analyzed: AnalyzedHomework,
  subResults: SubAgentOutput[],
  styleGuide: string,
  signal?: AbortSignal,
): Promise<string> {
  if (subResults.length <= 1) return subResults[0]?.content || ''

  const parts = subResults.map(r => `### 第 ${r.index} 部分\n\n${r.content}`).join('\n\n---\n\n')

  const prompt = `请将以下按题目拆分生成的各部分答案合并为一份完整的作业草稿。
统一标题层级、编号格式、参考文献位置。保持内容不变，只做格式统一。

${styleGuide}

各部分内容：
${parts}`

  try {
    const assembled = await complete({
      system: '你是作业格式整理助手。只做格式统一，不改变内容。直接输出整理后的完整答案。',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 6000,
    })
    return assembled
  } catch {
    return parts
  }
}
```

- [ ] **Step 2: Typecheck 验证**

```bash
npm run typecheck
```

---

### Task 10: 一键完成作业重写 — IPC 与 Preload 同步

**Files:**
- Modify: `src/main/ipc/ai.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/api.d.ts`
- Modify: `src/renderer/src/env.d.ts`

- [ ] **Step 1: 新增 `hwai:orchestrate` IPC handler**

在 `src/main/ipc/ai.ts` 中添加 import：
```ts
import { orchestrate } from '../services/homework-orchestrator'
```

在 `registerAiIpc()` 中添加 handler：
```ts
ipcMain.handle('hwai:orchestrate', async (event, req: any) => {
  const { analyzed, sessionId, outputFormat } = req
  const sender = event.sender
  const win = BrowserWindow.fromWebContents(sender)

  // Create abort controller
  const ctrl = new AbortController()
  abortControllers.set(sessionId, ctrl)

  try {
    const result = await orchestrate({
      analyzed,
      sessionId,
      outputFormat,
      signal: ctrl.signal,
      onProgress: (chunk) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('hwai:orchestrate-chunk', { sessionId, ...chunk })
        }
      },
    })

    if (win && !win.isDestroyed()) {
      win.webContents.send('hwai:orchestrate-end', { sessionId, result })
    }

    return { ok: true, result }
  } catch (err: any) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('hwai:orchestrate-end', { sessionId, error: formatError(err) })
    }
    return { ok: false, error: formatError(err) }
  } finally {
    abortControllers.delete(sessionId)
  }
})
```

- [ ] **Step 2: Preload 三文件同步**

在 `src/preload/api.d.ts` 的 `hwai` 接口中添加：
```ts
orchestrate: (params: { analyzed: any; sessionId: string; outputFormat?: string }) => Promise<{ ok: boolean; result?: any; error?: string }>
onOrchestrateChunk: (cb: (data: { sessionId: string; phase: any; detail?: string; content?: string }) => void) => () => void
onOrchestrateEnd: (cb: (data: { sessionId: string; result?: any; error?: string }) => void) => () => void
```

在 `src/preload/index.ts` 的 `hwai` 对象中添加：
```ts
orchestrate: (params: any) => ipcRenderer.invoke('hwai:orchestrate', params),
onOrchestrateChunk: (cb: any) => {
  const handler = (_e: any, data: any) => cb(data)
  ipcRenderer.on('hwai:orchestrate-chunk', handler)
  return () => ipcRenderer.removeListener('hwai:orchestrate-chunk', handler)
},
onOrchestrateEnd: (cb: any) => {
  const handler = (_e: any, data: any) => cb(data)
  ipcRenderer.on('hwai:orchestrate-end', handler)
  return () => ipcRenderer.removeListener('hwai:orchestrate-end', handler)
},
```

在 `src/renderer/src/env.d.ts` 的 `hwai` 接口中添加同 `api.d.ts` 的方法声明。

- [ ] **Step 3: Typecheck 验证**

```bash
npm run typecheck
```

---

### Task 11: 一键完成作业重写 — Renderer 改动

**Files:**
- Modify: `src/renderer/src/pages/HomeworkAutoComplete.tsx`
- Modify: `src/renderer/src/styles/tsinghua.css`

- [ ] **Step 1: 重写 handleSelect 使用新流水线**

修改 `HomeworkAutoComplete.tsx` 中的 `handleSelect` 函数：

```tsx
async function handleSelect(hw: ScanItem) {
  setSelectedHw(hw)
  setView('review')

  try {
    const analysis = await window.learn.hwai.analyze(courseId!, hw.homeworkId)
    setAnalyzed(analysis)

    // Start orchestration
    setGenerating(true)
    clearStreamText()
    setOrchestratePhase('analyzing')

    const result = await window.learn.hwai.orchestrate({
      analyzed: analysis,
      sessionId: `orch-${Date.now()}`,
    })

    if (!result.ok) {
      message.error(result.error || '生成失败')
      setGenerating(false)
      return
    }

    setDraft(result.result.contentMarkdown)
    setReviewOutput(result.result.review)
    setStyleProfile(result.result.styleProfile)

    // Build attachment if applicable
    if (analysis.suggestedOutputs?.includes('docx')) {
      const ar = await window.learn.hwai.buildAttachment(
        { kind: 'docx', filename: `${hw.title || 'homework'}.docx` },
        result.result.contentMarkdown,
      )
      if (ar.tempPath) setAttachmentPath(ar.tempPath)
    }

    setGenerating(false)
  } catch (err) {
    message.error(`AI 处理失败: ${err}`)
    setGenerating(false)
  }
}
```

- [ ] **Step 2: 添加可选的实时进度监听**

新增 state：
```tsx
const [orchestratePhase, setOrchestratePhase] = useState<string>('')
const [reviewOutput, setReviewOutput] = useState<any>(null)
const [styleProfile, setStyleProfile] = useState<any>(null)
const [styleFallback, setStyleFallback] = useState(false)
```

在生成中显示当前阶段：
```tsx
{generating && (
  <Card style={{ textAlign: 'center', padding: 40 }}>
    <Spin size="large" />
    <div style={{ marginTop: 16 }}>
      <RobotOutlined style={{ fontSize: 32, color: '#52C41A' }} />
      <div style={{ marginTop: 12, color: '#888' }}>
        {orchestratePhase === 'analyzing' && '正在扫描课件和课程资料...'}
        {orchestratePhase === 'learning-style' && '正在学习往期作业风格...'}
        {orchestratePhase === 'decomposing' && '正在分析题目结构...'}
        {orchestratePhase.startsWith?.('generating') && orchestratePhase}
        {orchestratePhase === 'assembling' && '正在组装答案...'}
        {orchestratePhase === 'reviewing' && '甘蔗 Tutor 正在审查草稿...'}
      </div>
    </div>
  </Card>
)}
```

- [ ] **Step 3: 风格缺失降级 UI**

在 `handleSelect` 中，如果 `styleProfile` 为 null（学不到风格），设置 `setStyleFallback(true)`。

在 review 视图中，当 `styleFallback` 且 `!draft` 已生成完成时，显示 Alert：

```tsx
{styleFallback && draft && !generating && (
  <Alert
    type="info"
    message="无法识别该课程往期作业风格（可能首次提交或历史作业不可访问），已使用标准学术格式生成。"
    style={{ marginBottom: 16 }}
    action={
      <Space>
        <Button size="small" onClick={() => handleRegenerateWithFormat('latex')}>LaTeX 格式</Button>
        <Button size="small" onClick={() => handleRegenerateWithFormat('docx')}>DOCX 格式</Button>
        <Button size="small" onClick={() => handleRegenerateWithFormat('pdf')}>PDF 格式</Button>
      </Space>
    }
  />
)}
```

添加 `handleRegenerateWithFormat` 函数（可选格式重新生成）。如果用户选择了不同格式，重新调 `orchestrate` 传 `outputFormat`。

- [ ] **Step 4: 审查结果显示**

在草稿预览下方显示审查结果：

```tsx
{reviewOutput && !generating && (
  <Card
    size="small"
    title="甘蔗 Tutor 审查结果"
    style={{ marginTop: 16 }}
    extra={reviewOutput.passed
      ? <Tag color="green">通过</Tag>
      : <Tag color="orange">需关注</Tag>
    }
  >
    {reviewOutput.issues.length > 0 && (
      <div>
        {reviewOutput.issues.map((issue: any, i: number) => (
          <Alert
            key={i}
            type={issue.severity === 'critical' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info'}
            message={issue.description}
            style={{ marginBottom: 8 }}
            showIcon
          />
        ))}
      </div>
    )}
    {reviewOutput.needsManualReview.length > 0 && (
      <div style={{ marginTop: 12 }}>
        <strong>需人工复核：</strong>
        <ul>
          {reviewOutput.needsManualReview.map((item: string, i: number) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>
    )}
  </Card>
)}
```

- [ ] **Step 5: Typecheck 验证**

```bash
npm run typecheck
```

---

### Task 12: 最终集成测试与打包

- [ ] **Step 1: 清理旧进程**

```powershell
Stop-Process -Name "learn++" -Force -ErrorAction SilentlyContinue
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Build**

```bash
npm run build
```

- [ ] **Step 4: Package**

```bash
npm run package:dir
npm run package
```

- [ ] **Step 5: 验证产物**

```powershell
Get-ChildItem "dist-installer\win-unpacked\learn++.exe" | Select-Object Name, LastWriteTime
Get-ChildItem "dist-installer\learn++ Setup 2.0.0.exe" | Select-Object Name, LastWriteTime
```

---

## 实施顺序

Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9 → Task 10 → Task 11 → Task 12

Tasks 1-5 可以并行（互不依赖），Tasks 6-11 有依赖链（6→9 依赖 6/7/8，10→11 依赖 9/10），Task 12 最后串行。
