import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, Input, message, Select, Spin, Tag } from 'antd'
import {
  CloudDownloadOutlined,
  DownloadOutlined,
  EyeOutlined,
  FilePdfOutlined,
  FilePptOutlined,
  FileTextOutlined,
  FileZipOutlined,
  FolderOpenOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import EmptyState from '../components/EmptyState'
import TutorSummaryDrawer from '../components/TutorSummaryDrawer'
import { useDownloadStore } from '../store/downloads'
import { formatDateTime } from '../utils/time'

interface DownloadEntry {
  loaded: number
  total: number
  status: string
  destPath?: string
  fileName?: string
}

export default function FilesPage() {
  const { courseId } = useParams()
  const [downloads, setDownloads] = useState<Record<string, DownloadEntry>>({})
  const [downloadStates, setDownloadStates] = useState<Record<string, { downloaded: boolean; destPath: string }>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [chapterFilter, setChapterFilter] = useState('all')
  const [sortOrder, setSortOrder] = useState('time-desc')
  const [summaryOpen, setSummaryOpen] = useState(false)
  const downloadRecords = useDownloadStore((state) => state.downloads)
  const addDownloadRecord = useDownloadStore((state) => state.addOrUpdate)

  const { data: files, isLoading } = useQuery({
    queryKey: ['files', courseId],
    queryFn: () => window.learn.files.list(courseId!),
    enabled: !!courseId,
  })

  const chapters = useMemo(() => {
    if (!files) return []
    return [...new Set(files.map((f: any) => f.chapter || '未分类'))]
  }, [files])

  const filteredFiles = useMemo(() => {
    if (!files) return []
    let result = [...files]
    const q = keyword.trim().toLowerCase()
    if (q) {
      result = result.filter((file: any) => String(file.name || '').toLowerCase().includes(q))
    }
    if (chapterFilter !== 'all') {
      result = result.filter((file: any) => (file.chapter || '未分类') === chapterFilter)
    }
    result.sort((a: any, b: any) => {
      switch (sortOrder) {
        case 'time-asc':
          return new Date(a.uploadTime || 0).getTime() - new Date(b.uploadTime || 0).getTime()
        case 'time-desc':
          return new Date(b.uploadTime || 0).getTime() - new Date(a.uploadTime || 0).getTime()
        case 'name-asc':
          return String(a.name || '').localeCompare(String(b.name || ''))
        case 'name-desc':
          return String(b.name || '').localeCompare(String(a.name || ''))
        default:
          return 0
      }
    })
    return result
  }, [files, keyword, chapterFilter, sortOrder])

  const selectedFile = filteredFiles.find((file: any) => file.id === selectedId) || filteredFiles[0]

  useEffect(() => {
    const unsub = window.learn.files.onProgress((data: any) => {
      addDownloadRecord({
        id: data.id,
        fileName: data.fileName,
        loaded: data.loaded,
        total: data.total,
        status: data.status,
        destPath: data.destPath,
        time: Date.now(),
      })
      setDownloads((prev) => ({
        ...prev,
        [data.id]: {
          loaded: data.loaded,
          total: data.total,
          status: data.status,
          destPath: data.destPath || prev[data.id]?.destPath,
          fileName: data.fileName,
        },
      }))
    })
    return () => { unsub() }
  }, [addDownloadRecord])

  useEffect(() => {
    if (!files?.length) return

    if (!selectedId || !files.some((file: any) => file.id === selectedId)) {
      setSelectedId(files[0].id)
    }

    let alive = true
    Promise.all(files.map(async (file: any) => {
      const cid = file.courseId || courseId
      const fid = file.fileId || file.id
      const downloadName = file.downloadName || file.name
      const state = await window.learn.files.downloadState(cid, fid, downloadName)
      return [state.key, state] as const
    })).then((entries) => {
      if (!alive) return
      setDownloadStates((prev) => {
        const next = { ...prev }
        for (const [key, state] of entries) next[key] = state
        return next
      })
    })

    return () => {
      alive = false
    }
  }, [files, selectedId, courseId])

  async function handleDownload(file: any) {
    const downloadName = file.downloadName || file.name
    const cid = file.courseId || courseId!
    const fid = file.fileId || file.id
    const key = `${cid}_${fid}`
    try {
      message.loading({ content: `正在下载 ${file.name}...`, key: file.id })
      const result = await window.learn.files.download(cid, file.id, downloadName, file.downloadUrl)
      setDownloads((prev) => ({
        ...prev,
        [result.downloadId]: {
          ...prev[result.downloadId],
          destPath: result.destPath,
          fileName: downloadName,
          status: 'completed',
          loaded: 0,
          total: 0,
        },
      }))
      addDownloadRecord({
        id: result.downloadId,
        fileName: downloadName,
        courseId: cid,
        fileId: fid,
        loaded: 0,
        total: 0,
        status: 'completed',
        destPath: result.destPath,
        time: Date.now(),
      })
      setDownloadStates((prev) => ({
        ...prev,
        [key]: { downloaded: true, destPath: result.destPath },
      }))
      message.success({ content: `${file.name} 下载完成`, key: file.id })
    } catch {
      message.error({ content: `下载失败: ${file.name}`, key: file.id })
    }
  }

  async function handlePreview(file: any) {
    message.loading({ content: '加载预览...', key: 'preview' })
    try {
      const result = await window.learn.files.previewOpen(
        file.fileId || file.id,
        file.downloadName || file.name,
        file.downloadUrl
      )
      message.destroy('preview')
      if (result.method === 'pdf' || result.method === 'image') {
        window.learn.files.previewWindow(result.content, result.fileName)
      } else {
        message.info(result.content)
      }
    } catch {
      message.destroy('preview')
      message.error('预览加载失败')
    }
  }

  async function handleBatchDownload() {
    if (!filteredFiles?.length) return
    const cid = courseId!
    // Separate already-downloaded files from pending ones
    const pending: any[] = []
    let skipped = 0
    for (const f of filteredFiles) {
      if (downloadedFile(f)) {
        skipped++
      } else {
        pending.push(f)
      }
    }
    if (pending.length === 0) {
      message.info('所有文件已下载完成')
      return
    }
    message.loading({ content: '批量下载中...', key: 'batch' })
    const items = pending.map((f: any) => ({
      courseId: cid,
      fileId: f.fileId || f.id,
      fileName: f.downloadName || f.name,
      url: f.downloadUrl,
    }))
    try {
      const results = await window.learn.files.batchDownload(items)
      const ok = results.filter((r) => r.success).length
      const fail = results.filter((r) => !r.success).length
      message.destroy('batch')
      const skipMsg = skipped > 0 ? `（已跳过 ${skipped} 个已完成）` : ''
      if (fail > 0) {
        message.warning(`批量下载完成: ${ok} 成功, ${fail} 失败${skipMsg}`)
      } else {
        message.success(`下载 ${ok} 个文件${skipMsg}`)
      }
      // Update download states for the batch results
      setDownloadStates((prev) => {
        const next = { ...prev }
        for (const r of results) {
          const item = pending.find((f: any) => (f.fileId || f.id) === r.fileId)
          if (item && r.success && r.destPath) {
            const key = `${cid}_${item.fileId || item.id}`
            next[key] = { downloaded: true, destPath: r.destPath }
          }
        }
        return next
      })
      // Update download records
      for (const r of results) {
        if (r.success && r.destPath) {
          const item = pending.find((f: any) => (f.fileId || f.id) === r.fileId)
          if (item) {
            const fid = item.fileId || item.id
            addDownloadRecord({
              id: `${r.fileId}-batch-${Date.now()}`,
              fileName: item.downloadName || item.name,
              courseId: cid,
              fileId: fid,
              loaded: 0,
              total: 0,
              status: 'completed',
              destPath: r.destPath,
              time: Date.now(),
            })
          }
        }
      }
    } catch {
      message.destroy('batch')
      message.error('批量下载失败')
    }
  }

  function handleTutorSummary() {
    if (!selectedFile) return
    setSummaryOpen(true)
  }

  function formatSize(bytes: number) {
    if (!bytes) return '-'
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function downloadedFile(record: any): { destPath: string } | null {
    const cid = record.courseId || courseId
    const fid = record.fileId || record.id
    const key = `${cid}_${fid}`

    const state = downloadStates[key]
    if (state?.downloaded) return { destPath: state.destPath }

    const history = downloadRecords.find((item) => (
      item.status === 'completed' &&
      item.destPath &&
      item.courseId === cid &&
      item.fileId === fid
    ))
    if (history?.destPath) return { destPath: history.destPath }

    const current = Object.values(downloads).find((item) => (
      item.destPath &&
      item.status === 'completed' &&
      item.fileName === (record.downloadName || record.name)
    ))
    return current?.destPath ? { destPath: current.destPath } : null
  }

  function fileIcon(fileName: string) {
    const lower = fileName.toLowerCase()
    if (lower.endsWith('.ppt') || lower.endsWith('.pptx')) return <FilePptOutlined />
    if (lower.endsWith('.pdf')) return <FilePdfOutlined />
    if (lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.7z')) return <FileZipOutlined />
    if (lower.endsWith('.mp4') || lower.endsWith('.mov')) return <PlayCircleOutlined />
    return <FileTextOutlined />
  }

  function fileTone(fileName: string) {
    const lower = fileName.toLowerCase()
    if (lower.endsWith('.ppt') || lower.endsWith('.pptx')) return 'orange'
    if (lower.endsWith('.pdf')) return 'red'
    if (lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.7z')) return 'slate'
    if (lower.endsWith('.mp4') || lower.endsWith('.mov')) return 'purple'
    return 'blue'
  }

  const selectedDownload = selectedFile ? downloadedFile(selectedFile) : null
  const selectedMeta = useMemo(() => {
    if (!selectedFile) return null
    return {
      uploadTime: formatDateTime(selectedFile.uploadTime) || '—',
      size: formatSize(selectedFile.size),
      source: selectedFile.publisher || selectedFile.teacher || '—',
      desc: selectedFile.description || '',
    }
  }, [selectedFile])

  if (isLoading) return <Spin style={{ display: 'block', margin: '40px auto' }} />
  if (!files?.length) return <EmptyState description="暂无课件" />

  return (
    <div className="lp2-files-page">
      <div className="lp2-file-toolbar">
        <Input prefix={<SearchOutlined />} placeholder="搜索课件" allowClear value={keyword} onChange={(event) => setKeyword(event.target.value)} />
        <Select
          value={chapterFilter}
          onChange={setChapterFilter}
          options={[{ value: 'all', label: '全部章节' }, ...chapters.map((c) => ({ value: c, label: c }))]}
        />
        <Select
          value={sortOrder}
          onChange={setSortOrder}
          options={[
            { value: 'time-desc', label: '最新优先' },
            { value: 'time-asc', label: '最早优先' },
            { value: 'name-asc', label: '文件名 A-Z' },
            { value: 'name-desc', label: '文件名 Z-A' },
          ]}
        />
        <Button icon={<CloudDownloadOutlined />} onClick={handleBatchDownload}>
          批量下载
        </Button>
      </div>

      <div className="lp2-files-layout">
        <section className="lp2-file-list-card">
          {filteredFiles.map((file: any) => {
            const dl = downloadedFile(file)
            const active = selectedFile?.id === file.id
            return (
              <button
                key={file.id}
                type="button"
                className={`lp2-file-row${active ? ' active' : ''}`}
                onClick={() => setSelectedId(file.id)}
              >
                <span className={`lp2-file-icon ${fileTone(file.name)}`}>{fileIcon(file.name)}</span>
                <span className="lp2-file-copy">
                  <strong>{file.name}</strong>
                  <small>{formatSize(file.size)} · {formatDateTime(file.uploadTime) || '-'}</small>
                </span>
                <span className="lp2-file-status">
                  {dl ? <Tag color="green">已下载</Tag> : null}
                  <span className="lp2-file-actions-inline">
                    <button
                      type="button"
                      className="lp2-file-action-button"
                      aria-label="预览课件"
                      title="预览课件"
                      onClick={(event) => {
                        event.stopPropagation()
                        handlePreview(file)
                      }}
                    >
                      <EyeOutlined />
                    </button>
                    <button
                      type="button"
                      className="lp2-file-action-button"
                      aria-label={dl ? '打开课件' : '下载课件'}
                      title={dl ? '打开课件' : '下载课件'}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (dl) {
                          window.learn.files.openFile(dl.destPath)
                          return
                        }
                        handleDownload(file)
                      }}
                    >
                      {dl ? <FolderOpenOutlined /> : <DownloadOutlined />}
                    </button>
                  </span>
                </span>
              </button>
            )
          })}
        </section>

        {selectedFile && selectedMeta && (
          <aside className="lp2-file-detail-card">
            <div className="lp2-file-detail-head">
              <span className={`lp2-file-icon large ${fileTone(selectedFile.name)}`}>
                {fileIcon(selectedFile.name)}
              </span>
              <h2>{selectedFile.name}</h2>
            </div>
            <div className="lp2-file-detail-meta">
              <span>上传时间</span>
              <strong>{selectedMeta.uploadTime}</strong>
              <span>文件大小</span>
              <strong>{selectedMeta.size}</strong>
              <span>来源</span>
              <strong>{selectedMeta.source}</strong>
              {selectedMeta.desc && (
                <>
                  <span>简介</span>
                  <p>{selectedMeta.desc}</p>
                </>
              )}
            </div>
            <div className="lp2-file-detail-actions">
              {selectedDownload ? (
                <>
                  <Button
                    type="primary"
                    icon={<FolderOpenOutlined />}
                    onClick={() => window.learn.files.openFile(selectedDownload.destPath)}
                  >
                    打开课件
                  </Button>
                  <Button className="lp2-green-button" icon={<RobotOutlined />} onClick={handleTutorSummary} disabled={!selectedFile}>
                    甘蔗 Tutor 总结
                  </Button>
                </>
              ) : (
                <Button type="primary" icon={<DownloadOutlined />} onClick={() => handleDownload(selectedFile)}>
                  下载课件
                </Button>
              )}
            </div>
          </aside>
        )}
      </div>

      {selectedFile && (
        <TutorSummaryDrawer
          open={summaryOpen}
          onClose={() => setSummaryOpen(false)}
          title={`课件总结 · ${selectedFile.name}`}
          summaryKey={`file:${courseId}:${selectedFile.fileId || selectedFile.id}`}
          run={(sessionId) => window.learn.hwai.summarizeFile({
            name: selectedFile.name,
            url: selectedFile.downloadUrl,
            fileType: selectedFile.fileType,
            sessionId,
          })}
          chatRun={(question, history, sessionId) => window.learn.hwai.fileChat({
            file: { name: selectedFile.name, url: selectedFile.downloadUrl, fileType: selectedFile.fileType },
            question,
            history,
            sessionId,
          })}
        />
      )}
    </div>
  )
}
