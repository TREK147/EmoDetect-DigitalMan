import { Card, Col, Row, Statistic, Tag, Space, Button, Alert } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../state/auth'

export function DashboardPage() {
  const { user } = useAuth()
  const nav = useNavigate()

  return (
    <div className="page">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="success"
          showIcon
          message="核心能力说明"
          description="当前页面数据来自后端接口与数据库：登录令牌、细粒度权限与数据范围拦截、档案访问审计、情绪可视化、预警推送与处置、关键操作审计与锁定机制。"
        />

        <Card>
          <Space direction="vertical" size={6}>
            <h2 style={{ margin: 0, fontSize: 20 }}>
              欢迎，{user?.name}{' '}
              <Tag color={user?.role === 'ADMIN' ? 'geekblue' : 'green'}>{user?.roleName}</Tag>
            </h2>
            <span style={{ color: '#8c8c8c' }}>登录后返回令牌并按角色跳转主页（侧边栏模块随角色变化）。</span>
          </Space>
        </Card>

        <Row gutter={12}>
          <Col xs={24} md={8}>
            <Card>
              <Statistic title="核心服务可用性" value="登录 / 预警" suffix="可用" />
              <span style={{ color: '#8c8c8c' }}>极端情况下仍需保障登录与核心报警可用（此处展示为“优雅降级”提示）。</span>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card>
              <Statistic title="权限模型" value="RBAC + 数据范围" />
              <span style={{ color: '#8c8c8c' }}>所有接口在后端权限层进行越权拦截。</span>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card>
              <Statistic title="安全审计" value="全量关键操作" />
              <span style={{ color: '#8c8c8c' }}>档案访问、冻结账号、阈值修改等均写入审计日志。</span>
            </Card>
          </Col>
        </Row>

        <Card title="快速入口">
          <Space wrap>
            {user?.role === 'COUNSELOR' ? (
              <>
                <Button type="primary" onClick={() => nav('/counselor/archive')}>
                  档案查询
                </Button>
                <Button onClick={() => nav('/counselor/visualization')}>情绪可视化</Button>
                <Button danger onClick={() => nav('/counselor/alerts')}>
                  预警中心
                </Button>
              </>
            ) : null}
            {user?.role === 'ADMIN' ? (
              <>
                <Button type="primary" onClick={() => nav('/admin/accounts')}>
                  账号管理
                </Button>
                <Button onClick={() => nav('/admin/role-scope')}>角色/范围配置</Button>
                <Button onClick={() => nav('/admin/thresholds')}>阈值设置</Button>
                <Button onClick={() => nav('/admin/audit')}>审计日志</Button>
              </>
            ) : null}
            <Button onClick={() => nav('/change-password')}>修改密码</Button>
          </Space>
        </Card>
      </Space>
    </div>
  )
}

