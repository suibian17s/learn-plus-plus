# learn++ 2.0 全面交接指南

> 写给完全没有接触过本项目的开发者 / AI agent。读完本文即可上手。
> 本文初写于 2026-07-02（全量源码审查 + 清华邮箱服务器实测），**2026-07-04 全面更新**以反映连续多轮开发的最终状态。
> 阅读顺序建议：**先读第 10 节（2026-07-03～04 会话进展总账，当前状态以它为准）** → 本文第 1–3 节（架构） → `CLAUDE.md`（维护铁律） → `config/` 下相关主题的维护记录。
> 第 5 节的问题清单（A1–C3）是**问题的原始分析档案**，多数已修复；每条的当前状态见第 10.1 节的对照表，不要再按第 5 节的"未修"字样行动。
> **动邮箱模块前必读第 8 节**（路线裁决 + 踩坑史，两条已废弃路线不要重走）。

> ⚠️ **当前状态一句话**：`npm run typecheck` 通过；安装包可正常构建（`dist-installer/learn++ Setup 2.0.0.exe`）；邮箱、甘蔗 Tutor、首页、作业、课件、下载均已完成多轮修复达到可用状态；剩余未做项集中在"死代码清理 / CSS 模块化 / 邮件 UID 增量同步 / 全局搜索邮件索引"等（见第 10.3 节）。

---

## 1. 项目是什么

learn++ 是清华网络学堂的第三方 Windows 桌面客户端，基于 **Electron 31 + React 18 + TypeScript 5 + Ant Design 5**，通过 `thu-learn-lib` 访问网络学堂数据。当前版本 2.0.0，**处于开发中状态，尚未达到可发布质量**（详见第 5 节问题清单）。

核心功能面：

- **课程工作台**：公告 / 课件 / 作业 / 讨论 / 问卷，多账号切换（官方网页登录，保存 cookies 快照）
- **首页 Dashboard**：学习进度、今日重点、课程进度、最近更新（由主进程 `stats.ts` 计算）
- **邮箱**：IMAP/SMTP 连接清华邮箱（`mails.tsinghua.edu.cn`），收发、星标、删除、回复、转发
- **甘蔗 Tutor**：全局唯一的内置 AI 助手（不是独立产品），支持多轮对话 + 工具调用（查课程/作业/邮件等 12 个工具）、公告/课件/讨论/邮件总结、作业草稿生成流水线（拆题 → 并行子代理 → 组装 → 审查）
- **下载管理**：Node http/https 手动下载（不用 Electron downloadURL，规避中文 Cookie/响应头问题）
- **桌面体验**：无边框自绘圆角窗口、自绘窗口控制按钮、托盘常驻、开机自启

## 2. 快速上手

```bash
npm install
npm run dev              # electron-vite 开发模式
npm run typecheck        # ✅ 当前通过（提交前硬门槛）
npm run build
npm run package:dir      # dist-installer/win-unpacked/
npm run package          # dist-installer/learn++ Setup 2.0.0.exe
```

打包时若 DLL 被占用（`remove ... d3dcompiler_47.dll: Access is denied`），是旧版 learn++ 实例还在运行占用文件——先 `Get-Process "learn++" | Stop-Process -Force` 再打包。**注意**：单实例锁（B15）已加，正常运行下不会有多实例；但开发期反复启动的残留进程仍可能占用，打包脚本建议前置一步杀进程（本项目所有打包都这么做的）。

## 3. 架构速览

### 3.1 进程与目录

```text
src/main/
  index.ts              入口：窗口、托盘、session 保活(10min)、崩溃恢复、自动登录、统计计时
  ipc/                  auth / courses / files / homework / discussion / notifications
                        settings / ai / app / stats / mail  —— 所有 renderer 能力都走这里
  services/
    learn.ts            登录态、Cookie 清洗、thu-learn-lib 适配核心（最重要的文件）
    session-store.ts    凭据、多账号档案(accounts.enc)、会话持久化
    browser-login.ts    官方网页登录窗口
    downloader.ts       带 Cookie 的下载通道；✅ 已加 Content-Length 完整性校验（截断即报错）
    ai-client.ts        ✅【统一 AI 客户端，C1 落地】唯一的 AI 调用层：读设置→按 apiFormat 构造
                        规范请求（OpenAI/Anthropic 工具协议、tool_calls 补 type 字段）→带缓冲 SSE
                        解析→AbortController+请求超时。complete/runAgentLoop/健康检查都消费它
    ai.ts               complete() 及包装，现委托给 ai-client（不再是重复实现）
    tutor-agent.ts      Tutor 工具定义(TOOLS，现 19 个) + agent loop（协议无关；工具 30s 超时）
    tutor.ts            公告/课件/讨论总结、askTutor、单文件总结 summarizeSingleFile、
                        课件追问 askAboutFile；含课件文本缓存 extractFileText（by url，30min）
    tutor-prompts.ts    Tutor 系统提示词（cute/serious；含 pageContext 上下文注入）
    homework-ai.ts      作业扫描/分析/生成（scan/analyze/generate/buildAttachment）
    homework-orchestrator.ts  作业生成流水线：匹配课件→学风格→拆题→并行子代理(限并发)→组装→审查
    homework-subagent.ts / homework-reviewer.ts / homework-style-learner.ts
    mail-imap.ts        node-imap + mailparser + nodemailer；连接保活(keepalive)、断线监听、
                        MOVE+expunge 删除、APPEND 已发送、UNSEEN 计数、搜索、cleanupMailTemp
    mail-service.ts     邮件统一层：ensureMailConnection 自动重连、按文件夹列表缓存、详情缓存、
                        两级搜索 searchMail ⚠️ 仍含约 800 行已弃用网页 DOM 抓取死代码（A6，待删）
    office-converter.ts Office→PDF COM 转换（课件预览）✅ 已按 Word/PPT/Excel 分别生成正确脚本
    search-index.ts     全局搜索倒排索引 ✅ 课程/作业/公告/讨论已入索引；⚠️ 邮件索引仍缺（A1 残留）
    stats.ts            学习时长(powerMonitor 真实活跃)/连续天数/课程进度；computeDashboard、getStatsForAI
    focus-store.ts      ✅【A2 落地】首页"今日重点"手动项持久化（focus-items.json）
    secret-store.ts     API Key + 邮箱密码加密存储（safeStorage）；provider 命名空间隔离，禁 fallback
    attachment-parser.ts  ✅ PDF/DOCX/PPT/XLS 解析：扩展名判断 + magic-byte 文件头嗅探兜底 +
                          40MB 上限保护；PDF 走 pdf-parse/lib 绕过入口 debug 误判
    attachment-builder.ts  DOCX/PDF 生成（一键作业附件）
src/preload/index.ts    contextBridge 暴露 window.learn.*
src/preload/api.d.ts    preload API 类型
src/renderer/src/
  env.d.ts              renderer 侧 window.learn 类型（与上面两个文件必须三处同步！）
  components/           AppShell（外壳+侧栏+顶栏+全局搜索+动画节流）、WindowControls、
                        MarkdownRenderer（✅ 支持表格/分割线/KaTeX 公式，含 $货币$ 保护）、
                        TutorSummaryDrawer（✅ 总结抽屉：持久缓存+重新生成+课件追问对话）、
                        CourseIcon、EmptyState、HomeworkPreview、RiskDisclaimerModal
  pages/                Login / Dashboard / Mailbox / Tutor / Files / Notifications / Homework /
                        HomeworkDetail / HomeworkAutoComplete / Discussion / Questionnaire /
                        Downloads / Settings / About / AllTasks / AllCourses / AllUpdates
  store/                auth / ai / downloads / tutor / summaries（zustand；
                        downloads/tutor/summaries 有 persist。tutor 为多会话结构，见 10.2）
  styles/tsinghua.css   ⚠️ 约 8700 行，多轮迭代堆叠 + pass1~8 无界化/动画 final override；
                        改样式只在末尾追加，不删历史规则（铁律 7）
src/shared/aiProviders.ts  服务商预设（OpenAI/Anthropic/Gemini/DeepSeek/Qwen/GLM/Kimi/豆包/
                           SiliconFlow/OpenRouter/自定义），含 endpoint、apiFormat、模型列表
config/                 按主题命名的维护流水账（每次重要改动必须写）
```

> **新增依赖**：`katex`（LaTeX 渲染，MarkdownRenderer 用）。ipc 层新增 `focus.ts`（今日重点）、`stats.ts`（含 SWR + stats:updated 事件）。

### 3.2 必须知道的机制

