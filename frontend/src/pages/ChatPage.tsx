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
  convertAudioBlobToWavFile,
  uploadFile,
  ApiError,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  createConversation,
  invalidateConversationMessages,
} from '@/utils/api'

const VIRTUAL_SCROLL_THRESHOLD = 30

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

interface PendingImage {
  url: string
  fileName: string
}

interface PendingVideo {
  url: string
  fileName: string
}

interface PendingVoice {
  blob: Blob
  url: string
  fileName: string
}

interface PendingAttachment {
  url: string
  fileName: string
  category: 'file' | 'voice'
}

export default function ChatPage() {
  const [inputValue, setInputValue] = useState('')
  const [isAiLoading, setIsAiLoading] = useState(false)
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null)
  const [pendingVideo, setPendingVideo] = useState<PendingVideo | null>(null)
  const [pendingVoice, setPendingVoice] = useState<PendingVoice | null>(null)
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null)
  const [realtimePopupOpen, setRealtimePopupOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const realtimeWindowRef = useRef<Window | null>(null)
  const realtimeWindowWatchRef = useRef<number | null>(null)

  const messages = useChatStore((s) => s.messages)
  const currentConversationId = useChatStore((s) => s.currentConversationId)
  const addMessage = useChatStore((s) => s.addMessage)
  const updateMessage = useChatStore((s) => s.updateMessage)
  const addConversation = useChatStore((s) => s.addConversation)
  const setCurrentConversationId = useChatStore((s) => s.setCurrentConversationId)
  const updateConversation = useChatStore((s) => s.updateConversation)
  const toast = useToastStore((s) => s.show)
  const { startRecording, stopRecording, isRecording } = useVoiceRecorder()

  const useVirtualScroll = messages.length >= VIRTUAL_SCROLL_THRESHOLD

  useEffect(() => {
    if (!useVirtualScroll && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, useVirtualScroll])

  useEffect(() => {
    return () => {
      if (realtimeWindowWatchRef.current != null) {
        window.clearInterval(realtimeWindowWatchRef.current)
      }
    }
  }, [])

  const handleDigitalHumanClick = useCallback(() => {
    const existing = realtimeWindowRef.current
    if (existing && !existing.closed) {
      existing.focus()
      return
    }
    const width = 420
    const height = 680
    const left = Math.max(0, Math.floor(window.screenX + (window.outerWidth - width) / 2))
    const top = Math.max(0, Math.floor(window.screenY + (window.outerHeight - height) / 2))
    const popup = window.open(
      '/realtime-window',
      'realtime-voice-window',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no`
    )
    if (!popup) {
      toast('无法打开实时对话窗口，请检查浏览器弹窗拦截设置')
      return
    }
    realtimeWindowRef.current = popup
    setRealtimePopupOpen(true)
    popup.focus()

    if (realtimeWindowWatchRef.current != null) {
      window.clearInterval(realtimeWindowWatchRef.current)
    }
    realtimeWindowWatchRef.current = window.setInterval(() => {
      const w = realtimeWindowRef.current
      if (!w || w.closed) {
        if (realtimeWindowWatchRef.current != null) {
          window.clearInterval(realtimeWindowWatchRef.current)
          realtimeWindowWatchRef.current = null
        }
        realtimeWindowRef.current = null
        setRealtimePopupOpen(false)
      }
    }, 400)
  }, [toast])

  const sendRecordedVoice = async (
    voiceToSend: PendingVoice,
    options?: { clearPending?: boolean; revokeSourceUrl?: boolean }
  ) => {
    if (!voiceToSend.blob || voiceToSend.blob.size === 0) {
      toast('语音数据为空，请重新录制后再发送')
      return
    }
    if (options?.clearPending) setPendingVoice(null)
    const convId = await ensureConversation()
    setIsAiLoading(true)
    const aiMsgId = generateId()
    try {
      const wavName = voiceToSend.fileName.replace(/\.[^.]+$/, '.wav')
      const file = await convertAudioBlobToWavFile(voiceToSend.blob, wavName)
      const { url: uploadedUrl, fileName: name } = await uploadFile(file)
      const userMsg: Message = {
        id: generateId(),
        content: '[语音]',
        sender: 'user',
        timestamp: new Date(),
        type: 'voice',
        fileUrl: uploadedUrl,
        fileName: name,
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

      await chatWithAIStream(
        convId,
        '',
        (chunk) => {
          const prev = useChatStore.getState().messages.find((m) => m.id === aiMsgId)
          updateMessage(aiMsgId, { content: (prev?.content ?? '') + chunk })
        },
        {
          audioUrl: uploadedUrl,
          voiceFileName: name,
          onAssistantAudio: ({ audioUrl, fileName: fn }) => {
            updateMessage(aiMsgId, { fileUrl: audioUrl, fileName: fn })
          },
        }
      )
      invalidateConversationMessages(convId)
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? (err.message || '语音处理或 AI 回复失败')
          : (err instanceof Error ? err.message : '网络异常，请检查后端服务与网络后重试')
      toast(msg)
      updateMessage(aiMsgId, { content: `[请求失败] ${msg}` })
    } finally {
      if (options?.revokeSourceUrl && voiceToSend.url) {
        URL.revokeObjectURL(voiceToSend.url)
      }
      setIsAiLoading(false)
    }
    setInputValue('')
  }

  const handleSubmit = async () => {
    const content = inputValue.trim()
    const hasImage = pendingImage != null
    const hasVideo = pendingVideo != null
    const hasVoice = pendingVoice != null
    const hasAttachment = pendingAttachment != null
    if ((!content && !hasImage && !hasVideo && !hasVoice && !hasAttachment) || isAiLoading) return

    if (hasVoice && !hasImage && !hasVideo && !hasAttachment) {
      const voiceToSend = pendingVoice!
      await sendRecordedVoice(voiceToSend, { clearPending: true, revokeSourceUrl: true })
      return
    }

    const attachmentToSend = pendingAttachment
    const displayContent =
      content
      || (hasImage
        ? '请描述或分析这张图片'
        : hasVideo
          ? '请描述或分析这个视频'
          : hasAttachment && attachmentToSend
            ? `请结合附件内容回复：${attachmentToSend.fileName}`
            : '（无文字内容）')
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
      type: hasImage ? 'image' : hasVideo ? 'video' : hasAttachment && attachmentToSend ? attachmentToSend.category : 'text',
      ...(hasImage && pendingImage ? { fileUrl: pendingImage.url, fileName: pendingImage.fileName } : {}),
      ...(hasVideo && pendingVideo ? { fileUrl: pendingVideo.url, fileName: pendingVideo.fileName } : {}),
      ...(hasAttachment && attachmentToSend ? { fileUrl: attachmentToSend.url, fileName: attachmentToSend.fileName } : {}),
    }
    const imageToSend = pendingImage
    const videoToSend = pendingVideo
    const attachmentCategory = attachmentToSend?.category ?? null
    addMessage(userMessage)
    setInputValue('')
    setPendingImage(null)
    setPendingVideo(null)
    setPendingAttachment(null)
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
        {
          ...(hasImage && imageToSend ? { imageUrl: imageToSend.url } : {}),
          ...(hasVideo && videoToSend ? { videoUrl: videoToSend.url } : {}),
          ...(hasAttachment && attachmentToSend
            ? attachmentCategory === 'voice'
              ? { audioUrl: attachmentToSend.url, voiceFileName: attachmentToSend.fileName }
              : { fileUrl: attachmentToSend.url, fileName: attachmentToSend.fileName }
            : {}),
          onAssistantAudio: ({ audioUrl, fileName: fn }) => {
            updateMessage(aiMsgId, { fileUrl: audioUrl, fileName: fn })
          },
        }
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
    const clearPendingVoiceIfAny = () => {
      setPendingVoice((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url)
        return null
      })
    }

    try {
      const { url, fileName: name, category } = await uploadFile(file)
      if (category === 'image') {
        setPendingVideo(null)
        setPendingAttachment(null)
        clearPendingVoiceIfAny()
        setPendingImage({ url, fileName: name })
        return
      }
      if (category === 'video') {
        setPendingImage(null)
        setPendingAttachment(null)
        clearPendingVoiceIfAny()
        setPendingVideo({ url, fileName: name })
        return
      }
      setPendingImage(null)
      setPendingVideo(null)
      clearPendingVoiceIfAny()
      setPendingAttachment({
        url,
        fileName: name,
        category: category === 'voice' ? 'voice' : 'file',
      })
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '上传失败'
      toast(msg)
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
    if (!blob) {
      toast('未获取到有效录音，请稍等 1 秒后重试')
      return
    }
    if (isAiLoading) {
      toast('当前有请求处理中，请稍后再录音发送')
      return
    }
    if (blob.size === 0) {
      toast('录制内容为空，请重新录制')
      return
    }
    const fileName = `voice-${Date.now()}.webm`
    const url = URL.createObjectURL(blob)
    await sendRecordedVoice({ blob, url, fileName }, { revokeSourceUrl: true })
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col md:flex-row">
      <aside className="hidden md:flex flex-col flex-shrink-0 w-56 lg:w-60 xl:w-72 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 items-center justify-center p-3 md:p-4 landscape:max-md:hidden">
        {realtimePopupOpen ? (
          <div className="w-full text-center px-3">
            <p className="text-sm text-primary-500 dark:text-primary-400">实时对话窗口已打开</p>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">关闭实时窗口后，数字人会回到这里</p>
          </div>
        ) : (
          <DigitalHuman
            expression="neutral"
            animate
            bodyMotion
            onClick={handleDigitalHumanClick}
            realtimeMode={false}
            className="w-full max-w-[180px] md:max-w-[200px]"
          />
        )}
      </aside>

      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        <div className="flex-1 min-h-0 flex flex-col">
          {useVirtualScroll ? (
            <VirtualMessageList messages={messages} scrollToEndRef={messagesEndRef} />
          ) : messages.length === 0 ? (
            <div className="flex-1 min-h-0 flex items-center justify-center text-gray-500 dark:text-gray-400 text-sm px-4">
              发送消息开始对话
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 md:p-4 pb-2 landscape:max-md:pb-2">
              <ul className="space-y-3 sm:space-y-4">
                {messages.map((msg) => (
                  <li key={msg.id} className={msg.sender === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                    <MessageBubble message={msg} />
                  </li>
                ))}
                <div ref={messagesEndRef} />
              </ul>
            </div>
          )}
        </div>

        {pendingImage && (
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <img src={pendingImage.url} alt={pendingImage.fileName} className="w-12 h-12 object-cover rounded-lg border border-gray-200 dark:border-gray-600" />
            <span className="text-sm text-gray-600 dark:text-gray-400 truncate flex-1 min-w-0">{pendingImage.fileName}</span>
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

        {pendingVideo && (
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <video
              src={pendingVideo.url}
              className="w-20 h-12 rounded-lg border border-gray-200 dark:border-gray-600 object-cover"
              preload="metadata"
              muted
            />
            <span className="text-sm text-gray-600 dark:text-gray-400 truncate flex-1 min-w-0">{pendingVideo.fileName}</span>
            <button
              type="button"
              onClick={() => setPendingVideo(null)}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-800 dark:hover:text-gray-200"
              title="移除视频"
              aria-label="移除视频"
            >
              ✕
            </button>
          </div>
        )}

        {pendingVoice && (
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <span className="text-sm text-gray-600 dark:text-gray-400 shrink-0">🎤 语音</span>
            <audio src={pendingVoice.url} controls className="flex-1 min-w-0 h-8 max-w-[200px] sm:max-w-[280px]" preload="metadata" />
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

        {pendingAttachment && (
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <span className="text-sm text-gray-600 dark:text-gray-400 shrink-0">
              {pendingAttachment.category === 'voice' ? '🎤 语音文件' : '📄 文件'}
            </span>
            <span className="text-sm text-gray-600 dark:text-gray-400 truncate flex-1 min-w-0">{pendingAttachment.fileName}</span>
            <button
              type="button"
              onClick={() => setPendingAttachment(null)}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-800 dark:hover:text-gray-200"
              title={pendingAttachment.category === 'voice' ? '移除语音文件' : '移除文件'}
              aria-label={pendingAttachment.category === 'voice' ? '移除语音文件' : '移除文件'}
            >
              ✕
            </button>
          </div>
        )}

        <div className="flex-shrink-0 pb-[env(safe-area-inset-bottom)]">
          <InputArea
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleSubmit}
            onFileSelect={handleFileSelect}
            onVoiceRecordStart={handleVoiceRecordStart}
            onVoiceRecordStop={handleVoiceRecordStop}
            voiceRecording={isRecording}
            pendingImage={pendingImage}
            pendingVideo={pendingVideo}
            pendingVoice={pendingVoice != null ? { url: pendingVoice.url, fileName: pendingVoice.fileName } : null}
            pendingFile={pendingAttachment != null ? { fileName: pendingAttachment.fileName } : null}
            disabled={isAiLoading}
            placeholder={isAiLoading ? 'AI 正在思考…' : '输入消息...'}
          />
        </div>
      </div>
    </div>
  )
}
