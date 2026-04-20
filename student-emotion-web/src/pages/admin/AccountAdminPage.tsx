import { useEffect, useMemo, useState } from 'react'
import { Card, Table, Tag, Space, Button, App as AntApp } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { useAuth } from '../../state/auth'
import { api } from '../../mock/api'
import type { DataScope, RoleCode, UserAccountStatus } from '../../mock/types'

type Row = {
  id: string
  staffNo: string
  name: string
  role: RoleCode
  roleName: string
  scope?: DataScope
  status: UserAccountStatus
  failedLoginCount: number
  lockedUntil?: number
  lastLoginAt?: number
}

export function AccountAdminPage() {
  const { token } = useAuth()
  const { message } = AntApp.useApp()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<Row[]>([])

  async function refresh() {
    setLoading(true)
    const r = await api.adminListAccounts(token)
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

  const columns = useMemo<ColumnsType<Row>>(
    () => [
      { title: '工号', dataIndex: 'staffNo', width: 110 },
      { title: '姓名', dataIndex: 'name', width: 100 },
      { title: '角色', dataIndex: 'roleName' },
      {
        title: '状态',
        dataIndex: 'status',
        width: 110,
        render: (v) => <Tag color={v === 'ACTIVE' ? 'green' : v === 'LOCKED' ? 'gold' : 'red'}>{v}</Tag>,
      },
      { title: '失败次数', dataIndex: 'failedLoginCount', width: 90 },
      {
        title: '锁定至',
        dataIndex: 'lockedUntil',
        width: 170,
        render: (v) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
      },
      {
        title: '最近登录',
        dataIndex: 'lastLoginAt',
        width: 170,
        render: (v) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
      },
      {
        title: '操作',
        key: 'op',
        width: 260,
        render: (_, r) => (
          <Space>
            <Button
              size="small"
              onClick={async () => {
                const res = await api.adminSetAccountStatus(token, { staffNo: r.staffNo, status: 'ACTIVE' })
                if (!res.ok) message.error(res.message)
                else message.success('已启用')
                await refresh()
              }}
            >
              启用
            </Button>
            <Button
              size="small"
              onClick={async () => {
                const res = await api.adminSetAccountStatus(token, { staffNo: r.staffNo, status: 'FROZEN' })
                if (!res.ok) message.error(res.message)
                else message.success('已冻结（若在线将强制下线）')
                await refresh()
              }}
              danger
            >
              冻结
            </Button>
            <Button
              size="small"
              onClick={async () => {
                const res = await api.adminSetAccountStatus(token, { staffNo: r.staffNo, status: 'DISABLED' })
                if (!res.ok) message.error(res.message)
                else message.success('已停用（若在线将强制下线）')
                await refresh()
              }}
            >
              停用
            </Button>
          </Space>
        ),
      },
    ],
    [token, message],
  )

  return (
    <div className="page">
      <Card
        title="账号列表（冻结/停用/强制下线）"
        extra={
          <Button onClick={() => void refresh()} loading={loading}>
            刷新
          </Button>
        }
      >
        <Table<Row> rowKey="id" columns={columns} dataSource={rows} loading={loading} pagination={{ pageSize: 8 }} />
      </Card>
    </div>
  )
}

