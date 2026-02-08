import { create } from 'zustand'
import type { User, Conversation, Message } from '@/types'

interface ChatState {
  // ---------- 用户状态 ----------
  user: User | null
  setUser: (user: User | null) => void
  logout: () => void
  isLoggedIn: () => boolean

  // ---------- 对话列表 ----------
  conversations: Conversation[]
  setConversations: (list: Conversation[]) => void
  addConversation: (conv: Conversation) => void
  updateConversation: (id: string, patch: Partial<Conversation>) => void
  removeConversation: (id: string) => void

  // ---------- 当前对话消息 ----------
  currentConversationId: string | null
  messages: Message[]
  setCurrentConversationId: (id: string | null) => void
  setMessages: (messages: Message[]) => void
  addMessage: (message: Message) => void
  clearMessages: () => void

  // ---------- UI 状态 ----------
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  // 用户状态
  user: null,
  setUser: (user) => set({ user }),
  logout: () =>
    set({
      user: null,
      currentConversationId: null,
      messages: [],
    }),
  isLoggedIn: () => get().user != null,

  // 对话列表
  conversations: [],
  setConversations: (list) => set({ conversations: list }),
  addConversation: (conv) =>
    set((s) => ({ conversations: [conv, ...s.conversations] })),
  updateConversation: (id, patch) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, ...patch } : c
      ),
    })),
  removeConversation: (id) =>
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      currentConversationId:
        s.currentConversationId === id ? null : s.currentConversationId,
      messages: s.currentConversationId === id ? [] : s.messages,
    })),

  // 当前对话消息
  currentConversationId: null,
  messages: [],
  setCurrentConversationId: (id) =>
    set({ currentConversationId: id, messages: [] }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((s) => ({ messages: [...s.messages, message] })),
  clearMessages: () => set({ messages: [] }),

  // UI 状态
  sidebarOpen: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}))
