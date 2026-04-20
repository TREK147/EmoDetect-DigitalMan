import { useMemo, useState } from 'react'
import { Card, Form, Input, Button, Space, Table, Drawer, Descriptions, Tag, Timeline, App as AntApp } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useAuth } from '../../state/auth'
import { api } from '../../mock/api'
import type { AssessmentReport, EmotionPoint, StudentBase } from '../../mock/types'
import { maskIdCard, maskPhone } from '../../utils/mask'
import ReactECharts from 'echarts-for-react'
import dayjs from 'dayjs'

type Row = StudentBase

export function StudentArchivePage() {
  const { token } = useAuth()
  const { message } = AntApp.useApp()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<Row[]>([])

  const [open, setOpen] = useState(false)
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [student, setStudent] = useState<StudentBase | null>(null)
  const [timeline, setTimeline] = useState<EmotionPoint[]>([])
  const [reports, setReports] = useState<AssessmentReport[]>([])

  const columns = useMemo<ColumnsType<Row>>(
    () => [
      { title: '学号', dataIndex: 'studentNo', width: 110 },
      { title: '姓名', dataIndex: 'name', width: 90 },
      { title: '学院', dataIndex: 'collegeName' },
      { title: '年级', dataIndex: 'grade', width: 80 },
      { title: '专业', dataIndex: 'major' },
      { title: '班级', dataIndex: 'className' },
      {
        title: '操作',
        key: 'op',
        width: 120,
        render: (_, r) => (
          <Button
            type="link"
            onClick={async () => {
              setOpen(true)
              setArchiveLoading(true)
              const res = await api.counselorGetStudentArchive(token, r.studentNo)
              setArchiveLoading(false)
              if (!res.ok) {
                message.error(res.message)
                return
              }
              setStudent(res.data.student)
              setTimeline(res.data.timeline)
              setReports(res.data.reports)
            }}
          >
            查看档案
          </Button>
        ),
      },
    ],
    [token, message],
  )

  const lineOption = useMemo(() => {
    const xs = timeline.map((p) => dayjs(p.ts).format('MM-DD'))
    const ys = timeline.map((p) => p.score)
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 40, right: 20, top: 30, bottom: 30 },
      xAxis: { type: 'category', data: xs, axisLabel: { rotate: 45 } },
      yAxis: { type: 'value', min: 0, max: 100 },
      series: [{ type: 'line', data: ys, smooth: true, areaStyle: {} }],
    }
  }, [timeline])

  return (
    <div className="page">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Card title="学生数字心理档案查询">
          <Form
            form={form}
            layout="inline"
            onFinish={async (v) => {
              setLoading(true)
              const r = await api.counselorSearchStudents(token, {
                keyword: v.keyword,
                studentNo: v.studentNo,
                name: v.name,
              })
              setLoading(false)
              if (!r.ok) {
                message.error(r.message)
                return
              }
              setRows(r.data)
              if (r.data.length === 0) message.warning('未检索到符合条件且在管辖范围内的学生')
            }}
          >
            <Form.Item label="关键词" name="keyword">
              <Input placeholder="学号/姓名" allowClear style={{ width: 180 }} />
            </Form.Item>
            <Form.Item label="学号" name="studentNo">
              <Input placeholder="精确/模糊" allowClear style={{ width: 160 }} />
            </Form.Item>
            <Form.Item label="姓名" name="name">
              <Input placeholder="精确/模糊" allowClear style={{ width: 140 }} />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={loading}>
              检索
            </Button>
          </Form>
        </Card>

        <Card title="检索结果">
          <Table<Row> rowKey="studentNo" columns={columns} dataSource={rows} loading={loading} pagination={{ pageSize: 8 }} />
        </Card>
      </Space>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        width={860}
        title="学生数字心理档案"
        destroyOnClose
      >
        {!student ? null : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Card size="small" title="基础信息（敏感字段脱敏展示）" loading={archiveLoading}>
              <Descriptions column={2} size="small">
                <Descriptions.Item label="学号">{student.studentNo}</Descriptions.Item>
                <Descriptions.Item label="姓名">{student.name}</Descriptions.Item>
                <Descriptions.Item label="学院">{student.collegeName}</Descriptions.Item>
                <Descriptions.Item label="班级">{student.className}</Descriptions.Item>
                <Descriptions.Item label="手机号">{student.phone ? maskPhone(student.phone) : '-'}</Descriptions.Item>
                <Descriptions.Item label="身份证号">{student.idCardNo ? maskIdCard(student.idCardNo) : '-'}</Descriptions.Item>
              </Descriptions>
            </Card>

            <Card size="small" title="历史情绪波动时间轴（优先读取学生端 emotion_record）" loading={archiveLoading}>
              <ReactECharts option={lineOption} style={{ height: 260 }} />
              <Timeline
                style={{ marginTop: 8 }}
                items={[...timeline].slice(-6).reverse().map((p) => ({
                  children: (
                    <span>
                      {dayjs(p.ts).format('YYYY-MM-DD')}：{p.score} 分 / {p.mood}{' '}
                      <Tag>{p.source}</Tag>
                    </span>
                  ),
                }))}
              />
            </Card>

            <Card size="small" title="多模态数字人交互评估报告" loading={archiveLoading}>
              {reports.length === 0 ? (
                <div>暂无报告</div>
              ) : (
                <Space direction="vertical" style={{ width: '100%' }}>
                  {reports.map((r) => (
                    <Card key={r.id} size="small">
                      <Space wrap>
                        <Tag color={r.riskLevel === '危' ? 'red' : r.riskLevel === '高' ? 'volcano' : r.riskLevel === '中' ? 'gold' : 'green'}>
                          风险：{r.riskLevel}
                        </Tag>
                        <Tag>时间：{dayjs(r.createdAt).format('YYYY-MM-DD HH:mm')}</Tag>
                        <Tag>模态：{r.modality.join('、')}</Tag>
                        {r.tags.map((t) => (
                          <Tag key={t}>{t}</Tag>
                        ))}
                      </Space>
                      <div style={{ marginTop: 8 }}>{r.summary}</div>
                    </Card>
                  ))}
                </Space>
              )}
            </Card>
          </Space>
        )}
      </Drawer>
    </div>
  )
}

