# 甘蔗 tutor 模型预设更新记录

## 背景

上一版模型清单里保留了较多旧模型，也使用了“美国主流 / 中国主流”这类不必要的地域标签。随着 2026 年模型生态继续变化，配置页需要更像“服务档案切换器”，让用户少填 Endpoint、多选当前可用模型。

## 参考

- OpenAI Models 文档：更新 GPT-5.5、GPT-5.4 系列。
- Anthropic Claude Models 文档：更新 Claude Opus 4.7、Sonnet 4.6、Haiku 4.5。
- Google Gemini Models 文档：更新 Gemini 3 / 3.1 Preview 与 2.5 稳定模型。
- DeepSeek、DashScope、Moonshot 等官方 API 文档：保留官方兼容模型名，同时补充较新的模型族。
- cc-switch 的配置档案思路：服务、模型、Endpoint、Key 都围绕当前档案切换。

## 修复思路

- 移除旧的 GPT-4o、Gemini 1.5、Qwen2.5 等默认清单项。
- 分组改成中性的“官方服务 / 聚合服务 / 自定义”，设置页不再显示地域标签。
- OpenAI、Anthropic、Gemini、DeepSeek、Qwen、GLM、Kimi、豆包、SiliconFlow、OpenRouter 的模型预设重新整理。
- 保留自定义接口，继续支持 OpenAI 兼容格式和 Anthropic messages 格式。

## 结果

- 甘蔗 tutor 配置页更接近正式版的服务档案管理。
- 默认模型列表更贴近 2026 年当前模型生态。
- 用户切换服务商时无需看到不必要的地域分类。
