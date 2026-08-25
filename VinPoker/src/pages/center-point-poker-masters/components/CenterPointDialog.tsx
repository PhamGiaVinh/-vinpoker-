import { CalendarDays, Crown, Newspaper, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type CenterPointEvent, type CenterPointNews, leaderboardGroups } from "../centerPointContent";

export type CenterPointDialogState =
  | { type: "registration"; event?: CenterPointEvent }
  | { type: "event"; event: CenterPointEvent }
  | { type: "gallery" }
  | { type: "leaderboard" }
  | { type: "news"; news: CenterPointNews };

type CenterPointDialogProps = { dialog: CenterPointDialogState | null; onClose: () => void };

function DialogAction({ onClose }: { onClose: () => void }) {
  return <Button className="cp-button cp-button--primary" type="button" onClick={() => { toast.success("Registration is a local demo—no data was submitted."); onClose(); }}>Continue to demo registration</Button>;
}

export function CenterPointDialog({ dialog, onClose }: CenterPointDialogProps) {
  const open = dialog !== null;
  const event = dialog?.type === "event" || dialog?.type === "registration" ? dialog.event : undefined;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="cp-dialog">
        {dialog?.type === "gallery" && <><DialogHeader><DialogTitle><Crown aria-hidden="true" />Champion gallery</DialogTitle><DialogDescription>A local Season 3 gallery preview, ready for future CMS-backed champions.</DialogDescription></DialogHeader><div className="cp-dialog__gallery"><div><b>01</b><span>Season 2 Champion</span><strong>Minh Khoa</strong></div><div><b>02</b><span>Season 1 Champion</span><strong>Thanh Tung</strong></div><div><b>03</b><span>High Roller Legend</span><strong>Hoang Nam</strong></div></div></>}
        {dialog?.type === "leaderboard" && <><DialogHeader><DialogTitle><Trophy aria-hidden="true" />Full leaderboard</DialogTitle><DialogDescription>Fixture standings for UI demonstration only; no live tournament data is queried.</DialogDescription></DialogHeader><ol className="cp-dialog__standings">{leaderboardGroups.main.map(([name, score], index) => <li key={name}><span>{index + 1}</span><strong>{name}</strong><em>{score}</em></li>)}</ol></>}
        {dialog?.type === "news" && <><DialogHeader><DialogTitle><Newspaper aria-hidden="true" />{dialog.news.title}</DialogTitle><DialogDescription>{dialog.news.date}</DialogDescription></DialogHeader><p className="cp-dialog__body">{dialog.news.summary}</p></>}
        {(dialog?.type === "event" || dialog?.type === "registration") && <><DialogHeader><DialogTitle><CalendarDays aria-hidden="true" />{event ? event.name : "Register for Season 3"}</DialogTitle><DialogDescription>{event ? event.category : "Interest registration"}</DialogDescription></DialogHeader><div className="cp-dialog__event-copy">{event ? <><strong>{event.priceLabel}</strong><span>{event.priceCaption} · {event.dateLabel} · {event.levelLabel}</span><p>{event.description}</p></> : <p>Choose an event from the Season 3 schedule. This public page is a visual demo: registration is not connected to payments, authentication, or any backend.</p>}</div></>}
        <DialogFooter className="cp-dialog__footer"><Button className="cp-button cp-button--secondary" type="button" onClick={onClose}>Close</Button>{(dialog?.type === "event" || dialog?.type === "registration") && <DialogAction onClose={onClose} />}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
