# P1 AI 通道统一 (2026-07-02)

## 背景

HANDOVER.md 全量审查发现 AI 调用存在三份平行实现（`services/ai.ts`、`ipc/ai.ts` 的 `runAiCallWithTools`、加上各自的 settings/headers/SSE 解析），已出现行为漂移（一个缓冲 SSE 一个不缓冲）。同时工具调用协议不规范导致 OpenAI 兼容服务商全部 400。

## 修复项

### C1 — 统一 AI 调用客户端（核心架构修复）

新建 `src/main/services/ai-client.ts`（~485 行），唯一职责：
- 读设置 → 按 `apiFormat` 构造规范请求（openai/anthropic/gemini）
- 协议无关消息格式（AiMessage: system/user/assistant/tool 四种 role + tool_calls/tool_call_id）
- 工具调用按 apiFormat 自动序列化为正确协议格式
- SSE 流式解析带跨 chunk 缓冲（buffer split + pop 保留不完整尾行）
- AbortController 全链路透传
- 同时支持流式和非流式两种路径

`services/ai.ts` 从 ~252 行精简到 ~52 行：删除了 `loadSettings`、`buildHeaders`、`streamComplete`、`completeNonStreaming`、SSE 解析等所有重复逻辑；`complete()` 和 `completeMultimodal()` 改为对 `aiCall()` 的薄包装。

`ipc/ai.ts` 从 ~803 行精简到 ~400 行：删除了 `loadAiSettings` 和 `buildAiHeaders` 的完整复制；`runAiCallWithTools` 从 ~200 行原始 fetch 改为 ~10 行调用 `aiCall()`。

### B2 — 工具调用协议修复（影响最大的单 bug）

`tutor-agent.ts` 中工具结果从 `role: 'user'` 文本追加改为 `role: 'tool'` + `tool_call_id` 结构。`ai-client.ts` 按 apiFormat 自动序列化：
- OpenAI：标准 `role: 'tool'` + `tool_call_id`
- Anthropic：转换为 `tool_result` content block

DeepSeek/Qwen/GLM/Kimi/豆包/SiliconFlow/OpenRouter 全部受益，不再 400。

### B3 — SSE 流解析丢字修复

`ai-client.ts` 实现跨 chunk 缓冲：`buffer.split('\n\n')` + `buffer = events.pop()` 保留不完整尾行，SSE 事件被 TCP 分包切断时不再丢弃。

### B4 — 流式消息定向修复

`homework-ai.ts` `generate()` 中 `BrowserWindow.getAllWindows()[0]` 改为通过 `event.sender` 精确定向。PDF/图片预览打开时作业生成流不再发错窗口。

### B17 — 作业编排流水线修复

1. **课件文本注入拆题 prompt**：`decomposeHomework` 的 prompt 中加入 `coursewareText`（限 6000 字），模型不再编造课件摘录
2. **子代理并发限制**：`Promise.all` 改为 worker-pool 模式，并发上限 3，避免瞬间打满 API 速率限制
3. **AbortSignal 全链路透传**：`decomposeHomework`、`runSubAgent`、`assembleResults`、`runReview` 全部接受并透传 `signal`，"取消生成"各阶段均生效

### B18 — Tutor 页面细节修复

1. **"仅供参考"标记**：从写回消息历史改为仅渲染层追加，不会发送给模型
2. **健康检查**：从真实 API 请求（消耗 token）改为检查 settings 中 `hasApiKey` 布尔值，零计费
3. **输入框**：`Input` 改为 `Input.TextArea`（autoSize 1-6 行），Enter 发送、Shift+Enter 换行
4. **MAX_LOOPS 截断提示**：循环上限到达时追加 `*(已达到对话轮次上限)*` 通知，不再静默结束

## 结果

- `npm run typecheck` 通过
- AI 调用逻辑从三份平行实现统一为 `ai-client.ts` 单一来源
- OpenAI 兼容服务商工具调用修复，不再 400
- SSE 流解析不再丢字

## 后续注意

- 新增 AI 能力（如真正的多模态）应在 `ai-client.ts` 中实现，不要再分叉
- `completeMultimodal` 标记为 deprecated（只是 complete 别名），未来可移除
- B17 课件文本 6000 字限制可能需要根据模型上下文窗口调整
