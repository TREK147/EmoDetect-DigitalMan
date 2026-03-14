import { useState, useRef, useEffect, useCallback } from 'react'
import type { Message } from '@/types'
import MessageBubble from '@/components/MessageBubble'
import InputArea from '@/components/InputArea'
import DigitalHuman from '@/components/DigitalHuman'
import VirtualMessageList from '@/components/VirtualMessageList'
import { useChatStore } from '@/stores/useChatStore'
import { useToastStore } from '@/stores/useToastStore'
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder'
import {
  chatWithAIStream,
  chatRealtimeStream,
  decodeAudioBlobToPcm16Base64,
  uploadFile,
  ApiError,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  createConversation,
  invalidateConversationMessages,
} from '@/utils/api'

/** 超过此条数启用虚拟滚动 */
const VIRTUAL_SCROLL_THRESHOLD = 30

const REALTIME_PCM_SAMPLE_RATE = 24000 // Realtime 返回 pcm24：24k 16bit 单声道

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** 待发送的图片（上传后等在输入框，和文字一起发送） */
interface PendingImage {
  url: string
  fileName: string
}

/** 待发送的语音（录制后先展示试听与删除，再点发送才上传） */
interface PendingVoice {
  blob: Blob
  url: string
  fileName: string
}

export default function ChatPage() {
  const [inputValue, setInputValue] = useState('')
  const [isAiLoading, setIsAiLoading] = useState(false)
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null)
  const [pendingVoice, setPendingVoice] = useState<PendingVoice | null>(null)
  const [realtimeMode, setRealtimeMode] = useState(false)
  const [isDigitalHumanSpeaking, setIsDigitalHumanSpeaking] = useState(false)
  const [digitalHumanSpeechLevel, setDigitalHumanSpeechLevel] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null)
  const ttsSpeechIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  /** 实时语音返回的 PCM base64 队列，顺序播放 */
  const realtimePcmQueueRef = useRef<string[]>([])
  const realtimePcmPlayingRef = useRef(false)
  /** 复用同一 AudioContext，避免多实例被浏览器静音 */
  const realtimeAudioContextRef = useRef<AudioContext | null>(null)

  const messages = useChatStore((s) => s.messages)
  const currentConversationId = useChatStore((s) => s.currentConversationId)
  const addMessage = useChatStore((s) => s.addMessage)
  const updateMessage = useChatStore((s) => s.updateMessage)
  const addConversation = useChatStore((s) => s.addConversation)
  const setCurrentConversationId = useChatStore((s) => s.setCurrentConversationId)
  const updateConversation = useChatStore((s) => s.updateConversation)
  const toast = useToastStore((s) => s.show)
  const { startRecording, stopRecording } = useVoiceRecorder()

  const useVirtualScroll = messages.length >= VIRTUAL_SCROLL_THRESHOLD

  const processRealtimePcmQueue = useCallback(() => {
    if (realtimePcmPlayingRef.current || realtimePcmQueueRef.current.length === 0) return
    const b64 = realtimePcmQueueRef.current.shift()!
    if (!b64 || b64.length < 4) {
      processRealtimePcmQueue()
      return
    }
    realtimePcmPlayingRef.current = true
    setIsDigitalHumanSpeaking(true)
    setDigitalHumanSpeechLevel(0.5)
    const cleanup = () => {
      realtimePcmPlayingRef.current = false
      setIsDigitalHumanSpeaking(false)
      setDigitalHumanSpeechLevel(0)
      processRealtimePcmQueue()
    }
    try {
      const binary = atob(b64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      let numSamples: number
      let float32: Float32Array
      // pcm24：官方为 24kHz 16bit；若为 24bit（3 字节/采样）也支持
      if (bytes.length % 3 === 0 && bytes.length % 2 !== 0) {
        numSamples = bytes.length / 3
        float32 = new Float32Array(numSamples)
        for (let i = 0; i < numSamples; i++) {
          const j = i * 3
          let n = bytes[j]! | (bytes[j + 1]! << 8) | (bytes[j + 2]! << 16)
          if (n & 0x800000) n -= 0x1000000
          float32[i] = n / 8388608
        }
      } else {
        numSamples = Math.floor(bytes.length / 2)
        if (numSamples === 0) {
          cleanup()
          return
        }
        const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, numSamples)
        float32 = new Float32Array(numSamples)
        for (let i = 0; i < numSamples; i++) {
          const s = int16[i]!
          float32[i] = s < 0 ? s / 0x8000 : s / 0x7fff
        }
      }
      let ctx = realtimeAudioContextRef.current
      if (!ctx || ctx.state === 'closed') {
        ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({ sampleRate: REALTIME_PCM_SAMPLE_RATE })
        realtimeAudioContextRef.current = ctx
      }
      const doPlay = () => {
        try {
          const buffer = ctx!.createBuffer(1, numSamples, REALTIME_PCM_SAMPLE_RATE)
          buffer.getChannelData(0)!.set(float32)
          const source = ctx!.createBufferSource()
          source.buffer = buffer
          source.connect(ctx!.destination)
          source.onended = cleanup
          source.addEventListener('error', cleanup)
          source.start(0)
        } catch (e) {
          cleanup()
        }
      }
      if (ctx.state === 'suspended') {
        ctx.resume().then(doPlay).catch(cleanup)
      } else {
        doPlay()
      }
    } catch {
      cleanup()
    }
  }, [])

  /** 将 Realtime 返回的 PCM base64 入队并顺序播放（24k 16bit 单声道） */
  const playRealtimePcmBase64 = useCallback((base64: string) => {
    if (!base64) return
    realtimePcmQueueRef.current.push(base64)
    processRealtimePcmQueue()
  }, [processRealtimePcmQueue])

  /** 点击数字人：切换实时对话模式（开启后发送语音走 Realtime，文字与语音同步输出） */
  const handleDigitalHumanClick = useCallback(() => {
    const next = !realtimeMode
    setRealtimeMode(next)
    if (!next) {
      realtimePcmQueueRef.current = []
      realtimePcmPlayingRef.current = false
      try {
        realtimeAudioContextRef.current?.close()
      } catch {
        // ignore
      }
      realtimeAudioContextRef.current = null
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause()
        ttsAudioRef.current = null
      }
      if (ttsSpeechIntervalRef.current) {
        clearInterval(ttsSpeechIntervalRef.current)
        ttsSpeechIntervalRef.current = null
      }
      setIsDigitalHumanSpeaking(false)
      setDigitalHumanSpeechLevel(0)
      toast('已关闭实时对话')
      return
    }
    toast('已开启实时对话，发送语音将同步输出文字与数字人播报')
  }, [realtimeMode, toast])

  // 组件卸载时清理语音播放
  useEffect(() => {
    return () => {
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause()
        ttsAudioRef.current = null
      }
      if (ttsSpeechIntervalRef.current) {
        clearInterval(ttsSpeechIntervalRef.current)
        ttsSpeechIntervalRef.current = null
      }
    }
  }, [])

  // 消息已由服务端持久化，无需再写 localStorage

  useEffect(() => {
    if (!useVirtualScroll && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, useVirtualScroll])

  const handleSubmit = async () => {
    const content = inputValue.trim()
    const hasImage = pendingImage != null
    const hasVoice = pendingVoice != null
    if ((!content && !hasImage && !hasVoice) || isAiLoading) return

    // 优先处理：仅发送语音
    if (hasVoice && !hasImage) {
      const voiceToSend = pendingVoice!
      if (!voiceToSend.blob || voiceToSend.blob.size === 0) {
        toast('语音数据为空，请重新录制后再发送')
        return
      }
      setPendingVoice(null)
      URL.revokeObjectURL(voiceToSend.url)
      const convId = await ensureConversation()
      setIsAiLoading(true)
      const aiMsgId = generateId()
      const userMsg: Message = {
        id: generateId(),
        content: '[语音]',
        sender: 'user',
        timestamp: new Date(),
        type: 'voice',
      }
      addMessage(userMsg)
      addMessage({
        id: aiMsgId,
        content: '',
        sender: 'ai',
        timestamp: new Date(),
        type: 'text',
      })
      updateConversation(convId, { lastMessage: userMsg.content, updatedAt: new Date(), messageCount: messages.length + 1 })
      try {
        if (realtimeMode) {
          const pcmBase64 = await decodeAudioBlobToPcm16Base64(voiceToSend.blob)
          await chatRealtimeStream(
            convId,
            pcmBase64,
            (delta) => {
              const prev = useChatStore.getState().messages.find((m) => m.id === aiMsgId)
              updateMessage(aiMsgId, { content: (prev?.content ?? '') + delta })
            },
            (base64) => playRealtimePcmBase64(base64)
          )
        } else {
          const file = new File([voiceToSend.blob], voiceToSend.fileName, {
            type: voiceToSend.blob.type || 'audio/webm',
          })
          const { fileName: name } = await uploadFile(file)
          const hint = `用户发送了一条语音，文件名：${name}，请简单回复。`
          await chatWithAIStream(convId, hint, (chunk) => {
            const prev = useChatStore.getState().messages.find((m) => m.id === aiMsgId)
            updateMessage(aiMsgId, { content: (prev?.content ?? '') + chunk })
          }, { attachmentHint: hint })
        }
        invalidateConversationMessages(convId)
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? (err.message || '语音处理或 AI 回复失败')
            : (err instanceof Error ? err.message : '网络异常，请检查后端服务与网络后重试')
        toast(msg)
        updateMessage(aiMsgId, { content: `[请求失败] ${msg}` })
      } finally {
        setIsAiLoading(false)
      }
      setInputValue('')
      return
    }

    const displayContent = content || '请描述或分析这张图片'
    const convId = await ensureConversation()
    updateConversation(convId, {
      lastMessage: displayContent,
      updatedAt: new Date(),
      messageCount: messages.length + 1,
    })

    const userMessage: Message = {
      id: generateId(),
      content: displayContent,
      sender: 'user',
      timestamp: new Date(),
      type: hasImage ? 'image' : 'text',
      ...(hasImage && pendingImage ? { fileUrl: pendingImage.url, fileName: pendingImage.fileName } : {}),
    }
    const imageToSend = pendingImage
    addMessage(userMessage)
    setInputValue('')
    setPendingImage(null)
    setIsAiLoading(true)

    const aiMsgId = generateId()
    addMessage({
      id: aiMsgId,
      content: '',
      sender: 'ai',
      timestamp: new Date(),
      type: 'text',
    })

    try {
      await chatWithAIStream(
        convId,
        displayContent,
        (chunk) => {
          const prev = useChatStore.getState().messages.find((m) => m.id === aiMsgId)
          updateMessage(aiMsgId, { content: (prev?.content ?? '') + chunk })
        },
        hasImage && imageToSend ? { imageUrl: imageToSend.url } : undefined
      )
      invalidateConversationMessages(convId)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'AI 回复失败，请稍后重试'
      toast(msg)
      updateMessage(aiMsgId, { content: `[请求失败] ${msg}` })
    } finally {
      setIsAiLoading(false)
    }
  }

  /** 确保当前有会话（无则服务端创建），返回会话 id。 */
  const ensureConversation = async (): Promise<string> => {
    if (currentConversationId) return currentConversationId
    const conv = await createConversation({ title: '新对话' })
    addConversation(conv)
    setCurrentConversationId(conv.id)
    return conv.id
  }

  const handleFileSelect = async (files: File[]) => {
    const file = files[0]
    if (!file || isAiLoading) return
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast(`文件过大，单文件最大支持 ${MAX_FILE_SIZE_LABEL}，请选择更小的文件`)
      return
    }
    const isImage = file.type.startsWith('image/')
    if (isImage) {
      try {
        const { url, fileName } = await uploadFile(file)
        setPendingImage({ url, fileName })
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : '图片上传失败'
        toast(msg)
      }
      return
    }
    const convId = await ensureConversation()
    const fileName = file.name || '未命名文件'
    setIsAiLoading(true)
    let msgType: Message['type'] = 'file'
    let userMsg: Message = {
      id: generateId(),
      content: `[文件] ${fileName}`,
      sender: 'user',
      timestamp: new Date(),
      type: 'file',
      fileName,
    }
    try {
      const { url, fileName: name, category } = await uploadFile(file)
      msgType = category === 'voice' ? 'voice' : category === 'video' ? 'video' : 'file'
      userMsg = {
        ...userMsg,
        type: msgType,
        content: `[${msgType === 'voice' ? '语音' : msgType === 'video' ? '视频' : '文件'}] ${name}`,
        fileUrl: url,
        fileName: name,
      }
      addMessage(userMsg)
      updateConversation(convId, { lastMessage: userMsg.content || name, updatedAt: new Date(), messageCount: messages.length + 1 })

      const aiMsgId = generateId()
      addMessage({
        id: aiMsgId,
        content: '',
        sender: 'ai',
        timestamp: new Date(),
        type: 'text',
      })
      const content =
        msgType === 'voice'
          ? `用户发送了一条语音，文件名：${name}，请简单回复。`
          : `用户发送了一个${msgType === 'file' ? '文件' : '视频'}，文件名：${name}，请简单回复。`
      await chatWithAIStream(
        convId,
        content,
        (chunk) => {
          const prev = useChatStore.getState().messages.find((m) => m.id === aiMsgId)
          updateMessage(aiMsgId, { content: (prev?.content ?? '') + chunk })
        },
        { attachmentHint: content }
      )
      invalidateConversationMessages(convId)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '上传或 AI 回复失败'
      toast(msg)
      addMessage({
        id: generateId(),
        content: `[请求失败] ${msg}`,
        sender: 'ai',
        timestamp: new Date(),
        type: 'text',
      })
    } finally {
      setIsAiLoading(false)
    }
  }

  const handleVoiceRecordStart = async () => {
    try {
      await startRecording()
      toast('语音录制开始')
    } catch {
      toast('无法访问麦克风')
    }
  }

  const handleVoiceRecordStop = async () => {
    toast('语音录制结束，正在处理…')
    const blob = await stopRecording()
    if (!blob || isAiLoading) return
    if (blob.size === 0) {
      toast('录制内容为空，请重新录制')
      return
    }
    const fileName = `voice-${Date.now()}.webm`
    const url = URL.createObjectURL(blob)
    setPendingVoice({ blob, url, fileName })
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col md:flex-row">
      {/* 数字人形象展示区域：平板/桌面显示，移动端可隐藏或置于顶部 */}
      <aside className="hidden md:flex flex-col flex-shrink-0 w-56 lg:w-60 xl:w-72 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 items-center justify-center p-3 md:p-4 landscape:max-md:hidden">
        <DigitalHuman
          expression="neutral"
          isSpeaking={isDigitalHumanSpeaking}
          speechLevel={digitalHumanSpeechLevel}
          animate
          bodyMotion
          onClick={handleDigitalHumanClick}
          realtimeMode={realtimeMode}
          className="w-full max-w-[180px] md:max-w-[200px]"
        />
      </aside>

      {/* 消息区 + 输入区 */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {/* 消息显示区域：少量用普通列表，大量用虚拟滚动 */}
        <div className="flex-1 min-h-0 flex flex-col">
          {useVirtualScroll ? (
            <VirtualMessageList
              messages={messages}
              scrollToEndRef={messagesEndRef}
            />
          ) : messages.length === 0 ? (
            <div className="flex-1 min-h-0 flex items-center justify-center text-gray-500 dark:text-gray-400 text-sm px-4">
              发送消息开始对话
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 md:p-4 pb-2 landscape:max-md:pb-2">
              <ul className="space-y-3 sm:space-y-4">
                {messages.map((msg) => (
                  <li
                    key={msg.id}
                    className={msg.sender === 'user' ? 'flex justify-end' : 'flex justify-start'}
                  >
                    <MessageBubble message={msg} />
                  </li>
                ))}
                <div ref={messagesEndRef} />
              </ul>
            </div>
          )}
        </div>

        {/* 待发送图片预览 */}
        {pendingImage && (
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <img
              src={pendingImage.url}
              alt={pendingImage.fileName}
              className="w-12 h-12 object-cover rounded-lg border border-gray-200 dark:border-gray-600"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400 truncate flex-1 min-w-0">
              {pendingImage.fileName}
            </span>
            <button
              type="button"
              onClick={() => setPendingImage(null)}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-800 dark:hover:text-gray-200"
              title="移除图片"
              aria-label="移除图片"
            >
              ✕
            </button>
          </div>
        )}

        {/* 待发送语音：试听 + 发送 + 删除 */}
        {pendingVoice && (
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <span className="text-sm text-gray-600 dark:text-gray-400 shrink-0">🎤 语音</span>
            <audio
              src={pendingVoice.url}
              controls
              className="flex-1 min-w-0 h-8 max-w-[200px] sm:max-w-[280px]"
              preload="metadata"
            />
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={isAiLoading}
              className="px-3 py-1.5 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 disabled:opacity-50 shrink-0"
              title="发送语音"
              aria-label="发送语音"
            >
              发送
            </button>
            <button
              type="button"
              onClick={() => {
                URL.revokeObjectURL(pendingVoice.url)
                setPendingVoice(null)
              }}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-800 dark:hover:text-gray-200 shrink-0"
              title="移除语音"
              aria-label="移除语音"
            >
              ✕
            </button>
          </div>
        )}

        {/* 输入区域（固定底部） */}
        <div className="flex-shrink-0 pb-[env(safe-area-inset-bottom)]">
          <InputArea
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleSubmit}
            onFileSelect={handleFileSelect}
            onVoiceRecordStart={handleVoiceRecordStart}
            onVoiceRecordStop={handleVoiceRecordStop}
            pendingImage={pendingImage}
            pendingVoice={pendingVoice != null ? { url: pendingVoice.url, fileName: pendingVoice.fileName } : null}
            disabled={isAiLoading}
            placeholder={isAiLoading ? 'AI 正在思考…' : '输入消息...'}
          />
        </div>
      </div>
    </div>
  )
}
