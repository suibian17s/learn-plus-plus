import { Empty } from 'antd'

interface Props {
  description?: string
  image?: React.ReactNode
}

export default function EmptyState({ description = '暂无数据' }: Props) {
  return (
    <Empty
      description={description}
      style={{ padding: '80px 0' }}
      image={Empty.PRESENTED_IMAGE_SIMPLE}
    />
  )
}
