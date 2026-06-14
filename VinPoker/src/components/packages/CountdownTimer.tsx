import { useCountdown } from '@/hooks/useCountdown'
import { useTranslation } from 'react-i18next'

interface Props {
  targetDate: string | null
  label: string
}

export default function CountdownTimer({ targetDate, label }: Props) {
  const { t } = useTranslation()
  const { days, hours, minutes, seconds, expired } = useCountdown(targetDate)

  if (!targetDate || expired) return null

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5 font-mono tabular-nums tracking-wider text-foreground">
        {days > 0 && (
          <>
            <span className="font-semibold text-emerald-400">{days}</span>
            <span className="text-muted-foreground">{t('countdown.days')}</span>
          </>
        )}
        <span className="font-semibold text-emerald-400">
          {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </span>
      </div>
    </div>
  )
}
