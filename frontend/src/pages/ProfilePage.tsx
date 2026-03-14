import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  getEmotionStats,
  getEmotionAnomalies,
  getProactivePending,
  ackProactiveTrigger,
  getSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  type EmotionAnomaly,
  type EmotionStatsPoint,
  type ProactiveTrigger,
  type Schedule,
} from '@/utils/api'
import { User, Mail, ArrowLeft, Calendar, TrendingUp, AlertCircle, MessageCircle, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useChatStore } from '@/stores/useChatStore'
import { useToastStore } from '@/stores/useToastStore'

const STATS_DAYS = 30
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] // 周一到周日
/** 早8-晚10，每小时一格，共14格 */
const SLOT_LABELS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00']
const EVENT_COLORS = ['bg-blue-400', 'bg-amber-400', 'bg-emerald-400', 'bg-violet-400', 'bg-rose-400', 'bg-sky-400']

/** 获取某天所在周的周一 00:00 */
function getWeekMonday(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

/** 用本地日期避免 UTC 导致“晚一天” */
function toLocalDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ProfilePage() {
  const navigate = useNavigate()
  const user = useChatStore((s) => s.user)
  const toast = useToastStore((s) => s.show)

  const [stats, setStats] = useState<EmotionStatsPoint[]>([])
  const [anomalies, setAnomalies] = useState<EmotionAnomaly[]>([])
  const [proactive, setProactive] = useState<ProactiveTrigger | null>(null)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  /** 周视图：当前显示的周的周一 */
  const [weekMonday, setWeekMonday] = useState<Date>(() => getWeekMonday(new Date()))
  /** 新增日程弹窗：打开时记录点击的格子 (dayIndex, slotIndex) */
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addModalDay, setAddModalDay] = useState(0)
  const [addModalSlot, setAddModalSlot] = useState(0)
  const [addFormName, setAddFormName] = useState('')
  const [addFormLocation, setAddFormLocation] = useState('')
  const [addFormNotes, setAddFormNotes] = useState('')
  /** 编辑日程弹窗 */
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null)
  const [editFormName, setEditFormName] = useState('')
  const [editFormLocation, setEditFormLocation] = useState('')
  const [editFormNotes, setEditFormNotes] = useState('')

  const load = async () => {
    if (!user) return
    setLoading(true)
    try {
      const [s, a, p] = await Promise.all([
        getEmotionStats(STATS_DAYS),
        getEmotionAnomalies({ limit: 50 }),
        getProactivePending(),
      ])
      setStats(s)
      setAnomalies(a)
      setProactive(p)
    } catch {
      setStats([])
      setAnomalies([])
      setProactive(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [user?.id])

  /** 按周拉取日程（周一 00:00 到周日 23:59:59） */
  useEffect(() => {
    if (!user) return
    const mon = new Date(weekMonday)
    const sun = new Date(mon)
    sun.setDate(sun.getDate() + 6)
    const start = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')} 00:00:00`
    const end = `${sun.getFullYear()}-${String(sun.getMonth() + 1).padStart(2, '0')}-${String(sun.getDate()).padStart(2, '0')} 23:59:59`
    getSchedules({ startDate: start, endDate: end }).then(setSchedules).catch(() => setSchedules([]))
  }, [user?.id, weekMonday.getTime()])

  const handleGoChatAndAck = async () => {
    if (proactive) {
      try {
        await ackProactiveTrigger(proactive.id)
      } catch {
        // ignore
      }
      setProactive(null)
    }
    navigate('/chat')
  }

  const openAddModal = (dayIndex: number, slotIndex: number) => {
    setAddModalDay(dayIndex)
    setAddModalSlot(slotIndex)
    setAddFormName('')
    setAddFormLocation('')
    setAddFormNotes('')
    setAddModalOpen(true)
  }

  /** 解析标题 "日程名 - 地点 - 备注" 为三栏 */
  const parseTitle = (title: string): [string, string, string] => {
    const parts = title.split(' - ')
    return [parts[0] ?? '', parts[1] ?? '', parts[2] ?? '']
  }

  const openEditModal = (s: Schedule) => {
    const [name, loc, notes] = parseTitle(s.title)
    setEditingSchedule(s)
    setEditFormName(name)
    setEditFormLocation(loc)
    setEditFormNotes(notes)
    setEditModalOpen(true)
  }

  const handleConfirmEditSchedule = async () => {
    if (!editingSchedule) return
    const name = editFormName.trim()
    if (!name) {
      toast('请填写日程名')
      return
    }
    const loc = editFormLocation.trim()
    const notes = editFormNotes.trim()
    const title = [name, loc, notes].filter(Boolean).join(' - ')
    try {
      await updateSchedule(editingSchedule.id, { title })
      toast('已修改日程')
      setEditModalOpen(false)
      setEditingSchedule(null)
      refreshSchedulesForWeek()
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : '修改失败'
      toast(msg)
    }
  }

  const handleConfirmAddSchedule = async () => {
    const name = addFormName.trim()
    if (!name) {
      toast('请填写日程名')
      return
    }
    const d = weekDates[addModalDay]
    if (!d) return
    const hour = 8 + addModalSlot
    const scheduled_at = `${toLocalDateString(d)} ${String(hour).padStart(2, '0')}:00:00`
    const loc = addFormLocation.trim()
    const notes = addFormNotes.trim()
    const title = [name, loc, notes].filter(Boolean).join(' - ')
    try {
      await createSchedule({ title, scheduled_at })
      toast('已添加日程')
      setAddModalOpen(false)
      refreshSchedulesForWeek()
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : '添加失败'
      toast(msg)
    }
  }

  /** 当周的 7 天日期（周一至周日） */
  const weekDates = useMemo(() => {
    const mon = new Date(weekMonday)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mon)
      d.setDate(d.getDate() + i)
      return d
    })
  }, [weekMonday])

  /** 日程按 (dayIndex 0-6, slotIndex 0-13) 分组；slot 按小时 8-21 映射，用本地日期比较避免晚一天 */
  const scheduleGrid = useMemo(() => {
    const grid: Record<string, Schedule[]> = {}
    schedules
      .filter((s) => s.status === 'pending')
      .forEach((s) => {
        const dateStr = s.scheduled_at.slice(0, 10)
        const hour = parseInt(s.scheduled_at.slice(11, 13), 10) || 8
        const slotIndex = Math.max(0, Math.min(13, hour - 8))
        const dayIndex = weekDates.findIndex((d) => toLocalDateString(d) === dateStr)
        if (dayIndex >= 0) {
          const key = `${dayIndex}-${slotIndex}`
          if (!grid[key]) grid[key] = []
          grid[key].push(s)
        }
      })
    return grid
  }, [schedules, weekDates])

  const refreshSchedulesForWeek = () => {
    const mon = new Date(weekMonday)
    const sun = new Date(mon)
    sun.setDate(sun.getDate() + 6)
    const start = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')} 00:00:00`
    const end = `${sun.getFullYear()}-${String(sun.getMonth() + 1).padStart(2, '0')}-${String(sun.getDate()).padStart(2, '0')} 23:59:59`
    getSchedules({ startDate: start, endDate: end }).then(setSchedules)
  }

  const emotionCurveData = useMemo(() => {
    const map = new Map(stats.map((s) => [s.date, s.count]))
    const out: { date: string; count: number }[] = []
    const today = new Date()
    for (let i = STATS_DAYS - 1; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      out.push({ date: d.toISOString().slice(0, 10), count: map.get(d.toISOString().slice(0, 10)) ?? 0 })
    }
    return out
  }, [stats])

  const maxCount = Math.max(1, ...emotionCurveData.map((d) => d.count))
  const chartW = 320
  const chartH = 160
  const padding = { top: 12, right: 12, bottom: 24, left: 28 }
  const emotionCurvePoints = useMemo(() => {
    if (emotionCurveData.length === 0) return []
    const xScale = (chartW - padding.left - padding.right) / Math.max(1, emotionCurveData.length - 1)
    const yScale = (chartH - padding.top - padding.bottom) / maxCount
    return emotionCurveData.map((d, i) => ({
      x: padding.left + i * xScale,
      y: padding.top + (chartH - padding.top - padding.bottom) - d.count * yScale,
      date: d.date,
      count: d.count,
    }))
  }, [emotionCurveData, maxCount])
  const curvePath = useMemo(
    () => (emotionCurvePoints.length === 0 ? '' : `M ${emotionCurvePoints.map((p) => `${p.x},${p.y}`).join(' L ')}`),
    [emotionCurvePoints]
  )

  if (!user) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
        <p className="text-gray-500 dark:text-gray-400">请先登录</p>
        <Link to="/login" className="text-primary-600 dark:text-primary-400 hover:underline">去登录</Link>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto w-full min-w-0 p-4 sm:p-6">
      <Link
        to="/chat"
        className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        返回聊天
      </Link>
      <h1 className="text-xl font-semibold text-gray-800 dark:text-white mb-6">个人中心</h1>

      {/* 用户信息卡片 */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4 sm:p-6 space-y-4 mb-8">
        <div className="flex items-center gap-4">
          {user.avatar ? (
            <img src={user.avatar} alt="" className="w-16 h-16 rounded-full object-cover" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center">
              <User className="w-8 h-8 text-primary-600 dark:text-primary-400" />
            </div>
          )}
          <div>
            <p className="text-lg font-medium text-gray-800 dark:text-white">{user.username}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{user.email}</p>
          </div>
        </div>
        <dl className="space-y-3 text-sm">
          <div className="flex items-center gap-3">
            <User className="w-4 h-4 text-gray-400" />
            <div>
              <dt className="text-gray-500 dark:text-gray-400">用户名</dt>
              <dd className="text-gray-800 dark:text-gray-200">{user.username}</dd>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Mail className="w-4 h-4 text-gray-400" />
            <div>
              <dt className="text-gray-500 dark:text-gray-400">邮箱</dt>
              <dd className="text-gray-800 dark:text-gray-200">{user.email}</dd>
            </div>
          </div>
        </dl>
      </div>

      {loading ? (
        <div className="text-gray-500 dark:text-gray-400">加载中...</div>
      ) : (
        <div className="space-y-8">
          {proactive && (
            <section className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200 mb-2">
                <MessageCircle className="w-5 h-5" />
                <span className="font-medium">数字人助手想和你聊聊</span>
              </div>
              <p className="text-sm text-amber-700 dark:text-amber-300 mb-3">
                {proactive.trigger_type === 'monitoring' ? '系统检测到你可能需要陪伴与疏导，' : '近期多次记录到情绪波动，'}小助手希望和你聊一聊。
              </p>
              <button
                type="button"
                onClick={handleGoChatAndAck}
                className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700"
              >
                去聊天
              </button>
            </section>
          )}

          {/* 情感曲线 */}
          <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4 sm:p-6">
            <h2 className="flex items-center gap-2 text-lg font-medium text-gray-800 dark:text-white mb-4">
              <TrendingUp className="w-5 h-5" />
              情感曲线（近 {STATS_DAYS} 天）
            </h2>
            {emotionCurveData.every((d) => d.count === 0) ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">暂无情绪记录</p>
            ) : (
              <div className="overflow-x-auto">
                <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full min-w-[280px] h-40 text-gray-600 dark:text-gray-400">
                  {[1, 2, 3, 4].map((i) => (
                    <line
                      key={i}
                      x1={padding.left}
                      y1={padding.top + (i * (chartH - padding.top - padding.bottom)) / 4}
                      x2={chartW - padding.right}
                      y2={padding.top + (i * (chartH - padding.top - padding.bottom)) / 4}
                      stroke="currentColor"
                      strokeOpacity={0.15}
                      strokeDasharray="4 2"
                    />
                  ))}
                  <path d={curvePath} fill="none" stroke="rgb(59, 130, 246)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  {emotionCurvePoints.map((p) =>
                    p.count > 0 ? <circle key={p.date} cx={p.x} cy={p.y} r={3} fill="rgb(59, 130, 246)" /> : null
                  )}
                  <text x={padding.left} y={chartH - 4} className="fill-current text-[10px]">
                    {emotionCurveData[0]?.date.slice(5) ?? ''}
                  </text>
                  <text x={(chartW - padding.left - padding.right) / 2 + padding.left - 12} y={chartH - 4} className="fill-current text-[10px]">
                    {emotionCurveData[Math.floor(emotionCurveData.length / 2)]?.date.slice(5) ?? ''}
                  </text>
                  <text x={chartW - padding.right - 24} y={chartH - 4} className="fill-current text-[10px]">
                    {emotionCurveData[emotionCurveData.length - 1]?.date.slice(5) ?? ''}
                  </text>
                </svg>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">纵轴：当日情绪异常记录次数</p>
              </div>
            )}
          </section>

          {/* 情绪事件记录 */}
          <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4 sm:p-6">
            <h2 className="flex items-center gap-2 text-lg font-medium text-gray-800 dark:text-white mb-4">
              <AlertCircle className="w-5 h-5" />
              情绪事件记录
            </h2>
            {anomalies.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">暂无异常记录</p>
            ) : (
              <ul className="space-y-3">
                {anomalies.map((a) => (
                  <li key={a.id} className="text-sm p-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-800 dark:text-white">{a.emotion_label}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{a.created_at.slice(0, 16)}</span>
                    </div>
                    {a.reason && <p className="mt-1 text-gray-600 dark:text-gray-300">{a.reason}</p>}
                    <span className="text-xs text-gray-400 dark:text-gray-500">{a.from_monitoring ? '来自监控' : '来自聊天'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 日程表 - 周课表样式 */}
          <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4 sm:p-6">
            <h2 className="flex items-center gap-2 text-lg font-medium text-gray-800 dark:text-white mb-4">
              <Calendar className="w-5 h-5" />
              日程表
            </h2>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <button
                type="button"
                onClick={() => setWeekMonday((prev) => { const d = new Date(prev); d.setDate(d.getDate() - 7); return d })}
                className="p-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                aria-label="上一周"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setWeekMonday((prev) => { const d = new Date(prev); d.setDate(d.getDate() + 7); return d })}
                className="p-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                aria-label="下一周"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setWeekMonday(getWeekMonday(new Date()))}
                className="px-3 py-1.5 rounded-lg text-sm bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-900/60"
              >
                本周
              </button>
              <span className="text-sm font-medium text-gray-800 dark:text-white">
                {weekDates[0] && weekDates[6] ? `${toLocalDateString(weekDates[0])} ~ ${toLocalDateString(weekDates[6])}` : ''}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-600">
                    <th className="w-14 sm:w-16 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">时间</th>
                    {weekDates.map((d, i) => (
                      <th key={i} className="py-2 text-center text-xs font-medium text-gray-700 dark:text-gray-300">
                        <div>周{WEEKDAYS[i]}</div>
                        <div className="text-gray-500 dark:text-gray-400">{String(d.getMonth() + 1).padStart(2, '0')}/{String(d.getDate()).padStart(2, '0')}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SLOT_LABELS.map((label, slotIndex) => (
                    <tr key={slotIndex} className="border-b border-gray-100 dark:border-gray-700/80 min-h-[56px]">
                      <td className="py-1 text-xs text-gray-500 dark:text-gray-400 align-top w-14 sm:w-16 min-h-[56px]">{label}</td>
                      {weekDates.map((_, dayIndex) => {
                        const key = `${dayIndex}-${slotIndex}`
                        const cellSchedules = scheduleGrid[key] ?? []
                        return (
                          <td key={dayIndex} className="p-0.5 align-top min-w-[80px] min-h-[56px] relative group">
                            <div className="flex flex-col gap-0.5 min-h-[52px]">
                              {cellSchedules.map((s, idx) => (
                                <div
                                  key={s.id}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => openEditModal(s)}
                                  onKeyDown={(e) => e.key === 'Enter' && openEditModal(s)}
                                  className={`relative z-10 rounded px-1.5 py-1.5 text-xs text-white ${EVENT_COLORS[idx % EVENT_COLORS.length]} flex items-center justify-between gap-1 min-h-[52px] cursor-pointer hover:opacity-90 transition-opacity`}
                                >
                                  <span className="truncate flex-1" title={s.title}>{s.title}</span>
                                  <button
                                    type="button"
                                    onClick={async (ev) => {
                                      ev.stopPropagation()
                                      try {
                                        await deleteSchedule(s.id)
                                        refreshSchedulesForWeek()
                                      } catch {
                                        // ignore
                                      }
                                    }}
                                    className="shrink-0 text-white/90 hover:text-white p-0.5"
                                    aria-label="删除"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={() => openAddModal(dayIndex, slotIndex)}
                                className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded bg-gray-200/80 dark:bg-gray-600/80 hover:bg-gray-300 dark:hover:bg-gray-500/80 text-gray-600 dark:text-gray-300 min-h-[52px]"
                                aria-label="添加日程"
                              >
                                <Plus className="w-6 h-6" />
                              </button>
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 新增日程弹窗 */}
            {addModalOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setAddModalOpen(false)}>
                <div
                  className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full p-5 border border-gray-200 dark:border-gray-700"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">新增日程</h3>
                  {weekDates[addModalDay] && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                      时间：{weekDates[addModalDay].getMonth() + 1}月{weekDates[addModalDay].getDate()}日 {SLOT_LABELS[addModalSlot]} - {String(8 + addModalSlot + 1).padStart(2, '0')}:00
                    </p>
                  )}
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">日程名</label>
                      <input
                        type="text"
                        placeholder="请填写日程名"
                        value={addFormName}
                        onChange={(e) => setAddFormName(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">地点</label>
                      <input
                        type="text"
                        placeholder="请填写地点"
                        value={addFormLocation}
                        onChange={(e) => setAddFormLocation(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">备注</label>
                      <input
                        type="text"
                        placeholder="请填写日程备注"
                        value={addFormNotes}
                        onChange={(e) => setAddFormNotes(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-5">
                    <button
                      type="button"
                      onClick={() => setAddModalOpen(false)}
                      className="flex-1 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmAddSchedule}
                      className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                    >
                      确定
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 编辑日程弹窗 */}
            {editModalOpen && editingSchedule && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => { setEditModalOpen(false); setEditingSchedule(null) }}>
                <div
                  className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full p-5 border border-gray-200 dark:border-gray-700"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">修改日程</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                    时间：{editingSchedule.scheduled_at.slice(0, 10)} {editingSchedule.scheduled_at.slice(11, 16)}
                  </p>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">日程名</label>
                      <input
                        type="text"
                        placeholder="请填写日程名"
                        value={editFormName}
                        onChange={(e) => setEditFormName(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">地点</label>
                      <input
                        type="text"
                        placeholder="请填写地点"
                        value={editFormLocation}
                        onChange={(e) => setEditFormLocation(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">备注</label>
                      <input
                        type="text"
                        placeholder="请填写日程备注"
                        value={editFormNotes}
                        onChange={(e) => setEditFormNotes(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-5">
                    <button
                      type="button"
                      onClick={() => { setEditModalOpen(false); setEditingSchedule(null) }}
                      className="flex-1 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmEditSchedule}
                      className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                    >
                      确定
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
