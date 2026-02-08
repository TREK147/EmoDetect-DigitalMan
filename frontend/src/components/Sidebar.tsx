import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, User, Menu, X } from 'lucide-react'
import type { User as UserType, Conversation } from '@/types'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import clsx from 'clsx'

interface SidebarProps {
  user?: UserType | null
  conversations?: Conversation[]
  currentConversationId?: string | null
  onNewConversation?: () => void
  onSelectConversation?: (id: string) => void
  /** 小屏幕下侧边栏是否展开，由父组件控制 */
  isOpen?: boolean
  onClose?: () => void
  onOpen?: () => void
  /** 是否在移动端显示触发按钮（通常由父组件在头部渲染） */
  showMobileTrigger?: boolean
}

export default function Sidebar({
  user,
  conversations = [],
  currentConversationId = null,
  onNewConversation,
  onSelectConversation,
  isOpen = false,
  onClose,
  onOpen,
  showMobileTrigger = false,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredConversations = searchQuery.trim()
    ? conversations.filter(
        (c) =>
          c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.lastMessage.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : conversations

  const sidebarContent = (
    <>
      {/* 新建对话 */}
      <div className="p-2 sm:p-3 border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={onNewConversation}
          className="w-full flex items-center justify-center gap-2 py-2 sm:py-2.5 px-3 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 transition-colors touch-manipulation"
        >
          <Plus className="w-4 h-4 shrink-0" />
          新建对话
        </button>
      </div>

      {/* 搜索 */}
      <div className="p-2 border-b border-gray-200 dark:border-gray-700">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索对话"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* 对话历史列表 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-2">
          <h2 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-2 mb-2">
            对话历史
          </h2>
          {filteredConversations.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 px-2 py-4 text-center">
              {searchQuery.trim() ? '未找到匹配对话' : '暂无对话'}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {filteredConversations.map((conv) => (
                <li key={conv.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectConversation?.(conv.id)
                      onClose?.()
                    }}
                    className={clsx(
                      'w-full text-left px-2 sm:px-3 py-2 sm:py-2.5 rounded-lg text-sm transition-colors truncate touch-manipulation',
                      currentConversationId === conv.id
                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:text-primary-600 dark:hover:text-primary-400'
                    )}
                  >
                    <div className="font-medium truncate">{conv.title}</div>
                    <div className="text-xs text-gray-500 truncate mt-0.5">
                      {formatDistanceToNow(new Date(conv.updatedAt), {
                        addSuffix: true,
                        locale: zhCN,
                      })}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 用户信息 */}
      <div className="flex-shrink-0 p-2 sm:p-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        {user ? (
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {user.avatar ? (
              <img
                src={user.avatar}
                alt=""
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-full object-cover shrink-0"
              />
            ) : (
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-primary-600 dark:text-primary-400" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                {user.username}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{user.email}</p>
            </div>
          </div>
        ) : (
          <Link
            to="/login"
            className="flex items-center gap-2 sm:gap-3 text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
          >
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center shrink-0">
              <User className="w-4 h-4 text-gray-500" />
            </div>
            <span className="text-sm">登录 / 注册</span>
          </Link>
        )}
      </div>

      {/* 小屏幕关闭按钮 */}
      <button
        type="button"
        onClick={onClose}
        className="lg:hidden absolute top-2 right-2 sm:top-3 sm:right-3 p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300 touch-manipulation"
        aria-label="关闭侧边栏"
      >
        <X className="w-5 h-5" />
      </button>
    </>
  )

  return (
    <>
      {/* 移动端遮罩 */}
      <button
        type="button"
        onClick={onClose}
        className={clsx(
          'fixed inset-0 z-30 bg-black/50 transition-opacity lg:hidden',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        aria-hidden={!isOpen}
      />

      {/* 移动端触发按钮（可放在布局头部） */}
      {showMobileTrigger && onOpen && (
        <button
          type="button"
          onClick={onOpen}
          className="lg:hidden fixed top-4 left-4 z-20 p-2 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 shadow-sm"
          aria-label="打开侧边栏"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}

      {/* 侧边栏容器 */}
      <aside
        className={clsx(
          'flex flex-col bg-gray-50 dark:bg-gray-800/50 border-r border-gray-200 dark:border-gray-700 w-[min(280px,85vw)] sm:w-64 md:w-56 lg:w-64 flex-shrink-0 transition-transform duration-200 ease-out',
          'fixed inset-y-0 left-0 z-40 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] lg:pt-0 lg:pb-0 lg:relative lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex flex-col h-full overflow-hidden relative">
          {sidebarContent}
        </div>
      </aside>
    </>
  )
}
