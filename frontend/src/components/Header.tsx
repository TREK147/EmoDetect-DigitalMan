import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { setStoredToken } from '@/utils/api'
import {
  Menu,
  Sun,
  Moon,
  Monitor,
  Settings,
  Bell,
  User,
  LogOut,
  ChevronDown,
} from 'lucide-react'
import type { User as UserType } from '@/types'
import { useChatStore } from '@/stores/useChatStore'
import { useThemeStore } from '@/stores/useThemeStore'
import {
  PRIMARY_COLOR_OPTIONS,
  getPrimaryPalette,
  type PrimaryColorKey,
  type ThemeMode,
} from '@/utils/theme'
import clsx from 'clsx'

interface HeaderProps {
  onMenuClick?: () => void
  user?: UserType | null
  notificationCount?: number
  onNotificationClick?: () => void
  onSettingsClick?: () => void
}

const THEME_MODE_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
]

export default function Header({
  onMenuClick,
  user,
  notificationCount = 0,
  onNotificationClick,
  onSettingsClick,
}: HeaderProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const themeMenuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const logout = useChatStore((s) => s.logout)
  const { mode, resolvedTheme, primaryColor, setMode, setPrimaryColor } =
    useThemeStore()

  const handleLogout = () => {
    setUserMenuOpen(false)
    setStoredToken(null)
    logout()
    navigate('/login', { replace: true })
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (userMenuRef.current && !userMenuRef.current.contains(target)) {
        setUserMenuOpen(false)
      }
      if (themeMenuRef.current && !themeMenuRef.current.contains(target)) {
        setThemeMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <header className="flex-shrink-0 h-12 sm:h-14 px-3 sm:px-4 md:px-6 flex items-center justify-between border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center gap-1 sm:gap-2 min-w-0">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            className="lg:hidden p-2 -ml-2 rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 touch-manipulation"
            aria-label="打开侧边栏"
          >
            <Menu className="w-5 h-5 sm:w-5 sm:h-5" />
          </button>
        )}
        <Link
          to="/"
          className="text-base sm:text-lg font-semibold text-gray-800 dark:text-white truncate"
        >
          智慧星
        </Link>
      </div>

      <nav className="flex items-center gap-1 sm:gap-2">
        <button
          type="button"
          onClick={onNotificationClick}
          className="relative p-2 rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors touch-manipulation"
          aria-label="通知"
        >
          <Bell className="w-5 h-5 sm:w-5 sm:h-5" />
          {notificationCount > 0 && (
            <span className="absolute top-1 right-1 min-w-[18px] h-[18px] flex items-center justify-center px-1 rounded-full bg-primary-500 text-white text-xs font-medium">
              {notificationCount > 99 ? '99+' : notificationCount}
            </span>
          )}
        </button>

        {/* 主题：模式 + 主题色 */}
        <div className="relative" ref={themeMenuRef}>
          <button
            type="button"
            onClick={() => setThemeMenuOpen((v) => !v)}
            className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors touch-manipulation"
            aria-label="主题设置"
            aria-expanded={themeMenuOpen}
          >
            {resolvedTheme === 'light' ? (
              <Sun className="w-5 h-5" />
            ) : (
              <Moon className="w-5 h-5" />
            )}
          </button>
          {themeMenuOpen && (
            <div
              className="absolute right-0 top-full mt-1 py-2 px-3 w-56 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg z-50"
              role="dialog"
              aria-label="主题设置"
            >
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 px-1">
                外观
              </p>
              <div className="flex flex-col sm:flex-row gap-1 mb-3">
                {THEME_MODE_OPTIONS.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setMode(value)
                      setThemeMenuOpen(false)
                    }}
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
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 px-1">
                主题色
              </p>
              <div className="flex flex-wrap gap-2">
                {PRIMARY_COLOR_OPTIONS.map(({ key, label }) => {
                  const palette = getPrimaryPalette(key as PrimaryColorKey)
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setPrimaryColor(key as PrimaryColorKey)
                      }}
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
          )}
        </div>

        <button
          type="button"
          onClick={onSettingsClick}
          className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors"
          aria-label="设置"
        >
          <Settings className="w-5 h-5" />
        </button>

        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setUserMenuOpen((v) => !v)}
            className="flex items-center gap-2 p-1.5 pr-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-expanded={userMenuOpen}
            aria-haspopup="true"
          >
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt=""
                className="w-8 h-8 rounded-full object-cover"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center">
                <User className="w-4 h-4 text-primary-600 dark:text-primary-400" />
              </div>
            )}
            <span className="hidden sm:block text-sm font-medium text-gray-700 dark:text-gray-300 max-w-[80px] md:max-w-[120px] truncate">
              {user ? user.username : '未登录'}
            </span>
            <ChevronDown
              className={clsx(
                'w-4 h-4 text-gray-500 transition-transform',
                userMenuOpen && 'rotate-180'
              )}
            />
          </button>

          {userMenuOpen && (
            <div
              className="absolute right-0 top-full mt-1 py-1 w-48 min-w-[180px] max-w-[min(100vw-2rem,240px)] rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg z-50"
              role="menu"
            >
              {user ? (
                <>
                  <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                      {user.username}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {user.email}
                    </p>
                  </div>
                  <Link
                    to="/chat/profile"
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    role="menuitem"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <User className="w-4 h-4" />
                    个人中心
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 text-left"
                    role="menuitem"
                  >
                    <LogOut className="w-4 h-4" />
                    退出登录
                  </button>
                </>
              ) : (
                <Link
                  to="/login"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  role="menuitem"
                  onClick={() => setUserMenuOpen(false)}
                >
                  <User className="w-4 h-4" />
                  登录 / 注册
                </Link>
              )}
            </div>
          )}
        </div>
      </nav>
    </header>
  )
}
