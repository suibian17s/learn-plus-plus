# 下载问题修复记录

## 背景

课件下载最初会在主进程报 `Cannot convert argument to a ByteString`。第一次判断是 Cookie 中含有中文字符，修复方向是清理 Electron session 里的非 Latin1 Cookie。

后续实测发现，下载“讲课提纲”等文件时仍然报错。新的线索是报错字符正好来自文件名里的中文，说明真正触发点不只是 Cookie，也包括网络学堂下载响应里的中文 `Content-Disposition` 文件名响应头。

## 修复过程

1. 保留 Cookie 清理逻辑，避免网络学堂写入中文 Cookie 时污染 Electron `session.fetch()`。
2. 下载链路不再使用 Electron `session.fetch()`，改为 Node 原生 `http/https` 流式下载。
3. Node 下载请求手动带上 API session 中的安全 Cookie，继续保持登录态。
4. 下载前自动创建目标下载目录，避免默认目录不存在导致写文件失败。
5. 保存文件名优先使用列表中的建议下载名；如果缺少扩展名，再从服务器响应头中补齐扩展名。
6. 文件列表阶段根据网络学堂返回的 `fileType` 为无扩展名标题补上建议保存名，例如 `讲课提纲 (13)` 保存为 `讲课提纲 (13).pdf`。
7. AI 作业附件解析也复用同一条 Node 下载链路，避免附件下载再次踩 ByteString 问题。

## 当前结果

课件下载不再因中文 Cookie 或中文响应头导致主进程崩溃。下载出的文件会尽量保留正确扩展名，方便 Windows 按文件类型直接打开。

## 注意事项

如果后续发现某些文件扩展名仍不正确，优先检查网络学堂返回的 `fileType` 和下载响应头里的文件名是否缺失或异常。


---

## 2026-07-04 下载完整性校验（修复大文件静默截断）

### 背景
上一批 Tutor 优化时发现某 107MB 课件 pptx 缺 zip EOCD 签名（损坏），怀疑 downloader 截断大文件。审查 downloader.ts 确认真实缺陷。

### 根因
downloadFile / downloadUrlToBuffer / downloadUrlToBufferWithMeta 三个函数都**未校验实际下载字节数 == Content-Length**。当大文件传输中途被截断、但 HTTP 响应以 'end' 而非 'error' 结束时（网络抖动、服务器/代理超时常见），pipe 正常 finish，写出不完整文件却标记为 completed → 用户得到打不开的坏文件。

### 修复
三个函数在 end/finish 时校验：`Content-Length > 0 且 loaded < total` 判定为截断 —— downloadFile 删除坏文件并发 error 进度；buffer 版 reject。无 Content-Length（chunked）时 total=0 跳过校验避免误判。截断从"静默产出坏文件"变为"下载失败可重试"。

### 遗留
未加下载超时（连接 hang 时不会自动失败）。如后续遇到大文件下载卡死，可在 openDownloadResponse 加 socket timeout。
