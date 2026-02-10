import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, User, Menu, X, Pencil, MoreVertical, Share2, Pin, Trash2 } from 'lucide-react'
import type { User as UserType, Conversation } from '@/types'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import clsx from 'clsx'

const RAIL_WIDTH = 56
const PANEL_WIDTH = 280

/** 三点更多菜单 */
function ConversationMenu({
  conversation,
  onClose,
  onShare,
  onPin,
  onRename,
  onDelete,
}: {
  conversation: Conversation
  onClose: () => void
  onShare: () => void
  onPin: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose])
  return (
    <>
      <div className="fixed inset-0 z-[45]" aria-hidden onClick={onClose} />
      <div
        ref={menuRef}
        className="absolute right-0 top-full mt-1 z-50 min-w-[180px] py-1 rounded-lg bg-gray-800 dark:bg-gray-700 border border-gray-600 dark:border-gray-600 shadow-xl"
      >
        <button
          type="button"
          onClick={onShare}
          className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors"
        >
          <Share2 className="w-4 h-4 shrink-0" />
          分享对话内容
        </button>
        <button
          type="button"
          onClick={onPin}
          className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors"
        >
          <Pin className="w-4 h-4 shrink-0" />
          {conversation.pinned ? '取消固定' : '固定'}
        </button>
        <button
          type="button"
          onClick={onRename}
          className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors"
        >
          <Pencil className="w-4 h-4 shrink-0" />
          重命名
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-red-300 hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors"
        >
          <Trash2 className="w-4 h-4 shrink-0" />
          删除
        </button>
      </div>
    </>
  )
}

/** 重命名内联输入 */
function RenameInput({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string
  onChange: (v: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  return (
    <div className="absolute inset-0 flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded-lg z-50">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave()
          if (e.key === 'Escape') onCancel()
        }}
        className="flex-1 min-w-0 px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
      />
      <button type="button" onClick={onSave} className="px-2 py-1 text-xs text-primary-600 dark:text-primary-400 hover:underline">
        确定
      </button>
      <button type="button" onClick={onCancel} className="px-2 py-1 text-xs text-gray-500 hover:underline">
        取消
      </button>
    </div>
  )
}

interface SidebarProps {
  user?: UserType | null
  conversations?: Conversation[]
  currentConversationId?: string | null
  onNewConversation?: () => void
  onSelectConversation?: (id: string) => void
  onRemoveConversation?: (id: string) => void
  onUpdateConversation?: (id: string, patch: Partial<Conversation>) => void
  /** 侧边栏展开面板是否展开 */
  isOpen?: boolean
  onClose?: () => void
  /** 点击左侧条「展开菜单」时调用（可传 toggle） */
  onOpen?: () => void
  /** 是否在移动端显示触发按钮 */
  showMobileTrigger?: boolean
}

