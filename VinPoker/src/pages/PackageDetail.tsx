import { useParams, useNavigate } from 'react-router-dom'
import { useTournamentPackage } from '@/hooks/useTournamentPackages'
import CountdownTimer from '@/components/packages/CountdownTimer'
import CurrencyDisplay from '@/components/packages/CurrencyDisplay'
import BenefitGrid from '@/components/packages/BenefitGrid'
import TournamentListItem from '@/components/packages/TournamentListItem'
import StickyBottomBar from '@/components/packages/StickyBottomBar'
import { Skeleton } from '@/components/ui/skeleton'

export default function PackageDetail() {
  const { packageId } = useParams<{ packageId: string }>()
  const navigate = useNavigate()
  const { data: pkg, isLoading, error } = useTournamentPackage(packageId)

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 pb-24 pt-6 md:pb-8">
        <Skeleton className="mb-4 h-6 w-20" />
        <Skeleton className="mb-6 h-8 w-3/5" />
        <Skeleton className="mb-4 h-5 w-1/3" />
        <div className="space-y-3">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      </div>
    )
  }

  if (error || !pkg) {
    return (
      <div className="mx-auto max-w-4xl px-4 pb-24 pt-6 md:pb-8">
        <button
          onClick={() => navigate('/packages')}
          className="mb-4 flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Quay lại
        </button>
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Không tìm thấy gói giải đấu.
        </div>
      </div>
    )
  }

  const handleRegister = () => {
    navigate(`/packages/${pkg.id}/register`)
  }

  return (
    <>
      <div className="mx-auto max-w-4xl px-4 pb-28 pt-6 md:pb-8">
        {/* Back button */}
        <button
          onClick={() => navigate('/packages')}
          className="mb-4 flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Quay lại
        </button>

        {/* Hero */}
        <div className="animate-fade-in">
          <div className="mb-2 flex items-center gap-3">
            <h1 className="font-display text-2xl font-bold text-foreground md:text-3xl">{pkg.name}</h1>
            {pkg.early_bird_end && (
              <span className="badge-early-bird">
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-white" />
                Early Bird
              </span>
            )}
          </div>
          {pkg.description && (
            <p className="mb-6 text-sm text-muted-foreground">{pkg.description}</p>
          )}
        </div>

        {/* Price section */}
        <div className="card-premium mb-6 animate-fade-in-up p-5" style={{ animationDelay: '100ms' }}>
          <div className="flex items-baseline gap-3">
            <CurrencyDisplay amountVND={pkg.price_vnd} />
            {pkg.original_price_vnd && pkg.original_price_vnd > pkg.price_vnd && (
              <span className="text-strikethrough text-muted-foreground">
                {new Intl.NumberFormat('vi-VN').format(pkg.original_price_vnd)}₫
              </span>
            )}
          </div>

          {pkg.early_bird_end && (
            <div className="mt-3">
              <CountdownTimer targetDate={pkg.early_bird_end} label="Giá Early Bird kết thúc sau" />
            </div>
          )}

          <button onClick={handleRegister} className="btn-primary mt-4 hidden w-full md:inline-flex">
            Đăng ký ngay
          </button>
        </div>

        {/* Benefits */}
        {pkg.benefits.length > 0 && (
          <div className="card-premium mb-6 animate-fade-in-up p-5" style={{ animationDelay: '200ms' }}>
            <h2 className="mb-3 text-base font-semibold text-foreground">Quyền lợi</h2>
            <BenefitGrid benefits={pkg.benefits} />
          </div>
        )}

        {/* Tournaments */}
        {pkg.tournaments.length > 0 && (
          <div className="card-premium animate-fade-in-up p-5" style={{ animationDelay: '300ms' }}>
            <h2 className="mb-3 text-base font-semibold text-foreground">Giải đấu bao gồm</h2>
            <div className="space-y-1.5">
              {pkg.tournaments.map((t) => (
                <TournamentListItem key={t.id} tournament={t} />
              ))}
            </div>
          </div>
        )}

        {/* Registration info */}
        <div className="mt-6 flex items-center gap-4 text-xs text-muted-foreground">
          {pkg.max_participants && (
            <span>
              Đã đăng ký: {pkg.registered_count} / {pkg.max_participants}
            </span>
          )}
        </div>
      </div>

      {/* Mobile sticky bottom bar */}
      <StickyBottomBar
        priceVND={pkg.price_vnd}
        originalPriceVND={pkg.original_price_vnd}
        earlyBirdEnd={pkg.early_bird_end}
        onRegister={handleRegister}
      />
    </>
  )
}
