interface Props {
  benefits: { icon: string; label: string }[]
}

export default function BenefitGrid({ benefits }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {benefits.map((b, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-foreground/80">
          <span className="material-symbols-outlined text-base text-emerald-400">{b.icon}</span>
          <span>{b.label}</span>
        </div>
      ))}
    </div>
  )
}
