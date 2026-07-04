# 单测补齐 + downloader socket 超时 + C2 评估

## 1. 补关键纯函数单测（unsolved 第 2 项）

### 背景
HANDOVER/unsolved 长期记"vitest 已装、`npm test` 脚本在、`src/__tests__` 为空"，10.0 警告"曾记 15 单测通过，实为 0"。本次实测发现**连 vitest 都没装、`test` 脚本也不存在**——又是一处假象。

### 修复
- `npm i -D vitest`（4.1.9）。
- `package.json` 加 `test`（`vitest run`）和 `test:watch`（`vitest`）脚本。
- 为便于单测，把 `ai-client.ts` 里纯函数 `toOpenAiContent` / `toAnthropicContent` 抽到独立 `src/main/services/ai-content.ts`（无 electron / fs / 网络依赖），`ai-client.ts` 从那里 import 并 re-export 保持对外接口不变。
- 新增三个测试文件，共 19 个用例，全部通过：
  - `src/__tests__/ai-content.test.ts`：OpenAI / Anthropic 中性 content 转换（字符串透传、image block、非数组兜底、malformed dataUrl 降级为 `[图片]`）。
  - `src/__tests__/sanitize.test.ts`：`sanitizeFilename` 去除 Windows 非法字符、trim、保留 CJK/点。
  - `src/__tests__/search-index.test.ts`：`indexEmails` / `indexItems` / `query` —— 主题/发件人/preview 命中、typeFilter 隔离、CJK 1/2-gram 子串命中、空结果。

### 结果
- `npm test` → 3 files / 19 tests passed。
- `npm run typecheck` 通过。

## 2. downloader socket 超时（观察项）

### 背景
`openDownloadResponse` 此前只有 redirect/error 处理，连接 hang（建立成功但服务器静默不发数据）时永不失败，大文件下载卡死只能手动关。downloader 主进程三层完整性校验已防"截断坏文件"，但防不了"永不返回"。

### 修复
- `client.request(..., { timeout: 30000 })`：DNS+TCP+TLS+响应头阶段 30s 超时。
- 收到响应头后 `req.setTimeout(0)` 清除请求超时，改在 `res.socket` 上设 `setTimeout(120000)`：数据流 120s 闲置 → `req.destroy` 失败。首个 `data` 事件清 socket 超时（正常下载不再计时）。
- 加 `req.on('timeout', () => req.destroy(new Error(...)))`：request timeout 触发的是 'timeout' 事件而非 'error'，需手动 destroy 才会 reject。

### 结果
- 连接 hang 不再永久挂起；下载卡死场景会以"下载请求超时（30s 无响应）"或"下载连接闲置超时（120s 无数据）"明确报错。
- `npm run typecheck` 通过。

## 3. C2: tsinghua.css 模块化（评估后暂缓）

### 评估
- 文件实际 9371 行（HANDOVER 记 ~8700，又长了一些），含 pass1~8 多轮叠加 + 大量 `!important` 覆盖规则。
- 顶部已有注释明令"铁律 7：不删看似重复的规则——它们是有意为之的覆盖层"。
- 真正安全的拆分需要逐行审计每一层 `!important` 覆盖依赖关系：哪个 selector 在哪个 pass 覆盖了 кем，拆错会让大面积 UI 回归（按钮颜色、间距、动画）。
- 收益：纯代码组织，零用户价值；风险：极高，回归难定位。

### 决定
**暂缓激进拆分**（与用户确认）。当前保留单文件 + 末尾追加铁律不变。未来若非要拆，建议顺序：
1. 先按 pass 边界（`grep "/\* .* pass"` 找到 `6869` / `8706` 等锚点）切出"历史沉淀层"和"近期 override 层"两个文件。
2. 近期 override 层（pass 5~8，~700 行）风险最低，可先抽到 `tsinghua-overrides.css`，main.tsx 在主 css 之后 import 它。
3. 历史沉淀层不要动 selector 顺序，只能按"页面域"切，且每切一块都要全量 UI 回归（首页/课程/邮箱/Tutor/作业/登录逐页点一遍）。

### 后续注意
- 下次有人想动 CSS，先读 `styles/tsinghua.css` 顶部注释与本文，再决定。