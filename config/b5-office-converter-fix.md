# B5: Office to PDF converter fix

**Date:** 2026-07-02
**Issue:** Office-to-PDF preview only worked for Word files; PPT and Excel always failed.

## Root cause

`convertToPdf()` in `src/main/services/office-converter.ts` used `$app.Documents.Open()` (Word-only COM API) for ALL Office applications. Additionally, `$app.Visible = $false` throws for PowerPoint, and file paths were interpolated directly into PowerShell double-quoted strings (injection risk for filenames containing `$`, backtick, or other PS special chars).

## Fix

### 1. Per-application COM automation (`buildPowerShellScript`)

- **Word (.doc/.docx):** `Documents.Open` + `ExportAsFixedFormat($path, 17)` — unchanged API, correct
- **PowerPoint (.ppt/.pptx):** `Presentations.Open($path, $true, $false, $false)` + `SaveAs($path, 32)`. CRITICAL: Do NOT set `$app.Visible = $false` — it throws for PowerPoint. Instead use `WithWindow=$false` (4th param to `Presentations.Open`)
- **Excel (.xls/.xlsx):** `Workbooks.Open` + `ExportAsFixedFormat(0, $path)` (0 = xlTypePDF)

### 2. Path injection fix

File paths are no longer interpolated into the PowerShell script string. Instead, each script uses a `param($inPath, $outPath)` block, and paths are passed as literal argv entries to `execFile()`:

```
execFile('powershell.exe', [
  '-ExecutionPolicy', 'Bypass',
  '-File', psFile,
  '-inPath', inputPath,
  '-outPath', pdfPath,
])
```

This is safe because each array element is a literal string in argv — never evaluated by any shell.

### 3. Error categorization

- Detects "Office not installed" via stderr patterns (`80040154`, `Class not registered`, `Cannot create ActiveX`)
- Distinguished error types: `OFFICE_NOT_INSTALLED` vs `COM_CONVERSION_FAILED`
- Increased timeout from 60s to 120s for large presentations

### 4. Renderer error display (`Files.tsx`)

- `OFFICE_NOT_INSTALLED` → `Modal.warning` with actionable guidance
- `CONVERSION_FAILED` → `Modal.error` with error details
- Network/download errors → `Modal.error`
- Generic text → `message.info` (unchanged)

## Files changed

- `src/main/services/office-converter.ts` — complete rewrite
- `src/renderer/src/pages/Files.tsx` — `handlePreview()` error UX

## Typecheck

Passed: `npx tsc --noEmit` — no errors.
