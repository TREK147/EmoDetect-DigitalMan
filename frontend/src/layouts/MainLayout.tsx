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
  invalidateConversationsCache,
} from '@/utils/api'
import { X, Sun, Moon, Monitor } from 'lucide-react'
import clsx from 'clsx'
import { useThemeStore } from '@/stores/useThemeStore'
import {
  PRIMARY_COLOR_OPTIONS,
  getPrimaryPalette,
  type PrimaryColorKey,
  type ThemeMode,
} from '@/utils/theme'

export default function MainLayout() {
  const [settingsOpen, setSettingsOpen] = useState(false)
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
  const { mode, primaryColor, setMode, setPrimaryColor } = useThemeStore()

  const THEME_MODE_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: '浅色', icon: Sun },
    { value: 'dark', label: '深色', icon: Moon },
    { value: 'system', label: '跟随系统', icon: Monitor },
  ]

  // 登录/恢复后：从服务端拉取会话列表（切换账号时先清缓存，避免读到上一账号的对话）
  useEffect(() => {
    if (authRestoring || !user) return
    invalidateConversationsCache()
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
      />

      {/* 设置弹层 */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setSettingsOpen(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full p-6 border border-gray-200 dark:border-gray-700" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-white">设置</h2>
              <button type="button" onClick={() => setSettingsOpen(false)} className="p-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="关闭">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">外观</p>
                <div className="flex flex-col sm:flex-row gap-1">
                  {THEME_MODE_OPTIONS.map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setMode(value)}
                      className={clsx(
                        'flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-sm transition-colors min-w-0',
                        mode === value
                          ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                      )}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">主题色</p>
                <div className="flex flex-wrap gap-2">
                  {PRIMARY_COLOR_OPTIONS.map(({ key, label }) => {
                    const palette = getPrimaryPalette(key as PrimaryColorKey)
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setPrimaryColor(key as PrimaryColorKey)}
                        className={clsx(
                          'w-8 h-8 rounded-full border-2 transition-transform touch-manipulation',
                          primaryColor === key
                            ? 'border-gray-800 dark:border-white scale-110'
                            : 'border-transparent hover:scale-105'
                        )}
                        style={{ backgroundColor: palette[500] }}
                        title={label}
                        aria-label={label}
                      />
                    )
                  })}
                </div>
              </div>
            </div>
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
