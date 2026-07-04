# 全局搜索索引修复

日期：2026-07-02

## 背景

搜索索引基础设施（`src/main/services/search-index.ts`）已存在，包含 `indexCourses`、`indexItems`、`indexEmails` 和 `query` 函数，但从未有数据被喂入索引。搜索结果始终为空。

此外，`indexCourses` 调用 `index.clear()` 会清空整个倒排索引（包括已索引的作业、公告、邮件等），而 `indexItems` 和 `indexEmails` 从不清理旧条目，导致重复累积。

## 修复内容

### 1. `src/main/services/search-index.ts`

- 新增 `clearType(type)` 函数，按类型精确清理倒排索引条目，替代全局 `index.clear()`
- `indexCourses` 改为 `clearType('course')` 后重建课程条目
- `indexItems` 改为 `clearType(type)` 后重建指定类型条目
- `indexEmails` 改为 `clearType('email')` 后重建邮件条目
- `query` 增加 TF (term frequency) 评分：统计每个文档匹配的 token 数量，按文档长度（title + subtitle）归一化后排序。短标题文档不再被长文档淹没，多关键字匹配的文档排名更高

### 2. `src/main/ipc/courses.ts`

- 导入 `indexCourses`
- 在 `course:list` handler 返回数据前调用 `indexCourses(mapped)` 将课程列表喂入搜索索引

### 3. `src/main/ipc/stats.ts`

- 在 `stats:computeDashboard` handler 中，从 payload 提取全部课程的作业、公告、讨论数据
- 分别调用 `indexItems('homework', ...)`, `indexItems('notice', ...)`, `indexItems('discussion', ...)` 喂入索引

### 4. `src/main/ipc/mail.ts`

- 导入 `indexEmails`
- 在 `mail:list` handler 返回数据后调用 `indexEmails(...)` 将邮件列表喂入搜索索引

### 5. `src/renderer/src/components/AppShell.tsx`

- 搜索输入增加 300ms debounce（`searchDebounce` state），避免每次按键都触发 IPC 查询
- `handleResultClick` 修复：邮件结果跳转到 `/mailbox?folder=inbox&mailId=...`，作业结果跳转到 `/course/:id/homework?hwId=...`，其他结果跳转到对应课程 tab

### 6. Tutor 搜索工具（无需修改）

`ipc/ai.ts` 中的 `search_global` 和 `search_emails` 工具已正确调用 `query()` 和 `query(..., 'email')`，索引填充后即可正常工作。

## 结果

- `npm run typecheck` 通过（主进程 + 渲染进程）
- 索引数据流：课程加载 → indexCourses；Dashboard 统计 → indexItems(homework/notice/discussion)；邮件列表 → indexEmails
- 各类型索引互不干扰：重新加载某类数据只更新该类条目，不影响其他类型

## 后续注意事项

- 搜索索引在内存中，应用重启后需要重新索引（首次 Dashboard 加载和邮件列表访问时自动完成）
- 邮件索引只覆盖最近访问过的文件夹（通常是收件箱），切换文件夹时会更新
- Dashboard 数据量大（多课程 x 多作业/公告/讨论）时，`stats:computeDashboard` 中的索引操作 O(n) 遍历所有条目，目前规模下性能无影响
