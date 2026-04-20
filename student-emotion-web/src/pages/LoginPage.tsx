import { useEffect, useMemo, useState } from 'react'
import { Card, Form, Input, Button, Space, Alert, App as AntApp } from 'antd'
import { useNavigate } from 'react-router-dom'
import { api } from '../mock/api'
import { useAuth } from '../state/auth'

function genCaptcha() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

export function LoginPage() {
  const [form] = Form.useForm()
  const nav = useNavigate()
  const { message } = AntApp.useApp()
  const { setToken, refresh, token, user } = useAuth()
  const [captcha, setCaptcha] = useState(genCaptcha)
  const [loading, setLoading] = useState(false)

  const passwordHint = useMemo(
    () => '密码复杂度：长度≥8，必须包含大写/小写字母、数字、特殊字符。',
    [],
  )

  useEffect(() => {
    if (token && user) nav('/dashboard', { replace: true })
  }, [token, user, nav])

  return (
    <div style={{ height: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <Card style={{ width: 420 }} title="教职工登录">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="默认初始化账号（仅数据库已启用示例种子时可用）"
            description={
              <div>
                <div>管理员：A0001 / Admin@123</div>
                <div>辅导员：T10086 / Teacher@123</div>
              </div>
            }
          />
          <span style={{ color: '#8c8c8c' }}>{passwordHint}</span>

          <Form
            form={form}
            layout="vertical"
            onFinish={async (v) => {
              setLoading(true)
              const r = await api.login({
                staffNo: v.staffNo,
                password: v.password,
                captchaText: v.captcha,
                captchaExpected: captcha,
              })
              setLoading(false)
              if (!r.ok) {
                message.error(r.message)
                setCaptcha(genCaptcha())
                form.setFieldsValue({ captcha: '' })
                return
              }
              setToken(r.data.token)
              await refresh()
              if (r.data.role === 'ADMIN') nav('/admin/accounts', { replace: true })
              else nav('/counselor/archive', { replace: true })
            }}
          >
            <Form.Item
              label="工号"
              name="staffNo"
              rules={[{ required: true, message: '请输入工号' }]}
            >
              <Input placeholder="例如：T10086" autoComplete="username" />
            </Form.Item>
            <Form.Item
              label="密码"
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password placeholder="请输入密码" autoComplete="current-password" />
            </Form.Item>
            <Form.Item label="验证码" required>
              <Space.Compact style={{ width: '100%' }}>
                <Form.Item
                  name="captcha"
                  noStyle
                  rules={[{ required: true, message: '请输入验证码' }]}
                >
                  <Input placeholder="4 位" />
                </Form.Item>
                <Button onClick={() => setCaptcha(genCaptcha())} style={{ width: 120 }}>
                  {captcha}
                </Button>
              </Space.Compact>
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              登录
            </Button>
          </Form>
        </Space>
      </Card>
    </div>
  )
}

