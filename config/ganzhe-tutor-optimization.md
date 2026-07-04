# 甘蔗 Tutor 专项优化设计

## 背景

v2.0 甘蔗 Tutor 已具备基础聊天、工具调用、一键完成作业能力，但需系统性优化：
状态检测、UI 精简、一键完成作业重写（多代理并行）、全局辅助能力增强、课件总结格式识别、全局按钮收敛、作业页按钮优化。

## 1. 在线/离线状态检测

- Tutor 页挂载时调 IPC `hwai:health-check`
- 主进程用当前 AI 配置发极短 API 请求（`max_tokens=1`）
- 返回 `{ ok: boolean }`
- 离线：显示灰色 Tag + Modal 提示检查 API Key 和网络
- 每次打开页面重新检测

文件：`src/main/ipc/ai.ts`（新增 handler）、`src/renderer/src/pages/Tutor.tsx`

## 2. Tutor 页 UI 清理

- 移除右侧 `aside.lp2-ai-side-panel`（profile 卡片 + 可用功能列表 + 注意事项）
- 聊天面板 `flex: 1` 全宽
- 按钮重构：圆角 10px、hover scale(1.03) + 阴影、active scale(0.97)、`transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1)`
- 发送按钮紫色渐变，停止红色 outline，新对话灰色 outline

文件：`src/renderer/src/pages/Tutor.tsx`、`src/renderer/src/styles/tsinghua.css`

## 3. 一键完成作业重写（核心）

### 架构

新增 4 个文件：

```
src/main/services/
  homework-orchestrator.ts   —— 主调度：拆题、派发子代理、组装、触发审查
  homework-subagent.ts       —— 单题/单模块子代理
  homework-reviewer.ts       —— 甘蔗 Tutor 审查代理
  homework-style-learner.ts  —— 往期风格学习
```

### 7 步流水线

| 步骤 | 文件 | 职责 |
|------|------|------|
| scan | homework-ai.ts | 列出未提交作业（不变） |
| analyze+ | homework-ai.ts | 下载附件 + 扫描课件/代码/往期提交 |
| style-learn | homework-style-learner.ts | 抓取已批阅作业 → 提取格式特征 → 风格描述 |
| decompose | homework-orchestrator.ts | 主 AI 审题 → 按题目/模块拆分 → 匹配课件片段 |
| parallel | homework-subagent.ts | N 道题 N 个并行 AI 调用 |
| assemble | homework-orchestrator.ts | 主 AI 合并子代理结果 |
| review | homework-reviewer.ts | 甘蔗 Tutor 视角：漏题、公式、方法、人工复核点 |

### 课件匹配

- 按文件名关键词（章节号、主题词）与作业标题/描述匹配
- 匹配到的课件下载解析 → 子代理优先使用课上方法
- matchCourseware() 放在 orchestrator

### 风格学习

- `withAuth` → `getHomeworkList(courseId)` 过滤已批阅项
- 提取：标题命名、段落结构、公式环境、表格用法、答案长度
- 若学堂不提供往期提交 API → 返回 null

### 风格缺失降级

- 前端弹 Alert 提示无法识别风格
- 用户可选 LaTeX / DOCX / PDF 标准格式

### IPC

| channel | 方向 | 用途 |
|---------|------|------|
| hwai:orchestrate | renderer→main | 启动流水线 |
| hwai:orchestrate-chunk | main→renderer | 进度事件（phase: analyzing→learning-style→decomposing→generating(N/M)→assembling→reviewing→done） |

文件：`src/main/ipc/ai.ts`、`src/preload/index.ts`、`src/preload/api.d.ts`、`src/renderer/src/env.d.ts`

### Renderer

`HomeworkAutoComplete.tsx`：analyze → orchestrate（流式进度）→ 结果 + 审查批注
进度 UI：阶段标签 + 非线性动画过渡

## 4. 课件总结格式识别

- 改为单文件总结（选中课件后右侧面板触发）
- 新增 IPC `hwai:summarize-file`
- 流程：下载 → parseAttachment 解析 → AI 总结
- 已下载文件直接读本地
- 不支持格式降级提示

文件：`src/main/ipc/ai.ts`、`src/main/services/tutor.ts`、`src/renderer/src/pages/Files.tsx`

## 5. 取消全局 Tutor 按钮

| 页面 | 改动 |
|------|------|
| Notifications | 删除顶部全局按钮，每条公告行末加 tuto 按钮 |
| Discussion | 删除顶部全局按钮，每条讨论行末加 tuto 按钮 |
| Files | 删除顶部全局按钮，保留右侧详情面板按钮（改为单文件总结） |

每行 tuto 按钮：浅绿底、RobotOutlined、"甘蔗 Tutor"、圆角 10px
点击提取该条目内容 → tutorAsk 生成定向总结 → Modal 展示

