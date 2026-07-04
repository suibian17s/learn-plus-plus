# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

learn++ 2.0 是清华网络学堂 Windows 桌面客户端，基于 Electron 31 + React 18 + TypeScript 5。定位：清爽、现代、柔和圆润但专业的第三方学习工作台。

内置 AI 助手统一称为 **甘蔗 Tutor**，不是独立产品或联名产品。全局只有一个 AI 角色。

> **接手前必读**：根目录 [HANDOVER.md](HANDOVER.md) 是 2026-07-02 全量代码审查后的交接文档，包含架构速览、按编号整理的已知问题清单（假功能 / bug / 安全 / 技术债）与分阶段实施路线图。开工前先读它，修完问题同步更新它和 `unsolved.md`。注意：`npm run typecheck` 当前处于失败状态（见 HANDOVER.md 问题 B1）。

## 常用命令

```bash
npm run dev              # 开发模式（electron-vite dev）
npm run typecheck        # TypeScript 类型检查（主进程 + 渲染进程）
npm run build            # electron-vite 构建
npm run package:dir      # 生成 dist-installer/win-unpacked/
npm run package          # 生成 NSIS 安装包
```

正式产物：

```text
dist-installer/win-unpacked/learn++.exe
dist-installer/learn++ Setup 2.0.0.exe
```

## 维护铁律

1. 不要回退用户或其他 agent 已有改动。
2. 每完成重要功能或重要 bug 修复，在 `config/` 下新增或更新 Markdown 记录。
3. 新增 IPC 时必须同步三个文件：
   - `src/preload/index.ts`（contextBridge 暴露）
   - `src/preload/api.d.ts`（preload API 类型）
   - `src/renderer/src/env.d.ts`（renderer 侧类型声明）
4. Renderer 运行在 sandbox 中，不能直接访问 Node.js、文件系统或本地路径，必须走 IPC。
5. 涉及登录态、Cookie、下载、作业提交、AI Key 的改动，至少运行 `npm run typecheck`；发布前运行 `npm run package:dir` 和 `npm run package`。
6. 讨论区详情继续使用内置 BrowserWindow 加载网络学堂原始页面，不要静态抓取重写。
7. 修改 UI/CSS 时优先在 `tsinghua.css` 末尾追加 final override，避免被前面历史覆盖规则吞掉。该文件有多轮迭代留下的重复规则，不要随意删除看起来重复的规则——它们可能是有意为之的覆盖层。
8. 所有图片禁止作为拖拽热区（`draggable="false"` + CSS `-webkit-user-drag: none`）。
9. **所有 AI 调用走统一的 `services/ai-client.ts`**（读设置 / 按 apiFormat 构造请求 / 工具协议 / 带缓冲 SSE 解析都在这里）。不要再新建平行的 AI 调用实现（历史上有过三份，行为漂移，见 HANDOVER C1）。新增流式 AI 功能复用 `hwai:generate-chunk` / `hwai:generate-end` 事件通道（带 sessionId 区分）。
10. **OpenAI 兼容服务商（DeepSeek 等）严格校验**：回传的 assistant `tool_calls[]` 必须带 `type: "function"`，否则第二轮请求 400；工具结果必须作为独立的 `role:"tool"` + `tool_call_id` 消息，不能塞进 user 文本。ai-client 已处理，改工具链时勿破坏。
11. 网络学堂课件的 title **不带扩展名**；解析（`attachment-parser`）前必须用 `fileType` 补回扩展名，否则按 `path.extname` 判类型会失败（`tutor.ts` 已处理，parser 另有 magic-byte 嗅探兜底）。

## 目录速览

