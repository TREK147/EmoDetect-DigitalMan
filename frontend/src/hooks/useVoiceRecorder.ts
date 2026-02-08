import { useState, useRef, useCallback, useEffect } from 'react'

/** 波形数据长度（用于 canvas 等） */
const WAVEFORM_LENGTH = 64

/** 浏览器语音识别类型 */
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance
  }
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList
  resultIndex: number
}

export interface UseVoiceRecorderReturn {
  // ---------- 录音 ----------
  isRecording: boolean
  startRecording: () => Promise<void>
  stopRecording: () => Promise<Blob | null>
  recordedBlob: Blob | null
  recordedUrl: string | null

  // ---------- 实时语音转文本 ----------
  transcript: string
  interimTranscript: string
  isListening: boolean

  // ---------- 波形可视化 ----------
  waveformData: number[]
  audioLevel: number

  // ---------- 打断（停止录音与播放） ----------
  stopAll: () => void

  // ---------- 播放控制 ----------
  isPlaying: boolean
  playbackProgress: number
  playbackDuration: number
  playRecorded: (blob?: Blob) => void
  pausePlayback: () => void
  stopPlayback: () => void
  error: string | null
}

export function useVoiceRecorder(): UseVoiceRecorderReturn {
  const [isRecording, setIsRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [waveformData, setWaveformData] = useState<number[]>(Array(WAVEFORM_LENGTH).fill(0))
  const [audioLevel, setAudioLevel] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackProgress, setPlaybackProgress] = useState(0)
  const [playbackDuration, setPlaybackDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const animationFrameRef = useRef<number>(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playbackBlobUrlRef = useRef<string | null>(null)
  const workerRef = useRef<Worker | null>(null)

  // 释放录音 URL
  useEffect(() => {
    return () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    }
  }, [recordedUrl])

  // 停止所有并清理
  const stopAll = useCallback(() => {
    // 停止录音
    if (mediaRecorderRef.current && isRecording) {
      try {
        mediaRecorderRef.current.state !== 'inactive' && mediaRecorderRef.current.stop()
      } catch (_) {}
      mediaRecorderRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setIsRecording(false)
    chunksRef.current = []

    // 停止语音识别
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort()
      } catch (_) {}
      recognitionRef.current = null
    }
    setIsListening(false)
    setInterimTranscript('')

    // 停止波形
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
    setWaveformData(Array(WAVEFORM_LENGTH).fill(0))
    setAudioLevel(0)
    if (scriptProcessorRef.current) {
      try {
        scriptProcessorRef.current.disconnect()
      } catch (_) {}
      scriptProcessorRef.current = null
    }
    if (audioContextRef.current?.state !== 'closed') {
      audioContextRef.current?.close()
    }
    audioContextRef.current = null
    analyserRef.current = null

    // 停止播放
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    setIsPlaying(false)
    setPlaybackProgress(0)
  }, [isRecording])

  // 开始录音
  const startRecording = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      setTranscript('')
      setInterimTranscript('')

      // MediaRecorder 录制
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        if (chunksRef.current.length) {
          const blob = new Blob(chunksRef.current, { type: mime })
          setRecordedBlob(blob)
          const prev = recordedUrl
          if (prev) URL.revokeObjectURL(prev)
          setRecordedUrl(URL.createObjectURL(blob))
        }
      }
      recorder.start(100)
      setIsRecording(true)

      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      audioContextRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)

      // 优先使用 Web Worker 处理波形，减轻主线程负担
      try {
        if (!workerRef.current) {
          workerRef.current = new Worker(
            new URL('../workers/voice.worker.ts', import.meta.url),
            { type: 'module' }
          )
          workerRef.current.onmessage = (ev: MessageEvent<{ type: string; level?: number; waveform?: number[] }>) => {
            if (ev.data.type === 'result') {
              if (ev.data.waveform) setWaveformData(ev.data.waveform)
              if (ev.data.level != null) setAudioLevel(ev.data.level)
            }
          }
        }
        const worker = workerRef.current
        const bufferSize = 4096
        const processor = ctx.createScriptProcessor(bufferSize, 1, 1)
        scriptProcessorRef.current = processor
        const gainNode = ctx.createGain()
        gainNode.gain.value = 0
        source.connect(processor)
        processor.connect(gainNode)
        gainNode.connect(ctx.destination)
        processor.onaudioprocess = (e) => {
          if (!worker) return
          const input = e.inputBuffer.getChannelData(0)
          worker.postMessage({ type: 'process', data: input.buffer.slice(0) })
        }
      } catch {
        // 回退：主线程 AnalyserNode
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.8
        source.connect(analyser)
        analyserRef.current = analyser
        const bufferLength = analyser.frequencyBinCount
        const dataArray = new Uint8Array(bufferLength)
        const updateWaveform = () => {
          if (!analyserRef.current) return
          analyserRef.current.getByteTimeDomainData(dataArray)
          const slice = Math.floor(bufferLength / WAVEFORM_LENGTH)
          const arr: number[] = []
          let sum = 0
          for (let i = 0; i < WAVEFORM_LENGTH; i++) {
            const v = (dataArray[i * slice] - 128) / 128
            arr.push(v)
            sum += Math.abs(v)
          }
          setWaveformData(arr)
          setAudioLevel(Math.min(1, sum / WAVEFORM_LENGTH))
          animationFrameRef.current = requestAnimationFrame(updateWaveform)
        }
        updateWaveform()
      }

      // 语音识别（若支持）
      const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition()
        recognition.continuous = true
        recognition.interimResults = true
        recognition.lang = 'zh-CN'
        recognition.onresult = (e: SpeechRecognitionEvent) => {
          let interim = ''
          let final = ''
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i]
            const t = r[0].transcript
            if (r.isFinal) final += t
            else interim += t
          }
          if (final) setTranscript((prev) => prev + final)
          setInterimTranscript(interim)
        }
        recognition.onend = () => setIsListening(false)
        recognition.onerror = () => setIsListening(false)
        recognitionRef.current = recognition
        recognition.start()
        setIsListening(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法访问麦克风')
      setIsRecording(false)
    }
  }, [recordedUrl])

  // 停止录音
  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
        if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        setIsRecording(false)
        if (recognitionRef.current) {
          try { recognitionRef.current.stop() } catch (_) {}
          recognitionRef.current = null
        }
        setIsListening(false)
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
        setWaveformData(Array(WAVEFORM_LENGTH).fill(0))
        setAudioLevel(0)
        resolve(null)
        return
      }
      const mr = mediaRecorderRef.current
      mr.onstop = () => {
        if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        mediaRecorderRef.current = null
        if (recognitionRef.current) {
          try { recognitionRef.current.stop() } catch (_) {}
          recognitionRef.current = null
        }
        setIsRecording(false)
        setIsListening(false)
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
        setWaveformData(Array(WAVEFORM_LENGTH).fill(0))
        setAudioLevel(0)
        const blob = chunksRef.current.length
          ? new Blob(chunksRef.current, { type: mr.mimeType })
          : null
        if (blob) {
          setRecordedBlob(blob)
          setRecordedUrl((u) => {
            if (u) URL.revokeObjectURL(u)
            return URL.createObjectURL(blob)
          })
        }
        resolve(blob)
      }
      mr.stop()
    })
  }, [])

  // 播放
  const playRecorded = useCallback((blob?: Blob) => {
    const toPlay = blob ?? recordedBlob
    if (!toPlay) return
    setError(null)
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    if (playbackBlobUrlRef.current) URL.revokeObjectURL(playbackBlobUrlRef.current)
    const url = URL.createObjectURL(toPlay)
    playbackBlobUrlRef.current = url
    const audio = new Audio(url)
    audioRef.current = audio
    audio.onloadedmetadata = () => setPlaybackDuration(audio.duration)
    audio.ontimeupdate = () => setPlaybackProgress(audio.currentTime / (audio.duration || 1))
    audio.onended = () => {
      setIsPlaying(false)
      setPlaybackProgress(1)
      if (playbackBlobUrlRef.current) {
        URL.revokeObjectURL(playbackBlobUrlRef.current)
        playbackBlobUrlRef.current = null
      }
      audioRef.current = null
    }
    audio.onerror = () => {
      setError('播放失败')
      setIsPlaying(false)
    }
    audio.play()
    setIsPlaying(true)
  }, [recordedBlob])

  const pausePlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      setIsPlaying(false)
    }
  }, [])

  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      audioRef.current = null
    }
    if (playbackBlobUrlRef.current) {
      URL.revokeObjectURL(playbackBlobUrlRef.current)
      playbackBlobUrlRef.current = null
    }
    setIsPlaying(false)
    setPlaybackProgress(0)
  }, [])

  // 卸载时清理
  useEffect(() => {
    return () => {
      stopAll()
      if (playbackBlobUrlRef.current) URL.revokeObjectURL(playbackBlobUrlRef.current)
    }
  }, [stopAll])

  return {
    isRecording,
    startRecording,
    stopRecording,
    recordedBlob,
    recordedUrl,
    transcript,
    interimTranscript,
    isListening,
    waveformData,
    audioLevel,
    stopAll,
    isPlaying,
    playbackProgress,
    playbackDuration,
    playRecorded,
    pausePlayback,
    stopPlayback,
    error,
  }
}
