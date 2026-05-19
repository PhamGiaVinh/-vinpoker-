import { useCurrencyRates } from '@/hooks/useCurrencyRates'
import { Skeleton } from '@/components/ui/skeleton'

interface Props {
  amountVND: number
  className?: string
}

const formatVND = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + '₫'
const formatUSD = (n: number) => '$' + new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
const formatCNY = (n: number) => '¥' + new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
const formatKRW = (n: number) => new Intl.NumberFormat('ko-KR').format(n) + '₩'

export default function CurrencyDisplay({ amountVND, className = '' }: Props) {
  const { data: rates, isLoading } = useCurrencyRates()

  if (isLoading) {
    return (
      <div className={`space-y-1 ${className}`}>
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-4 w-36" />
      </div>
    )
  }

  const conversions: string[] = []
  if (rates) {
    if (rates.usd) conversions.push(formatUSD(amountVND / rates.usd))
    if (rates.cny) conversions.push(formatCNY(amountVND / rates.cny))
    if (rates.krw) conversions.push(formatKRW(amountVND / rates.krw))
  }

  return (
    <div className={`${className}`}>
      <div className="text-lg font-bold text-foreground">{formatVND(amountVND)}</div>
      {conversions.length > 0 && (
        <div className="text-xs text-muted-foreground">{conversions.join(' · ')}</div>
      )}
    </div>
  )
}
