import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useTournamentPackages } from '@/hooks/useTournamentPackages'
import PackageCard from '@/components/packages/PackageCard'
import PackageCardSkeleton from '@/components/packages/PackageCardSkeleton'

export default function PackageListing() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { data: packages, isLoading, error } = useTournamentPackages()

  return (
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-6 md:pb-8">
      {/* Header */}
      <div className="mb-6 animate-fade-in">
        <h1 className="font-display text-3xl font-bold text-foreground">{t('packageListing.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('packageListing.subtitle')}
        </p>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <PackageCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t('packageListing.loadError')}
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && packages?.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <span className="material-symbols-outlined text-5xl text-muted-foreground/30">inventory_2</span>
          <p className="mt-3 text-sm text-muted-foreground">{t('packageListing.empty')}</p>
        </div>
      )}

      {/* List */}
      {!isLoading && packages && packages.length > 0 && (
        <div className="space-y-4">
          {packages.map((pkg, i) => (
            <PackageCard key={pkg.id} pkg={pkg} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}
