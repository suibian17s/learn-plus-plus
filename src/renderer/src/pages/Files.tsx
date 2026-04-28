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
  const downloadRecords = useDownloadStore((state) => state.downloads)
  const addDownloadRecord = useDownloadStore((state) => state.addOrUpdate)

  const { data: files, isLoading } = useQuery({
    queryKey: ['files', courseId],
    queryFn: () => window.learn.files.list(courseId!),
    enabled: !!courseId,
  })

  const visibleFiles = useMemo(() => {
    if (!files) return []
    const q = keyword.trim().toLowerCase()
    if (!q) return files
    return files.filter((file: any) => String(file.name || '').toLowerCase().includes(q))
  }, [files, keyword])

  const selectedFile = visibleFiles.find((file: any) => file.id === selectedId) || visibleFiles[0]

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
      const downloadName = file.downloadName || file.name
      const state = await window.learn.files.downloadState(downloadName)
      return [downloadName, state] as const
    })).then((entries) => {
      if (!alive) return
      setDownloadStates((prev) => {
        const next = { ...prev }
        for (const [name, state] of entries) next[name] = state
        return next
      })
    })

    return () => {
      alive = false
    }
  }, [files, selectedId])

  async function handleDownload(file: any) {
    const downloadName = file.downloadName || file.name
    try {
      message.loading({ content: `正在下载 ${file.name}...`, key: file.id })
      const result = await window.learn.files.download(file.id, downloadName, file.downloadUrl)
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
        loaded: 0,
        total: 0,
        status: 'completed',
        destPath: result.destPath,
        time: Date.now(),
      })
      setDownloadStates((prev) => ({
        ...prev,
        [downloadName]: { downloaded: true, destPath: result.destPath },
      }))
      message.success({ content: `${file.name} 下载完成`, key: file.id })
    } catch {
      message.error({ content: `下载失败: ${file.name}`, key: file.id })
    }
  }

  function formatSize(bytes: number) {
    if (!bytes) return '-'
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function downloadedFile(record: any): { destPath: string } | null {
    const downloadName = record.downloadName || record.name
    const state = downloadStates[downloadName]
    if (state?.downloaded) return { destPath: state.destPath }

    const history = downloadRecords.find((item) => (
      item.status === 'completed' &&
      item.destPath &&
      (item.fileName === record.name || item.fileName === downloadName)
    ))
    if (history?.destPath) return { destPath: history.destPath }

    const current = Object.values(downloads).find((item) => (
      item.destPath &&
      (item.fileName === record.name || item.fileName === downloadName) &&
      item.status === 'completed'
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
      uploadTime: formatDateTime(selectedFile.uploadTime) || '2026-05-26 23:59',
      size: formatSize(selectedFile.size),
      source: selectedFile.publisher || selectedFile.teacher || '任课教师',
      desc: '本章介绍课程资料中的核心概念与实践方法，可配合甘蔗 Tutor 生成摘要、重点和复习提纲。',
    }
  }, [selectedFile])

  if (isLoading) return <Spin style={{ display: 'block', margin: '40px auto' }} />
  if (!files?.length) return <EmptyState description="暂无课件" />

  return (
    <div className="lp2-files-page">
      <div className="lp2-file-toolbar">
        <Input prefix={<SearchOutlined />} placeholder="搜索课件" allowClear value={keyword} onChange={(event) => setKeyword(event.target.value)} />
        <Select
          defaultValue="all"
          options={[{ value: 'all', label: '全部章节' }, { value: 'chapter-3', label: '第 3 章' }]}
        />
        <Select
          defaultValue="time"
          options={[{ value: 'time', label: '发布时间' }, { value: 'name', label: '文件名' }]}
        />
        <Button icon={<CloudDownloadOutlined />} onClick={() => message.info('批量下载将在 v2.0 后续开发中接入')}>
          批量下载
        </Button>
        <Button className="lp2-green-button" icon={<RobotOutlined />} onClick={() => message.info('甘蔗 Tutor 总结将在后续接入')}>
          甘蔗 Tutor 总结
        </Button>
      </div>

      <div className="lp2-files-layout">
        <section className="lp2-file-list-card">
          {visibleFiles.map((file: any) => {
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
                  {dl ? <Tag color="green">已下载</Tag> : <Tag color="purple">未下载</Tag>}
                  <span className="lp2-file-actions-inline">
                    <button
                      type="button"
                      className="lp2-file-action-button"
                      aria-label="预览课件"
                      onClick={(event) => {
                        event.stopPropagation()
                        message.info('课件预览将在后续接入')
                      }}
                    >
                      <EyeOutlined />
                    </button>
                    <button
                      type="button"
                      className="lp2-file-action-button"
                      aria-label={dl ? '打开课件' : '下载课件'}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (dl) {
                          window.learn.files.openFolder(dl.destPath)
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
              <span>简介</span>
              <p>{selectedMeta.desc}</p>
            </div>
            <div className="lp2-file-detail-actions">
              {selectedDownload ? (
                <>
                  <Button
                    type="primary"
                    icon={<FolderOpenOutlined />}
                    onClick={() => window.learn.files.openFolder(selectedDownload.destPath)}
                  >
                    打开课件
                  </Button>
                  <Button className="lp2-green-button" icon={<RobotOutlined />} onClick={() => message.info('甘蔗 Tutor 总结将在后续接入')}>
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
    </div>
  )
}
