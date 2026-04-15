import { useEffect, useMemo, useState } from 'react'
import { Card, Space, Statistic, Segmented, Row, Col, Tag, App as AntApp } from 'antd'
import { useAuth } from '../../state/auth'
import { api } from '../../mock/api'
import ReactECharts from 'echarts-for-react'
import dayjs from 'dayjs'

type Range = 'week' | 'month' | 'term'

export function VisualizationPage() {
  const { token } = useAuth()
  const { message } = AntApp.useApp()
  const [range, setRange] = useState<Range>('week')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{
    scopeLabel: string
    todayAvg: number
    distribution: Record<string, number>
    trend: Array<{ ts: number; avg: number }>
    visibleCount: number
  } | null>(null)

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const r = await api.counselorGetVisualization(token, { range })
      setLoading(false)
      if (!r.ok) {
        message.error(r.message)
        return
      }
      setData(r.data)
    })()
  }, [token, range, message])

  const pieOption = useMemo(() => {
    const dist = data?.distribution ?? { 积极: 0, 中性: 0, 消极: 0 }
    return {
      tooltip: { trigger: 'item' },
      legend: { bottom: 0 },
      series: [
        {
          type: 'pie',
          radius: ['35%', '65%'],
          data: Object.entries(dist).map(([name, value]) => ({ name, value })),
          label: { formatter: '{b}: {d}%' },
        },
      ],
    }
  }, [data])

  const trendOption = useMemo(() => {
    const xs = (data?.trend ?? []).map((x) => dayjs(x.ts).format('MM-DD'))
    const ys = (data?.trend ?? []).map((x) => Number(x.avg.toFixed(1)))
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 40, right: 20, top: 30, bottom: 30 },
      xAxis: { type: 'category', data: xs, axisLabel: { rotate: 45 } },
      yAxis: { type: 'value', min: 0, max: 100 },
      series: [{ type: 'line', data: ys, smooth: true }],
    }
  }, [data])

  const total = (data?.distribution?.积极 ?? 0) + (data?.distribution?.中性 ?? 0) + (data?.distribution?.消极 ?? 0)
  const positiveRatio = total ? ((data?.distribution?.积极 ?? 0) / total) * 100 : 0
  const negativeRatio = total ? ((data?.distribution?.消极 ?? 0) / total) * 100 : 0

  return (
    <div className="page">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Card
          title="情绪数据可视化（与学生端识别记录对齐）"
          extra={
            <Space>
              <Tag>维度：{data?.scopeLabel ?? '-'}</Tag>
              <Segmented
                value={range}
                onChange={(v) => setRange(v as Range)}
                options={[
                  { label: '周', value: 'week' },
                  { label: '月', value: 'month' },
                  { label: '学期', value: 'term' },
                ]}
              />
            </Space>
          }
        >
          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Card size="small" loading={loading}>
                <Statistic title="今日情绪均值" value={Number((data?.todayAvg ?? 0).toFixed(1))} suffix="/100" />
                <div style={{ marginTop: 8 }}>
                  <Tag color="green">积极占比：{positiveRatio.toFixed(1)}%</Tag>
                  <Tag color="red">消极占比：{negativeRatio.toFixed(1)}%</Tag>
                </div>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small" title="情绪分布比例" loading={loading}>
                <ReactECharts option={pieOption} style={{ height: 240 }} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small" title="可见学生数" loading={loading}>
                <Statistic value={data?.visibleCount ?? 0} suffix="人" />
                <div style={{ marginTop: 8 }}>
                  <Tag>全校/学院/班级维度均可按权限展示（此处随角色与范围变化）</Tag>
                </div>
              </Card>
            </Col>
          </Row>
        </Card>

        <Card title="情绪波动曲线（群体趋势）" loading={loading}>
          <ReactECharts option={trendOption} style={{ height: 320 }} />
        </Card>
      </Space>
    </div>
  )
}

