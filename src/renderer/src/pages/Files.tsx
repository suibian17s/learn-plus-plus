import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Table, Button, message, Spin } from 'antd'
import { DownloadOutlined, FolderOpenOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
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
  const downloadRecords = useDownloadStore((s) => s.downloads)
  const addDownloadRecord = useDownloadStore((s) => s.addOrUpdate)

  const { data: files, isLoading } = useQuery({
    queryKey: ['files', courseId],
    queryFn: () => window.learn.files.list(courseId!),
    enabled: !!courseId,
  })

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
  }, [files])

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

    const history = downloadRecords.find((d) => (
      d.status === 'completed' &&
      d.destPath &&
      (d.fileName === record.name || d.fileName === downloadName)
    ))
    if (history?.destPath) return { destPath: history.destPath }

    const current = Object.values(downloads).find((d) => (
      d.destPath &&
      (d.fileName === record.name || d.fileName === downloadName) &&
      d.status === 'completed'
    ))
    return current?.destPath ? { destPath: current.destPath } : null
  }

  const columns: ColumnsType<any> = [
    { title: '文件名', dataIndex: 'name', key: 'name', ellipsis: true },
    { title: '大小', dataIndex: 'size', key: 'size', width: 100, render: (s: number) => formatSize(s) },
    { title: '上传时间', dataIndex: 'uploadTime', key: 'uploadTime', width: 180, render: (t: string) => formatDateTime(t) || '-' },
    {
      title: '操作', key: 'actions', width: 200,
      render: (_: any, record: any) => {
        const dl = downloadedFile(record)
        return (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {dl ? (
              <Button size="small" icon={<FolderOpenOutlined />} style={{ color: '#52C41A' }}
                onClick={() => window.learn.files.openFolder(dl.destPath)}>
                已下载
              </Button>
            ) : (
              <Button size="small" type="primary" icon={<DownloadOutlined />}
                onClick={() => handleDownload(record)}>
                下载
              </Button>
            )}
          </div>
        )
      },
    },
  ]

  if (isLoading) return <Spin style={{ display: 'block', margin: '40px auto' }} />
  if (!files?.length) return <EmptyState description="暂无课件" />

  return (
    <Table
      dataSource={files}
      columns={columns}
      rowKey="id"
      pagination={false}
      size="middle"
      style={{ background: '#fff', borderRadius: 8 }}
    />
  )
}
