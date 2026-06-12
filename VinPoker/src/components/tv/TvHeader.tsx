import type { TvData } from "@/types/tv";
import { TvStatusBadge } from "./TvStatusBadge";

export function TvHeader({ data }: { data: TvData }) {
  return (
    <header className="flex h-[10vh] shrink-0 items-center justify-between gap-[2vmin] border-b border-border/60 px-[3vmin]">
      <div className="flex min-w-0 flex-1 items-center gap-[1.5vmin]">
        {data.clubLogoUrl ? (
          <img src={data.clubLogoUrl} alt="" className="h-[6vh] w-auto object-contain" />
        ) : null}
        <span className="truncate text-[2.4vmin] font-semibold text-muted-foreground">
          {data.clubName}
        </span>
      </div>

      <h1 className="min-w-0 flex-[2] truncate text-center text-[3.2vmin] font-bold uppercase tracking-wide text-foreground">
        {data.tournamentName}
      </h1>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-[1.5vmin]">
        {data.eventNote ? (
          <span className="truncate text-[2vmin] text-muted-foreground">{data.eventNote}</span>
        ) : null}
        <TvStatusBadge data={data} />
      </div>
    </header>
  );
}