- **双 session 分区**：`session.defaultSession` 给官方登录窗口和讨论区原始页面；`session.fromPartition('persist:learnpp-api')` 给 thu-learn-lib / 下载 / 提交。原因：网络学堂会写非 Latin1 Cookie，undici 拼 Header 会抛 `Cannot convert argument to a ByteString`。**任何新网络请求都复用 `learn.ts` 的 `apiFetch` / `withAuth`，不要绕过 Cookie 清洗。**
- **多账号**＝cookies 快照档案（`accounts.enc`，safeStorage 加密），不是存账号密码。cookies 过期时切换会失败，应引导重新添加。
- **新增 IPC 三处同步**：`preload/index.ts` + `preload/api.d.ts` + `renderer/src/env.d.ts`，漏一处 typecheck 或运行时就挂。
- **Renderer 是 sandbox**：拿不到真实文件路径，文件选择必须走主进程 `dialog.showOpenDialog()`；提交附件先复制到临时目录。
- **讨论区详情**永远用内置 BrowserWindow 加载原站页面，不要静态抓取重写（历史教训）。
- **AI 流式事件通道**：主进程统一通过 `hwai:generate-chunk` / `hwai:generate-end`（携带 `sessionId`）向 renderer 推流；Tutor 对话、文件总结/追问、公告/讨论/邮件总结、作业生成全部共用这两个 channel，靠 sessionId 区分。任何新的流式 AI 功能都复用它。
- **成绩过滤**：作业成绩可能出现 `-60` 之类的无效负值，不能当真实分数展示（`stats.ts`、`Homework.tsx`、`ipc/ai.ts` 的 list_homeworks/get_homework_detail 都已过滤 `grade < 0`）。
- **Dashboard SWR**：`stats:refreshDashboard` 内存+磁盘双层缓存；命中新鲜缓存直接返回，过期先返回旧数据再后台刷新、完成后经 `stats:updated` 事件推 renderer 静默更新。首页/全部任务/全部课程/全部记录都复用这一份快照（毫秒级），不再逐课串行拉取。
- **邮件缓存**：`mail-service.ts` 按文件夹缓存列表(TTL 60s)、按 id 缓存详情(TTL 30min)；renderer 侧 `Mailbox.tsx` 另有模块级 `mailListMemory` 即时渲染。刷新按钮传 `force` 绕过缓存。
- **邮件自动连接**：任何邮箱 IPC（status/list/get/star/delete/compose/search）前都 `await ensureMailConnection()`，用已存配置+密码自动重连；`logoutMail()` 会断开并清除已存密码（否则会被自动连回）。
- **Tutor 上下文机制**：从课程页/作业页点"问甘蔗"调 `useTutorStore.getState().startFocused(ctx, prompt?)`——若当前会话非空会**自动开新会话**再注入上下文，避免上下文与历史对话串扰。`pageContext` 经 `tutor:chat` 注入 system prompt。
- **课件文本缓存**：`tutor.ts` 的 `extractFileText` 按 url 缓存解析结果 30min，总结与追问复用（避免重复下载解析同一课件）。
- **附件/课件扩展名补全**：网络学堂课件 title 不带扩展名，解析前必须用 `fileType` 补回（`tutor.ts`）或靠 `attachment-parser.ts` 的 magic-byte 嗅探兜底，否则解析器按扩展名判类型会失败。
- **动画节流**：`AppShell` 监听路由变化，10 秒内连续导航加 `body.lp2-anim-quiet` 类禁用进场/级联动画（只保留 hover/按压微反馈）。
- **图片一律禁止拖拽**：`draggable="false"` + CSS `-webkit-user-drag: none`（自绘窗口拖拽区的约束）。

---

## 4. 重要认知：旧 unsolved.md 与实际严重脱节

旧版 `unsolved.md`（UI 升级时写的交接文档）列出的大量"待实现"项**实际早已实现**：Dashboard 真实统计、课件章节筛选/排序/批量下载/预览入口、Tutor 流式对话+工具调用、邮箱 IMAP 全套、学期设置页、课件/邮件 Tutor 总结等都有代码。当前的主要矛盾已经从"没实现"变成"**实现质量**"：协议正确性、数据口径、安全默认值、死功能清理。以下问题清单来自 2026-07-02 的逐文件审查，是当前唯一可信的问题列表。

---

## 5. 问题清单与解决方案

严重程度标注：🔴 必须修（出错/误导用户/安全）｜🟡 应该修（质量/体验）｜⚪ 清理项。

> ⚠️ **本节是问题的原始分析档案（2026-07-02 审查），供理解"为什么这么改"。每条的当前状态见第 10.1 对照表，不要再按下面的"未修/方案"字样直接行动。** 截至 2026-07-04，A/B 类问题绝大多数已修复；剩余项集中在第 10.3 节。

### A. 假功能 / 有 UI 无实现

**A1 🔴 全局搜索是死功能。**
首页搜索框（`src/renderer/src/components/AppShell.tsx` ~449 行）调 `search:query`，但 `src/main/services/search-index.ts` 的 `indexCourses` / `indexItems` / `indexEmails` **全仓无任何调用方**（`search:indexItems` IPC 存在但 renderer 从不调）。搜索永远"无结果"；连带 Tutor 的 `search_global`、`search_emails` 工具（`src/main/ipc/ai.ts`）也永远返回空，AI 会误答"没找到"。
**方案**：主进程集中建索引——课程列表加载后索引课程；Dashboard 统计拉数据时顺带索引作业/公告/讨论（数据已经在手）；`fetchMailList` 后索引邮件。同时修三个附带问题：`indexCourses` 里的 `index.clear()` 会清掉其他类型的条目（改为按类型清除）；查询结果无评分排序（单字 token 噪声大，按命中 token 数排序）；`handleResultClick` 忽略 `targetId`，只跳课程 tab 不定位具体条目。搜索框加 ~300ms 防抖。

**A2 🔴 邮件"转为今日重点"是假按钮。**
`src/renderer/src/pages/Mailbox.tsx` 的 `handleConvertToFocus`（~416 行）只弹成功 toast，什么都不做。
**方案**：实现（主进程存手动 focus 列表 JSON，`stats.ts` 的 `computeDashboard` 合并进 `todayFocus`），或先删按钮。用户被虚假成功提示欺骗是最差状态。

**A3 🔴 邮件附件不可下载。**
`src/main/services/mail-imap.ts` `fetchMailBody`（~276 行）返回的附件 `url` 恒为 `''`，UI 显示附件名但点击无效。
**方案**：解析时把 `parsed.attachments[].content`（Buffer）写入临时目录返回本地路径，renderer 提供"另存为"走现有下载目录。

**A4 🟡 Tutor 对话历史不持久。**
`src/renderer/src/store/tutor.ts` 是普通 zustand store（无 persist），重启即丢，也无多会话。
**方案**：仿 `store/downloads.ts` 加 zustand persist；进阶做法是按会话存 JSON 到主进程 userData。

**A5 🟡 名不副实的 AI 接口。**
`src/main/services/ai.ts` 的 `completeMultimodal` 只是 `complete` 的别名（并非多模态）；`completeNonStreaming` 全仓无调用方，且对 anthropic 格式会构造非法 body（把 `system` role 塞进 messages）。CLAUDE.md 宣称的"多模态"实际不存在。
**方案**：删除两个死导出；真要多模态在统一 AI client（见 C1）里按 apiFormat 构造 image block。

**A6 ⚪ 死代码与杂物。**
① `src/renderer/src/utils/icons.ts` 无人引用；② `src/main/ipc/app.ts` 里 `window:command`（带 `normalBounds`/`customMaximized` 还原逻辑的**精细版**窗口控制）是死代码——`WindowControls.tsx` 实际走的是没有还原逻辑的简化版 `window:minimize/toggle-maximize/close`，更好的实现没被用上；③ `mail-service.ts` 里约 800 行网页 DOM 抓取模式（`MAIL_LIST_SCRIPT` 等）已被 IMAP 取代，设置页明说"网页抓取已隐藏"；④ 仓库根下 `tmp/` 目录不该入库。
**方案**：窗口 IPC 合并为一套（保留带 bounds 还原的版本）；删 web 抓取模式、icons.ts、tmp/。

**A7 🔴 课件详情面板展示假数据。**
`src/renderer/src/pages/Files.tsx` ~327 行：上传时间为空时 fallback 到写死的 `'2026-05-26 23:59'`；"简介"是所有文件通用的硬编码文案；来源 fallback"任课教师"。
**方案**：无数据显示"—"；删除假简介。

### B. 实现有 bug

**B1 🔴 typecheck 当前失败。**
`mail-imap.ts(54): Property 'getBoxes' does not exist on type 'Imap'`（node-imap 类型声明缺口）。违反项目铁律。
**方案**：`(imapClient as any).getBoxes(...)` 或写模块 augmentation；修完把 typecheck 作为一切改动的门槛。

**B2 🔴🔴 Tutor 工具调用协议在 OpenAI 兼容服务商上会 400（影响最大的单个 bug）。**
预设服务商中 DeepSeek/Qwen/GLM/Kimi/豆包/SiliconFlow/OpenRouter 全是 openai 格式。`tutor-agent.ts` 的 agent loop 把工具结果作为 `role:'user'` 文本追加（~282 行），而 `ipc/ai.ts` 的 `runAiCallWithTools`（~397 行）又把带 `tool_calls` 的 assistant 消息原样回传。OpenAI 协议要求 assistant 的每个 `tool_call_id` 后必须紧跟 `role:'tool'` 消息——**模型一旦调用工具，第二轮请求立即报错，Tutor 的全部工具能力在多数服务商上不可用**。Anthropic 分支同样丢失 `tool_use` 块、把结果当普通 user 文本，行为退化。
**方案**：agent loop 内部用协议无关的消息结构（text / tool_use / tool_result 三种块），序列化时按 apiFormat 输出规范格式（OpenAI: `assistant.tool_calls` + `role:'tool'` + `tool_call_id`；Anthropic: `tool_use` content block + user 消息里的 `tool_result` block）。

**B3 🔴 SSE 流解析丢字。**
`services/ai.ts` `streamComplete`（~140 行）按单次 `read()` 的 chunk 切 `data:` 行，**没有跨 chunk 缓冲**——SSE 事件被 TCP 分包切断时整条丢弃。作业生成、各类总结都走这里，表现为偶发输出缺字断句。讽刺的是 `ipc/ai.ts` 里的另一份实现缓冲是对的——同一功能两份实现已经漂移（见 C1）。

**B4 🔴 流式消息发错窗口。**
`homework-ai.ts` `generate`（~230 行）用 `BrowserWindow.getAllWindows()[0]` 发 chunk——PDF/图片预览窗口也是 BrowserWindow，开着预览时生成流会发到预览窗。
**方案**：调用链传入发起请求的 `event.sender`（其他 handler 已是这么做的）。

