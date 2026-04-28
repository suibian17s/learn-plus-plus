import { execFile } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'

type OfficeApp = 'Word.Application' | 'PowerPoint.Application' | 'Excel.Application'

function getOfficeApp(ext: string): OfficeApp | null {
  const e = ext.toLowerCase()
  if (e === '.docx' || e === '.doc') return 'Word.Application'
  if (e === '.pptx' || e === '.ppt') return 'PowerPoint.Application'
  if (e === '.xlsx' || e === '.xls') return 'Excel.Application'
  return null
}

export async function convertToPdf(inputPath: string): Promise<string> {
  const ext = path.extname(inputPath)
  const officeApp = getOfficeApp(ext)
  if (!officeApp) throw new Error(`Unsupported file type: ${ext}`)
  const pdfPath = inputPath.replace(ext, '.pdf')
  const psScript = `
$app = New-Object -ComObject "${officeApp}"
$app.Visible = $false
$doc = $app.Documents.Open("${inputPath.replace(/\\/g, '\\\\')}")
$doc.ExportAsFixedFormat("${pdfPath.replace(/\\/g, '\\\\')}", 17, $false)
$doc.Close()
$app.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($doc) | Out-Null
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($app) | Out-Null
`
  return new Promise((resolve, reject) => {
    const psFile = path.join(os.tmpdir(), `convert-${Date.now()}.ps1`)
    fs.writeFileSync(psFile, psScript)
    execFile('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', psFile], { timeout: 60000 }, (err) => {
      try { fs.unlinkSync(psFile) } catch { /* ignore */ }
      if (err) reject(new Error(`COM conversion failed: ${err.message}`))
      else if (fs.existsSync(pdfPath)) resolve(pdfPath)
      else reject(new Error('PDF was not generated'))
    })
  })
}

export async function previewFile(tempPath: string): Promise<{ method: 'pdf' | 'image' | 'text'; content: string }> {
  const ext = path.extname(tempPath).toLowerCase()
  if (ext === '.pdf') return { method: 'pdf', content: tempPath }
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
    return { method: 'image', content: tempPath }
  }
  if (['.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls'].includes(ext)) {
    try {
      const pdfPath = await convertToPdf(tempPath)
      return { method: 'pdf', content: pdfPath }
    } catch {
      return { method: 'text', content: 'Office 未安装或转换失败，请安装 Microsoft Office 后重试。' }
    }
  }
  return { method: 'text', content: '不支持的文件格式' }
}
