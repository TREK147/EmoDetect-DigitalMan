import { useState, useRef, useCallback } from 'react'
import {
  Send,
  Paperclip,
  Mic,
  Square,
  Smile,
  Bold,
  Italic,
  Code,
  List,
  Quote,
  Heading2,
  Link as LinkIcon,
} from 'lucide-react'
import clsx from 'clsx'

const DEFAULT_ROWS = 2
const MAX_ROWS = 8

const EMOJI_LIST = [
  '😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂',
  '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '🙂', '🤗',
  '👍', '👎', '👏', '🙌', '🤝', '🙏', '❤️', '💙', '💚', '💛',
  '🔥', '⭐', '✨', '💯', '✅', '❌', '📌', '💡', '🎉', '🚀',
]

const MARKDOWN_SHORTCUTS: Array<
  | { icon: typeof Bold; wrap: string; title: string }
  | { icon: typeof Heading2; prefix: string; title: string }
  | { icon: typeof LinkIcon; replace: (s: string) => string; insertWhenEmpty: string; title: string }
> = [
  { icon: Bold, wrap: '**', title: '粗体' },
  { icon: Italic, wrap: '*', title: '斜体' },
  { icon: Code, wrap: '`', title: '行内代码' },
  { icon: Heading2, prefix: '## ', title: '标题' },
  { icon: List, prefix: '- ', title: '列表' },
  { icon: Quote, prefix: '> ', title: '引用' },
  {
    icon: LinkIcon,
    replace: (s) => `[${s}]()`,
    insertWhenEmpty: '[]()',
    title: '链接',
  },
]

interface InputAreaProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onFileSelect?: (files: File[]) => void
  onVoiceRecordStart?: () => void
  onVoiceRecordStop?: () => void
  placeholder?: string
  disabled?: boolean
}

export default function InputArea({
  value,
  onChange,
  onSubmit,
  onFileSelect,
  onVoiceRecordStart,
  onVoiceRecordStop,
  placeholder = '输入消息...',
  disabled = false,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [isRecording, setIsRecording] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!value.trim() || disabled) return
    onSubmit()
  }

  const insertAtCursor = useCallback((before: string, after = '') => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const text = el.value
    const newText = text.slice(0, start) + before + (text.slice(start, end) || '') + after + text.slice(end)
    onChange(newText)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + before.length + (end - start) + after.length
      el.setSelectionRange(pos, pos)
    })
  }, [onChange])

  const insertMarkdown = useCallback((item: (typeof MARKDOWN_SHORTCUTS)[number]) => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = el.value.slice(start, end)

    if ('replace' in item) {
      const toInsert = selected ? item.replace(selected) : item.insertWhenEmpty ?? ''
      if (toInsert) insertAtCursor(toInsert, '')
      return
    }
    if ('wrap' in item && item.wrap) {
      insertAtCursor(item.wrap, item.wrap)
      return
    }
    if ('prefix' in item && item.prefix) {
      insertAtCursor(item.prefix, '')
    }
  }, [insertAtCursor])

  const insertEmoji = useCallback((emoji: string) => {
    insertAtCursor(emoji, '')
  }, [insertAtCursor])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files?.length && onFileSelect) {
      onFileSelect(Array.from(files))
    }
    e.target.value = ''
  }

  const handleVoiceClick = () => {
    if (isRecording) {
      onVoiceRecordStop?.()
      setIsRecording(false)
    } else {
      onVoiceRecordStart?.()
      setIsRecording(true)
    }
  }

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2 sm:p-3 md:p-3">
      {/* Markdown 快捷输入工具栏：小屏可横向滚动 */}
      <div className="flex items-center gap-0.5 sm:gap-1 pb-1.5 sm:pb-2 border-b border-gray-100 dark:border-gray-800 overflow-x-auto scrollbar-hide">
        {MARKDOWN_SHORTCUTS.map((item) => (
          <button
            key={item.title}
            type="button"
            onClick={() => insertMarkdown(item)}
            title={item.title}
            className="p-1.5 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-300 touch-manipulation shrink-0"
          >
            <item.icon className="w-4 h-4" />
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-1.5 sm:gap-2 pt-2 sm:pt-3">
        {/* 左侧：附件、表情 */}
        <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="p-2 sm:p-2.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
            title="上传文件（图片、视频、文档）"
            aria-label="上传文件"
          >
            <Paperclip className="w-5 h-5" />
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setEmojiOpen((v) => !v)}
              disabled={disabled}
              className="p-2 sm:p-2.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
              title="表情"
              aria-label="选择表情"
            >
              <Smile className="w-5 h-5" />
            </button>
            {emojiOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  aria-hidden
                  onClick={() => setEmojiOpen(false)}
                />
                <div className="absolute bottom-full left-0 mb-1 p-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg z-20 w-[min(280px,90vw)] sm:w-64 max-h-40 sm:max-h-48 overflow-y-auto">
                  <div className="grid grid-cols-8 gap-0.5 sm:gap-1">
                    {EMOJI_LIST.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          insertEmoji(emoji)
                          setEmojiOpen(false)
                        }}
                        className="p-1.5 text-base sm:text-lg hover:bg-gray-100 dark:hover:bg-gray-700 rounded touch-manipulation"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 多行输入框 */}
        <div className="flex-1 min-w-0 flex flex-col min-h-[44px]">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit(e)
              }
            }}
            placeholder={placeholder}
            disabled={disabled}
            rows={DEFAULT_ROWS}
            className={clsx(
              'w-full min-h-[44px] sm:min-h-[52px] md:min-h-[60px] max-h-[120px] sm:max-h-[160px] md:max-h-[180px] resize-y px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg sm:rounded-xl text-base',
              'border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800',
              'text-gray-800 dark:text-gray-200 placeholder-gray-400',
              'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          />
        </div>

        {/* 语音 + 发送 */}
        <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={handleVoiceClick}
            disabled={disabled}
            className={clsx(
              'p-2.5 sm:p-3 rounded-lg sm:rounded-xl transition-colors touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center',
              isRecording
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50'
            )}
            title={isRecording ? '停止录制' : '语音输入'}
            aria-label={isRecording ? '停止录制' : '语音输入'}
          >
            {isRecording ? (
              <Square className="w-5 h-5" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </button>
          <button
            type="submit"
            disabled={!value.trim() || disabled}
            className="p-2.5 sm:p-3 rounded-lg sm:rounded-xl bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center active:scale-95"
            aria-label="发送"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </form>
    </div>
  )
}