**B5 🔴 Office 转 PDF 只对 Word 有效，PPT/Excel 必失败。**
`office-converter.ts` 对所有 Office 应用统一用 `$app.Documents.Open(...)` + `ExportAsFixedFormat($path, 17)`——这是 Word 专属 API。PowerPoint 要 `Presentations.Open` + `SaveAs(..., 32)`，Excel 要 `Workbooks.Open` + `ExportAsFixedFormat(0, $path)`。**课件最常见的 PPT 预览实际永远失败**（落到"Office 未安装或转换失败"）。另外文件路径直接内插进 PS 双引号字符串，文件名含 `$`、反引号会被 PowerShell 展开（注入/失败风险）。
**方案**：按应用生成正确 COM 脚本；路径用 `param($in,$out)` 参数传入而非字符串内插；renderer 侧预览失败提示从 `message.info(错误文本)` 改成正式 UI。
**实现陷阱预警**：PowerPoint 的 COM 对象**不允许设置 `Visible = $false`**（会直接抛错，和 Word/Excel 行为不同），正确做法是 `Presentations.Open($path, [ReadOnly]=$true, [Untitled]=$false, [WithWindow]=$false)`；Excel 则是 `Workbooks.Open` + `ExportAsFixedFormat(0, $pdfPath)`（Type 参数在前）。

**B6 🔴 邮箱密码与 AI Key 交叉污染（安全）。**
邮箱密码复用 API Key 仓存为 `provider='mail'`，而 `secret-store.ts` `loadApiKey`（~97 行）在指定 provider 无 Key 时 **fallback 返回 `default` Key**——从 v1.x 升级的用户（旧 AI Key 存在 default 槽位）没存邮箱密码时，IMAP 登录会把旧 AI Key 当密码发出去。该函数还在读路径上 `writeApiKeyStore`（读时写盘副作用）。
**方案**：mail 凭据独立命名空间且禁止 fallback；legacy 迁移移到启动时一次性执行，读路径纯读。

**B7 🔴 TLS 证书验证被关闭（安全）。**
`mail-imap.ts` 中 IMAP 与 SMTP 均 `rejectUnauthorized: false`（149/302/325 行附近）——公共网络下邮箱凭据可被中间人截获。
**方案**：直接删掉该选项，恢复默认严格验证。**已实测无兼容性风险**：2026-07-02 对 `mails.tsinghua.edu.cn` 的 993/465 端口在 `rejectUnauthorized: true` 下握手成功，服务器证书为正规签发的 `*.tsinghua.edu.cn`（Let's Encrypt），关闭验证没有任何存在理由。无需再提供"跳过验证"开关。

**B8 🔴 邮件"删除"是永久删除。**
`deleteImapMail` 打 `\Deleted` 后立即 `expunge`——不进回收站，且 expunge 会清掉邮箱中**所有**已标记删除的邮件。
**方案**：改 IMAP `MOVE` 到 Trash（或 COPY+标记）；仅在"已删除"文件夹提供彻底删除。

**B9 🔴 HTML 邮件被打成纯文本（"排版全乱、图片不显示"的直接原因）。**
`mail-service.ts` `cleanMailBodyHtml` 把正文剥成文本行再逐行转义为 `<p>`——链接、图片、表格、格式全丢；正文中恰好匹配"噪声正则"的行（如 http 开头）被误删。renderer 侧 `Mailbox.tsx` ~673 行又对 body 不消毒直接 `dangerouslySetInnerHTML`（当前因为主进程已转义所以没炸，但两层互相抵消的设计很脆）。
**方案**：见第 8.3 节（原始 HTML + DOMPurify + sandboxed iframe 隔离渲染 + `cid:` 内嵌图片转 data URI）。

**B10 🟡 邮箱性能与多账号缺陷。**
每次列表全量拉 300 封 HEADER 无增量缓存；`AppShell.tsx` 每 2 分钟轮询 `mail.check`，而 `checkMailStatus` 又触发一次全量 inbox 拉取；IMAP 连接是全局单例，不随 learn 多账号切换隔离。
**方案**：按 UID 增量同步（记录 UIDNEXT）；新邮件检查改 `STATUS`/`SEARCH UNSEEN`；邮箱配置按 learn 账号 ID 命名空间化。详见第 8.2 节。

**B11 🔴 未消毒的 HTML 注入点。**
`src/renderer/src/pages/Homework.tsx` ~290 行 `submitTarget.description` 裸 `dangerouslySetInnerHTML`——同项目 HomeworkDetail / Notifications / AnsweringDetail 都用了 DOMPurify，唯独这里漏了，违反自家铁律。
**方案**：封装 `SanitizedHtml` 组件，全仓替换所有裸用法。

**B12 🟡 学习统计口径失真。**
① `stats.ts` `pauseTracking` 注释明说"后台时间也算学习时间"——配合托盘常驻+开机自启，"本周学习时长/连续天数"实际是**开机时长**；② 课程进度=作业提交率，无作业课程直接算 100%（~126 行），"已完成课程"数字无意义；③ `ipc/ai.ts` 的 `get_stats` 工具（~272 行）是 stats.ts 的手工重复实现，streak 口径已经不一致。
**方案**：用 `powerMonitor.getSystemIdleTime()` + 窗口可见性统计真实活跃时间；无作业课程从总进度剔除而非计 100%；`get_stats` 直接调用 stats.ts 导出函数，删重复实现。

**B13 🟡 学期选择不持久。**
Settings 保存了 `lastSemesterId`，但 AppShell 启动时的 `loadCourses`（~234 行）从不读它，永远按"当前学期→候选遍历"加载；Settings 内部还混用 store `semesters` 与本地 `localSemesters` 两个数据源（store 为空时学期名不更新）。
**方案**：`loadCourses` 优先用 `lastSemesterId`；Settings 统一数据源。

**B14 🟡 Dashboard 首屏慢。**
`Dashboard.tsx` 在 renderer **串行** `await` 每门课 3 个接口（13 门课=39 次串行请求）。
**方案**：下沉主进程 `stats:refresh`，限并发 `Promise.all` + 磁盘缓存；顺带在此处喂 A1 的搜索索引（一次拉取两处受益）。

**B15 🔴 无单实例锁。**
`main/index.ts` 没有 `app.requestSingleInstanceLock()`——托盘常驻下再次启动会出现双实例（双托盘、配置竞写），也是打包 DLL 占用问题的诱因。
**方案**：加锁，`second-instance` 事件里 `showMainWindow()`。

**B16 🟡 下载状态按文件名判定。**
`files:downloadState` 只查下载目录同名文件——不同课程同名课件（"第1讲.pdf"）互相误判"已下载"。批量下载（`Files.tsx` `handleBatchDownload`）用 `files` 而非 `filteredFiles`（忽略筛选），且不跳过已下载文件全部重下。
**方案**：下载记录以 `courseId+fileId` 为键；批量下载用筛选结果并跳过已完成。

**B17 🟡 作业编排流水线缺陷。**
`homework-orchestrator.ts`：① 拆题 prompt 要求模型输出"匹配的课件内容摘录"，**但 `coursewareText` 根本没进 prompt**——模型只能编造该字段；② 子代理 `Promise.all` 无并发上限（多题作业瞬间打满速率限制）；③ `decomposeHomework` / `assembleResults` 的 `signal` 未透传给 `complete`——"取消生成"在这两阶段无效。
**方案**：课件文本注入拆题 prompt（或让 orchestrator 自己按题分配，不让模型编）；并发限 2-3；signal 全链路透传。

**B18 🟡 Tutor 页面细节。**
① 每条回复末尾把"仅供参考"HTML span **写回消息历史**并在下轮发回给模型（应只在渲染层追加）；② 每次进入 Tutor 页都发一条真实计费请求做健康检查（`Tutor.tsx` ~84 行，应缓存结果/只查 Key 存在性）；③ 输入框是单行 `Input`，不支持多行提问；④ agent loop `MAX_LOOPS=5` 到顶静默结束无提示。

**B19 ⚪ 其他小项。**
① `main/index.ts` 自动登录结果 `webContents.send('auto-login-result')` 可能在 renderer 加载完成前发出（竞态）；② `Files.tsx` `handleTutorSummary` 里 `!summaryText` 读的是过期闭包值（流式场景恒为空，逻辑靠 result.content 兜底才没炸）；③ `MarkdownRenderer.tsx` 是手写解析器，不支持表格/嵌套列表，还为"仅供参考"span 写了特判（B18① 修掉后可删）。

**B20 🔴 IMAP 无持久化登录与自动重连（用户感知为"星标/删除/发件全都没实现"的根因）。**
① `mail-service.ts` 的 `loginMail()`（~541 行）**已经写好**了从已保存配置 + 加密密码自动连接的逻辑，但应用启动时没有任何代码调用它——`Mailbox.tsx` 挂载时查 `mail:status` 得到未登录，直接展示登录页，用户每次重启都要重新登录；② `mail-imap.ts` `connectMail` 只在连接建立前注册了一次性 `error` 监听，**连接成功后的断线（网络切换、服务器超时踢连接）没有任何监听与重连**，留下僵尸 client；③ 断线后 `setImapStarred` / `deleteImapMail` 静默 `resolve({ok:false})`、`sendMail` 复用已死的 SMTP transport——所有操作无声失败，UI 层因为只在 `ok` 时更新状态，**表现为按钮点了没反应，让人以为功能根本没做**。
**方案**：见第 8.2 节连接管理器设计（启动自动连接 + `ensureConnection()` 包装 + 断线事件驱动重连 + 错误透出到 UI）。

**B21 🟡 发送成功后未写入"已发送"文件夹。**
`sendMail` 走 SMTP 发出后没有通过 IMAP `APPEND` 把邮件副本写入 Sent 文件夹（清华 Coremail 的 SMTP 不会自动保存已发送），用户在"已发送"里看不到刚发的邮件 → 误以为发送失败。
**方案**：SMTP 发送成功后，用 nodemailer 的 `MailComposer` 生成同一封邮件的 RFC822 原文，IMAP `append(raw, { mailbox: Sent文件夹, flags: ['\\Seen'] })`。

