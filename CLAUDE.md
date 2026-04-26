# CLAUDE.md - learn++ v1.1 Agent Handoff

本文面向后续接手 learn++ 2.0 开发的 AI 编程助手和维护者。重点是架构边界、危险点、维护约定和已经踩过的坑。

## 项目定位

learn++ 是清华网络学堂 Windows 桌面客户端，基于 Electron + React + TypeScript。v1.1 已具备：

- 官方网页登录与多账号切换
- 课程、公告、课件、作业、讨论、答疑、问卷
- 下载历史与已下载识别
- 作业查看、提交、修改、批阅展示
- 讨论区原站交互窗口
- 后台托盘与开机后台运行
- 甘蔗 tutor AI 学习助手
- “关于”页面与正式版 README

## 常用命令

```bash
npm run dev
npm run typecheck
npm run build
npm run package:dir
npm run package
```

正式产物：

```text
dist-installer/win-unpacked/learn++.exe
dist-installer/learn++ Setup 1.1.0.exe
```

## 维护铁律

1. 不要回退用户或其他 agent 已有改动。
2. 手动改文件使用 `apply_patch`。
3. 每完成重要功能或重要 bug 修复，都要在 `config/` 下新增或更新 Markdown 记录。
4. 新增 IPC 时必须同步：
   - `src/preload/index.ts`
   - `src/preload/api.d.ts`
   - `src/renderer/src/env.d.ts`
5. Renderer 运行在 sandbox 中，不能直接访问 Node.js、文件系统或真实本地路径，必须走 IPC。
6. 涉及登录态、Cookie、下载、作业提交、AI Key 的改动，至少运行 `npm run typecheck`；发布前运行 `npm run package:dir` 和 `npm run package`。
7. 讨论区详情不要再静态抓取重写，继续打开网络学堂原始交互页面。

## 目录速览

```text
src/main/
  index.ts              应用入口、窗口、托盘、app info IPC
  ipc/                  auth、courses、files、homework、discussion、notifications、settings、ai
  services/
    learn.ts            登录态、Cookie、thu-learn-lib 适配核心
    session-store.ts    凭据、账号档案、会话持久化
    browser-login.ts    官方网页登录窗口
    downloader.ts       带 Cookie 的下载通道
    homework-ai.ts      AI 作业辅助
    tutor.ts            甘蔗 tutor 总结/问答
    secret-store.ts     API Key 加密保存
  utils/                paths、sanitize、errors

src/preload/
  index.ts              contextBridge 暴露 window.learn
  api.d.ts              preload API 类型

src/renderer/src/
  components/           AppShell、Logo、EmptyState、风险承诺等
  pages/                Login、About、Settings、课程功能页面
  store/                Zustand store
  styles/               全局样式和主题样式
  utils/                前端工具

src/shared/
  aiProviders.ts        甘蔗 tutor 服务商与模型预设

config/                 维护记录
resources/              图标资源
scripts/                构建辅助脚本
```

## 登录与多账号

只保留官方网页登录。账号密码登录 UI 已删除。

关键文件：

- `src/main/ipc/auth.ts`
- `src/main/services/browser-login.ts`
- `src/main/services/learn.ts`
- `src/main/services/session-store.ts`
- `src/renderer/src/components/AppShell.tsx`
- `src/renderer/src/pages/Login.tsx`

多账号机制：

- 浏览器登录成功后，调用 `getHelper().getUserInfo()` 读取姓名/院系。
- 当前 API session cookies 保存为账号档案，写入 `accounts.enc`。
- 左上角 logo 菜单列出已保存账号。
- 切换账号时恢复对应 cookies，重建 API session，并刷新课程列表。

注意：

- 账号档案是 cookies 快照，不是账号密码。
- 旧的单 session 登录态会在读取账号列表时尝试迁移为账号档案。
- 如果某账号 cookies 过期，切换会失败，应提示用户重新添加账号。

## Cookie 与网络学堂会话

网络学堂可能写入非 Latin1 Cookie，Electron/undici 拼接 Header 时会抛：

```text
TypeError: Cannot convert argument to a ByteString
```

当前架构使用独立 API session：

- `session.defaultSession`：官方网页登录窗口、讨论区原始页面。
- `session.fromPartition('persist:learnpp-api')`：thu-learn-lib、下载、作业提交、API 调用。

`src/main/services/learn.ts` 中的重要函数：

- `sanitizeSession`
- `sanitizeApiSession`
- `syncCookiesToApiSession`
- `syncApiCookiesToDefaultSession`
- `saveApiSessionToDisk`
- `restoreApiSessionFromDisk`
- `restoreApiSessionCookies`
- `getApiSessionCookiesSnapshot`
- `apiFetch`
- `withAuth`

