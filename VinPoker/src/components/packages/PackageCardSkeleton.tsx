import { Skeleton } from '@/components/ui/skeleton'

export default function PackageCardSkeleton() {
  return (
    <div className="card-premium p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-3/5" />
          <Skeleton className="h-4 w-4/5" />
        </div>
        <Skeleton className="h-6 w-24 shrink-0 rounded-full" />
      </div>
      <div className="mb-4 flex gap-1.5">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <div className="mb-4 space-y-1">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-8 rounded-lg" />
        <Skeleton className="h-8 rounded-lg" />
        <Skeleton className="h-8 rounded-lg" />
        <Skeleton className="h-8 rounded-lg" />
      </div>
    </div>
  )
}