**B22 🟡 邮件搜索名不副实。**
列表页搜索只是对已加载的 300 封做本地过滤，且 IMAP 模式下 `preview` 恒为 `''`（`parseHeaderMessage` 写死），实际只能命中主题和发件人；正文搜不到，超出 300 封的历史邮件搜不到。
**方案**：两级搜索——本地即时过滤（主题/发件人，零延迟）+ 用户回车时发起服务端 `IMAP SEARCH`（`['TEXT', query]`，Coremail 支持 UTF-8 charset）合并结果；邮件头同步后顺带喂给全局搜索索引（配合 A1）。

**B23 🔴 fetchMailBody 必然竞态：正文永远报"邮件正文为空"（2026-07-03 已实验证实）。**
`mail-imap.ts` `fetchMailBody`（~286 行）在 fetcher `'end'` 事件里 `if (!resolved) reject('邮件正文为空')`——但 `resolve` 发生在 `simpleParser` 的**异步回调**里。IMAP 协议上 tagged OK（触发 `end`）紧跟在 body 数据后一个网络包内到达，而 mailparser 是流式解析器需要多个事件循环 tick。**`end` 永远跑赢 parser** → promise 先被 reject，稍后解析成功的 resolve 变成 no-op，正文被静默丢弃。本地竞速实验证实：即使让 parser 先启动、解析最小邮件，`setImmediate` 模拟的 `end` 仍然先触发。对照组 `fetchMailList` 之所以正常，是因为它的 `end` 里 `await Promise.all(parsing)` **等了解析**——两函数唯一的结构性差异就在这里，与 IMAP 命令无关（这就是为什么换 6 种 FETCH 写法全部失败：换的都是命令，保留的都是同一个错误的 end 脚手架）。
**方案**：`end` 里绝不 reject 正在解析的请求——记 `sawMessage` 标志，仅当服务器确实没返回任何 message（uid 不存在/已删）时才 reject（错误语义改为"未找到该邮件"）；resolve/reject 全权交给 simpleParser 回调。修复代码见 8.6。

**B24 🔴 删除邮件在 Coremail 上会"删了还在"（2026-07-03 修复批次的残留）。**
删除已改为 `imapClient.move()` 到回收站（B8 方向正确），但实测 Coremail 的 CAPABILITY **不含 MOVE 扩展**（仅 `IMAP4rev1 XLIST SPECIAL-USE ID LITERAL+ STARTTLS APPENDLIMIT UIDPLUS`）——node-imap 的 `move()` 会回退为 COPY + 打 `\Deleted` 标记，**但不 expunge**，且 `fetchMailList` 不过滤 `\Deleted` 标记 → 副本进了回收站，原件刷新后仍出现在收件箱。
**方案**：双保险——① `move()` 回调成功后对源文件夹执行 `expunge()`；② `parseHeaderMessage` 已拿到 flags，列表过滤掉含 `\Deleted` 的邮件。

**B25 🟡 邮件附件临时文件无清理。**
每次读信把全部普通附件写入 `%TEMP%/learnpp-mail-attachments`（`fetchMailBody`），永不删除，反复读信会无限累积。
**方案**：应用启动时清空该目录（附件语义是"读信期间临时可保存"，跨会话无须保留）；或改为用户点击"保存"时才从内存/按需重新拉取写盘。

### C. 架构级技术债

**C1 🔴 AI 调用逻辑存在三份平行实现（多数 B 类问题的根）。**
`services/ai.ts`、`ipc/ai.ts` 的 `runAiCallWithTools`（注释自己承认 "duplicated to keep it self-contained"）、加上两份独立的 settings/headers/SSE 解析——已经出现行为漂移（一个缓冲 SSE 一个不缓冲，见 B3）。
**方案**：新建 `src/main/services/ai-client.ts`，唯一职责：读设置 → 按 apiFormat 构造规范请求（工具协议、多模态块）→ 带缓冲 SSE 解析 → AbortController 管理。`complete` / `runAgentLoop` / 健康检查全部改为其消费者，删除重复代码。**这是修 B2/B3/B5 类问题的正确姿势，不要在三个地方分别打补丁。**

**C2 ⚪ tsinghua.css ≈7900 行。**
多轮 UI 迭代堆叠的覆盖规则 + `!important`。短期规则：改样式只在文件末尾追加 final override，**不要删除看起来重复的规则**（可能是有意的覆盖层）。长期：按窗口/布局/课程页/首页/邮箱/Tutor/登录页拆模块。必须保留的关键约束：图片不可拖拽、窗口按钮 no-drag、课程列表与课件列表可滚动、课程 Tab 不滚动。

**C3 ⚪ 文档陈旧。**
旧 unsolved.md 已重写（见第 4 节）；上级目录 `D:\ai\CLAUDE.md` 是 v1.1 时代的文档（版本号、目录结构均过时），若继续在 `D:\ai` 工作区打开本项目会误导 agent。

---

## 6. 建议实施路线图（按风险 × 收益排序）

| 阶段 | 内容 | 对应问题 |
|---|---|---|
| **P0 止血**（小改动，半天量级） | 修 typecheck；单实例锁；补消毒；TLS 默认验证；密钥 fallback 隔离 | B1 B15 B11 B7 B6 |
| **P1 AI 通道统一** | 建 `ai-client.ts`，修工具协议 / SSE 缓冲 / 发错窗口 / orchestrator prompt 与取消 | C1 B2 B3 B4 B17 B18 |
| **P2 搜索管线** | 主进程建索引 + 结果定位跳转 + 防抖 + 排序 | A1 |
| **P3 邮箱**（完整方案见第 8 节） | 连接管理器与持久化登录/自动重连、错误透出、HTML 隔离渲染+cid 内嵌图片、附件落地、删除→Trash、发送后写入已发送、两级搜索、UID 增量同步 | B20 B9 A3 B8 B21 B22 B10 |
| **P4 统计与仪表盘** | 真实活跃时间、进度口径、统计下沉主进程、今日重点手动项 | B12 B14 A2 |
| **P5 预览与下载** | office-converter 按应用修 COM、下载键改 courseId+fileId、批量下载修正 | B5 B16 A7 |
| **P6 清理** | 死代码（A5 A6 B19③）、CSS 模块化、文档同步 | A5 A6 C2 C3 |

每阶段验收标准：

1. `npm run typecheck` 通过（P0 起成为硬门槛）。
2. 涉及打包行为的跑 `npm run package:dir` 确认 `dist-installer/win-unpacked/learn++.exe` 更新。
3. 新增/修改 IPC 三处类型文件同步。
4. 在 `config/` 落一份维护记录（背景 / 思路 / 结果 / 后续注意）。
5. 不回退用户或其他 agent 的已有改动。

## 7. 文档地图（哪些可信）

| 文档 | 状态 |
|---|---|
| `HANDOVER.md`（本文） | ✅ 2026-07-04 全面更新；**当前状态看第 10 节**，第 5 节为问题原始档案 |
| `CLAUDE.md` | ✅ 架构与铁律准确（"多模态"描述已修正） |
| `unsolved.md` | ✅ 指向本文第 10 节的状态页 |
| `config/*.md` | ✅ 历史维护记录，按主题查（邮箱/tutor/下载/uiupdate 等），新改动继续追加 |
| `README.md` | ✅ 已更新到 2.0（用户向文档） |
| `SECURITY.md` / `THIRD_PARTY_NOTICES.md` | ✅ 已同步（安全政策指向本文 B6/B7/B11；依赖清单已含邮件栈，可补 katex） |
| `D:\ai\CLAUDE.md`（上级目录） | ⚠️ v1.1 时代产物，与本仓库现状不符，勿以其为准 |

---

## 8. 邮箱模块专题：踩坑史与目标架构

邮箱是本项目返工最多、用户痛点最集中的模块。本节记录已被验证走不通的路线（**不要再试**）、当前实现的精确缺陷链，以及目标架构。对应问题编号：A3、B7、B8、B9、B10、B20、B21、B22。

### 8.1 路线裁决与踩坑史

**最终裁决（2026-07-02，已实测）：在 learn++ 程序窗口内部输入账号密码登录邮箱是完全可行的，且就是现行 IMAP 路线——`Mailbox.tsx` 里的内嵌登录卡片和设置页表单已经是这个形态，全程不需要弹出任何外部浏览器窗口。** 本裁决基于对服务器的真实握手探测：

```text
mails.tsinghua.edu.cn:993  → "* OK Coremail System IMap Server Ready"（IMAP 在线）
mails.tsinghua.edu.cn:465  → "220 tsinghua.edu.cn Anti-spam GT for Coremail"（SMTP 在线）
两者均在 rejectUnauthorized: true（严格证书验证）下握手成功，
证书 *.tsinghua.edu.cn，Let's Encrypt 签发，有效期至 2026-09。
```

协议端点真实可用、证书正规，代码默认的服务器/端口（993 SSL / 465 SSL）也是对的。此前"登录不上/用不了"全部是工程完成度问题（B20 静默失败链），不是路线问题。三个使用前提要在 UI 上讲清楚：

1. 填的是**清华邮箱自身的密码**（与网络学堂 / info 门户不是同一套密码体系）；
2. 开了两步验证的账号必须用**客户端专用密码（授权码）**，不能用登录密码；
3. 若认证反复失败，提示用户到网页邮箱设置里确认 IMAP 服务已开启。
   登录失败的错误提示必须区分"认证失败 / 网络不通 / 证书异常"三类（对应 8.5 验收最后一条）。

#### 8.1.1 "普通网页密码 vs 客户端专用密码"决策树（2026-07-02 实测补充）

