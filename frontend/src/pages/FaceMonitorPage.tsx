import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import {
  ApiError,
  listFaceStudents,
  recognizeFaceImage,
  registerFaceStudent,
  type FaceDetection,
  type FaceStudent,
} from '@/utils/api'
import { useToastStore } from '@/stores/useToastStore'

const EMOTION_ZH: Record<string, string> = {
  anger: '愤怒',
  disgust: '厌恶',
  fear: '恐惧',
  happiness: '高兴',
  neutral: '平静',
  sadness: '悲伤',
  surprise: '惊讶',
}

function getEmotionLabel(raw: string): string {
  return EMOTION_ZH[raw] ?? raw
}

export default function FaceMonitorPage() {
  const toast = useToastStore((s) => s.show)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const runningRef = useRef(false)

  const [students, setStudents] = useState<FaceStudent[]>([])
  const [detections, setDetections] = useState<FaceDetection[]>([])
  const [frameSize, setFrameSize] = useState({ width: 640, height: 480 })
  const [loading, setLoading] = useState(false)
  const [capturing, setCapturing] = useState(false)

  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')

  const activeDetections = useMemo(
    () => detections.filter((d) => d.student_id && d.student_id !== 'unknown'),
    [detections]
  )

  const loadStudents = async () => {
    try {
      const list = await listFaceStudents({ limit: 200 })
      setStudents(list)
    } catch (e) {
      toast('加载学生列表失败')
    }
  }

  useEffect(() => {
    loadStudents()
  }, [])

  const stopLoop = () => {
    runningRef.current = false
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const stopCamera = () => {
    stopLoop()
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setCapturing(false)
  }

  const startCamera = async () => {
    if (capturing) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCapturing(true)
      runningRef.current = true
      runRecognitionLoop()
    } catch {
      toast('无法访问摄像头，请检查浏览器权限')
    }
  }

  const grabFrameBase64 = (): string | null => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return null
    const vw = video.videoWidth || 0
    const vh = video.videoHeight || 0
    if (vw <= 0 || vh <= 0) return null

    canvas.width = vw
    canvas.height = vh
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, vw, vh)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
    return dataUrl
  }

  const runRecognitionLoop = async () => {
    if (!runningRef.current) return
    const image_base64 = grabFrameBase64()
    if (!image_base64) {
      timerRef.current = window.setTimeout(runRecognitionLoop, 350)
      return
    }
    setLoading(true)
    try {
      const res = await recognizeFaceImage({ image_base64 })
      setDetections(res.detections ?? [])
      setFrameSize({ width: res.width || 640, height: res.height || 480 })
    } catch {
      // 识别过程失败时不打断摄像头循环，避免用户手动重启
    } finally {
      setLoading(false)
      if (runningRef.current) {
        timerRef.current = window.setTimeout(runRecognitionLoop, 700)
      }
    }
  }

  const handleRegister = async () => {
    const sid = studentId.trim()
    const nm = name.trim()
    if (!sid || !nm) {
      toast('请输入学号和姓名')
      return
    }
    const image_base64 = grabFrameBase64() ?? undefined
    try {
      await registerFaceStudent({ student_id: sid, name: nm, image_base64 })
      toast('注册成功，已写入后端人脸库')
      setStudentId('')
      setName('')
      await loadStudents()
    } catch (e) {
      const fallback = '注册失败，请确认已登录、后端已启动，且画面中为清晰正脸'
      if (e instanceof ApiError) {
        toast(e.message || fallback)
      } else if (axios.isAxiosError(e)) {
        const data = e.response?.data as { error?: string } | undefined
        toast(data?.error ?? (e.message || fallback))
      } else {
        toast(fallback)
      }
    }
  }

  useEffect(() => () => stopCamera(), [])

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-slate-50 via-white to-indigo-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <div className="mx-auto max-w-7xl p-4 md:p-6 space-y-4">
        <section className="rounded-2xl border border-gray-200/70 dark:border-gray-700 bg-white/80 dark:bg-gray-900/70 backdrop-blur p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">人脸识别 + 七类情绪识别</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">摄像头实时检测学号与情绪，结果会写入后端记录。</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={startCamera}
                disabled={capturing}
                className="px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
              >
                启动摄像头
              </button>
              <button
                type="button"
                onClick={stopCamera}
                disabled={!capturing}
                className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
              >
                停止
              </button>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 rounded-2xl border border-gray-200 dark:border-gray-700 bg-black/90 overflow-hidden relative">
            <video ref={videoRef} className="w-full h-auto max-h-[72vh] object-contain" muted playsInline />
            <canvas ref={canvasRef} className="hidden" />
            {detections.map((d, idx) => {
              const [x1, y1, x2, y2] = d.box
              const w = frameSize.width || 1
              const h = frameSize.height || 1
              const left = `${(x1 / w) * 100}%`
              const top = `${(y1 / h) * 100}%`
              const width = `${((x2 - x1) / w) * 100}%`
              const height = `${((y2 - y1) / h) * 100}%`
              return (
                <div key={`${d.student_id}-${idx}`} className="absolute border-2 border-emerald-400 rounded-md" style={{ left, top, width, height }}>
                  <div className="absolute -top-6 left-0 text-xs px-2 py-0.5 rounded bg-emerald-500 text-white whitespace-nowrap">
                    {d.student_id}:{getEmotionLabel(d.emotion)} ({d.confidence.toFixed(2)})
                  </div>
                </div>
              )
            })}
            {loading && (
              <div className="absolute right-3 top-3 px-2 py-1 rounded bg-black/50 text-white text-xs">识别中...</div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">注册人脸</h3>
              <div className="space-y-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="姓名"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                />
                <input
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  placeholder="学号"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={handleRegister}
                  className="w-full px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  采集当前画面并注册
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">当前识别</h3>
              <div className="mt-2 space-y-2 text-sm">
                {activeDetections.length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400">暂无已识别学生</p>
                ) : (
                  activeDetections.map((d, i) => (
                    <div key={`${d.student_id}-${i}`} className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-900/20 px-3 py-2">
                      <p className="font-medium text-emerald-700 dark:text-emerald-300">{d.student_id}</p>
                      <p className="text-emerald-600/90 dark:text-emerald-200/90">
                        {getEmotionLabel(d.emotion)} / 置信度 {d.confidence.toFixed(2)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">已注册学生</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-2">共 {students.length} 人（已过滤逻辑删除）</p>
              <div className="max-h-48 overflow-y-auto text-sm space-y-1">
                {students.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-md px-2 py-1.5 bg-gray-50 dark:bg-gray-800">
                    <span className="font-medium">{s.student_id}</span>
                    <span className="text-gray-500">{s.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
