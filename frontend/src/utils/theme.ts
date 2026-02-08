/** 持久化 key */
export const THEME_STORAGE_KEY = 'app_theme'

export type ThemeMode = 'light' | 'dark' | 'system'
export type PrimaryColorKey = 'blue' | 'green' | 'purple' | 'orange' | 'rose'

export interface ThemeState {
  mode: ThemeMode
  primaryColor: PrimaryColorKey
}

const PRIMARY_PALETTES: Record<
  PrimaryColorKey,
  { 50: string; 100: string; 500: string; 600: string }
> = {
  blue: { 50: '#eff6ff', 100: '#dbeafe', 500: '#3b82f6', 600: '#2563eb' },
  green: { 50: '#f0fdf4', 100: '#dcfce7', 500: '#22c55e', 600: '#16a34a' },
  purple: { 50: '#faf5ff', 100: '#f3e8ff', 500: '#a855f7', 600: '#9333ea' },
  orange: { 50: '#fff7ed', 100: '#ffedd5', 500: '#f97316', 600: '#ea580c' },
  rose: { 50: '#fff1f2', 100: '#ffe4e6', 500: '#f43f5e', 600: '#e11d48' },
}

export function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** 根据 mode 得到实际应用的明暗 */
export function getResolvedTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') return getSystemTheme()
  return mode
}

/** 将主题应用到 document：dark class + CSS 变量 */
export function applyTheme(mode: ThemeMode, primaryColor: PrimaryColorKey): void {
  const resolved = getResolvedTheme(mode)
  const root = document.documentElement
  if (resolved === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
  const palette = PRIMARY_PALETTES[primaryColor]
  root.style.setProperty('--primary-50', palette[50])
  root.style.setProperty('--primary-100', palette[100])
  root.style.setProperty('--primary-500', palette[500])
  root.style.setProperty('--primary-600', palette[600])
}

export function loadThemeFromStorage(): ThemeState {
  if (typeof window === 'undefined') {
    return { mode: 'light', primaryColor: 'blue' }
  }
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (!raw) return { mode: 'light', primaryColor: 'blue' }
    const parsed = JSON.parse(raw) as Partial<ThemeState>
    return {
      mode: parsed.mode === 'system' ? 'system' : parsed.mode === 'dark' ? 'dark' : 'light',
      primaryColor:
        parsed.primaryColor && PRIMARY_PALETTES[parsed.primaryColor as PrimaryColorKey]
          ? (parsed.primaryColor as PrimaryColorKey)
          : 'blue',
    }
  } catch {
    return { mode: 'light', primaryColor: 'blue' }
  }
}

export function saveThemeToStorage(state: ThemeState): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

export function getPrimaryPalette(key: PrimaryColorKey) {
  return PRIMARY_PALETTES[key]
}

export const PRIMARY_COLOR_OPTIONS: { key: PrimaryColorKey; label: string }[] = [
  { key: 'blue', label: '蓝色' },
  { key: 'green', label: '绿色' },
  { key: 'purple', label: '紫色' },
  { key: 'orange', label: '橙色' },
  { key: 'rose', label: '玫瑰' },
]