用户关切：能否像网页登录一样直接用普通邮箱密码，而不必去网页邮箱生成 IMAP 专用密码。实测证据：

```text
IMAP CAPABILITY 探测：IMAP4rev1 标准能力集，无 LOGINDISABLED、无强制授权码声明
IMAP 假账号登录探测：返回通用错误 "NO LOGIN Login error or password error"
  ——不是 QQ 邮箱那种 "Please use the authorization code" 的强制授权码提示
网页登录页探测：纯 Coremail 表单，POST /coremail/index.jsp?cus=1
  ——无统一身份认证(info)跳转，网页登录用的就是邮箱自身密码
```

**结论**：

- **未开启二步验证的账号：IMAP 接受的就是普通网页密码**，协议层面没有一刀切强制专用密码。"必须生成专用密码"通常只发生在开启了二步验证的账号上——此时它是**服务器端的安全设计**（静态密码被有意排除在客户端协议之外），Outlook / Thunderbird 等任何邮件客户端同样绕不开，不是 learn++ 的限制，也**不应该尝试绕过**。
- 此前用户"用普通密码登录不上"的体验，需要与 B20 静默失败链区分：断线/僵尸连接/用户名格式错误在旧代码里同样表现为"登录失败"，很可能造成了"必须用专用密码"的误判。**实现登录引导时应让用户先用普通密码试一次**，认证失败再引导生成专用密码（附一键打开网页邮箱设置页 + 图文步骤）。
- **备选路线（记录在案，默认不实施）——Coremail HTTP JSON API**：如果强制要求"普通密码"体验（含二步验证账号也想只输密码），唯一途径是程序化调用网页登录本身：POST 上述表单端点拿会话 cookie，再调 Coremail 内部 JSON API（`/coremail/s/json?func=mbox:listMessages` / `mbox:readMessage` / `mail:send` 等）完成全部操作。它与已废弃的"DOM 抓取"（路线二）本质不同——走结构化 JSON 而非解析页面，健壮性可接受。代价：非官方接口可能随升级变动；Coremail 在多次失败后可能弹验证码（需在窗口内展示验证码图完成挑战）；二步验证账号网页登录同样要二次验证，等于没有省事。工程量为数天级。**裁决：主路线维持 IMAP（专用密码是一次性两分钟操作，换来协议级长期稳定）；JSON API 仅在产品层面确认"普通密码体验"值得这笔脆弱性成本后再立项。**

以下是两条**已验证走不通并废弃**的路线，记录在此防止重走：

**路线一：弹出 BrowserWindow 让用户在清华邮箱网页（Coremail）登录，然后捕获会话。已废弃。**
失败原因：Coremail 登录流程有多次重定向（含统一身份认证跳转），没有稳定的"登录完成"信号可监听——靠 URL 变化、`did-finish-load`、DOM 探测（`MAILBOX_CHECK_SCRIPT` 那套启发式）判断登录态都不可靠，经常在用户已登录时仍判定未登录，或在登录页误判已登录。**结论：网页会话捕获这条路对 Coremail 不可行，不要再尝试。**

**路线二：登录后用隐藏 BrowserWindow 抓取邮箱页面 DOM（现 `mail-service.ts` 中约 800 行 `MAIL_LIST_SCRIPT` / `MAIL_DETAIL_SCRIPT` 等）。已废弃。**
失败原因：正文抓取会把 Coremail 页面的导航栏、工具栏、文件夹名等无关内容混进邮件正文（用户报告的"正文和 http 网页无关内容混杂"就是这个阶段的产物）；选择器全靠启发式猜测，页面结构一变就碎；星标/删除/发件要靠模拟页面点击，从未稳定实现。**结论：删除这批死代码（见 A6），设置页已注明"网页抓取已隐藏"。**

**现行路线：IMAP/SMTP（正确方向，但实现不完整）。** 协议标准、能力完整（收发/星标/删除/搜索/文件夹全部有原生协议支持）、不受页面改版影响。当前所有缺陷都是工程完成度问题，不是路线问题。可以额外保留一个"在浏览器中打开清华邮箱"按钮（`shell.openExternal`）作为兜底逃生口——只跳转，不抓取。

### 8.2 缺陷链解剖：为什么用户觉得"什么都没实现"

代码里 `setImapStarred` / `deleteImapMail` / `sendMail`（`mail-imap.ts`）和对应 UI（`Mailbox.tsx` 的 handleStar/handleDelete/handleSendCompose）**都存在且逻辑基本正确**，但一条静默失败链让它们形同虚设：

```text
应用启动 ──× 没人调用 loginMail()（它内部的自动连接逻辑其实已写好，~541 行）
             └→ Mailbox 查 mail:status = 未登录 → 每次重启都弹登录页（"没做好持久化登录"）
用户手动登录 ──> 连接建立，但 connectMail 只注册了 pre-ready 的一次性 error 监听
             └→ 之后断线（网络切换/服务器超时）无人知晓，留下僵尸 client
僵尸状态下操作 ──> star/delete 静默 resolve({ok:false})，SMTP 复用死 transport
             └→ UI 只在 ok 时更新、失败无任何提示（"点了没反应 = 没实现"）
发件即使成功 ──> 没有 IMAP APPEND 到已发送文件夹
             └→ 用户在"已发送"看不到 → 认定发送失败
```

**目标架构：新建 `mail-connection.ts` 连接管理器**，其余代码不直接持有 imap client：

1. **启动自动连接**：`app.whenReady` 后（或首次邮箱相关 IPC 时惰性触发）调用现有 `loginMail()`——配置和加密密码都已持久化（settings + secret-store `mail` 槽位，注意先修 B6 的 fallback 污染），缺的只是这一次调用。
2. **`ensureConnection()` 包装所有操作**：每个 IMAP/SMTP 操作前检查 `state === 'authenticated'`，断了就用已存配置重连（指数退避，上限 3 次），重连失败才向 UI 抛错。
3. **断线感知**：连接成功后注册持久的 `error` / `close` / `end` 监听，标记断开状态；显式配置 node-imap `keepalive`（默认虽开启，建议固定 `{ interval: 10000, idleInterval: 300000, forceNoop: true }`——Coremail 对 IDLE 支持不可靠，`forceNoop` 更稳）。
4. **错误必须透出**：IPC 返回 `{ ok: false, error: '具体原因' }` 而不是裸 `false`；UI 层对失败弹 message.error。"静默失败"是本模块用户信任崩塌的核心原因，任何操作都不允许无声失败。
5. **操作前定位文件夹**：星标/删除依赖"当前打开的 mailbox"，操作前显式 `openFolder(folder)`，不依赖上次列表恰好打开的文件夹。

### 8.3 正文渲染：从"剥成纯文本"改为"隔离渲染原始 HTML"

当前 `cleanMailBodyHtml` 把 HTML 邮件剥成纯文本行（格式/表格/链接/图片全丢，样式全乱的直接原因）。目标做法：

1. **主进程返回 mailparser 的原始 `parsed.html`**（fallback `textAsHtml`），不做文本化处理。
2. **`cid:` 内嵌图片**：邮件里 `<img src="cid:xxx">` 引用的图片在 `parsed.attachments` 中（有 `contentId` 且 `related=true`），主进程把它们替换为 `data:image/...;base64,` URI 后再返回——这是"图片无法显示"的主要修复点（清华通知类邮件大量使用内嵌图）。
3. **renderer 用 sandboxed iframe 渲染**：`<iframe srcdoc={DOMPurify.sanitize(html)}>` + 注入一小段基础 CSS（约束宽度、字体、图片 max-width:100%）。用 iframe 而不是 div 的原因：邮件自带的 `<style>` 和内联样式不会污染应用 UI，应用的 tsinghua.css 也不会把邮件排版打乱（此前"排版全乱"的另一半原因就是双向样式互相污染）。**两个实现陷阱**：① sandbox 属性不能写空值 `sandbox=""`——全封锁沙箱连链接点击都会被静默吞掉；正确写法是 `sandbox="allow-popups allow-popups-to-escape-sandbox"`（仍禁脚本）并在消毒后的 HTML 头部注入 `<base target="_blank">`，这样链接点击会走 window.open → 主窗口 webContents 已有的 `setWindowOpenHandler`（`main/index.ts` ~152 行）自动转 `shell.openExternal`，零额外代码；② 不加 `allow-same-origin`（保持隔离）时读不到 iframe 内容高度，**不要尝试自适应高度**，用固定高度容器 + 内部滚动即可（邮件详情面板本来就是滚动区）。
4. **远程图片**（`http(s)://` 的 `<img>`）：默认加载（校内邮件场景隐私风险低）；如要更保守可加"显示远程图片"开关，实现成本低。
5. **普通附件**：按 A3 方案落地临时目录 + "另存为"。

### 8.4 搜索、同步与已发送

- **搜索（B22）**：本地即时过滤（主题/发件人）+ 回车触发服务端 `imap.search(['TEXT', query])` 合并结果；同步到的邮件头喂给全局搜索索引（A1）。
- **增量同步（B10）**：按文件夹记录 `uidvalidity` + 最大 UID，新拉取只 fetch `lastUid+1:*`；新邮件红点检查改 `STATUS (UNSEEN)`，不再 2 分钟全量拉 300 封。
- **已发送（B21）**：SMTP 成功后用 `MailComposer` 生成 RFC822 原文，IMAP `append` 到 Sent 文件夹（文件夹名用现有 `resolveMailboxName('sent')` 解析）。
- **删除（B8）**：`MOVE` 到 Trash；仅在"已删除"文件夹内提供真正 expunge。
- **TLS（B7）**：恢复证书验证，`mails.tsinghua.edu.cn` 证书是正规签发的，`rejectUnauthorized: false` 没有存在理由。

### 8.5 验收清单（邮箱模块完成的定义）

