import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import Toast from '@/components/Toast'
import { useChatStore } from '@/stores/useChatStore'
import {
  getConversations,
  createConversation,
  getMessages,
  deleteConversation,
  patchConversation,
} from '@/utils/api'
import { X } from 'lucide-react'

export default function MainLayout() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const user = useChatStore((s) => s.user)
  const sidebarOpen = useChatStore((s) => s.sidebarOpen)
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen)
  const conversations = useChatStore((s) => s.conversations)
  const currentConversationId = useChatStore((s) => s.currentConversationId)
  const addConversation = useChatStore((s) => s.addConversation)
  const setConversations = useChatStore((s) => s.setConversations)
  const setCurrentConversationId = useChatStore((s) => s.setCurrentConversationId)
  const setMessages = useChatStore((s) => s.setMessages)
  const clearMessages = useChatStore((s) => s.clearMessages)
  const removeConversation = useChatStore((s) => s.removeConversation)
  const updateConversation = useChatStore((s) => s.updateConversation)

  const authRestoring = useChatStore((s) => s.authRestoring)

  // 登录/恢复后：从服务端拉取会话列表
  useEffect(() => {
    if (authRestoring || !user) return
    getConversations()
      .then((list) => {
        setConversations(list)
        setCurrentConversationId(null)
        clearMessages()
      })
      .catch(() => {
        setConversations([])
        setCurrentConversationId(null)
        clearMessages()
      })
  }, [user?.id, authRestoring, setConversations, setCurrentConversationId, clearMessages])

  const handleNewConversation = async () => {
    try {
      const conv = await createConversation({ title: '新对话' })
      addConversation(conv)
      setCurrentConversationId(conv.id)
      clearMessages()
    } catch {
      // 创建失败时仍可在前端新建本地会话，但无法持久化；这里简单清空当前
      setCurrentConversationId(null)
      clearMessages()
    }
  }

  const handleSelectConversation = async (id: string) => {
    setCurrentConversationId(id)
    try {
      const list = await getMessages(id)
      setMessages(list)
    } catch {
      setMessages([])
    }
  }

  const handleRemoveConversation = async (id: string) => {
    try {
      await deleteConversation(id)
      removeConversation(id)
    } catch {
      removeConversation(id)
    }
  }

  const handleUpdateConversation = async (id: string, patch: { title?: string; lastMessage?: string; updatedAt?: Date; messageCount?: number; pinned?: boolean }) => {
    updateConversation(id, patch)
    if (patch.title !== undefined || patch.pinned !== undefined) {
      try {
        await patchConversation(id, { title: patch.title, pinned: patch.pinned })
      } catch {
        // 忽略
      }
    }
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
          onRemoveConversation={handleRemoveConversation}
          onUpdateConversation={handleUpdateConversation}
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
