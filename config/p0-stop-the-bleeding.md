# P0 止血修复 (2026-07-02)

## 背景

根据 HANDOVER.md 全量代码审查，执行 P0 阶段 6 项高优先级修复：typecheck 失败、单实例锁、XSS 消毒、TLS 证书验证、密钥隔离、死代码清理。

## 修复项

### B1 — typecheck 修复
- `src/main/services/mail-imap.ts` L54：`imapClient.getBoxes(...)` 改为 `(imapClient as any).getBoxes(...)`，绕过 node-imap 类型声明缺口
- 同时补了 L53 的分号防止 ASI 歧义

### B15 — 单实例锁
- `src/main/index.ts`：在初始化前添加 `app.requestSingleInstanceLock()` 检查，非首个实例直接退出
- 添加 `second-instance` 事件处理器，第二个实例启动时唤出已有窗口
- 根除双托盘、配置竞写、打包 DLL 占用问题

### B11 — XSS 消毒
- `src/renderer/src/pages/Homework.tsx` L291：`submitTarget.description` 的 `dangerouslySetInnerHTML` 加上 `DOMPurify.sanitize()` 包裹
- 与 HomeworkDetail / Notifications / AnsweringDetail 的消毒模式一致

### B7 — TLS 证书验证恢复
- `src/main/services/mail-imap.ts`：删除 IMAP `connectMail()`、SMTP `createTransport()`、`testMailConnection()` 三处的 `rejectUnauthorized: false`
- `mails.tsinghua.edu.cn` 使用 Let's Encrypt 正规证书，已实测验证通过

### B6 — 密钥隔离
- `src/main/services/secret-store.ts` `loadApiKey()`：去掉跨 provider fallback——mail 找不到密码时不再回退到 default AI Key
- 去掉读路径上的 `writeApiKeyStore()` 写盘副作用
- `hasApiKey` 自动受益

### A6 — 死代码清理
- 删除 `src/renderer/src/utils/icons.ts`（零引用）
- 窗口 IPC 双轨合并：`WindowControls.tsx` 改用统一的 `window:command`，`app.ts` 删除 4 个独立 handler，三处类型文件同步
- `mail-service.ts` 删除约 820 行已废弃的网页 DOM 抓取代码（`MAIL_LIST_SCRIPT` 等），精简到 235 行纯 IMAP
- `ipc/mail.ts` 删除 `mail:show` handler
- 删除 `tmp/` 目录 181 个文件，添加 `tmp/` 到 `.gitignore`

## 结果

- `npm run typecheck` 通过（主进程 + 渲染进程均无错误）
- IPC 三文件类型同步已确认

## 后续注意

- P0 完成后 typecheck 成为后续所有阶段的硬门槛
- 打包前确认无旧版后台进程占用 DLL
- mail-service.ts 精简后功能不受影响（已废弃的网页抓取模式设置页已注明"已隐藏"）