- [ ] 登录与全部邮箱操作**均在 learn++ 窗口内完成**，全程无外部浏览器窗口参与
- [ ] 首次配置后，**重启应用直接进入收件箱**，无需再次登录
- [ ] 断网 → 恢复后，点击任意操作自动重连成功；重连失败时 UI 有明确错误提示（无任何静默失败路径）
- [ ] 打开一封含图片和表格的 HTML 邮件（如学校通知），排版与网页版一致、内嵌图片正常显示、样式不影响应用其他界面
- [ ] 星标后在网页版 Coremail 能看到同步的旗标；取消星标同理
- [ ] 删除的邮件出现在"已删除"文件夹而不是消失
- [ ] 发送一封邮件后，"已发送"文件夹里能看到它
- [ ] 搜索能命中主题/发件人（即时）和正文（回车后）
- [ ] 附件可以另存到本地
- [ ] 两步验证账号用授权码可登录，错误提示能区分"认证失败 / 网络不通 / 证书问题"

### 8.6 fetchMailBody 竞态修复（B23）与主进程调试三件套

**修复代码**（核心改动只有 `end` 的语义；`resolved` 标志不再需要，promise 重复 settle 本身无害）：

```ts
export function fetchMailBody(uid: string): Promise<{ body: string; attachments: { name: string; url: string }[] }> {
  return new Promise((resolve, reject) => {
    if (!imapClient) return reject(new Error('邮箱未连接'))
    const fetcher = (imapClient as any).fetch(uid, { bodies: '', markSeen: true })
    let sawMessage = false

    fetcher.on('message', (msg: any) => {
      sawMessage = true
      msg.on('body', (stream: any) => {
        simpleParser(stream, (err, parsed) => {
          if (err) return reject(err)
          resolve({
            body: parsed.html || parsed.textAsHtml || parsed.text || '',
            attachments: (parsed.attachments || []).map((a) => ({ name: a.filename || 'attachment', url: '' })),
          })
        })
      })
    })

    fetcher.once('error', reject)
    fetcher.once('end', () => {
      // 'end' 只代表 FETCH 命令完成，解析可能仍在进行——绝不能在这里 reject 进行中的请求。
      if (!sawMessage) reject(new Error('未找到该邮件（可能已被删除或移动）'))
    })
  })
}
```

后续增强（不属于本修复，见 8.2 第 5 条）：调用前显式 `openFolder(folder)`，避免跨文件夹点击时 uid 落在错误的 mailbox。

**主进程调试三件套（本案例中因缺失导致连续 6 次盲试）**：

1. **主进程日志看终端，不看 DevTools**——`mail-imap.ts` 运行在 Electron 主进程，`console.log` 输出在运行 `npm run dev` 的终端里；在 renderer DevTools 里永远看不到，容易得出"事件从未触发"的错误结论（本案例中 `message` 事件实际一直在触发）。
2. **确认主进程代码真的重启了**——改主进程代码后确认 electron-vite 重启了 Electron（在模块加载处打一条带时间戳的日志）；如果主进程还在跑旧代码，任何改动都会"表现完全一致"。
3. **node-imap 原始协议日志**——构造时传 `debug: (msg) => console.log('[imap]', msg)`，能直接看到 `* 1 FETCH (BODY[] {12345}` 之类的原始协议往来；本案例开着它就能立刻看到正文数据实际到达，把怀疑对象从"服务器/命令"转到"本地事件时序"。

顺带澄清一个当时的误判：**"列表瞬间显示"不代表连接是假的**——header-only 拉 300 封只有几百 KB、亚秒级完成，且 renderer 的 React state 保留上次列表。B23 报错为干净的 `end` 而非超时/协议错误，恰恰证明连接存活、FETCH 正常完成。

---

## 9. 前端视觉整改方案（2026-07-03，邮件页优先）

> **状态：M1–M13 已于 2026-07-03 全部落地**（含顺带修复：A2 前端接线、Tutor 页恒离线弹窗 bug、AppShell 假在线 pill、课件页降噪），实施细节见 `config/uiupdate.md` 末节。本节保留原方案作为设计依据；9.3 的全局原则继续适用于后续所有页面改动。

用户反馈：整体风格好，但存在**多余线条框、排版比例失衡、多余按钮、视觉冗余**，邮件页是重灾区。以下问题全部来自对 `Mailbox.tsx` / `AppShell.tsx` / `tsinghua.css`（~7593-7830 行邮件区）的结构审查，每条附具体改法。改 CSS 时遵守铁律 7（在 `tsinghua.css` 末尾追加 final override，不删历史规则）。

### 9.1 邮件列表页（信息冗余是核心病灶）

**M1 🔴 文件夹名四重显示。**"收件箱"同时出现在：①侧栏子菜单高亮项 ②列表头 `lp2-mail-list-summary` ③**每一行**发件人下方的 `<small>{folderLabel}</small>`（整列几百行重复同三个字，`Mailbox.tsx` ~616 行）④详情页 `<Tag color="purple">{folderLabel}</Tag>`。
**改法**：删除③④。①②保留（一个是导航态，一个是页面标题）。

**M2 🔴 每行"暂无预览内容"灰字刷屏。**IMAP 模式 `preview` 恒为空（`parseHeaderMessage` 写死 `''`），列表每行渲染 `{mail.preview || '暂无预览内容'}`——几百行重复占位文案是页面最大的视觉噪声源。
**改法**：preview 为空时**整个 `<small>` 不渲染**（该行自动变单行紧凑布局）；后续增强可在后端用 `BODY.PEEK[TEXT]<0.256>` 抓真实摘要（列入 B10 增量同步一并做）。

**M3 🟡 表头行（发件人/主题/日期）删除。**双行卡片式列表配表格表头是过时范式（Gmail/Outlook 均无），还额外贡献一条分隔线和 46px 高度。删 `lp2-mail-table-head` 的 JSX 与样式引用。

**M4 🟡 行尾 `›` 装饰列删除。**`lp2-mail-open-cue` 整列无功能（整行本就可点击），并占用 28px 网格 + gap。

**M5 🟡 网格比例重排。**现为 `76px | 0.85fr | 1.9fr | 118px | 28px`：首列 76px 只放未读点+星标过宽，日期 118px 过宽。删除末列后建议 `44px | minmax(140px, 0.7fr) | 2.2fr | 92px`；星标按钮改为 hover 时显现（默认只显示未读点和已星标的金星），减少整列图标噪声。

**M6 🟡 "退出邮箱"按钮从列表头移走。**高频页面顶部常驻一个低频破坏性操作是"多余按钮"的典型。移入设置页邮箱配置卡（上下文更合适），或收进列表头右侧"···"菜单。

**M7 🟡 统计信息精简。**`{filtered}/{total} 封 · X 未读 · Y 星标` 三组数字过载且未筛选时前两个数相同。改为仅"X 封未读"；有筛选/搜索激活时改为"匹配 N 封"。

**M8 ⚪ 刷新入口去重。**顶栏有刷新按钮，空态 Empty 里又有"重新读取"——空态保留（那里有用），但语义统一为一个文案。

### 9.2 邮件详情页

**M9 🔴 工具栏 7 按钮平铺 + 图标/文字混排。**现状：返回 | 星标(纯图标) 删除(纯图标) 回复 转发 转为今日重点 Tutor总结。
**改法**：左侧"← 返回"；右侧只保留【回复】【转发】【甘蔗 Tutor 总结】三个文字按钮，星标/删除/转为今日重点收进"···"Dropdown。若保留任何 icon-only 按钮必须加 Tooltip。

**M10 🔴 正文 iframe 固定 400px 高度。**长邮件出现 iframe 内滚+页面外滚双滚动条，短邮件下方大片留白——"排版比例"问题的最大单点。
**改法**：`.lp2-mail-read-body { display:flex; flex-direction:column; flex:1; min-height:0 }`，iframe `style={{ flex:1, minHeight:0, width:'100%', border:'none' }}`，让正文占满剩余视口高度，滚动只发生在 iframe 内。

**M11 🟡 读信头压缩。**现状 Tag + 大标题 + 三行 `<dl>`（发件人/收件人/日期）占约 180px 纵深，挤压正文。改法：删 Tag（M1④）；`<dl>` 压成一行次要信息"发件人 · 日期"（收件人折叠，点击展开）；标题字号可降一档。

**M12 🟡 附件区无样式。**当前是裸 `<button style={{marginLeft:8}}>`。改为与课件页一致的 chip 风格（圆角、文件图标、hover 反馈），复用现有 lp2 按钮类。

**M13 🟡 详情态顶栏控件失义。**读信时 AppShell 顶栏的筛选 tabs/排序/刷新仍然可见，点击它们会因 `updateMailQuery` 清掉 `mailId` 把用户踢回列表——交互上是"看起来可用、点了就丢上下文"。改法：`mailId` 存在时顶栏这三组控件隐藏或禁用（保留搜索与写邮件）。

### 9.3 全局视觉原则（其余页面按此审计）

- **线条预算**：同一视图内水平分隔线 ≤ 2 层；卡片内部不再嵌套带 border 的子卡片，用间距（16/24px 阶梯）替代线条做分组。邮件区删掉表头线后剩 summary 底线 + 行分隔线两层，达标。
- **按钮预算**：每屏 primary 按钮 ≤ 1；icon-only 必配 Tooltip；破坏性操作（退出/删除）不进常驻工具栏第一排。
- **重复信息零容忍**：同一事实（文件夹名、计数、状态）最多出现两处（导航态 + 内容区标题）。
- **占位文案不成列**：任何"暂无 XX"式占位不允许在列表中逐行重复出现——数据为空就收起该元素。
- 执行时逐页过一遍 Dashboard / Files / Tutor / Homework，用以上四条做 checklist；改动统一追加在 `tsinghua.css` 末尾并注明 `/* 2026-07 visual cleanup */`。

