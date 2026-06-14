import { Link } from 'react-router-dom'

interface Props {
  tournament: { id: string; name: string }
}

export default function TournamentListItem({ tournament }: Props) {
  return (
    <Link
      to={`/tournaments/${tournament.id}`}
      className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-white/10"
    >
      <span className="material-symbols-outlined text-base text-success">stadia_controller</span>
      <span>{tournament.name}</span>
      <span className="material-symbols-outlined ml-auto text-base text-muted-foreground">chevron_right</span>
    </Link>
  )
}
