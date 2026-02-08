import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type { User, Conversation, Message } from '@/types'
import { getCached, setCache, invalidateCache } from './apiCache'

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'
const DEFAULT_TIMEOUT = 30000
const MAX_RETRIES = 3
const RETRY_DELAY_BASE = 1000

/** 认证 token 存储 key */
const TOKEN_KEY = 'auth_token'

export const getStoredToken = (): string | null => localStorage.getItem(TOKEN_KEY)
export const setStoredToken = (token: string | null) => {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

const client = axios.create({
  baseURL: BASE_URL,
  timeout: DEFAULT_TIMEOUT,
  headers: { 'Content-Type': 'application/json' },
})

/** 是否为可重试的错误 */
function isRetryableError(err: AxiosError): boolean {
  if (!err.response) return true // 网络错误
  const status = err.response.status
  if (status === 401 || status === 403) return false
  return status >= 500 || status === 408 || status === 429
}

/** 延迟 */
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 请求拦截：注入 token */
client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getStoredToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/** 响应拦截：错误处理与重试 */
client.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const config = err.config as InternalAxiosRequestConfig & { _retryCount?: number }
    config._retryCount = config._retryCount ?? 0

    if (config._retryCount < MAX_RETRIES && isRetryableError(err)) {
      config._retryCount += 1
      const wait = RETRY_DELAY_BASE * Math.pow(2, config._retryCount - 1)
      await delay(wait)
      return client.request(config)
    }

    if (err.response?.status === 401) setStoredToken(null)
    return Promise.reject(normalizeApiError(err))
  }
)

/** 统一错误格式 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    public payload?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function normalizeApiError(err: AxiosError): ApiError {
  const status = err.response?.status
  const data = err.response?.data as { message?: string; error?: string; code?: string } | undefined
  const message =
    data?.message ?? data?.error ?? err.message ?? `请求失败${status ? ` (${status})` : ''}`
  return new ApiError(message, status, data?.code, data)
}

// ---------- 类型 ----------

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest extends LoginRequest {
  username: string
}

export interface AuthResponse {
  user: User
  token: string
}

export interface ConversationCreateRequest {
  title?: string
}

export interface MessageSendRequest {
  content: string
  type?: 'text' | 'image' | 'file' | 'voice'
  fileUrl?: string
  fileName?: string
}

// ---------- 1. 用户认证 API ----------

export async function login(data: LoginRequest): Promise<AuthResponse> {
  const res = await client.post<AuthResponse>('/auth/login', data)
  if (res.data.token) setStoredToken(res.data.token)
  return res.data
}

export async function register(data: RegisterRequest): Promise<AuthResponse> {
  const res = await client.post<AuthResponse>('/auth/register', data)
  if (res.data.token) setStoredToken(res.data.token)
  return res.data
}

export async function logout(): Promise<void> {
  try {
    await client.post('/auth/logout')
  } finally {
    setStoredToken(null)
  }
}

/** 获取当前用户信息 */
export async function getCurrentUser(): Promise<User> {
  const res = await client.get<User>('/auth/me')
  return res.data
}

// ---------- 2. 对话管理 API ----------

const CACHE_TTL = 5 * 60 * 1000 // 5 分钟

export async function getConversations(): Promise<Conversation[]> {
  const cached = getCached<Conversation[]>('GET', '/conversations')
  if (cached != null) return cached
  const res = await client.get<Conversation[]>('/conversations')
  const list = (res.data ?? []).map(normalizeConversation)
  setCache('GET', '/conversations', list, undefined, CACHE_TTL)
  return list
}

export async function createConversation(
  data?: ConversationCreateRequest
): Promise<Conversation> {
  const res = await client.post<Conversation>('/conversations', data ?? {})
  invalidateCache(/^GET:\/conversations:/)
  return normalizeConversation(res.data)
}

export async function getConversation(id: string): Promise<Conversation> {
  const cached = getCached<Conversation>('GET', `/conversations/${id}`)
  if (cached != null) return cached
  const res = await client.get<Conversation>(`/conversations/${id}`)
  const normalized = normalizeConversation(res.data)
  setCache('GET', `/conversations/${id}`, normalized, undefined, CACHE_TTL)
  return normalized
}

export async function deleteConversation(id: string): Promise<void> {
  await client.delete(`/conversations/${id}`)
  invalidateCache(/^GET:\/conversations:/)
  invalidateCache(new RegExp(`/conversations/${id}`))
}

