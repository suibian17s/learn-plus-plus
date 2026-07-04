# B10: 邮件 UID 增量同步 + 账号隔离

## 背景

`fetchMailList` 原本每次打开文件夹都按序号拉最后 300 封 header 全量重拉，对大邮箱频繁刷新是浪费，也是 IMAP 服务器限速的常见诱因。同时邮件缓存（`folderListCache` / `detailCache`）是全局单 Map，多邮箱账号切换时旧账号的邮件列表会串到新账号。

## 修复思路

### UID 增量同步
- 新增 `mail-sync.json` 持久化文件（`utils/paths.ts` 加 `mailSyncFile`），结构 `{ [username]: { [folder]: { uidvalidity, maxUid } } }`。
- `mail-imap.ts` 加 `loadSyncState/saveSyncState/readFolderSync/writeFolderSync/clearFolderSync/clearAllMailSync`。
- `fetchMailList` 重写为 `Promise<MailListResult>`，返回 `{ mails, incremental }`：
  - 打开文件夹后读 `box.uidvalidity` 和 `box.uidnext`，比对 `readFolderSync(username, folder)`。
  - uidvalidity 一致且 `uidnext > maxUid+1` → 用 `uid.fetch('<maxUid+1>:<uidnext-1>')` 增量拉新邮件，`incremental=true`。
  - uidvalidity 一致且无新邮件 → 直接 resolve 空列表 + `incremental=true`，不发 fetch。
  - 否则（初次 / uidvalidity 变了 / 邮箱被重排）→ 回退按序号拉最后 300 封全量。
  - fetch 完成后记 `maxUid = max(本次见到, 已存 maxUid)`，写回 sync state。
- `mail-service.ts` 的 `getMailListUnified` 适配新签名：`incremental && cached` 时把新邮件并入旧缓存（按 id 去重，不丢历史邮件），全量时替换。

### 账号隔离
- `folderListCache` / `detailCache` 改为 `Map<username, Map<folder, …>>` 二级结构，新增 `cacheOwner` 标记当前账号。
- 新增 `ensureCacheOwner(username)`：username 变化时丢弃旧账号全部缓存（list + detail）。
- `loginMailImap` 成功后调 `ensureCacheOwner(config.username)`；`logoutMail` 清空 + 置 `cacheOwner=null`。
- 所有 cache 访问改为经 `getFolderCache/setFolderCache/getDetailCacheEntry/setDetailCache` helper，不再直接命中全局 Map。
- 这样：用户在 Settings 切换不同邮箱账号 → `loginMailImap` 触发 `ensureCacheOwner` → 旧账号邮件列表不串到新账号。

## 结果

- 大邮箱二次拉取只拉新邮件，IMAP 流量与延迟显著下降。
- uidvalidity 变化（服务器端邮箱重排 / UID 失效）时安全回退全量，不丢邮件。
- 多邮箱账号缓存隔离，切换不串扰。
- 持久化 sync state 跨会话生效：重启后首次拉取仍走增量（uidnext > maxUid+1）。
- `npm run typecheck` 通过。

## 后续注意事项

- `mail-sync.json` 在 `userDataPath` 下，明文存 username + uidvalidity + maxUid（不含邮件正文，敏感度低）。如需彻底清除可调 `clearAllMailSync()`（导出但暂未接 IPC）或手动删文件。
- 增量只用于"已知文件夹"。从未打开过的文件夹回退全量，行为不变。
- 若服务器对 `uid.fetch` 返回与 `seq.fetch` 不同（极少见，如 Gmail），可考虑加回退；Coremail 实测 OK。
- 删除邮件时 maxUid 不下移（保留高水位），这样新邮件对照仍正确；若服务器复用 UID（uidvalidity 不变但复用已删 UID，违反 RFC 但少见），可能漏拉——可接受，下次 uidvalidity 变化时全量重建。