```text
src/main/
  index.ts              应用入口、窗口、托盘、session 保活、崩溃恢复、单实例锁、cleanupMailTemp
  ipc/                  auth、courses、files、homework、discussion、notifications、settings、ai、app、stats、mail、focus
  services/
    learn.ts            登录态、Cookie 清洗、thu-learn-lib 适配核心
    session-store.ts    凭据、账号档案、会话持久化
    browser-login.ts    官方网页登录窗口
    downloader.ts       带 Cookie 的下载通道（含 Content-Length 完整性校验）
    ai-client.ts        【统一 AI 客户端】唯一的 AI 调用层（读设置/构造请求/工具协议/缓冲 SSE/超时）
    ai.ts               complete() 等，委托 ai-client（不再是重复实现）
    tutor-agent.ts      Tutor 工具定义（19 个）+ agent loop
    tutor.ts            公告/课件/讨论总结、askTutor、课件追问 askAboutFile、课件文本缓存
    tutor-prompts.ts    Tutor 系统提示词（cute/serious + pageContext 上下文注入）
    homework-ai.ts / homework-orchestrator.ts / homework-subagent.ts / homework-reviewer.ts / homework-style-learner.ts
    mail-imap.ts / mail-service.ts   IMAP/SMTP + 连接管理 + 缓存 + 两级搜索
    stats.ts            学习时长(powerMonitor)/进度/computeDashboard/getStatsForAI
    focus-store.ts      首页"今日重点"手动项持久化
    office-converter.ts Office→PDF（按 Word/PPT/Excel 分别处理）
    secret-store.ts     API Key + 邮箱密码加密保存（provider 命名空间隔离）
    attachment-builder.ts   生成 DOCX/PDF 附件
    attachment-parser.ts    解析 PDF/DOCX/PPT/XLS（扩展名 + magic-byte 嗅探 + 40MB 上限）
  utils/                paths、sanitize、errors

src/preload/
  index.ts              contextBridge 暴露 window.learn（含 hwai、stats、focus、mail、search 等）
  api.d.ts              preload API 类型

src/renderer/src/
  components/           AppShell、WindowControls、TsinghuaLogo、EmptyState、HomeworkPreview、
                        RiskDisclaimerModal、MarkdownRenderer（表格/KaTeX）、TutorSummaryDrawer（总结抽屉）
  pages/                Login、Dashboard、Mailbox、Tutor、Files、Notifications、Homework、HomeworkDetail、HomeworkAutoComplete、Discussion、DiscussionDetail、Answering、AnsweringDetail、Questionnaire、Downloads、About、Settings、AllTasks、AllCourses、AllUpdates
  store/                auth.ts、ai.ts、downloads.ts、tutor.ts（多会话+persist）、summaries.ts（总结缓存）（Zustand）
  styles/               global.css、tsinghua.css（约 8700 行，含 pass1~8 无界化/动画）
  utils/                time.ts

src/shared/
  aiProviders.ts        甘蔗 Tutor 服务商与模型预设

config/                 维护记录（按主题命名）
resources/              图标资源
scripts/                构建辅助脚本
```

## 窗口与外壳

Electron 窗口使用自绘圆角矩形（`frame: false, transparent: true`），系统标题栏已移除。右上角窗口控制按钮（最小化、最大化/还原、关闭）由 `WindowControls.tsx` 自绘，关闭按钮带非线性淡出/缩放动画。

顶部区域可拖拽移动窗口，但交互元素、图片、按钮、输入框都必须设置 `no-drag`。

关键文件：
- `src/renderer/src/components/WindowControls.tsx`
- `src/main/ipc/app.ts`（`window:minimize`、`window:toggle-maximize`、`window:close`、`window:quit`）
- `src/renderer/src/styles/tsinghua.css`

主界面底色为纯白。框架外阴影由 Electron `hasShadow: false` 关闭，阴影改用 CSS 实现。

## 左侧导航与课程列表

一级导航只保留三项：**首页**、**邮箱**、**甘蔗 Tutor**。课程列表在导航下方直接展示（学期选择移入设置页）。课程列表可滚动，保留浅紫色细滚动条。首页打开时课程列表不选中，进入具体课程页后才高亮。

关键文件：`src/renderer/src/components/AppShell.tsx`

## 登录与多账号

只保留官方网页登录。账号密码登录 UI 已删除（但 `auth:login` IPC 和 `learn.ts` 中的 `login()` 函数作为 fallback 保留，用于 session 保活自动重登录）。

多账号机制：
- 浏览器登录成功后调用 `getHelper().getUserInfo()` 读取姓名/院系。
- API session cookies 保存为账号档案，写入 `accounts.enc`。
- 左上角 logo 菜单列出已保存账号，可添加、切换、退出。
- 账号档案是 cookies 快照，不是账号密码。
- 旧单 session 登录态在读取账号列表时尝试迁移为账号档案。
- Cookies 过期时切换失败，应提示用户重新添加。

