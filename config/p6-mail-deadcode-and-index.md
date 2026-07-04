# 邮箱死代码清理 + 邮件搜索索引接线（A6 + A1）

## 背景

`mail-service.ts` 历史上同时维护两条邮件通道：网页 DOM 抓取（Coremail 选择器）和 IMAP。v2.0 邮箱已全面切到 IMAP/SMTP（`mail-imap.ts`），网页轨约 800 行代码不再被任何外部入口选用——`mailMode` 在 `loginMailImap` 后恒为 `'imap'`，但 `getMailListWeb`/`getMailDetailWeb`/`composeMailWeb`、`MAIL_LIST_SCRIPT`/`MAIL_DETAIL_SCRIPT`/`MAILBOX_CHECK_SCRIPT`、`scrollToLoadAll`/`clickNextPage`/`clickFolderByKeywords`/`ensureFolderReady`/`scrapeMailList`/`ensureMailWindow`/`waitForLoad`/`delay`、`mailWindow`/`mailLoggedIn`/`loginMail`/`showMailWindow` 等仍驻留文件，是 A6 待办的最大块死代码。

同时 `indexEmails` 在 `search-index.ts` 已实现、`mail-service.ts` 也 `import` 了它，但**从未调用**——全局搜索（`search:query`）和甘蔗 Tutor 的 `search_emails` 工具对邮件恒空。这是 A1 残留。

## 修复思路

### A6：网页轨整轨切除
- 重写 `mail-service.ts`：删掉 `mailMode`/`mailWindow`/`mailLoggedIn` 及所有 web 分支与脚本常量，所有统一接口（`getMailList`/`getMailDetail`/`composeMail`/`setMailStarred`/`deleteMail`/`checkMailStatus`/`isMailLoggedIn`）直接走 IMAP。
- 删 `mail:login`（网页登录窗口入口，已无意义）、`mail:show`（`showMailWindow`）两个 IPC handler；删 `mail:delete-permanent`——三处类型声明都在（preload/index.ts、api.d.ts、env.d.ts），但**既无 IPC handler 也无 renderer 调用**，是个会 hang 的隐藏 bug。删除三个文件中的声明。
- 修 `mail:status` 返回类型：原 api.d.ts/env.d.ts 声明 `{ loggedIn; state }`，但 ipc 实际只返回 `{ loggedIn }`，且 Mailbox 只读 `loggedIn`。同步为 `{ loggedIn: boolean }`。
- 修 `mail:check` 返回类型：去掉 `mode: 'web' | 'imap'`（web 轨已删）。
- 同步三处 preload/renderer 类型文件（铁律 3）。

### A1：邮件索引接线
- 在 `mail-service.ts` 新增 `reindexAllMail()`：合并 `folderListCache` 中所有文件夹的邮件（按 id 去重），调一次 `indexEmails`。多文件夹覆盖问题靠"每次拿全量合并再 index"解决，而不是单文件夹 index 互相清掉。
- 在 `getMailListUnified` 的 IMAP 分支拿到列表并写缓存后调一次 `reindexAllMail()`；`deleteMail` 成功后也调一次（删除立即反映到索引）。
- 这样：用户进邮箱页拉 inbox → 索引建立 → 切到"已发送"再拉 → 索引扩到含已发送；全局搜索框和 Tutor `search_emails` 都能命中。

## 结果

- `mail-service.ts` 从 1103 行减到 ~290 行（-~800 行死代码）。
- `npm run typecheck` 通过。
- 全局搜索 / Tutor search_emails 现在能命中已拉取过的邮件。
- 删除了 `mail:delete-permanent` 这个有声明无实现的隐藏 hang bug。

## 后续注意事项

- `mail:login` / `mail:show` 删了，如果以后要恢复网页登录窗口入口，需重新接 IPC + preload 三处同步。
- `reindexAllMail` 只索引"已缓存"的邮件。文件夹从未打开过的邮件不在索引——可接受（搜索语义就是搜已见过列表）；如果以后要"开邮箱即索引全部文件夹"，可在 `ensureMailConnection` 成功后预拉四个文件夹（注意流量）。
- IMAP 连接隔离与 UID 增量同步仍待做（B10）。