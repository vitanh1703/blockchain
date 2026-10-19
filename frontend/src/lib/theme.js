import { useEffect, useState } from 'react'

const MODE_KEY = 'caro.theme'

/** Màu nền theo mùa, giống dự án Cờ Tỉ Phú. */
export function getDefaultSeason(d = new Date()) {
  const m = d.getMonth() + 1
  const day = d.getDate()
  const md = m * 100 + day
  if (md >= 121 && md <= 220) return 'tet'
  if (md >= 421 && md <= 505) return 'reunification'
  if (md >= 911 && md <= 1005) return 'mid_autumn'
  if (md >= 1020 && md <= 1031) return 'halloween'
  if (md >= 1211 && md <= 1231) return 'christmas'
  if (m <= 3) return 'spring'
  if (m <= 7) return 'summer'
  if (m <= 10) return 'autumn'
  return 'winter'
}

function initialMode() {
  try {
    const saved = localStorage.getItem(MODE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // localStorage bị chặn
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const [mode, setMode] = useState(initialMode)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = mode
    root.dataset.seasonalTheme = getDefaultSeason()
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      // bỏ qua
    }
  }, [mode])

  return { mode, toggle: () => setMode((m) => (m === 'dark' ? 'light' : 'dark')) }
}
