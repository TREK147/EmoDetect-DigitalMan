import { useState, useRef, useEffect } from 'react'
import type { Message } from '@/types'
import MessageBubble from '@/components/MessageBubble'
import InputArea from '@/components/InputArea'
import DigitalHuman from '@/components/DigitalHuman'
import VirtualMessageList from '@/components/VirtualMessageList'
import { useChatStore } from '@/stores/useChatStore'
import { useToastStore } from '@/stores/useToastStore'
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder'
import { chatWithAIStream, uploadFile, ApiError } from '@/utils/api'

/** 超过此条数启用虚拟滚动 */
const VIRTUAL_SCROLL_THRESHOLD = 30

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** 待发送的图片（上传后等在输入框，和文字一起发送） */
interface PendingImage {
  url: string
  fileName: string
}

export default function ChatPage() {
  const [inputValue, setInputValue] = useState('')
  const [isAiLoading, setIsAiLoading] = useState(false)
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    if (!useVirtualScroll && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, useVirtualScroll])

  const handleSubmit = async () => {
    const content = inputValue.trim()
    const hasImage = pendingImage != null
    if ((!content && !hasImage) || isAiLoading) return

    const displayContent = content || '请描述或分析这张图片'
    let convId = currentConversationId
    if (!convId) {
      const title = (content || pendingImage?.fileName || '图片').slice(0, 20) + ((content || pendingImage?.fileName || '').length > 20 ? '…' : '')
      const conv = {
        id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        title,
        lastMessage: displayContent,
        updatedAt: new Date(),
        messageCount: 0,
      }
      addConversation(conv)
      setCurrentConversationId(conv.id)
      convId = conv.id
      updateConversation(conv.id, {
        title: conv.title,
        lastMessage: displayContent,
        updatedAt: conv.updatedAt,
        messageCount: 1,
      })
    } else {
      updateConversation(convId, {
        lastMessage: displayContent,
        updatedAt: new Date(),
        messageCount: messages.length + 1,
      })
    }

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
      const history = messages
        .slice(-20)
        .filter((m) => m.type === 'text')
        .map((m) => ({
          role: m.sender === 'user' ? ('user' as const) : ('assistant' as const),
          content: m.content,
        }))
      await chatWithAIStream(
        displayContent,
        (chunk) => {
          const prev = useChatStore.getState().messages.find((m) => m.id === aiMsgId)
          updateMessage(aiMsgId, { content: (prev?.content ?? '') + chunk })
        },
        history,
        hasImage && imageToSend ? { imageUrl: imageToSend.url } : undefined
      )
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'AI 回复失败，请稍后重试'
      toast(msg)
      updateMessage(aiMsgId, { content: `[请求失败] ${msg}` })
    } finally {
      setIsAiLoading(false)
    }
  }

  const ensureConversation = (): string => {
    let convId = currentConversationId
    if (!convId) {
      const conv = {
        id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        title: '新对话',
        lastMessage: '',
        updatedAt: new Date(),
        messageCount: 0,
      }
      addConversation(conv)
      setCurrentConversationId(conv.id)
      convId = conv.id
    }
    return convId
  }

  const handleFileSelect = async (files: File[]) => {
    const file = files[0]
    if (!file || isAiLoading) return
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
    const convId = ensureConversation()
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
      const history = messages
        .slice(-20)
        .filter((m) => m.type === 'text')
        .map((m) => ({
          role: m.sender === 'user' ? ('user' as const) : ('assistant' as const),
          content: m.content,
        }))
      const content =
        msgType === 'voice'
          ? `用户发送了一条语音，文件名：${name}，请简单回复。`
          : `用户发送了一个${msgType === 'file' ? '文件' : '视频'}，文件名：${name}，请简单回复。`
      await chatWithAIStream(
        content,
        (chunk) => {
          const prev = useChatStore.getState().messages.find((m) => m.id === aiMsgId)
          updateMessage(aiMsgId, { content: (prev?.content ?? '') + chunk })
        },
        history,
        { attachmentHint: content }
      )
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
    const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type || 'audio/webm' })
    await handleFileSelect([file])
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col md:flex-row">
      {/* 数字人形象展示区域：平板/桌面显示，移动端可隐藏或置于顶部 */}
      <aside className="hidden md:flex flex-col flex-shrink-0 w-56 lg:w-60 xl:w-72 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 items-center justify-center p-3 md:p-4 landscape:max-md:hidden">
        <DigitalHuman
          expression="neutral"
          animate
          bodyMotion
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
            disabled={isAiLoading}
            placeholder={isAiLoading ? 'AI 正在思考…' : '输入消息...'}
          />
        </div>
      </div>
    </div>
  )
}
