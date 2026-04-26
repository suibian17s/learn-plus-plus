import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Popconfirm, Table, Tag, Progress, Empty, Typography } from 'antd'
import {
  ArrowLeftOutlined,
  DownloadOutlined,
  FileOutlined,
  FolderOpenOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons'
import { useDownloadStore } from '../store/downloads'

const { Text } = Typography

export default function DownloadsPage() {
  const navigate = useNavigate()
  const { downloads, clearAll, addOrUpdate, remove } = useDownloadStore()

  // Listen for download progress globally
  useEffect(() => {
    const unsub = window.learn.files.onProgress((data: any) => {
      addOrUpdate({
        id: data.id,
        fileName: data.fileName || '',
        loaded: data.loaded,
        total: data.total,
        status: data.status,
        destPath: data.destPath,
        time: Date.now(),
      })
    })
    return () => { unsub() }
  }, [addOrUpdate])

  const columns = [
    {
      title: '文件名',
      dataIndex: 'fileName',
      key: 'fileName',
      render: (name: string, r: any) => (
        <span style={{ fontSize: 13 }}>
          <FileOutlined style={{ marginRight: 8, color: '#999' }} />
          {name || '(未知)'}
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 180,
      render: (_: any, r: any) => {
        if (r.status === 'completed') return <Tag color="success" icon={<CheckCircleOutlined />}>已完成</Tag>
        if (r.status === 'error') return <Tag color="error" icon={<CloseCircleOutlined />}>失败</Tag>
        return <Tag color="processing">下载中</Tag>
      },
    },
    {
      title: '进度',
      dataIndex: 'progress',
      key: 'progress',
      width: 200,
      render: (_: any, r: any) => {
        if (r.status === 'downloading' && r.total > 0) {
          const pct = Math.round((r.loaded / r.total) * 100)
          return <Progress percent={pct} size="small" style={{ marginBottom: 0 }} />
        }
        if (r.status === 'completed') {
          const size = r.total > 0 ? `${(r.total / 1024 / 1024).toFixed(1)} MB` : ''
          return <Text type="secondary" style={{ fontSize: 12 }}>{size}</Text>
        }
        return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 190,
      render: (_: any, r: any) => {
        return (
          <div style={{ display: 'flex', gap: 8 }}>
            {r.status === 'completed' && r.destPath && (
              <Button
                type="link"
                size="small"
                icon={<FolderOpenOutlined />}
                onClick={() => window.learn.files.openFolder(r.destPath!)}
              >
                打开位置
              </Button>
            )}
            <Popconfirm
              title="从下载历史中删除这条记录？"
              okText="删除"
              cancelText="取消"
              onConfirm={() => remove(r.id)}
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </div>
        )
      },
    },
  ]

  const sorted = [...downloads].sort((a, b) => b.time - a.time)
  const activeCount = downloads.filter((d) => d.status === 'downloading').length

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}
          style={{ padding: 0 }}>
          返回
        </Button>
        <div style={{ display: 'flex', gap: 8 }}>
          <Popconfirm
            title="清空全部下载历史？正在下载的任务也会从列表移除。"
            okText="清空"
            cancelText="取消"
            onConfirm={clearAll}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>清空全部</Button>
          </Popconfirm>
        </div>
      </div>

      {sorted.length === 0 ? (
        <Empty description="暂无下载任务" />
      ) : (
        <>
          {activeCount > 0 && (
            <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
              <DownloadOutlined style={{ marginRight: 4 }} />
              {activeCount} 个文件正在下载
            </Text>
          )}
          <Table
            dataSource={sorted}
            columns={columns}
            rowKey="id"
            size="middle"
            pagination={false}
            style={{ background: '#fff', borderRadius: 8, border: '1px solid #f0f0f0' }}
          />
        </>
      )}
    </div>
  )
}
