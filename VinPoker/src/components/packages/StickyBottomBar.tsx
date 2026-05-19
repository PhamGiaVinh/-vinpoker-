import CurrencyDisplay from './CurrencyDisplay'
import CountdownTimer from './CountdownTimer'

interface Props {
  priceVND: number
  originalPriceVND: number | null
  earlyBirdEnd: string | null
  onRegister: () => void
}

export default function StickyBottomBar({ priceVND, originalPriceVND, earlyBirdEnd, onRegister }: Props) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-background/95 backdrop-blur-md md:hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <CurrencyDisplay amountVND={priceVND} className="!flex-row items-baseline gap-2" />
            {originalPriceVND && originalPriceVND > priceVND && (
              <span className="text-strikethrough text-sm text-muted-foreground">
                {new Intl.NumberFormat('vi-VN').format(originalPriceVND)}₫
              </span>
            )}
          </div>
          {earlyBirdEnd && (
            <CountdownTimer targetDate={earlyBirdEnd} label="" />
          )}
        </div>
        <button onClick={onRegister} className="btn-primary shrink-0 whitespace-nowrap">
          Đăng ký
        </button>
      </div>
    </div>
  )
}
