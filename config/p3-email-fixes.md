# P3 邮箱修复 (2026-07-02)

## 背景

HANDOVER.md 全量审查发现邮箱模块是本项目返工最多、用户痛点最集中的模块。所有缺陷都是工程完成度问题而非路线问题——IMAP/SMTP 协议栈正确，服务器证书正规，端点可达。

## 修复项

### B20 — IMAP 连接管理器（根基修复）

新建 `src/main/services/mail-connection.ts`，`MailConnectionManager` 单例：
- 状态机：disconnected → connecting → authenticated | error
- `autoConnect()`：从 settings + secret-store 读取凭据，启动时自动连接
- `ensureConnection()`：每项操作前检查连接状态，断线自动重连（指数退避 1s/2s/4s，最多 3 次）
- 持久监听：每次成功连接后注册 error/close/end 监听，断线触发自动重连
- keepalive：`{ interval: 10000, idleInterval: 300000, forceNoop: true }`（Coremail IDLE 不可靠）
- 错误分类：区分"认证失败"/"网络连接失败"/"证书验证失败"
- SMTP transport 惰性创建 + `verify()` 检查 + 断开时失效
- `testConnection()` 使用隔离 IMAP 客户端，不影响主连接状态

`mail-imap.ts`：删除模块级 client 变量，所有操作通过 connection manager。每项操作先 `ensureConnection()`，失败返回 `{ ok: false, error: '...' }`。

`mail-service.ts`：`loginMail()` 委托给 `connectionManager.autoConnect()`。

`main/index.ts`：启动时调用 `mailConnection.autoConnect()`。

`ipc/mail.ts`：`mail:status` 返回连接状态机 state 字符串。

### B9 — HTML 邮件隔离渲染

- `mail-imap.ts` `fetchMailBody`：分离内嵌图片附件（cid: → base64 data URI 替换），返回 `htmlBody` 字段
- `Mailbox.tsx`：sandboxed iframe + DOMPurify 消毒 + 注入基础 CSS + `<base target="_blank">`
- sandbox 用 `allow-popups allow-popups-to-escape-sandbox`（禁脚本但允许链接）
- 固定高度容器 + 内部滚动

### A3 — 邮件附件可下载

- `fetchMailBody`：附件 buffer 写入临时目录，url 返回本地路径
- 新增 `mail:save-attachment` IPC：dialog.showSaveDialog + 文件复制
- `Mailbox.tsx`：附件改为可点击按钮，触发"另存为"；支持"全部另存为"

### B8 — 删除改为移入回收站

- `deleteImapMail`：使用 IMAP MOVE 到回收站文件夹
- 仅在回收站文件夹内才调用 `permanentDeleteImapMail`（标记 \Deleted + expunge）
- 新增 `mail:delete-permanent` IPC

### B21 — 发送后写回已发送文件夹

- `sendMail`：SMTP 成功后用 nodemailer `MailComposer` 生成 RFC822 原文
- IMAP `append` 到 Sent 文件夹（\Seen 标记），失败仅返回 warning 不影响发送结果

### B22 — 两级邮件搜索

- 本地即时过滤：主题/发件人/预览（零延迟）
- 服务端 IMAP SEARCH：回车触发 TEXT + SUBJECT + FROM 三条件搜索，带标题+正文获取
- `preview` 字段：fetchMailList 同步获取 BODY[TEXT]<0.200> 片段
- 全局搜索索引补入 preview 内容

### B10 — UID 增量同步

- `FolderCache`：按文件夹缓存 uidvalidity + maxUid + 消息列表
- `fetchMailListIncremental`：仅拉取 lastUid+1:* 的新消息
- `checkNewMailCount`：SEARCH UNSEEN 轻量未读检查（替代全量 300 封拉动）
- AppShell 2 分钟轮询改为轻量未读检查
- 星标/删除/登出时清除缓存

## 结果

- `npm run typecheck` 通过
- 三处 IPC 类型文件已同步
- 遵守 HANDOVER.md 第 8 节路线裁决：只走 IMAP/SMTP，不重试已废弃的网页会话捕获或 DOM 抓取路线

## 后续注意

- 连接管理器是邮箱模块唯一入口，新增邮箱操作必须走 `ensureConnection()`
- 邮件 HTML 渲染使用 sandboxed iframe，不要尝试自适应高度（需要 allow-same-origin）
- Coremail IMAP IDLE 不可靠，keepalive 使用 forceNoop
- 二步验证用户需生成客户端专用密码，loginMail 应给清晰指引
