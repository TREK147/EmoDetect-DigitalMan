import { useEffect, useMemo, useState } from 'react'
import { Card, Form, Select, Button, Space, App as AntApp, Alert, Typography } from 'antd'
import { useAuth } from '../../state/auth'
import { api } from '../../mock/api'
import type { DataScope, RoleCode } from '../../mock/types'

type AccountRow = {
  staffNo: string
  name: string
  role: RoleCode
  roleName: string
  scope?: DataScope
}

const colleges = [
  { id: 'C01', name: '信息工程学院' },
  { id: 'C02', name: '管理学院' },
]

const majorsByCollege: Record<string, string[]> = {
  C01: ['软件工程', '计算机科学与技术'],
  C02: ['工商管理', '会计学'],
}

const classIdsByCombo: Record<string, Array<{ id: string; name: string }>> = {
  'C01|2024|软件工程': [
    { id: 'CL2401', name: '软工2401班' },
    { id: 'CL2402', name: '软工2402班' },
  ],
  'C02|2023|工商管理': [{ id: 'CL2301', name: '工管2301班' }],
}

export function RoleScopeAdminPage() {
  const { token } = useAuth()
  const { message } = AntApp.useApp()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [accounts, setAccounts] = useState<AccountRow[]>([])

  async function refresh() {
    setLoading(true)
    const r = await api.adminListAccounts(token)
    setLoading(false)
    if (!r.ok) {
      message.error(r.message)
      return
    }
    setAccounts(r.data)
  }

  useEffect(() => {
    void refresh()
  }, [token])

  const selectedStaffNo = Form.useWatch('staffNo', form) as string | undefined
  const selectedAccount = useMemo(
    () => accounts.find((a) => a.staffNo === selectedStaffNo),
    [accounts, selectedStaffNo],
  )

  useEffect(() => {
    if (!selectedAccount) return
    form.setFieldsValue({
      role: selectedAccount.role,
      roleName: selectedAccount.roleName,
      collegeId: selectedAccount.scope?.collegeId,
      grade: selectedAccount.scope?.grade,
      major: selectedAccount.scope?.major,
      classIds: selectedAccount.scope?.classIds,
    })
  }, [selectedAccount, form])

  const collegeId = Form.useWatch('collegeId', form) as string | undefined
  const grade = Form.useWatch('grade', form) as string | undefined
  const major = Form.useWatch('major', form) as string | undefined
  const classOptions = useMemo(() => {
    const key = `${collegeId ?? ''}|${grade ?? ''}|${major ?? ''}`
    return (classIdsByCombo[key] ?? []).map((x) => ({ label: `${x.name}（${x.id}）`, value: x.id }))
  }, [collegeId, grade, major])

  return (
    <div className="page">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="细粒度权限校验"
          description="管理员可为教师分配角色并设置数据管辖范围；所有学生档案检索/查看接口在“接口层”按 scope 进行横向越权拦截。"
        />
        <Card title="角色与数据管辖范围配置">
          <Form
            form={form}
            layout="vertical"
            onFinish={async (v) => {
              const role = v.role as RoleCode
              const roleName = v.roleName as string
              const scope: DataScope | undefined =
                role === 'COUNSELOR'
                  ? {
                      collegeId: v.collegeId,
                      collegeName: colleges.find((c) => c.id === v.collegeId)?.name ?? v.collegeId,
                      grade: v.grade,
                      major: v.major,
                      classIds: v.classIds ?? [],
                    }
                  : undefined

              const r = await api.adminUpdateRoleScope(token, { staffNo: v.staffNo, role, roleName, scope })
              if (!r.ok) {
                message.error(r.message)
                return
              }
              message.success('已更新角色/范围')
              await refresh()
            }}
          >
            <Form.Item label="选择账号" name="staffNo" rules={[{ required: true, message: '请选择账号' }]}>
              <Select
                placeholder="请选择教职工账号"
                options={accounts.map((a) => ({ label: `${a.name}（${a.staffNo}）`, value: a.staffNo }))}
              />
            </Form.Item>

            <Space size={12} align="start" wrap>
              <Form.Item label="角色" name="role" rules={[{ required: true, message: '请选择角色' }]} style={{ width: 220 }}>
                <Select
                  options={[
                    { label: '管理员（ADMIN）', value: 'ADMIN' },
                    { label: '辅导员（COUNSELOR）', value: 'COUNSELOR' },
                  ]}
                />
              </Form.Item>
              <Form.Item label="角色名称" name="roleName" rules={[{ required: true, message: '请输入角色名称' }]} style={{ width: 260 }}>
                <Select
                  options={[
                    { label: '管理员', value: '管理员' },
                    { label: '某学院辅导员', value: '某学院辅导员' },
                  ]}
                  allowClear
                  placeholder="例如：某学院辅导员"
                  showSearch
                />
              </Form.Item>
            </Space>

            <Typography.Title level={5} style={{ marginTop: 8 }}>
              数据管辖范围（仅辅导员需要）
            </Typography.Title>
            <Space size={12} align="start" wrap>
              <Form.Item label="学院" name="collegeId" style={{ width: 220 }}>
                <Select options={colleges.map((c) => ({ label: `${c.name}（${c.id}）`, value: c.id }))} allowClear />
              </Form.Item>
              <Form.Item label="年级" name="grade" style={{ width: 160 }}>
                <Select options={['2023', '2024', '2025'].map((g) => ({ label: g, value: g }))} allowClear />
              </Form.Item>
              <Form.Item label="专业" name="major" style={{ width: 220 }}>
                <Select
                  options={(majorsByCollege[collegeId ?? ''] ?? []).map((m) => ({ label: m, value: m }))}
                  allowClear
                />
              </Form.Item>
              <Form.Item label="班级（可多选）" name="classIds" style={{ width: 360 }}>
                <Select mode="multiple" options={classOptions} allowClear placeholder="选择后将用于档案越权拦截" />
              </Form.Item>
            </Space>

            <Space>
              <Button type="primary" htmlType="submit" loading={loading}>
                保存配置
              </Button>
              <Button onClick={() => form.resetFields()}>重置</Button>
            </Space>
          </Form>
        </Card>
      </Space>
    </div>
  )
}

