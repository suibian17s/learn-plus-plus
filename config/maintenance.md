# 维护记录规则

以后每完成一个重要功能实现或重要 bug 修复，都需要在 `config/` 目录下新增或更新一份对应的 Markdown 记录。

记录不需要写成完整技术论文，但要说明：

1. 问题或需求背景。
2. 排查到的主要原因。
3. 本次采取的修复或实现思路。
4. 当前结果和后续注意事项。

命名建议使用功能或问题域，例如：

- `download.md`：下载相关问题。
- `signin.md`：登录和会话保持相关问题。
- `homework-submit.md`：作业提交相关问题。

这条规则视为项目维护约定。后续接手该项目时，应默认遵守。

---

## 2026-07-03 后端性能与邮箱持久化专项（B20/B24/B25 收尾 + 全局加载提速）

### 背景

用户反馈四大卡顿：首页每次打开加载半天；"查看全部XX"页面加载半天；邮箱经常要重新登录；切文件夹/重进邮箱每次全量重拉。

### 根因与修复

1. **邮箱重新登录（B20，本批终于修掉）**：`loginMail()` 的自动连接逻辑一直无人调用。新增 `ensureMailConnection()`（in-flight 去重），接入 mail:status / mail:check / list / detail / star / delete / compose / search —— 状态查询即自动重连；`connectMail` 就绪后注册持久 close/end/error 监听清引用，配 keepalive forceNoop 心跳。**连带修正退出语义**：logoutMail 现在断开 IMAP 并清除已存密码（否则 ensure 会把用户立刻连回去）。
2. **切文件夹/重进全量重拉**：主进程 listCache 原来只写不读。改为按文件夹 Map 缓存（TTL 60s）+ force 参数（刷新按钮/重试按钮传 true）；detailCache（TTL 30min）真正启用；星标就地更新缓存、删除从缓存移除。renderer 侧加模块级 mailListMemory：重进页面先用上次数据即时渲染、后台静默换新。mail:list IPC 增加 force 参数（preload/api.d.ts/env.d.ts 三处同步）。
3. **首页加载半天**：stats:refreshDashboard 改为 SWR——内存+磁盘（userData/dashboard-cache.json）双层缓存；新鲜(<5min)直接返回；过期先返回旧数据秒开、后台刷新完通过 stats:updated 事件推送（preload 新增 stats.onUpdated，Dashboard 订阅静默更新）；仅真正首次运行需等全量。刷新任务加 in-flight 去重。
4. **查看全部XX加载半天**：AllTasks/AllCourses/AllUpdates 原来各自在 renderer 串行 for 循环逐课 await（正是 B14 批评过的反模式）。全部改为一次 refreshDashboard 快照取数（缓存命中毫秒级）；computeDashboard 的 recentUpdates 从 10 条扩至 100 条供"全部记录"复用，首页卡片自行截取前 10。
5. **顺带收尾 B24**：Coremail 无 MOVE 扩展，删除的 COPY+\Deleted 回退现在 move 后 expunge + 列表过滤 \Deleted 标记（双保险），"删了还在"消除。
6. **顺带收尾 B25**：启动时 cleanupMailTemp() 清空附件临时目录。

### 结果

- typecheck 通过，完整打包流程执行
- 预期体验：首页除首次运行外秒开（旧数据先显示，最新数据静默替换）；三个"查看全部"页秒开；邮箱重启免登录、切文件夹/返回秒开、断线自动重连
