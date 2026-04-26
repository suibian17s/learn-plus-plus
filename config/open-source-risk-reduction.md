# 开源版权与合规降风险记录

## 背景

准备将 learn++ v1.1 开源到 GitHub。用户决定保留现有图标，因此本轮只处理图标之外的版权、授权和误认官方风险。

## 调整内容

- `electron-builder.yml` 的 `appId` 从 `cn.tsinghua.learnpp` 改为 `app.learnpp.desktop`，避免使用类似官方域名空间。
- `package.json` 描述改为“面向清华网络学堂的第三方桌面客户端”。
- README 和关于页强化“第三方、非官方”表述。
- 新增 `SECURITY.md`，说明不要公开 Cookie、会话、API Key、课程内容和个人信息。
- 新增 `THIRD_PARTY_NOTICES.md`，列出主要第三方依赖、字体资源和授权说明。
- 新增 `resources/fonts/NOTICE.txt`，标注 Source Han Sans / Noto Sans CJK 字体来源与 SIL Open Font License 1.1。
- 打包配置补充 `resources/fonts` 到 extraResources，确保字体资源及 notice 随应用分发。

## 结果

除图标外，项目的开源表述、应用标识、第三方资源说明和安全披露说明都更适合公开发布。