关键文件：`src/main/ipc/auth.ts`、`src/main/services/browser-login.ts`、`src/main/services/learn.ts`、`src/main/services/session-store.ts`、`src/renderer/src/components/AppShell.tsx`、`src/renderer/src/pages/Login.tsx`

## Cookie 与会话管理

网络学堂可能写入非 Latin1 Cookie，Electron/undici 拼接 Header 时会抛 `TypeError: Cannot convert argument to a ByteString`。

当前使用两个独立 session：
- `session.defaultSession`：官方网页登录窗口、讨论区原始页面。
- `session.fromPartition('persist:learnpp-api')`：thu-learn-lib、下载、作业提交、API 调用。

`src/main/services/learn.ts` 中的关键函数：`sanitizeSession`、`sanitizeApiSession`、`syncCookiesToApiSession`、`syncApiCookiesToDefaultSession`、`saveApiSessionToDisk`、`restoreApiSessionFromDisk`、`restoreApiSessionCookies`、`getApiSessionCookiesSnapshot`、`apiFetch`、`withAuth`。

任何新网络请求都应复用 `apiFetch` 或 `withAuth`，不要绕过 Cookie 清洗。

**Session 保活**：主进程每 10 分钟调用 `probeApiSession()` 检测 API session 有效性，失效时尝试用已保存凭据重新登录（见 `src/main/index.ts` 中 `startSessionKeepAlive`）。

**Renderer 崩溃恢复**：主进程监听 `render-process-gone` 和 `unresponsive` 事件，自动 `reloadIgnoringCache()`（见 `src/main/index.ts`）。

## 下载

关键文件：`src/main/services/downloader.ts`、`src/main/ipc/files.ts`、`src/main/ipc/homework.ts`、`src/renderer/src/store/downloads.ts`、`src/renderer/src/pages/Downloads.tsx`

不使用 Electron `downloadURL`，而是 Node `http/https` 手动请求并显式附带 Cookie，以避免中文 Cookie、中文响应头和扩展名丢失问题。

**完整性校验**：`downloader.ts` 三个下载函数都校验 `已下载字节 == Content-Length`，截断则删坏文件并报错（可重试），避免大文件传输中断时静默产出打不开的坏文件。

下载状态判断同时参考：当前下载目录中是否已有目标文件 + Zustand persist 中下载历史是否有完成记录。

## 作业

关键文件：`src/main/ipc/homework.ts`、`src/renderer/src/pages/Homework.tsx`、`src/renderer/src/pages/HomeworkDetail.tsx`

注意点：
- Renderer sandbox 下拿不到真实文件路径，文件选择必须通过主进程 `dialog.showOpenDialog()`。
- 提交附件前复制到临时目录。
- `hw:submit` 手动构造 `multipart/form-data`，字段顺序需接近原站表单。
- 成绩字段过滤异常负值（如 `-60` 不能展示为真实分数）。
- 老师留言、作业要求、提交内容可能含 HTML，渲染前必须消毒。

## 邮箱

IMAP/SMTP 连接清华邮箱（`mails.tsinghua.edu.cn`，993 SSL / 465 SSL），**非网页抓取**。**动这个模块前必读 HANDOVER 第 8 节**（两条已废弃路线不要重走、fetchMailBody 竞态大坑、目标架构与 8.5 验收清单）。

关键机制：
- **登录**：窗口内输入账号密码（Mailbox 登录卡片 + 设置页），服务器/端口/TLS 折叠进"高级设置"。未开两步验证用普通密码即可，开了则需客户端专用密码。
- **自动连接**：任何邮箱 IPC 前 `await ensureMailConnection()`，用已存配置+加密密码自动重连；**重启免登录**。`logoutMail` 会断开并清除已存密码（否则被自动连回）。
- **缓存**：按文件夹列表(60s) + 详情(30min)；renderer 侧 `mailListMemory` 即时渲染；刷新按钮传 `force` 绕过。
- **删除** move 到 Trash + expunge + 列表过滤 `\Deleted`（Coremail 无 MOVE 扩展的双保险）；**发送** SMTP 后 APPEND 到 Sent；**搜索** 本地过滤 + 服务端 IMAP SEARCH 两级。
- **正文**：主进程返回原始 HTML + `cid:` 内嵌图转 data URI；renderer 用 sandboxed iframe 隔离渲染（不污染应用样式）。
- **竞态雷区**：`fetchMailBody` 的 `end` 事件**绝不能 reject 正在解析的请求**（会永远跑赢 mailparser 异步回调），只在 `!sawMessage` 时 reject。

