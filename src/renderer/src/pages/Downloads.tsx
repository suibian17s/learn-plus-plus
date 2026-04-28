import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Popconfirm, Table, Tag, Progress, Empty, Typography, Tabs } from 'antd'
import {
  ArrowLeftOutlined,
  DownloadOutlined,
  FileOutlined,
  FolderOpenOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useDownloadStore } from '../store/downloads'

const { Text } = Typography

export default function DownloadsPage() {
  const navigate = useNavigate()
  const { downloads, clearAll, addOrUpdate, remove } = useDownloadStore()
  const [activeTab, setActiveTab] = useState('downloading')

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

  const sorted = [...downloads].sort((a, b) => b.time - a.time)

  const downloadingItems = sorted.filter((d) => d.status === 'downloading')
  const completedItems = sorted.filter((d) => d.status === 'completed')
  const failedItems = sorted.filter((d) => d.status === 'error')

  function handleRetry(item: { fileName: string }) {
    window.learn.files.openFolder('')
    // Note: We don't have the download URL stored, so we can't truly retry.
    // Direct the user back to the course files page.
  }

  const columns = [
    {
      title: '文件名',
      dataIndex: 'fileName',
      key: 'fileName',
      render: (name: string) => (
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
      width: 140,
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
      width: 220,
      render: (_: any, r: any) => {
        return (
          <div style={{ display: 'flex', gap: 8 }}>
            {r.status === 'completed' && r.destPath && (
              <>
                <Button
                  type="link"
                  size="small"
                  icon={<FileOutlined />}
                  onClick={() => window.learn.files.openFile(r.destPath!)}
                >
                  打开文件
                </Button>
                <Button
                  type="link"
                  size="small"
                  icon={<FolderOpenOutlined />}
                  onClick={() => window.learn.files.openFolder(r.destPath!)}
                >
                  打开位置
                </Button>
              </>
            )}
            {r.status === 'error' && (
              <Button
                type="link"
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => handleRetry(r)}
              >
                重试
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

  const tabItems = [
    {
      key: 'downloading',
      label: `进行中${downloadingItems.length > 0 ? ` (${downloadingItems.length})` : ''}`,
      children: downloadingItems.length === 0 ? (
        <Empty description="暂无下载中的任务" />
      ) : (
        <Table
          dataSource={downloadingItems}
          columns={columns}
          rowKey="id"
          size="middle"
          pagination={false}
          style={{ background: '#fff', borderRadius: 8, border: '1px solid #f0f0f0' }}
        />
      ),
    },
    {
      key: 'completed',
      label: `已完成 (${completedItems.length})`,
      children: completedItems.length === 0 ? (
        <Empty description="暂无已完成的下载" />
      ) : (
        <Table
          dataSource={completedItems}
          columns={columns}
          rowKey="id"
          size="middle"
          pagination={false}
          style={{ background: '#fff', borderRadius: 8, border: '1px solid #f0f0f0' }}
        />
      ),
    },
    {
      key: 'failed',
      label: `失败${failedItems.length > 0 ? ` (${failedItems.length})` : ''}`,
      children: failedItems.length === 0 ? (
        <Empty description="暂无失败的下载" />
      ) : (
        <Table
          dataSource={failedItems}
          columns={columns}
          rowKey="id"
          size="middle"
          pagination={false}
          style={{ background: '#fff', borderRadius: 8, border: '1px solid #f0f0f0' }}
        />
      ),
    },
  ]

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
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={tabItems}
          style={{ background: '#fff', borderRadius: 8, border: '1px solid #f0f0f0', padding: '0 16px' }}
        />
      )}
    </div>
  )
}
