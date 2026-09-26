import { useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'

/** Keep reply counts current while the forum is open, without polling hidden tabs. */
export function useForumRefresh() {
  const router = useRouter()
  useEffect(() => {
    let pending = false
    const refresh = async () => {
      if (pending || document.visibilityState !== 'visible') return
      pending = true
      try { await router.invalidate() } catch { /* Retry on the next tick. */ }
      finally { pending = false }
    }
    const timer = window.setInterval(() => void refresh(), 12000)
    document.addEventListener('visibilitychange', refresh)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [router])
}
