# Learn++ 2.0 未解决问题（状态页）

> 完整状态、架构与所有已完成工作见根目录 [HANDOVER.md](HANDOVER.md) **第 10 节（会话进展总账，当前状态以它为准）**。
> 本页只列"仍未完成项"，供快速挑活。最后复核：2026-07-04（本轮全部清完）。

## ⚠️ 接手第一步

**不要轻信历史"已完成"记录**（之前某轮工具输出错乱，多处"完成"是假象）。接手后先跑 `npm run typecheck` + `npm run typecheck` + `npm run build` + `npm test` 拿真实状态，详见 HANDOVER **10.0**。

## 当前整体状态

`npm run typecheck` 通过、`npm run build` 成功、`npm test` 19 测试通过、安装包（`learn++ Setup 2.0.0.exe`）可正常生成。邮箱、甘蔗 Tutor（含图片多模态）、首页/统计、作业、课件、下载均可用。第 5 节 A/B/C 清单**已全部修完或评估完毕**（见 HANDOVER 10.1）。

## ✅ 本轮（2026-07-04）全部清完

1. **A6 死代码清理** ✅：`mail-service.ts` 网页抓取死代码整轨切除（~800 行 → 文件减到 ~290 行）。详见 `config/p6-mail-deadcode-and-index.md`。
2. **A1 邮件索引** ✅：`reindexAllMail()` 在 `getMailListUnified` / `deleteMail` 调用，全局搜索和 Tutor `search_emails` 现能命中已拉取过的邮件。
3. **A5** ✅（早已完成）：`ai.ts` 现仅 34 行委托层，无 `completeMultimodal`/`completeNonStreaming` 死导出。
4. **B16 下载状态键** ✅：HomeworkDetail / Notifications 附件下载改 `courseId+fileId` 复合键 + `hw-attachments/<nsCourseId>/` 子目录隔离；跨课程/跨作业同名附件不再误判。详见 `config/p7-download-state-key-fix.md`。
5. **B10 邮件 UID 增量同步 + 账号隔离** ✅：`mail-sync.json` 持久化 uidvalidity+maxUid；`fetchMailList` 增量 `uid.fetch`，无新邮件不发请求；缓存按 username 二级隔离，多账号不串扰。详见 `config/p8-mail-uid-incremental-sync.md`。
6. **补关键单测** ✅：vitest 装上、`test`/`test:watch` 脚本加上；`ai-content.ts` 抽纯函数 + 19 个用例全过（ai-content / sanitize / search-index）。
7. **观察项 downloader socket 超时** ✅：request 30s 超时 + socket 120s 闲置超时，连接 hang 不再永久挂。
8. **C2 CSS 模块化** ⏸️ 评估后暂缓（与用户确认）：9371 行 + 大量 `!important` 覆盖链，激进拆分零收益高风险，保留单文件 + 铁律 7。详见 `config/p9-tests-socket-css.md`。

## ⚪ 长期观察项（仍非紧急）

- 上级目录 `D:\ai\CLAUDE.md` 为 v1.1 旧文档，勿以其为准（非本仓库文件）。
- `files:downloadState` 旧单参分支（`arg2 === undefined` 时按根目录 fileName 探针）目前无 renderer 调用者，保留作 backward-compat；如确认彻底不需可下一轮删。
- `tsinghua.css` 9371 行未拆分（见 C2 决定）；动 CSS 前先读文件顶部注释与 `config/p9-tests-socket-css.md`。

## 建议下一批次方向

主要清单已清完。可考虑的后续工作：
- 给更多纯函数补单测（attachment-parser 类型判定需先 export `extToKind`/`sniffKind`，或加间接测试）。
- 邮件搜索索引可考虑"开邮箱即拉四文件夹预索引"（目前只索引已打开过的文件夹）。
- CSS 若要拆，按 `config/p9-tests-socket-css.md` 末尾建议的安全顺序。

每完成一项：过 `npm run typecheck`、`npm test`、IPC 三处类型同步、`config/` 写维护记录、更新本文件与 HANDOVER 第 10 节。