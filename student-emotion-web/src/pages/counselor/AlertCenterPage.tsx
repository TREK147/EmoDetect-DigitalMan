import { useEffect, useMemo, useState } from 'react'
import { Card, Table, Tag, Space, Button, Modal, Form, Input, App as AntApp } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { useAuth } from '../../state/auth'
import { api } from '../../mock/api'
import type { AlertItem } from '../../mock/types'

function statusText(status: AlertItem['status']) {
  if (status === 'NEW') return '待处理'
  if (status === 'FOLLOWED') return '已跟进'
  return '已消除'
}

export function AlertCenterPage() {
  const { token } = useAuth()
  const { message } = AntApp.useApp()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<AlertItem[]>([])
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState<AlertItem | null>(null)
  const [form] = Form.useForm()
  const [targetStatus, setTargetStatus] = useState<AlertItem['status']>('FOLLOWED')

  async function refresh() {
    setLoading(true)
    const r = await api.counselorListAlerts(token)
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

  const columns = useMemo<ColumnsType<AlertItem>>(
    () => [
      { title: '时间', dataIndex: 'createdAt', width: 160, render: (v) => dayjs(v).format('YYYY-MM-DD HH:mm') },
      { title: '学生', key: 'stu', render: (_, r) => `${r.studentName}（${r.studentNo}）` },
      {
        title: '等级',
        dataIndex: 'level',
        width: 80,
        render: (v) => (
          <Tag color={v === '危' ? 'red' : v === '高' ? 'volcano' : v === '中' ? 'gold' : 'green'}>{v}</Tag>
        ),
      },
      { title: '原因', dataIndex: 'reason' },
      {
        title: '状态',
        dataIndex: 'status',
        width: 110,
        render: (v) => <Tag color={v === 'NEW' ? 'red' : v === 'FOLLOWED' ? 'blue' : 'green'}>{statusText(v)}</Tag>,
      },
      { title: '备注', dataIndex: 'note', width: 220, ellipsis: true },
      {
        title: '操作',
        key: 'op',
        width: 220,
        render: (_, r) => (
          <Space>
            <Button
              size="small"
              onClick={() => {
                setCurrent(r)
                setTargetStatus('FOLLOWED')
                setOpen(true)
                form.setFieldsValue({ note: r.note })
              }}
              disabled={r.status === 'CLEARED'}
            >
              标记已跟进
            </Button>
            <Button
              size="small"
              type="primary"
              onClick={() => {
                setCurrent(r)
                setTargetStatus('CLEARED')
                setOpen(true)
                form.setFieldsValue({ note: r.note })
              }}
            >
              标记已消除
            </Button>
          </Space>
        ),
      },
    ],
    [form],
  )

  return (
    <div className="page">
      <Card title="异常情绪预警与干预" extra={<Button onClick={() => void refresh()}>刷新</Button>}>
        <Table<AlertItem> rowKey="id" columns={columns} dataSource={rows} loading={loading} pagination={{ pageSize: 8 }} />
      </Card>

      <Modal
        open={open}
        title={targetStatus === 'FOLLOWED' ? '标记：已跟进/干预' : '标记：已消除'}
        onCancel={() => setOpen(false)}
        onOk={async () => {
          if (!current) return
          const v = await form.validateFields()
          const r = await api.counselorUpdateAlert(token, { id: current.id, status: targetStatus, note: v.note })
          if (!r.ok) {
            message.error(r.message)
            return
          }
          message.success('更新成功')
          setOpen(false)
          await refresh()
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="备注" name="note">
            <Input.TextArea rows={4} placeholder="填写跟进记录/干预措施/消除原因等" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

