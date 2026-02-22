import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type { User, Conversation, Message } from '@/types'
import { getCached, setCache, invalidateCache } from './apiCache'

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'
const DEFAULT_TIMEOUT = 30000
const MAX_RETRIES = 3
const RETRY_DELAY_BASE = 1000

/** 单文件上传最大大小（10MB），上传前校验，超过则提示并终止 */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
export const MAX_FILE_SIZE_LABEL = '10MB'

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

export async function patchConversation(
  id: string,
  patch: { title?: string; pinned?: boolean }
): Promise<Conversation> {
  const res = await client.patch<Conversation>(`/conversations/${id}`, patch)
  invalidateCache(/^GET:\/conversations:/)
  invalidateCache(new RegExp(`/conversations/${id}`))
  return normalizeConversation(res.data)
}

export async function deleteConversation(id: string): Promise<void> {
  await client.delete(`/conversations/${id}`)
  invalidateCache(/^GET:\/conversations:/)
  invalidateCache(new RegExp(`/conversations/${id}`))
}

/** 使某会话的消息列表缓存失效（发送新消息后调用，以便切换回时拉取最新） */
export function invalidateConversationMessages(conversationId: string): void {
  invalidateCache(new RegExp(`/conversations/${conversationId}/messages`))
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

// ---------- 5. AI 对话（对接 backend /api/chat，转发 AutoDL） ----------

export interface ChatHistoryItem {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatResponse {
  content: string
}

/** 上传文件，返回 url、fileName、category（image|video|file|voice） */
export interface UploadResult {
  url: string
  fileName: string
  mimeType: string
  category: 'image' | 'video' | 'file' | 'voice'
}

const UPLOAD_TIMEOUT_MS = 60000

export async function uploadFile(file: File): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', file)
  const token = getStoredToken()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new ApiError(
        (err as { error?: string }).error ?? `上传失败: ${res.status}`,
        res.status
      )
    }
    return res.json()
  } catch (e) {
    clearTimeout(timeoutId)
    if (e instanceof ApiError) throw e
    if (e instanceof Error && e.name === 'AbortError') {
      throw new ApiError('上传超时，请检查网络后重试')
    }
    throw new ApiError(e instanceof Error ? e.message : '上传失败，请重试')
  }
}

/** 发送一条用户消息，携带可选历史，获取 AI 回复 */
export async function chatWithAI(
  content: string,
  history?: ChatHistoryItem[]
): Promise<ChatResponse> {
  const res = await client.post<ChatResponse>('/chat', { content, messages: history ?? [] })
  return res.data
}

export interface ChatStreamOptions {
  imageUrl?: string
  attachmentHint?: string
}

/** 流式对话：需登录，会话历史由服务端从数据库读取并持久化。通过 onChunk 逐块接收 AI 回复。支持图片（imageUrl）和视频/语音描述（attachmentHint）。 */
export async function chatWithAIStream(
  conversationId: string,
  content: string,
  onChunk: (chunk: string) => void,
  options?: ChatStreamOptions
): Promise<void> {
  const token = getStoredToken()
  const url = `${BASE_URL}/chat/stream`
  const body: Record<string, unknown> = {
    conversationId,
    content: content || undefined,
  }
  if (options?.imageUrl) body.imageUrl = options.imageUrl
  if (options?.attachmentHint) body.attachmentHint = options.attachmentHint
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new ApiError(
      (err as { error?: string }).error ?? `请求失败: ${res.status}`,
      res.status
    )
  }
  const reader = res.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const raw = line.slice(6).trim()
        if (raw === '[DONE]') return
        try {
          const data = JSON.parse(raw) as { content?: string; error?: string }
          if (data.error) throw new ApiError(data.error, 500)
          if (data.content) onChunk(data.content)
        } catch (e) {
          if (e instanceof ApiError) throw e
        }
      }
    }
  }
  if (buffer.startsWith('data: ')) {
    const raw = buffer.slice(6).trim()
    if (raw !== '[DONE]') {
      try {
        const data = JSON.parse(raw) as { content?: string; error?: string }
        if (data.error) throw new ApiError(data.error, 500)
        if (data.content) onChunk(data.content)
      } catch (e) {
        if (e instanceof ApiError) throw e
      }
    }
  }
}
