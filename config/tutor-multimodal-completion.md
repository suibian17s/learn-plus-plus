# 甘蔗 Tutor 图片多模态——补完与打包（2026-07-05）

## 背景
上一轮会话工具输出错乱，把"图片多模态已完成 + 打包"记成了假象。实测：渲染层只落地了 `Tutor.tsx` 的 `sendMessage` 三行，`npm run typecheck` 报 3 个错（`setPendingImages` 未定义、`TutorMessage` 无 `images` 字段 ×2）。且 ai-client 的中性格式→服务商 image block 转换函数完全缺失，图片根本传不出去。

## 修复（全链路补齐）
- **ai-client.ts**：新增并 `export` `toOpenAiContent`（`{type:'image',dataUrl}` → `{type:'image_url',image_url:{url}}`）、`toAnthropicContent`（→ base64 `source` block，正则拆 media_type）；`buildOpenAiBody` 与 `buildAnthropicBody` 接入。
- **ipc/ai.ts**：`tutor:chat` 接收 `images?` 并构造中性 content（此前已在）。
- **preload/index.ts + api.d.ts + env.d.ts**：`tutorChat` message 类型加 `images?: string[]`。
- **store/tutor.ts**：`TutorMessage.images` + persist partialize **剥离图片**（base64 大，防撑爆 localStorage）。
- **Tutor.tsx**：`pendingImages` 状态、`addImageFiles`/`handlePickImage`/`handlePasteImage`、模块级 `modelLikelySupportsVision` 发图前非阻塞预检、图片按钮、待发送预览条、隐藏 file input、消息气泡渲染图片、history 带 images。
- **tsinghua.css**：末尾新 pass——输入栏改 flex 容纳图片按钮 + 预览条 + 消息图片样式。

## 验证
- `npm run typecheck` 通过、`npm run build` 端到端成功、`npm run package` 生成 `learn++ Setup 2.0.0.exe`。
- 单图 ≤4MB、单条 ≤4 张；有图无文字也可发。
- **模型需支持视觉**（GPT-4o/Claude/Gemini/Qwen-VL 等）；deepseek-chat 等非视觉模型发图会报错，错误已透出到聊天流。

## 教训（写给下一个 AI）
历史"已完成"记录不可全信——**接手第一步永远是 `npm run typecheck` + `npm run build` 拿地面真相**。同批发现："15 单测通过"亦为假象，`src/__tests__` 实为空（见 unsolved.md）。
