import { useState, useRef, useEffect } from 'react'
import type { Message } from '@/types'
import MessageBubble from '@/components/MessageBubble'
import InputArea from '@/components/InputArea'
import DigitalHuman from '@/components/DigitalHuman'
import VirtualMessageList from '@/components/VirtualMessageList'
import { useChatStore } from '@/stores/useChatStore'
import { useToastStore } from '@/stores/useToastStore'

/** 超过此条数启用虚拟滚动 */
const VIRTUAL_SCROLL_THRESHOLD = 30

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export default function ChatPage() {
  const [inputValue, setInputValue] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const messages = useChatStore((s) => s.messages)
  const currentConversationId = useChatStore((s) => s.currentConversationId)
  const addMessage = useChatStore((s) => s.addMessage)
  const addConversation = useChatStore((s) => s.addConversation)
  const setCurrentConversationId = useChatStore((s) => s.setCurrentConversationId)
  const updateConversation = useChatStore((s) => s.updateConversation)
  const toast = useToastStore((s) => s.show)

  const useVirtualScroll = messages.length >= VIRTUAL_SCROLL_THRESHOLD

  useEffect(() => {
    if (!useVirtualScroll && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, useVirtualScroll])

  const handleSubmit = () => {
    const content = inputValue.trim()
    if (!content) return

    let convId = currentConversationId
    if (!convId) {
      const title = content.slice(0, 20) + (content.length > 20 ? '…' : '')
      const conv = {
        id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        title,
        lastMessage: content,
        updatedAt: new Date(),
        messageCount: 0,
      }
      addConversation(conv)
      setCurrentConversationId(conv.id)
      convId = conv.id
      updateConversation(conv.id, {
        title: conv.title,
        lastMessage: content,
        updatedAt: conv.updatedAt,
        messageCount: 1,
      })
    } else {
      updateConversation(convId, {
        lastMessage: content,
        updatedAt: new Date(),
        messageCount: messages.length + 1,
      })
    }

    const userMessage: Message = {
      id: generateId(),
      content,
      sender: 'user',
      timestamp: new Date(),
      type: 'text',
    }
    addMessage(userMessage)
    setInputValue('')

    // 占位：模拟 AI 回复
    setTimeout(() => {
      const aiMessage: Message = {
        id: generateId(),
        content: '收到您的消息，这是模拟回复。',
        sender: 'ai',
        timestamp: new Date(),
        type: 'text',
      }
      addMessage(aiMessage)
    }, 500)
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

  const handleFileSelect = (files: File[]) => {
    const convId = ensureConversation()
    const file = files[0]
    const fileName = file?.name ?? '未命名文件'
    const userMsg: Message = {
      id: generateId(),
      content: `[文件] ${fileName}`,
      sender: 'user',
      timestamp: new Date(),
      type: 'file',
      fileName,
    }
    addMessage(userMsg)
    updateConversation(convId, { lastMessage: `[文件] ${fileName}`, updatedAt: new Date(), messageCount: messages.length + 1 })
    setTimeout(() => {
      addMessage({
        id: generateId(),
        content: `已收到文件「${fileName}」。（演示：实际需后端上传）`,
        sender: 'ai',
        timestamp: new Date(),
        type: 'text',
      })
    }, 400)
    toast(`已添加文件：${fileName}`)
  }

  const handleVoiceRecordStart = () => {
    toast('语音录制开始（演示）')
  }

  const handleVoiceRecordStop = () => {
    toast('语音录制结束（演示）')
    const convId = ensureConversation()
    const userMsg: Message = {
      id: generateId(),
      content: '[语音消息]',
      sender: 'user',
      timestamp: new Date(),
      type: 'voice',
    }
    addMessage(userMsg)
    updateConversation(convId, { lastMessage: '[语音]', updatedAt: new Date(), messageCount: messages.length + 1 })
    setTimeout(() => {
      addMessage({
        id: generateId(),
        content: '已收到语音。（演示）',
        sender: 'ai',
        timestamp: new Date(),
        type: 'text',
      })
    }, 400)
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

        {/* 输入区域（固定底部） */}
        <div className="flex-shrink-0 pb-[env(safe-area-inset-bottom)]">
          <InputArea
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleSubmit}
            onFileSelect={handleFileSelect}
            onVoiceRecordStart={handleVoiceRecordStart}
            onVoiceRecordStop={handleVoiceRecordStop}
          />
        </div>
      </div>
    </div>
  )
}
