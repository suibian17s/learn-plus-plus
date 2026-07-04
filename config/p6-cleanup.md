# P6 清理收尾 (2026-07-02)

## 背景

完成残余清理：死导出、B19 小项、B13 学期持久化、文档更新。

## 修复项

### A5 残余 — 删除 completeMultimodal 死导出

- `services/ai.ts` 删除 `completeMultimodal`、`AiMultimodalOptions`、`AiProvider` 导出（均为零调用方）
- 净减少 17 行

### B19-1 — 自动登录结果竞态修复

- `main/index.ts` `auto-login-result` 发送前检查 `webContents.isLoading()`，若 renderer 未就绪则 defer 到 `did-finish-load`

### B19-2 — Files.tsx 过期闭包修复

- `handleTutorSummary` 中 `summaryText` 改为通过 `useRef` 读取，避免流式场景下读取过期闭包值

### B19-3 — MarkdownRenderer "仅供参考"特判清理

- 删除 `MarkdownRenderer.tsx` 中对 `<span class="lp2-reference-note">` 的正则匹配和渲染特判
- B18 已将免责声明改为渲染层独立元素，不再嵌入消息内容

### B19-4 / B13 — 学期选择持久化

- `AppShell.tsx` `loadCourses` 优先读取 `lastSemesterId`，用户上次选择的学期不再被忽略
- `Settings.tsx` 学期数据源统一为 store 优先（不再混用 `localSemesters` 和 `store.semesters`）

### C2 — tsinghua.css 文档化

- `tsinghua.css` 顶部添加规则说明注释：只在末尾追加 final override、勿删旧规则、长期拆分计划

### C3 — 旧文档标记

- `D:\ai\CLAUDE.md`（上级目录 v1.1 产物）顶部添加过时警告，指向本仓库 CLAUDE.md 和 HANDOVER.md

## 结果

- `npm run typecheck` 通过
- 零新错误

## 后续注意

- tsinghua.css 长期应拆分为模块：窗口/布局/课程页/首页/邮箱/Tutor/登录页
- `D:\ai\CLAUDE.md` 的 v1.1 内容仍保留作为历史参考，但标注已过时
