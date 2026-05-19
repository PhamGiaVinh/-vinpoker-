import { useState, useEffect } from 'react'

export function useCountdown(targetDate: string | number | Date | null) {
  const [remaining, setRemaining] = useState<{ days: number; hours: number; minutes: number; seconds: number; expired: boolean }>({
    days: 0, hours: 0, minutes: 0, seconds: 0, expired: true,
  })

  useEffect(() => {
    if (!targetDate) return
    const target = new Date(targetDate).getTime()

    const tick = () => {
      const now = Date.now()
      const diff = target - now
      if (diff <= 0) {
        setRemaining({ days: 0, hours: 0, minutes: 0, seconds: 0, expired: true })
        return
      }
      setRemaining({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((diff / (1000 * 60)) % 60),
        seconds: Math.floor((diff / 1000) % 60),
        expired: false,
      })
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [targetDate])

  return remaining
}
