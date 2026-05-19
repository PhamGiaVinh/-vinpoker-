import { Link } from 'react-router-dom'
import { TournamentPackage } from '@/hooks/useTournamentPackages'
import CountdownTimer from './CountdownTimer'
import CurrencyDisplay from './CurrencyDisplay'
import BenefitGrid from './BenefitGrid'

interface Props {
  pkg: TournamentPackage
  index: number
}

const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max) + '…' : s)

export default function PackageCard({ pkg, index }: Props) {
  return (
    <Link
      to={`/packages/${pkg.id}`}
      className={`card-premium block animate-fade-in-up p-5 transition-all duration-300 hover:-translate-y-1 hover:border-emerald-500/30`}
      style={{ animationDelay: `${index * 100}ms` }}
    >
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold text-foreground">{pkg.name}</h3>
          {pkg.description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{truncate(pkg.description, 80)}</p>
          )}
        </div>
        {pkg.early_bird_end && (
          <span className="badge-early-bird shrink-0">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-white" />
            Early Bird
          </span>
        )}
      </div>

      {/* Tournaments */}
      {pkg.tournaments.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {pkg.tournaments.map((t) => (
            <span
              key={t.id}
              className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-foreground/70"
            >
              {t.name}
            </span>
          ))}
        </div>
      )}

      {/* Price */}
      <div className="mb-4 flex items-end gap-3">
        <CurrencyDisplay amountVND={pkg.price_vnd} />
        {pkg.original_price_vnd && pkg.original_price_vnd > pkg.price_vnd && (
          <span className="text-strikethrough pb-0.5 text-sm text-muted-foreground">
            {new Intl.NumberFormat('vi-VN').format(pkg.original_price_vnd)}₫
          </span>
        )}
      </div>

      {/* Benefits */}
      {pkg.benefits.length > 0 && (
        <BenefitGrid benefits={pkg.benefits} />
      )}

      {/* Early Bird countdown */}
      {pkg.early_bird_end && (
        <div className="mt-4 border-t border-white/10 pt-3">
          <CountdownTimer targetDate={pkg.early_bird_end} label="Kết thúc sau" />
        </div>
      )}
    </Link>
  )
}
