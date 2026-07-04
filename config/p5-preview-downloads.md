# P5 预览与下载修复 (2026-07-02)

## 背景

Office 转 PDF 只对 Word 有效，PPT/Excel 必失败。下载状态按文件名判定导致跨课程误判。课件详情面板含硬编码假数据。

## 修复项

### B5 — Office 转换器按应用修复

- `office-converter.ts` 完全重写：
  - Word：`Documents.Open` + `ExportAsFixedFormat(17)`
  - PowerPoint：`Presentations.Open($path, $true, $false, $false)` + `SaveAs(32)`，不设 `Visible=$false`（会抛错）
  - Excel：`Workbooks.Open` + `ExportAsFixedFormat(0)`
- 路径安全：用 `param()` 块接收参数，`execFile` argv 传入，不内插到脚本字符串
- 120 秒超时
- `Files.tsx` 错误提示区分"Office 未安装"和"转换失败"

### B16 — 下载状态改 courseId+fileId 组合键

- 下载目录改为 `downloadDir/courseId/filename`（不同课程同名文件不再冲突）
- `downloadState` 用 `courseId+fileId` 组合键
- 下载历史记录新增 `courseId`/`fileId` 字段（可选，向后兼容）
- 批量下载改用 `filteredFiles` 并跳过已完成文件
- 批量下载结果提示跳过数量

### A7 — 课件面板假数据清理

- 上传时间无数据时显示 `'—'`（不再写死 `'2026-05-26 23:59'`）
- 来源无数据时显示 `'—'`（不再写死"任课教师"）
- 简介改为 `selectedFile.description || '暂无简介'`（不再写死通用假文案）

## 结果

- `npm run typecheck` 通过
- PPT 课件预览可用（最常见的课件格式）

## 后续注意

- 文件路径中的 `$`、反引号通过 param() 块安全传入，不再有注入风险
- PowerPoint COM 不能设 `Visible = $false`，只能用 `WithWindow=$false`