文件：`src/renderer/src/pages/Notifications.tsx`、`src/renderer/src/pages/Discussion.tsx`、`src/renderer/src/pages/Files.tsx`

## 6. 作业页按钮优化

- 提交按钮和 tuto 按钮加大、圆角 10px
- tutor 按钮统一浅绿色底绿色文字（`className="lp2-green-button"`）
- 两按钮间距适当增加

文件：`src/renderer/src/pages/Homework.tsx`、`src/renderer/src/styles/tsinghua.css`

## 7. 全局辅助能力（验证现有）

tutor-agent.ts + tutor-prompts.ts 已有 12 个工具，覆盖课程/作业/邮件/课件/公告/讨论/搜索/统计。本次确认可用即可，不新增工具。

## 实施顺序

1. Status & UI Cleanup（1+2）
2. Remove global buttons + per-item tutor（5）+ Homework buttons（6）
3. Files tutor summary format parsing（4）
4. Homework auto-complete rewrite（3）+ IPC sync（3 files）

---

## 2026-07-03 甘蔗 Tutor 专项：全栈融入 + 无界化（P1+P2 一次落地）

### 后端：三层融入架构

1. **上下文自动感知**：`tutor:chat` 新增 `pageContext` 参数（label/courseId/courseName/itemTitle/itemExcerpt），注入 system prompt（tutor-prompts.ts 重写，含"用户说'这个'指当前对象"指引）。renderer 经 store/tutor.ts 的 context 字段传递。
2. **工具面从 12 个扩到 19 个**（tutor-agent.ts TOOLS + ipc/ai.ts 执行器）：
   - get_file_content（下载+attachment-parser 解析课件全文）
   - get_homework_detail（复用 homework-ai.analyze：要求全文+附件解析+状态）
   - get_notice_detail（公告全文）
   - list_deadlines（**直接读 dashboard 磁盘缓存，毫秒级**）
   - add_focus_item（写入 focus-store，type 扩展为 email|custom）
   - draft_mail（生成邮件草稿，绝不发送）
   - navigate_to（renderer 拦截 tool_call 渲染跳转卡片，主进程零副作用）
   安全边界：唯一写操作是 add_focus_item；发信/交作业永不给 Agent。
3. **对话工程**：历史裁剪（>12 条只带最近 12）；MAX_LOOPS 5→8（工具变多）；新增 hwai:draft-mail 直连 IPC 供写信页使用。

### 前端：无界化 + 融入入口

- Tutor 页重写（Tutor.tsx + store/tutor.ts）：
  - **会话持久化**（zustand persist，最多 10 个会话）+ 顶部会话栏（历史下拉/切换/删除 + 新对话）——A4 收尾
  - **空状态**：居中头像 + 欢迎语 + 2×2 引导卡片（本周要交什么/解释概念/练习题/复习计划）
  - 消息气泡去边框；快捷 chips 无界填充；工具调用改为脉冲小点状态线（不再占假气泡）
  - **navigate_to 跳转卡片**（绿色系，点击直达课程 tab/邮箱/首页）
  - 上下文 chip（显示来源页面上下文，可一键移除）
  - "仅供参考"从每条回复尾部改为输入框下固定一行
  - 输入栏左侧按钮改为"今日简报"（时钟图标）
- 融入入口：
  - 课程顶栏空置的 stats 占位槽改为绿色"问甘蔗"按钮（带课程上下文跳 Tutor）
  - 首页 Tutor 卡片新增"今日简报"按钮（pendingPrompt 机制，进入 Tutor 自动发送）
  - 作业详情页新增"问甘蔗这道题"（携带标题+要求节选）
  - 写信页新增"甘蔗代笔"（正文要点→完整草稿，hwai:draft-mail）
- CSS 全部为 pass 4 末尾追加块

### 结果

- typecheck 通过；preload/api.d.ts/env.d.ts 三处同步（tutorChat pageContext + draftMail）
- 已知取舍：邮箱列表态顶栏为 5 列定宽网格，未塞"问甘蔗"（邮件详情已有 Tutor 总结入口）

### 2026-07-03 补丁：工具调用卡死根因修复 + 顶栏按钮叠加修复

1. **根因（DeepSeek/OpenAI 严格协议）**：流式增量累积出的 tool_call 缺少 `type:"function"` 字段，回传 assistant.tool_calls 时被 DeepSeek 400 拒绝 → 第二轮请求必失败。修复：ai-client buildOpenAiBody 与 agent loop 双侧补全 type 字段。
2. **错误静默链**：agent loop 返回 finishReason:'error' 时 handler 走成功路径、renderer 忽略返回值并删除空占位 → 一切失败表现为"卡住无回复"。修复：错误直接写入聊天流（⚠️ 前缀）+ generate-end 携带 error + renderer 将空占位替换为错误说明 + electron-log 记录。
3. **超时兜底**：工具执行 30s 超时（Promise.race）、aiCall 请求 180s 超时（AbortSignal.any）。
4. **顶栏按钮叠加**：问甘蔗按钮误复用 lp2-context-stats 容器，历史规则把 Button 内部两个 span 各渲染成 112×68 统计卡。修复：slot 独立类 + 防御性 span 重置。
5. 输入栏简化为 [输入框][发送] 两列（时钟简报按钮移除，快捷 chips 已有"今日简报"）。