---

## 10. 会话进展总账（2026-07-03 ～ 07-04，当前状态以本节为准）

这一节汇总连续多轮开发后的**真实状态**。第 5 节的问题清单是历史分析，本节是结论。所有改动均通过 `npm run typecheck` 并完成 `package:dir + package` 打包验证；每个主题在 `config/` 下有对应维护记录。

### 10.0 最新进展（2026-07-05 补记）与可靠性警告 ⚠️

**给下一个 AI 的第一条忠告：不要轻信历史"已完成"记录，先用 `npm run typecheck` + `npm run build` 验证真实状态。** 原因如下——

- 之前某轮会话的工具输出（grep/sed/文件读取）曾大面积错乱，导致**多处"已完成"是假象，实际并未落地**。已证实的两例：
  1. **甘蔗 Tutor 图片多模态**曾被记为"已完成 + 打包"，但实际只落地了 `Tutor.tsx` 里 `sendMessage` 三行，其余全缺（typecheck 报 3 个错）。**已于本次补齐**（见下）。
  2. 曾记"Vitest 15 个单测通过"——**实际没有任何测试文件**（`npm test` 报 no test files）。vitest 已装、`test` 脚本在，但 `src/__tests__` 从未真正创建。
- **教训**：接手后第一步永远是跑 typecheck / build 拿地面真相，再动手。

**本次（2026-07-05）真正完成的：甘蔗 Tutor 图片多模态（全链路补齐并验证）**
- `ai-client.ts`：新增并接入 `toOpenAiContent` / `toAnthropicContent`——把中性图片格式 `{type:'image',dataUrl}` 转成 OpenAI 的 `image_url` 与 Anthropic 的 base64 `source` block（此前完全缺失，图片传不出去）。
- `ipc/ai.ts`：`tutor:chat` 接收 `images?` 并构造中性 content（此前已在）。
- `preload/index.ts`+`api.d.ts`+`env.d.ts`：`tutorChat` 的 message 类型加 `images?: string[]`。
- `store/tutor.ts`：`TutorMessage.images` 字段 + persist partialize **剥离图片**（base64 大，防撑爆 localStorage，历史留文字、图片仅当会话内存可见）。
- `Tutor.tsx`：`pendingImages` 状态、选图/粘贴处理、`modelLikelySupportsVision` 发图前非阻塞预检提示、图片按钮、待发送预览条、隐藏 file input、消息气泡渲染图片、history 带 images。
- `tsinghua.css`：输入栏改 flex 容纳图片按钮 + 预览条 + 消息图片样式（末尾新 pass）。
- **验证**：`npm run typecheck` 通过、`npm run build` 端到端成功。**注意模型需支持视觉**（GPT-4o/Claude/Gemini/Qwen-VL 等），非视觉模型（如 deepseek-chat）发图会报错，错误已透出到聊天流。
- **状态**：改动当时为**未提交**（工作区修改），交付时请自行决定是否 `git commit`。

### 10.1 问题清单状态对照表

| 编号 | 状态 | 落地方式 / 关键文件 |
|---|---|---|
| A1 | ✅ | 课程/作业/公告/讨论已入索引（`ipc/stats.ts` feedSearchIndex）+ 搜索框 300ms 防抖 + 结果按 targetId 定位跳转。**2026-07-04 补完**：邮件索引接线（`mail-service.ts` `reindexAllMail()` 在 `getMailListUnified` / `deleteMail` 调用，全局搜索和 Tutor search_emails 现能命中已拉取过的邮件），见 `config/p6` |
| A2 | ✅ | `focus-store.ts` + `ipc/focus.ts`；邮件"转今日重点"、Tutor `add_focus_item` 都写入，`computeDashboard` 合并进 todayFocus |
| A3 | ✅ | 邮件附件写入临时目录，`mail:save-attachment` 走保存对话框另存 |
| A4 | ✅ | `store/tutor.ts` 重写为多会话 + zustand persist（见 10.2） |
| A5 | ✅ | `ai.ts` 现仅 34 行委托 ai-client，`completeMultimodal`/`completeNonStreaming` 死导出早已不存在（unsolved 早确认） |
| A6 | ✅ | **2026-07-04 整轨切除**：`mail-service.ts` 网页抓取死代码删完（~800 行 → 文件 ~290 行），见 `config/p6`。`utils/icons.ts` / `window:command` / `tmp/` 前轮已清 |
| A7 | ✅ | 课件详情假数据（假上传时间/通用简介）已改为无数据显示"—"、空简介隐藏 |
| B1 | ✅ | `(imapClient as any).getBoxes`，typecheck 通过 |
| B2 | ✅ | `ai-client.ts` 统一通道 + 规范工具协议；**并修复 DeepSeek 严格校验的 `tool_calls[].type:"function"` 缺失**（见 10.4） |
| B3 | ✅ | ai-client SSE 跨 chunk 缓冲 |
| B4 | ✅ | 流式发送改用 `event.sender` |
| B5 | ✅ | office-converter 按 Word/PPT/Excel 分别生成 COM 脚本（PPT 用 WithWindow=$false 不设 Visible） |
| B6 | ✅ | secret-store provider 命名空间隔离、禁 default fallback |
| B7 | ✅ | 删除 `rejectUnauthorized:false`，恢复严格 TLS（实测无兼容问题） |
| B8 / B24 | ✅ | 删除改 `move()` 到 Trash，且 **move 后 expunge + 列表过滤 `\Deleted`**（Coremail 无 MOVE 扩展的双保险） |
| B9 | ✅ | 主进程返回原始 HTML + cid 图片转 data URI；renderer sandboxed iframe 渲染（`base target=_blank`、flex 占满高度、空段落折叠、货币/引号处理） |
| B10 | ✅ | **2026-07-04 完成**：UID 增量同步（`mail-sync.json` 存 uidvalidity+maxUid，`fetchMailList` 增量 `uid.fetch`，无新邮件不发请求）+ 缓存按 username 二级隔离。见 `config/p8` |
| B11 | ✅ | Homework.tsx 的 `dangerouslySetInnerHTML` 已套 DOMPurify |
| B12 | ✅ | `powerMonitor.getSystemIdleTime()`+窗口可见性算真实活跃；无作业课程剔除总进度；`getStatsForAI` 统一 |
| B13 | ✅ | loadCourses 优先读 `lastSemesterId` |
| B14 | ✅ | `stats:refreshDashboard` 下沉主进程并发拉取 + SWR 磁盘缓存 |
| B15 | ✅ | `requestSingleInstanceLock` + second-instance 显示窗口 |
| B16 | ✅ | **2026-07-04 完成**：课件主线早已用 `courseId_fileId` 键 + 子目录；本轮把 HomeworkDetail / Notifications 附件也迁到 `courseId+fileId` 复合键 + `hw-attachments/<nsCourseId>/` 子目录隔离，跨课程/跨作业同名附件不再误判。见 `config/p7` |
| B17 | ✅ | 课件文本注入拆题 prompt、子代理限并发、signal 全链路透传 |
| B18 | ✅ | ①"仅供参考"移出历史（渲染层追加）②健康检查改查 Key 存在不发计费请求 ③输入框多行 TextArea ④MAX_LOOPS 提到 8 + 到顶提示 |
| B19 | 🟩 部分 | ①自动登录竞态已加 did-finish-load 守卫 ②Files 闭包已改 ③MarkdownRenderer 已支持表格（不再是"待删特判"） |
| B20 | ✅ | `ensureMailConnection()` 接入全部邮箱 IPC + 断线监听 + keepalive；重启免登录、断线自动重连 |
| B21 | ✅ | SMTP 成功后 MailComposer 生成 RFC822 + IMAP APPEND 到 Sent |
| B22 | ✅ | 后端 `searchMail` 两级（本地过滤 + IMAP SEARCH）+ IPC `mail:search`；前端 AppShell 顶栏搜索接线 |
| B23 | ✅ | fetchMailBody 竞态：`end` 不再 reject 进行中的解析，仅 `!sawMessage` 时 reject（见第 8.6） |
| B25 | ✅ | 启动 `cleanupMailTemp()` 清空附件临时目录 |
| B26 | ✅ | **新发现**：downloader 缺 Content-Length 完整性校验，大文件截断静默产出坏文件（见 10.4） |
| C1 | ✅ | `ai-client.ts` 建成，complete/agent loop/健康检查统一消费 |
| C2 | ⏸️ 评估后暂缓 | tsinghua.css 现 9371 行（pass1~8 叠加 + 大量 `!important` 覆盖链）。激进拆分零收益高风险（破坏级联导致 UI 回归），与用户确认暂缓。保留单文件 + 铁律 7。详见 `config/p9` |
| C3 | 🟩 | 本文档已更新；上级 `D:\ai\CLAUDE.md` 旧文档仍在（非本仓库，未动） |

### 10.2 本次会话新增 / 重构的架构组件

**`services/ai-client.ts`（C1，AI 通道统一）**
唯一的 AI 调用入口。职责：读设置 → 按 `apiFormat`（openai/anthropic）构造规范请求（含工具协议序列化、`tool_calls[].type:"function"` 补全）→ 带缓冲的 SSE 流解析 → AbortController + 请求超时（180s）。`complete()`、`runAgentLoop` 的 `runAiCall`、健康检查全部消费它。**任何新 AI 功能都走这里，不要再复制第四份实现。**

**甘蔗 Tutor 工具面（19 个，`tutor-agent.ts` TOOLS + `ipc/ai.ts` executeTutorTool）**
原 12 个（list_courses/list_homeworks/list_emails/search_emails/get_email/list_files/list_notices/list_discussions/summarize_content/complete_homework/search_global/get_stats）
新增 7 个：`get_file_content`（下载解析课件全文）、`get_homework_detail`（要求+附件+**得分/批阅**）、`get_notice_detail`（公告全文）、`list_deadlines`（读 dashboard 磁盘缓存，毫秒级）、`add_focus_item`（写今日重点）、`draft_mail`（起草不发送）、`navigate_to`（renderer 渲染跳转卡片）。
安全边界：**唯一写操作是 add_focus_item；发邮件、提交作业永不给 Agent**（只到"草稿/预览+用户确认"）。工具执行有 30s 超时兜底。

