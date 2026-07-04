import { execFile } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'

type OfficeApp = 'Word' | 'PowerPoint' | 'Excel'

function getOfficeApp(ext: string): OfficeApp | null {
  const e = ext.toLowerCase()
  if (e === '.docx' || e === '.doc') return 'Word'
  if (e === '.pptx' || e === '.ppt') return 'PowerPoint'
  if (e === '.xlsx' || e === '.xls') return 'Excel'
  return null
}

function buildPowerShellScript(app: OfficeApp): string {
  switch (app) {
    case 'Word':
      return `param($inPath, $outPath)
$app = New-Object -ComObject Word.Application
$app.Visible = $false
$doc = $app.Documents.Open($inPath)
$doc.ExportAsFixedFormat($outPath, 17)
$doc.Close()
$app.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($doc) | Out-Null
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($app) | Out-Null
`
    case 'PowerPoint':
      // CRITICAL: Do NOT set $app.Visible = $false for PowerPoint — it throws.
      // Instead, open the presentation with WithWindow=$false (4th param).
      return `param($inPath, $outPath)
$app = New-Object -ComObject PowerPoint.Application
$pres = $app.Presentations.Open($inPath, $true, $false, $false)
$pres.SaveAs($outPath, 32)
$pres.Close()
$app.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($pres) | Out-Null
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($app) | Out-Null
`
    case 'Excel':
      return `param($inPath, $outPath)
$app = New-Object -ComObject Excel.Application
$app.Visible = $false
$wb = $app.Workbooks.Open($inPath)
$wb.ExportAsFixedFormat(0, $outPath)
$wb.Close()
$app.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($wb) | Out-Null
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($app) | Out-Null
`
  }
}

function isOfficeNotInstalled(stderr: string): boolean {
  return /80040154|class not registered|cannot create activex/i.test(stderr)
}

export async function convertToPdf(inputPath: string): Promise<string> {
  const ext = path.extname(inputPath)
  const officeApp = getOfficeApp(ext)
  if (!officeApp) throw new Error(`Unsupported file type: ${ext}`)

  // Derive PDF path by replacing only the trailing extension
  const pdfPath = inputPath.slice(0, -ext.length) + '.pdf'

  const psScript = buildPowerShellScript(officeApp)

  return new Promise((resolve, reject) => {
    const psFile = path.join(os.tmpdir(), `learnpp-convert-${Date.now()}.ps1`)
    fs.writeFileSync(psFile, psScript, 'utf8')

    execFile(
      'powershell.exe',
      [
        '-ExecutionPolicy', 'Bypass',
        '-File', psFile,
        '-inPath', inputPath,
        '-outPath', pdfPath,
      ],
      { timeout: 120000 },
      (err, _stdout, stderr) => {
        try { fs.unlinkSync(psFile) } catch { /* ignore */ }

        if (err) {
          const msg = stderr || err.message
          if (isOfficeNotInstalled(msg)) {
            reject(new Error(`OFFICE_NOT_INSTALLED:${officeApp}`))
          } else {
            reject(new Error(`COM_CONVERSION_FAILED:${msg.replace(/\r?\n/g, ' ').slice(0, 500)}`))
          }
        } else if (fs.existsSync(pdfPath)) {
          resolve(pdfPath)
        } else {
          reject(new Error('PDF was not generated; output file missing'))
        }
      }
    )
  })
}

export async function previewFile(
  tempPath: string
): Promise<{ method: 'pdf' | 'image' | 'text'; content: string }> {
  const ext = path.extname(tempPath).toLowerCase()

  if (ext === '.pdf') return { method: 'pdf', content: tempPath }
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
    return { method: 'image', content: tempPath }
  }

  if (['.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls'].includes(ext)) {
    try {
      const pdfPath = await convertToPdf(tempPath)
      return { method: 'pdf', content: pdfPath }
    } catch (err: any) {
      if (err.message?.startsWith('OFFICE_NOT_INSTALLED')) {
        const appName = err.message.split(':')[1] || 'Office'
        return {
          method: 'text',
          content: `OFFICE_NOT_INSTALLED:${appName}|未检测到 Microsoft ${appName} 安装。\n请安装 Microsoft Office 后重试，或下载文件后使用其他软件打开。`,
        }
      }
      const detail = err.message?.replace(/^COM_CONVERSION_FAILED:/, '') || '未知错误'
      return {
        method: 'text',
        content: `CONVERSION_FAILED:|Office 文件转换失败。\n请确认已安装对应版本的 Microsoft Office，或下载文件后使用其他软件打开。\n\n错误详情：${detail}`,
      }
    }
  }

  return { method: 'text', content: '不支持的文件格式' }
}