---

## 2026-07-04 甘蔗 Tutor 第二批：PDF 修复 / 总结抽屉化+持久化 / 一键作业重设计 / Markdown 表格 / 动画节流

### 1. PDF 总结失败根因修复
pdf-parse 包入口 index.js 在打包环境下 `module.parent` 为空会误判 debug 模式，启动即读取包内测试 PDF 而 ENOENT → 所有 PDF 解析失败。修复：`import('pdf-parse/lib/pdf-parse.js')` 绕过入口直取实现。

### 2. 总结全面抽屉化 + 持久化（告别弹窗）
- 新组件 `TutorSummaryDrawer`（480px 右侧抽屉，绿色标题，流式渲染，"重新生成"按钮）
- 新 store `store/summaries.ts`（zustand persist，键→{content, createdAt}，上限 60 条 LRU）
- **同一对象的总结持久保存，重开直接显示，不再重新生成**（重启也在）
- 接入四处：课件总结（Files）、公告总结（Notifications）、讨论总结（Discussion，改为按条总结带标题）、邮件总结（Mailbox）
- 键规范：file:{课程}:{文件} / notices:{课程}:{数量} / discussion:{课程}:{id} / mail:{id}

### 3. 一键完成作业重设计
- 移除页头的甘蔗大卡片（总结公告/课件/讨论/作业答疑与各 tab 抽屉重复）及其 Modal/函数/状态
- 扫描卡片改无界样式（浅紫填充圆角卡：标题/类型 Tag/截止时间；紧急橙色、逾期中性；修复空 courseName Tag 渲染成灰色小横杠的 bug）
- **附件优先提交**：非代码作业一律生成 DOCX 附件；正文编辑过或附件缺失时提交前用最新草稿重建；文本框只填"详见附件。"——符合常规提交习惯，不再把全文塞进文本框

### 4. MarkdownRenderer 支持 GFM 表格与分割线
表格（含分隔行识别、th/td、横向滚动容器）+ `---` 水平线。修复 Tutor 输出表格时竖线文字碎屏的问题。

### 5. 动画节流
AppShell 监听路由变化：10 秒内连续导航加 body.lp2-anim-quiet 类禁用进场/级联动画，间隔超过 10 秒才重播。hover/按压微反馈不受影响。

---

## 2026-07-04 课件/附件解析根因修复（用 3 个真实课件文件本地验证）

### 真正根因：扩展名丢失（不是 pdf-parse）

网络学堂课件的 title 不带扩展名（如"水文观测方法集研究进展"），summarizeSingleFile 用 `${Date.now()}_${file.name}` 建临时文件也就无扩展名，parseAttachment 靠 `path.extname` 判类型时拿到空串 → 落 default 分支 → 返回空文本 → 报"无法提取（扫描版）"。DOCX/PPTX 同因失败，印证用户"其他格式也不行"。

### 修复（两层）

1. **tutor.ts**：用 `file.fileType` 给临时文件补回扩展名（主路径）
2. **attachment-parser.ts 重写**：
   - 扩展名缺失时用 magic-byte 文件头嗅探（%PDF / PK-zip / OLE）兜底判类型
   - office 类无扩展名时复制成 .docx 临时副本再交 officeparser（其依赖扩展名）
   - pdf 用 `pdf-parse/lib/pdf-parse.js` 绕过入口 debug 误判
   - 支持 .ppt/.xls/.xlsx/.doc（原仅 .pptx）
   - 40MB 上限保护：超大/损坏文件返回 OVERSIZED 而非误导性"扫描版"提示，避免 OOM

### 本地实测（去扩展名，模拟课件 title）

- PDF「水文观测方法集研究进展.pdf」（截图报错的原文件）：嗅探=pdf，提取 **7764 字符**，中文正常 ✓
- DOCX：mammoth 提取 **7881 字符** ✓
- PPTX 样本为 107MB 且末尾 70KB 无 zip EOCD → 判定为**截断/损坏的超大文件**，非解析器缺陷；现由 40MB 上限给出明确提示

### 遗留观察（未处理）

那个 107MB pptx 磁盘文件（下载功能所下）缺 EOCD，疑似 downloader 对超大文件截断或源文件本身损坏。若后续用户反馈大课件下载打不开，需查 downloader.ts 的 downloadFile 是否有大小/超时截断。
