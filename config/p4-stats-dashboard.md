# P4 统计与仪表盘修复 (2026-07-02)

## 背景

学习统计口径失真 + Dashboard 首屏串行请求慢。修复统计追踪准确性和页面性能。

## 修复项

### B12 — 统计口径修复

1. **活跃时间替代开机时长**：`stats.ts` 新增 `powerMonitor.getSystemIdleTime()` 检测（>5 分钟空闲停止计时）+ 窗口可见性检测（隐藏 >30 分钟停止计时）。`main/index.ts` 中 `showMainWindow()` 和 `close` 事件同步窗口可见性状态。

2. **无作业课程不计入完成度**：无作业课程 progress 返回 -1 而非 100。`completedCourses` 仅统计有作业且 100% 完成的课程。Dashboard 显示"已完成 X/Y（Y 为有作业课程数）"，无作业课程显示"无作业"替代假进度条。

3. **删除 ipc/ai.ts 中的重复 get_stats**：新增 `stats.ts` `getStatsForAI()` 导出，Tutor 的 `get_stats` 工具改为调用它而非手工重复实现，消除口径漂移。

### B14 — Dashboard 首屏性能

- 新增 `stats:refreshDashboard` IPC：主进程并发拉取所有课程数据（限制 5 并发），5 分钟内存缓存
- Dashboard 从串行 39 次请求改为单次 IPC 调用
- 拉取数据顺带喂给全局搜索索引（A1 受益）
- IPC 三文件同步

### A2 — "转为今日重点"实现

- 新建 `focus-store.ts`：手动今日重点项持久化到 `focus-items.json`
- 新建 `ipc/focus.ts`：`focus:add/remove/list` IPC handlers
- `Mailbox.tsx` `handleConvertToFocus` 不再假成功，实际调用 IPC 存储
- `stats.ts` `computeDashboard` 合并手动 focus 项到 `todayFocus` 前列
- Dashboard 点击邮箱类 focus 项导航到对应邮件
- IPC 三文件同步

## 结果

- `npm run typecheck` 通过
- 统计追踪使用真实活跃时间而非开机时长

## 后续注意

- 空闲检测阈值（5 分钟）和隐藏宽限期（30 分钟）可根据实际使用反馈调整
- Dashboard 缓存 5 分钟，手动刷新 force 参数可绕过
