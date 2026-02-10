import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import Toast from '@/components/Toast'
import { useChatStore } from '@/stores/useChatStore'
import type { Conversation } from '@/types'
import { X } from 'lucide-react'

function generateId(): string {
  return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export default function MainLayout() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const user = useChatStore((s) => s.user)
  const sidebarOpen = useChatStore((s) => s.sidebarOpen)
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen)
  const conversations = useChatStore((s) => s.conversations)
  const currentConversationId = useChatStore((s) => s.currentConversationId)
  const addConversation = useChatStore((s) => s.addConversation)
  const setCurrentConversationId = useChatStore((s) => s.setCurrentConversationId)
  const clearMessages = useChatStore((s) => s.clearMessages)

  const handleNewConversation = () => {
    const conv: Conversation = {
      id: generateId(),
      title: '新对话',
      lastMessage: '',
      updatedAt: new Date(),
      messageCount: 0,
    }
    addConversation(conv)
    setCurrentConversationId(conv.id)
    clearMessages()
  }

  const handleSelectConversation = (id: string) => {
    setCurrentConversationId(id)
  }

  return (
    <div className="flex flex-col h-screen min-h-[100dvh] max-h-[100dvh] overflow-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <Header
        user={user}
        onSettingsClick={() => setSettingsOpen(true)}
        onNotificationClick={() => setNotificationOpen(true)}
      />

      {/* 设置弹层（演示） */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setSettingsOpen(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full p-6 border border-gray-200 dark:border-gray-700" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-white">设置</h2>
              <button type="button" onClick={() => setSettingsOpen(false)} className="p-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="关闭">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">此处为设置页演示，接入后端后可配置通知、隐私等。</p>
          </div>
        </div>
      )}

      {/* 通知弹层（演示） */}
      {notificationOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4 bg-black/50" onClick={() => setNotificationOpen(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-t-xl sm:rounded-xl shadow-xl max-w-sm w-full p-6 border border-gray-200 dark:border-gray-700 max-h-[60vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-white">通知</h2>
              <button type="button" onClick={() => setNotificationOpen(false)} className="p-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="关闭">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">暂无通知（演示）</p>
          </div>
        </div>
      )}

      <Toast />

      {/* 主体：侧边栏 + 主内容区 */}
      <div className="flex flex-1 min-h-0">
        <Sidebar
          user={user}
          conversations={conversations}
          currentConversationId={currentConversationId}
          onNewConversation={handleNewConversation}
          onSelectConversation={handleSelectConversation}
          onRemoveConversation={(id) => useChatStore.getState().removeConversation(id)}
          onUpdateConversation={(id, patch) => useChatStore.getState().updateConversation(id, patch)}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onOpen={() => setSidebarOpen(true)}
        />

        {/* 主内容区域（左侧条 56px 常驻，展开面板时 56+280px） */}
        <main
          className="flex-1 flex flex-col min-w-0 bg-white dark:bg-gray-900 overflow-hidden transition-[padding-left] duration-200 ease-out"
          style={{ paddingLeft: sidebarOpen ? 336 : 56 }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  )
}