export default function Sidebar({
  user,
  conversations = [],
  currentConversationId = null,
  onNewConversation,
  onSelectConversation,
  onRemoveConversation,
  onUpdateConversation,
  isOpen = false,
  onClose,
  onOpen,
  showMobileTrigger = false,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [menuConvId, setMenuConvId] = useState<string | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const filteredConversations = searchQuery.trim()
    ? conversations.filter(
        (c) =>
          c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.lastMessage.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [...conversations].sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      })

  const panelContent = (
    <>
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
            对话
          </h2>
          {filteredConversations.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 px-2 py-4 text-center">
              {searchQuery.trim() ? '未找到匹配对话' : '暂无对话'}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {filteredConversations.map((conv) => (
                <li key={conv.id} className="group relative">
                  <div
                    className={clsx(
                      'flex items-center gap-1 w-full rounded-lg text-sm transition-colors min-w-0',
                      currentConversationId === conv.id
                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700/80'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectConversation?.(conv.id)
                        onClose?.()
                      }}
                      className="flex-1 min-w-0 text-left px-2 sm:px-3 py-2 sm:py-2.5 rounded-lg truncate touch-manipulation"
                    >
                      <div className="font-medium truncate">{conv.title}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                        {formatDistanceToNow(new Date(conv.updatedAt), {
                          addSuffix: true,
                          locale: zhCN,
                        })}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setMenuConvId(menuConvId === conv.id ? null : conv.id)
                      }}
                      className={clsx(
                        'flex-shrink-0 p-1.5 rounded-full text-gray-500 hover:bg-gray-300 dark:hover:bg-gray-600 transition-opacity touch-manipulation',
                        menuConvId === conv.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      )}
                      aria-label="更多选项"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                  {menuConvId === conv.id && (
                    <ConversationMenu
                      conversation={conv}
                      onClose={() => setMenuConvId(null)}
                      onShare={() => {
                        setMenuConvId(null)
                        // 分享：复制当前对话标题或链接（演示）
                        if (navigator.clipboard?.writeText) {
                          navigator.clipboard.writeText(conv.title)
                        }
                      }}
                      onPin={() => {
                        onUpdateConversation?.(conv.id, { pinned: !conv.pinned })
                        setMenuConvId(null)
                      }}
                      onRename={() => {
                        setRenameId(conv.id)
                        setRenameValue(conv.title)
                        setMenuConvId(null)
                      }}
                      onDelete={() => {
                        onRemoveConversation?.(conv.id)
                        setMenuConvId(null)
                      }}
                    />
                  )}
                  {renameId === conv.id && (
                    <RenameInput
                      value={renameValue}
                      onChange={setRenameValue}
                      onSave={() => {
                        if (renameValue.trim()) {
                          onUpdateConversation?.(conv.id, { title: renameValue.trim() })
                        }
                        setRenameId(null)
                        setRenameValue('')
                      }}
                      onCancel={() => {
                        setRenameId(null)
                        setRenameValue('')
                      }}
                    />
                  )}
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

      {/* 关闭按钮 */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-2 right-2 sm:top-3 sm:right-3 p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300 touch-manipulation z-10"
        aria-label="关闭侧边栏"
      >
        <X className="w-5 h-5" />
      </button>
    </>
  )

  return (
    <>
      {/* 遮罩：点击主区域可收起展开的面板（不盖住左侧条） */}
      <button
        type="button"
        onClick={onClose}
        className={clsx(
          'fixed inset-0 z-30 bg-black/40 dark:bg-black/50 transition-opacity duration-200',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        style={{ left: RAIL_WIDTH }}
        aria-hidden={!isOpen}
      />

      {/* 左侧固定条 + 可展开面板（仿 Gemini） */}
      <aside
        className={clsx(
          'flex fixed inset-y-0 left-0 z-40 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] transition-[width] duration-200 ease-out overflow-hidden',
          'bg-gray-100 dark:bg-gray-800/80 border-r border-gray-200 dark:border-gray-700',
          isOpen ? 'w-[336px]' : 'w-14'
        )}
      >
        {/* 左侧窄条：展开菜单 + 新建对话 */}
        <div className="flex flex-col items-center flex-shrink-0 w-14 py-3 gap-1 border-r border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/80">
          <button
            type="button"
            onClick={() => (isOpen ? onClose?.() : onOpen?.())}
            title="展开菜单"
            className="group relative flex items-center justify-center w-10 h-10 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors touch-manipulation"
            aria-label="展开菜单"
          >
            <Menu className="w-5 h-5" strokeWidth={2} />
            <span className="absolute left-full ml-2 px-2 py-1 rounded text-xs whitespace-nowrap bg-gray-800 dark:bg-gray-700 text-white opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg">
              展开菜单
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              onNewConversation?.()
              onClose?.()
            }}
            title="新建对话"
            className="group relative flex items-center justify-center w-10 h-10 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors touch-manipulation"
            aria-label="新建对话"
          >
            <Pencil className="w-5 h-5" strokeWidth={2} />
            <span className="absolute left-full ml-2 px-2 py-1 rounded text-xs whitespace-nowrap bg-gray-800 dark:bg-gray-700 text-white opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg">
              新建对话
            </span>
          </button>
        </div>

        {/* 可展开面板：对话历史等 */}
        <div
          className={clsx(
            'flex flex-col flex-1 min-w-0 h-full bg-gray-50 dark:bg-gray-800/50 transition-transform duration-200 ease-out',
            isOpen ? 'translate-x-0' : '-translate-x-full'
          )}
          style={{ width: PANEL_WIDTH }}
        >
          <div className="flex flex-col h-full overflow-hidden relative">
            {panelContent}
          </div>
        </div>
      </aside>
    </>
  )
}