**`store/tutor.ts`（多会话 + 持久化，A4）**
结构：`sessions: TutorSession[]`（每个含 id/title/messages/updatedAt，最多 10 个 LRU）+ `currentId` + `style` + `context`(pageContext，不持久) + `pendingPrompt`(不持久)。persist 只存 sessions/currentId/style。关键 action：`startFocused(ctx, prompt?)`——带上下文进入时若当前会话非空则开新会话（修上下文串扰）。消费用 `useCurrentTutorMessages()`。

**`store/summaries.ts` + `components/TutorSummaryDrawer.tsx`（总结抽屉化 + 持久化 + 追问）**
总结从弹窗改为右侧抽屉。`summaries` store（persist，键→{content,createdAt}，60 条 LRU）：同一对象的总结生成一次即缓存，重开秒显、不重复生成。抽屉支持"重新生成"和（可选）"课件追问对话"——`chatRun` prop 有值时底部出现输入框，走 `hwai:file-chat` → `tutor.ts` askAboutFile（基于课件全文多轮问答）。接入四处：课件（Files，带追问）、公告（Notifications）、讨论（Discussion）、邮件（Mailbox）。

**`focus-store.ts` + `ipc/focus.ts`（今日重点手动项，A2）**
`ManualFocusItem` type 为 `email | custom`；`focus.add/remove/list`。邮件"转今日重点"和 Tutor `add_focus_item` 都写入；`computeDashboard` 经 `convertToTodayFocus` 合并进首页 todayFocus。

**邮件连接与缓存（`mail-service.ts` / `mail-imap.ts`）**
`ensureMailConnection()`（in-flight 去重，自动用已存配置重连）接入全部邮箱 IPC；连接就绪注册 close/end/error 断线监听 + keepalive(forceNoop)。按文件夹列表缓存(60s)+详情缓存(30min)；删除 move+expunge+过滤\Deleted；发送 APPEND 到 Sent；两级搜索；启动清临时附件目录。

**`MarkdownRenderer.tsx`（表格 + 分割线 + KaTeX）**
GFM 表格、`---` 分割线、KaTeX 公式（`$$..$$`/`\[..\]` 块级，`$..$`/`\(..\)` 行内）。**货币保护**：`$..$` 仅在含 `\ ^ _ { }` 特征时当公式，`$350` 等原样保留。依赖 `katex`。

**全局非线性动画（`tsinghua.css` pass 6 + AppShell 节流）**
缓动令牌 `--lp2-ease-out`（快出缓停）/`--lp2-ease-spring`（回弹）；页面进入上浮淡入、列表前 8 行级联、按压 scale(0.96) 微反馈；`prefers-reduced-motion` 全禁；AppShell 对 10s 内连续导航加 `body.lp2-anim-quiet` 抑制重播。

**下载完整性校验（`downloader.ts`，B26）**
三个下载函数在 end/finish 校验 `loaded == Content-Length`，截断则删坏文件并报错（可重试），不再静默产出坏文件。

### 10.3 剩余未完成项（下一个 agent 的候选任务）

**2026-07-04 更新：原 1–8 项已全部清完或评估完毕。** 当前主要清单为空。可选的后续方向：

1. **C2 CSS 模块化** ⏸️：评估后暂缓（见 10.1 对照表与 `config/p9`）。如要重启按 `config/p9` 末尾的安全顺序。
2. **更多单测覆盖**：给 attachment-parser 类型判定补测（需先 export `extToKind`/`sniffKind` 或加间接测试）、stats 口径、`formatMailDate`/`addressText` 等纯函数。
3. **邮件索引预拉**：当前 `reindexAllMail` 只索引"已打开过的文件夹"。如要"开邮箱即索引全部文件夹"，可在 `ensureMailConnection` 成功后预拉四文件夹（注意流量）。
4. **`files:downloadState` 旧单参分支清理**：目前无 renderer 调用者，保留作 backward-compat；如确认彻底不需可删。
5. **downloader socket 超时打磨**：已加 30s 请求超时 + 120s 闲置超时（见 `config/p9`）；如遇实际下载卡死可调阈值。

> 历史条目（A6 / A5 / A1 / B16 / B10 / 单测 / socket 超时）已在 2026-07-04 全部完成，详见 `config/p6`~`p9` 与 10.1 对照表。

### 10.4 会话中新发现并修复的问题（不在原 A/B/C 编号里）

- **DeepSeek 工具调用第二轮 400**：流式累积的 `tool_calls` 缺 `type:"function"`，DeepSeek 等严格校验的 openai 兼容服务商回传时 400 → 工具调用"卡住无回复"。ai-client `buildOpenAiBody` 与 agent loop 双侧补 type。**并把错误全链路透出**（loop 返回 error → 写进聊天流"⚠️ 对话出错" + electron-log），杜绝静默吞错。
- **PDF/课件总结失败根因 = 扩展名丢失**（不是 pdf-parse）：课件 title 无扩展名 → 临时文件无扩展名 → parseAttachment 按 `path.extname` 判类型落 default 返回空。用真实课件文件本地验证：PDF 提取 7764 字符、DOCX 7881 字符。修复：`tutor.ts` 用 fileType 补扩展名 + `attachment-parser.ts` magic-byte 嗅探兜底 + 40MB 上限保护。**顺带确认那个 107MB pptx 是下载截断的坏文件（缺 zip EOCD），引出 B26。**
- **downloader 静默截断（B26）**：见 10.2 末。
- **LaTeX 不渲染**：MarkdownRenderer 手写解析器不支持数学，接入 KaTeX（含货币保护）。
- **Tutor 看不到作业得分**：list_homeworks/get_homework_detail 原本不返回 grade 字段，补 status/graded/grade/gradeLevel/graderName/gradeComment（负分过滤）。
- **Tutor 上下文串扰**：带上下文进入复用了正在聊别课的旧会话 → `startFocused` 自动开新会话。

### 10.5 UI 视觉整改历程（tsinghua.css pass 1~8，详见 config/uiupdate.md）

- **pass 1–2**：邮件页 M1–M13（信息降噪、去表头、网格重排、读信 flex 高度、写邮件改页面视图+滑入动画、收件人截断、空段落折叠）
- **pass 3**：邮箱全线无界化（去分隔线改圆角悬浮块、控件柔和填充聚焦显边）+ 登录页聚焦（账号密码为主，服务器/端口/TLS 折叠进高级设置）
- **pass 4**：甘蔗 Tutor 无界化（消息气泡去边框、chips 填充、工具状态脉冲线、空状态引导卡片、跳转卡片、会话栏）
- **pass 5**：Tutor 工具卡死修复配套 + 课程顶栏"问甘蔗"按钮叠加修复
- **pass 6**：作业页无界化（去空圆点列、分数配色）+ 全局非线性动画系统
- **pass 7**：总结抽屉 / Markdown 表格 / 一键作业无界卡片 / 动画节流
- **pass 8**：作业页两列布局 + 分数改绿、上下文 chip 去绿、用户气泡字重、KaTeX 样式、课件追问对话区

**全局无界设计范式**（后续页面统一参照）：结构分组靠间距+圆角悬停底色而非分隔线；表单控件柔和填充（`#F6F3FB`）、聚焦才显紫边；每屏 primary 按钮 ≤1；同一信息 ≤2 处；占位文案不成列。

### 10.6 config/ 维护记录索引（深入某主题时查）

每个主题的"背景 / 思路 / 结果 / 后续注意"都在 `config/` 下：

| 主题 | 记录文件 |
|---|---|
| P0 止血（typecheck / 单实例锁 / 消毒 / TLS / 密钥隔离） | `p0-stop-the-bleeding.md` |
| P1 AI 通道统一（ai-client.ts、工具协议、SSE 缓冲） | `p1-ai-channel-unification.md` |
| P3 邮箱修复（连接管理 / 删除 / 发送 / 搜索 / HTML 正文 / 竞态） | `p3-email-fixes.md` |
| P4 统计与仪表盘（真实活跃时间 / SWR / 今日重点） | `p4-stats-dashboard.md` |
| P5 预览与下载（office-converter / 下载键 / 批量） | `p5-preview-downloads.md` |
| P6 清理 | `p6-cleanup.md` |
| P6 邮箱死代码清理 + 邮件索引接线（A6 + A1，2026-07-04） | `p6-mail-deadcode-and-index.md` |
| P7 下载状态改 courseId+fileId 键（B16，2026-07-04） | `p7-download-state-key-fix.md` |
| P8 邮件 UID 增量同步 + 账号隔离（B10，2026-07-04） | `p8-mail-uid-incremental-sync.md` |
| P9 单测补齐 + downloader socket 超时 + C2 评估（2026-07-04） | `p9-tests-socket-css.md` |
| Office→PDF 分应用修复 | `b5-office-converter-fix.md` |
| 全局搜索索引接线 | `search-index-fix.md` |
| 甘蔗 Tutor 三批（全栈融入 / PDF 解析 / 追问 / 得分 / LaTeX / 上下文 / 一键作业） | `ganzhe-tutor-optimization.md` |
| 邮箱持久化 + 后端性能（缓存 / SWR / 全部页复用快照 / 下载完整性） | `maintenance.md`、`download.md` |
| UI 无界化 + 非线性动画 pass 1~8 | `uiupdate.md` |

> 新增记录时：同一主题追加到已有文件，新主题新建；文件命名用主题名（非日期）。