关键文件：`mail-imap.ts`、`mail-service.ts`、`ipc/mail.ts`、`pages/Mailbox.tsx`、`pages/Settings.tsx`（邮箱配置卡）

## 甘蔗 Tutor

关键文件：`src/shared/aiProviders.ts`、`src/main/services/ai-client.ts`（AI 通道）、`src/main/services/tutor.ts`、`src/main/services/tutor-agent.ts`、`src/main/services/tutor-prompts.ts`、`src/main/services/homework-ai.ts`、`src/main/services/attachment-parser.ts`、`src/main/ipc/ai.ts`、`src/renderer/src/pages/HomeworkAutoComplete.tsx`、`src/renderer/src/pages/Tutor.tsx`、`src/renderer/src/store/tutor.ts`、`src/renderer/src/store/summaries.ts`、`src/renderer/src/components/TutorSummaryDrawer.tsx`、`src/renderer/src/components/MarkdownRenderer.tsx`、`src/renderer/src/components/RiskDisclaimerModal.tsx`

能力：多轮对话（19 个工具：查课程/作业/课件/公告/讨论/邮件、读全文、看得分、查截止、加今日重点、起草邮件、跳转卡片）、公告/课件/讨论/邮件总结（右侧抽屉 `TutorSummaryDrawer`，持久缓存 + 可追问）、作业答疑、一键完成作业流水线（附件优先提交）。

关键机制（详见 HANDOVER 第 3.2 / 10.2）：
- **上下文感知**：从课程页/作业页点"问甘蔗"用 `useTutorStore.getState().startFocused(ctx, prompt?)`——非空会话会自动开新会话，避免上下文串扰；`pageContext` 经 `tutor:chat` 注入 system prompt。
- **会话持久化**：`store/tutor.ts` 多会话结构（persist，最多 10 个），顶部会话栏可切换/删除。
- **总结持久化**：`store/summaries.ts` 缓存每个对象的总结，重开秒显不重复生成；课件抽屉可追问（`hwai:file-chat` → `askAboutFile` 基于课件全文）。
- **Markdown/LaTeX**：`MarkdownRenderer` 支持表格、`---`、KaTeX 公式（`$..$` 有货币保护，`$350` 不当公式）。
- **安全边界**：Agent 唯一写操作是 add_focus_item；发邮件、提交作业永不给 Agent（只到草稿/预览 + 用户确认）。

API Key：
- `src/main/services/secret-store.ts` 按服务商加密保存（provider 命名空间隔离，禁 default fallback）。
- 不允许从 Renderer 读回明文。

模型预设：OpenAI、Anthropic、Gemini、DeepSeek、Qwen、GLM、Kimi、豆包、SiliconFlow、OpenRouter、自定义接口。设置页不显示地域标签。旧模型名在读取设置时迁移到当前服务商默认模型。

## 视觉体系

- 主色：紫色 `#6B46C1` / `#4C1D95`
- 辅助色：甘蔗绿 `#7CB342` / `#4F8A10`（仅甘蔗 Tutor 相关入口）
- 背景：主界面纯白，登录页浅紫白渐变
- 卡片：白底、淡紫边框、柔和紫色阴影、较大圆角
- 主按钮：紫色渐变；Tutor 辅助按钮：浅绿底绿色文字
- 学术诚信风险提示：浅黄色，不用刺眼红色

## 发布前检查

```bash
npm run typecheck
npm run package:dir
npm run package
```

> 打包前建议先 `Get-Process "learn++" | Stop-Process -Force` 杀掉残留实例（否则 DLL 被占用会报 `Access is denied` 打包失败）。本项目所有打包都前置这一步。

确认：
- `dist-installer/win-unpacked/learn++.exe` 时间更新。
- `dist-installer/learn++ Setup 2.0.0.exe` 生成。
- 旧版后台进程未占用打包目录（打包时如 DLL 被占用，先退出托盘中的旧版）。
- 登录页只保留官方网页登录。
- 左上角账号菜单可添加、切换账号。
- 托盘菜单文案为"打开 learn++ / 退出"。
