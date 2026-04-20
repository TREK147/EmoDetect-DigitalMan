import { useEffect, useMemo, useState } from 'react'
import { Card, Table, Tag, Space, Button, App as AntApp } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { useAuth } from '../../state/auth'
import { api } from '../../mock/api'
import type { AuditLog } from '../../mock/types'

export function AuditLogPage() {
  const { token } = useAuth()
  const { message } = AntApp.useApp()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<AuditLog[]>([])

  async function refresh() {
    setLoading(true)
    const r = await api.adminListAuditLogs(token)
    setLoading(false)
    if (!r.ok) {
      message.error(r.message)
      return
    }
    setRows(r.data)
  }

  useEffect(() => {
    void refresh()
  }, [token])

  const columns = useMemo<ColumnsType<AuditLog>>(
    () => [
      { title: '时间', dataIndex: 'ts', width: 170, render: (v) => dayjs(v).format('YYYY-MM-DD HH:mm:ss') },
      {
        title: '动作',
        dataIndex: 'action',
        width: 160,
        render: (v) => <Tag>{v}</Tag>,
      },
      { title: '操作人', key: 'actor', width: 160, render: (_, r) => (r.actorStaffNo ? `${r.actorName ?? ''}（${r.actorStaffNo}）` : '-') },
      { title: '目标学生', dataIndex: 'targetStudentNo', width: 110, render: (v) => v ?? '-' },
      { title: '目标账号', dataIndex: 'targetStaffNo', width: 110, render: (v) => v ?? '-' },
      { title: 'IP', dataIndex: 'ip', width: 120 },
      { title: '设备', dataIndex: 'device', width: 260, ellipsis: true },
      { title: '内容', dataIndex: 'detail' },
    ],
    [],
  )

  return (
    <div className="page">
      <Card
        title="系统安全与审计日志"
        extra={
          <Space>
            <Button onClick={() => void refresh()} loading={loading}>
              刷新
            </Button>
          </Space>
        }
      >
        <Table<AuditLog> rowKey="id" columns={columns} dataSource={rows} loading={loading} pagination={{ pageSize: 10 }} />
      </Card>
    </div>
  )
}

