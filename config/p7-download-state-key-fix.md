# B16: 下载状态判定改 courseId+fileId 键（含作业/公告附件）

## 背景

下载状态判定原按"文件名"在根下载目录探针，跨课程同名课件/附件会互相误判"已下载"。课件主线（Files.tsx + files:downloadState 3 参签名 + `courseId/fileName` 子目录）在之前一轮已修好，但残留两处仍调用旧单参 `files:downloadState(name)`：

- `HomeworkDetail.tsx`：作业附件（老师附件 / 提交附件 / 答案附件 / 批阅附件）下载状态查询与历史匹配，全按 `fileName` 比对。
- `Notifications.tsx`：公告附件同理。

而 `hw:downloadAttachment` 把附件下到根下载目录，与课件目录混在一起，加剧同名误判。

另外：课件侧 history 匹配已按 `courseId+fileId` 联合键；作业/公告附件的 history 记录没传 `courseId`/`fileId`，也是按 fileName 兜底，同样有误判风险。

## 修复思路

### 作业/公告附件按合成 courseId 子目录隔离
- `hw:downloadAttachment` IPC 加可选 `courseId` 参数，destDir 改为 `<downloadDir>/hw-attachments/<courseId>/`（不传则回退根目录，向后兼容）。
- HomeworkDetail 合成 `nsCourseId = "hw-<courseId>-<homeworkId>"`、Notifications 合成 `nsCourseId = "notice-<courseId>-<noticeId>"`，传给 `hw.downloadAttachment` 与 `files.downloadState`。
- 这样 destPath = `<downloadDir>/hw-attachments/<nsCourseId>/<name>`，下载与探针同路径。

### downloadState 一律走 3 参
- HomeworkDetail/Notifications 改用 `files.downloadState(nsCourseId, name, name)`，IPC 返回 `key = "<nsCourseId>_<name>"` 和正确 destPath 探针。

### history 匹配加 courseId
- `addDownloadRecord` 调用补 `courseId` + `fileId` 字段；`downloadedAttachment` / attachmentHistory 匹配加 `item.courseId === nsCourseId` 条件，跨课程/跨作业同名不再误中。

### 三处 preload 类型同步
- `downloadAttachment` 加可选 `courseId` 参数：preload/index.ts、api.d.ts、env.d.ts。

## 结果

- 跨课程同名课件、跨作业同名附件、跨公告同名附件不再互相误判"已下载"。
- 课件、作业附件、公告附件三类各自落在 `downloadDir/<scope>/<courseId>/<name>` 子目录下，互不混淆。
- `npm run typecheck` 通过。

## 后续注意事项

- `files:downloadState` 的旧单参分支（`arg2 === undefined` 时按根目录 fileName 探针）目前**无 renderer 调用者**，但保留作 backward-compat 以兼容可能存在的根目录残留文件。如确认彻底不需，下一轮可删。
- `removeAll` 根目录残留旧课件文件（升级前下载的）不会自动迁移到子目录；用户手动清理即可。