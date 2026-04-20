import { Layout, Menu, Space, Button, Tag, notification } from 'antd'
import {
  DashboardOutlined,
  SearchOutlined,
  LineChartOutlined,
  AlertOutlined,
  UserOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  FileSearchOutlined,
  LogoutOutlined,
  KeyOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../state/auth'
import { api } from '../mock/api'
import { useEffect, useMemo, useRef } from 'react'

const { Header, Sider, Content } = Layout

export function MainLayout() {
  const { user, token, logout } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const lastNotified = useRef<Set<string>>(new Set())

  const menuItems = useMemo(() => {
    const common = [{ key: '/dashboard', icon: <DashboardOutlined />, label: '主页总览' }]
    const counselor =
      user?.role === 'COUNSELOR'
        ? [
            { key: '/counselor/archive', icon: <SearchOutlined />, label: '心理档案查询' },
            { key: '/counselor/visualization', icon: <LineChartOutlined />, label: '情绪可视化' },
            { key: '/counselor/alerts', icon: <AlertOutlined />, label: '预警与干预' },
          ]
        : []
    const admin =
      user?.role === 'ADMIN'
        ? [
            { key: '/admin/accounts', icon: <UserOutlined />, label: '账号管理' },
            { key: '/admin/role-scope', icon: <SafetyCertificateOutlined />, label: '角色/范围配置' },
            { key: '/admin/thresholds', icon: <SettingOutlined />, label: '预警阈值设置' },
            { key: '/admin/audit', icon: <FileSearchOutlined />, label: '安全审计日志' },
          ]
        : []
    const security = [
      { type: 'divider' as const },
      { key: '/change-password', icon: <KeyOutlined />, label: '修改密码' },
    ]
    return [...common, ...counselor, ...admin, ...security]
  }, [user?.role])

  const selectedKeys = useMemo(() => {
    const p = loc.pathname
    const exact = menuItems.find((x: any) => x.key === p)
    if (exact) return [p]
    const prefixes = (menuItems as any[])
      .map((x) => x.key)
      .filter((k) => typeof k === 'string' && k !== '/')
      .sort((a, b) => b.length - a.length)
    const hit = prefixes.find((k) => p.startsWith(k))
    return hit ? [hit] : ['/dashboard']
  }, [loc.pathname, menuItems])

  useEffect(() => {
    if (!user || !token) return
    if (user.role !== 'COUNSELOR') return
    const timer = window.setInterval(async () => {
      const r = await api.counselorListAlerts(token)
      if (!r.ok) return
      r.data
        .filter((a) => a.status === 'NEW')
        .forEach((a) => {
          if (lastNotified.current.has(a.id)) return
          lastNotified.current.add(a.id)
          notification.warning({
            message: `异常情绪预警：${a.level}`,
            description: `${a.studentName}（${a.studentNo}）：${a.reason}`,
            duration: 6,
            onClick: () => nav('/counselor/alerts'),
          })
        })
    }, 5000)
    return () => window.clearInterval(timer)
  }, [user, token, nav])

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider theme="light" width={220}>
        <div style={{ height: 56, display: 'flex', alignItems: 'center', padding: '0 16px' }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>学生情绪管理</h3>
        </div>
        <Menu
          mode="inline"
          items={menuItems as any}
          selectedKeys={selectedKeys}
          onClick={(e) => nav(e.key)}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 16px', borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '100%' }}>
            <Space size={12}>
              <span style={{ fontWeight: 600 }}>{user?.name}</span>
              <Tag color={user?.role === 'ADMIN' ? 'geekblue' : 'green'}>{user?.roleName}</Tag>
              {user?.role === 'COUNSELOR' && user.scope ? (
                <span style={{ color: '#8c8c8c' }}>
                  管辖：{user.scope.collegeName}/{user.scope.grade}/{user.scope.major}（{user.scope.classIds.join('、')}）
                </span>
              ) : null}
            </Space>
            <Space>
              <Button icon={<LogoutOutlined />} onClick={() => void logout()}>
                退出
              </Button>
            </Space>
          </div>
        </Header>
        <Content style={{ overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}