原则：任何新网络请求都先考虑复用 `apiFetch` 或 `withAuth`，不要绕过 Cookie 清洗。

## 下载

关键文件：

- `src/main/services/downloader.ts`
- `src/main/ipc/files.ts`
- `src/main/ipc/homework.ts`
- `src/renderer/src/store/downloads.ts`
- `src/renderer/src/pages/Downloads.tsx`

当前下载不使用 Electron `downloadURL`，而是 Node `http/https` 手动请求并显式附带 Cookie。这样避免中文 Cookie、中文响应头和扩展名丢失问题。

下载状态判断同时参考：

- 当前下载目录中是否已有目标文件
- Zustand persist 中的下载历史是否有完成记录

## 作业

关键文件：

- `src/main/ipc/homework.ts`
- `src/renderer/src/pages/Homework.tsx`
- `src/renderer/src/pages/HomeworkDetail.tsx`

注意点：

- Renderer sandbox 下拿不到真实文件路径，文件选择必须通过主进程 `dialog.showOpenDialog()`。
- 提交附件前会复制到临时目录，避免 renderer 文件对象路径缺失。
- `hw:submit` 手动构造 `multipart/form-data`，保持字段顺序接近原站表单。
- 成绩字段要过滤异常负值，例如 `-60` 不能展示为真实分数。
- 老师留言、作业要求、提交内容都可能含 HTML，渲染前必须消毒。

## 讨论区

讨论区详情页继续使用内置 BrowserWindow 加载网络学堂原始页面。

原因：头像、点赞、回复、评论等依赖原站脚本、Cookie、样式和相对资源路径；静态抓取无法保证完整交互。

关键文件：

- `src/main/ipc/discussion.ts`
- `src/renderer/src/pages/Discussion.tsx`

## 后台与托盘

关键文件：

- `src/main/index.ts`
- `src/main/ipc/settings.ts`

行为：

- 点击窗口右上角关闭按钮：隐藏窗口，不退出。
- 托盘左键：打开窗口。
- 托盘右键：打开或退出。
- 开机自启动：写入 `--hidden` 参数，启动后后台运行。

打包时如果 `dist-installer/win-unpacked/*.dll` 被占用，通常是旧版 learn++ 仍在托盘后台运行，需要先退出或结束进程。

## 甘蔗 tutor

甘蔗 tutor 是正式名称，不再使用“AI 代写”文案。

关键文件：

- `src/shared/aiProviders.ts`
- `src/main/services/ai.ts`
- `src/main/services/tutor.ts`
- `src/main/services/homework-ai.ts`
- `src/main/ipc/ai.ts`
- `src/renderer/src/pages/HomeworkAutoComplete.tsx`
- `src/renderer/src/components/RiskDisclaimerModal.tsx`

能力：

- 公告总结
- 课件总结
- 讨论总结
- 作业答疑
- 高风险测试型作业辅助

API Key：

- `src/main/services/secret-store.ts`
- 按服务商加密保存。
- 不允许从 Renderer 读回明文。

模型预设：

- OpenAI、Anthropic、Gemini、DeepSeek、Qwen、GLM、Kimi、豆包、SiliconFlow、OpenRouter、自定义接口。
- 设置页不显示地域标签。
- 旧模型名会在读取设置时迁移到当前服务商默认模型。

## 关于页与版本

关于页：

- `src/renderer/src/pages/About.tsx`
- 路由：`/about`
- 入口：右上角设置菜单中的“关于 learn++”

版本来自 `app.getVersion()`，由 `package.json` 控制。发布新版本时同时检查：

- `package.json`
- `package-lock.json`
- README 安装包路径
- 打包产物文件名

## 文档与维护记录

`config/` 是维护流水账，不是用户手册。每个重要变更写清：

- 背景
- 修复/实现思路
- 结果
- 后续注意事项

已有记录覆盖下载、登录、作业提交、公告、讨论、多账号、后台、甘蔗 tutor 等主题。新增主题再新建 Markdown；同一主题继续更新已有文件。

## 发布前检查

发布前建议执行：

```bash
npm run typecheck
npm run package:dir
npm run package
```

确认：

- `dist-installer/win-unpacked/learn++.exe` 时间更新。
- `dist-installer/learn++ Setup 1.1.0.exe` 生成。
- 旧版后台进程未占用打包目录。
- 登录页只保留官方网页登录。
- 左上角账号菜单可添加、切换账号。
- 托盘菜单文案为“打开 learn++ / 退出”。
