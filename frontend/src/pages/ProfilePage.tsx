import { Link } from 'react-router-dom'
import { User, Mail, ArrowLeft } from 'lucide-react'
import { useChatStore } from '@/stores/useChatStore'

export default function ProfilePage() {
  const user = useChatStore((s) => s.user)

  if (!user) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
        <p className="text-gray-500 dark:text-gray-400">请先登录</p>
        <Link to="/login" className="text-primary-600 dark:text-primary-400 hover:underline">去登录</Link>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-2xl mx-auto">
      <Link
        to="/chat"
        className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        返回聊天
      </Link>
      <h1 className="text-xl font-semibold text-gray-800 dark:text-white mb-6">个人中心</h1>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-4">
          {user.avatar ? (
            <img
              src={user.avatar}
              alt=""
              className="w-16 h-16 rounded-full object-cover"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center">
              <User className="w-8 h-8 text-primary-600 dark:text-primary-400" />
            </div>
          )}
          <div>
            <p className="text-lg font-medium text-gray-800 dark:text-white">{user.username}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{user.email}</p>
          </div>
        </div>
        <dl className="space-y-3 text-sm">
          <div className="flex items-center gap-3">
            <User className="w-4 h-4 text-gray-400" />
            <div>
              <dt className="text-gray-500 dark:text-gray-400">用户名</dt>
              <dd className="text-gray-800 dark:text-gray-200">{user.username}</dd>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Mail className="w-4 h-4 text-gray-400" />
            <div>
              <dt className="text-gray-500 dark:text-gray-400">邮箱</dt>
              <dd className="text-gray-800 dark:text-gray-200">{user.email}</dd>
            </div>
          </div>
        </dl>
      </div>
    </div>
  )
}