function normalizeConversation(c: Conversation): Conversation {
  return {
    ...c,
    updatedAt: c.updatedAt ? new Date(c.updatedAt) : new Date(),
  }
}

// ---------- 3. 消息 API ----------

export async function getMessages(conversationId: string): Promise<Message[]> {
  const url = `/conversations/${conversationId}/messages`
  const cached = getCached<Message[]>('GET', url)
  if (cached != null) return cached
  const res = await client.get<Message[]>(url)
  const list = (res.data ?? []).map(normalizeMessage)
  setCache('GET', url, list, undefined, CACHE_TTL)
  return list
}

/** 发送文本消息 */
export async function sendTextMessage(
  conversationId: string,
  content: string
): Promise<Message> {
  const res = await client.post<Message>(
    `/conversations/${conversationId}/messages`,
    { content, type: 'text' }
  )
  return normalizeMessage(res.data)
}

/** 发送文件/语音：multipart/form-data */
export async function sendFileMessage(
  conversationId: string,
  file: File,
  type: 'image' | 'file' | 'voice',
  content = ''
): Promise<Message> {
  const form = new FormData()
  form.append('file', file)
  form.append('content', content)
  form.append('type', type)
  const res = await client.post<Message>(
    `/conversations/${conversationId}/messages`,
    form,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    }
  )
  return normalizeMessage(res.data)
}

/** 统一发送入口：根据内容类型选择文本或文件 */
export async function sendMessage(
  conversationId: string,
  payload: MessageSendRequest | { type: 'file'; file: File; content?: string }
): Promise<Message> {
  if ('file' in payload && payload.file) {
    const t = payload.type === 'file' ? 'file' : 'image'
    return sendFileMessage(conversationId, payload.file, t, payload.content)
  }
  return sendTextMessage(conversationId, payload.content)
}

function normalizeMessage(m: Message): Message {
  return {
    ...m,
    timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
  }
}

// ---------- 4. 流式响应 ----------

export interface StreamChunk {
  type: 'text' | 'done' | 'error'
  content?: string
  messageId?: string
}

/**
 * 发送消息并消费 SSE 流式响应。
 * 通过 onChunk 回调逐块接收内容；流结束后 resolve 最终 message（若后端返回）。
 */
export async function sendMessageStream(
  conversationId: string,
  content: string,
  onChunk: (chunk: StreamChunk) => void
): Promise<Message | null> {
  const token = getStoredToken()
  const url = `${BASE_URL}/conversations/${conversationId}/messages/stream`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ content, type: 'text' }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new ApiError(
      (err as { message?: string }).message ?? `Stream failed: ${res.status}`,
      res.status
    )
  }

  const reader = res.body?.getReader()
  if (!reader) {
    onChunk({ type: 'done' })
    return null
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let lastMessage: Message | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const raw = line.slice(6)
        if (raw === '[DONE]') {
          onChunk({ type: 'done' })
          continue
        }
        try {
          const data = JSON.parse(raw) as {
            type?: string
            content?: string
            messageId?: string
            message?: Message
          }
          if (data.message) lastMessage = normalizeMessage(data.message)
          if (data.type === 'text' && data.content)
            onChunk({ type: 'text', content: data.content })
          if (data.type === 'done' && data.messageId)
            onChunk({ type: 'done', messageId: data.messageId })
          if (data.type === 'error')
            onChunk({ type: 'error', content: (data as { error?: string }).error })
        } catch {
          // 非 JSON 行忽略
        }
      }
    }
  }

  if (buffer.trim() && buffer.startsWith('data: ')) {
    try {
      const data = JSON.parse(buffer.slice(6))
      if (data.content) onChunk({ type: 'text', content: data.content })
    } catch {
      // ignore
    }
  }
  onChunk({ type: 'done' })
  return lastMessage
}

/**
 * 带重试的流式发送（仅对网络/5xx 重试，最多 MAX_RETRIES 次）
 */
export async function sendMessageStreamWithRetry(
  conversationId: string,
  content: string,
  onChunk: (chunk: StreamChunk) => void
): Promise<Message | null> {
  let lastError: unknown
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      return await sendMessageStream(conversationId, content, onChunk)
    } catch (err) {
      lastError = err
      const status = err instanceof ApiError ? err.status : undefined
      if (status != null && (status === 401 || status === 403)) break
      if (i < MAX_RETRIES - 1) await delay(RETRY_DELAY_BASE * Math.pow(2, i))
    }
  }
  throw lastError
}
