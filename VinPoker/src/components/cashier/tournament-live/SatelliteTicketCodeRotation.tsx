import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const rpc = supabase.rpc as unknown as (name: string, args: Record<string, unknown>) =>
  Promise<{ data: unknown; error: { message: string } | null }>;

/** Owner-only server action. Rotating a secret does not change the serial or award. */
export function SatelliteTicketCodeRotation({ sourceTournamentId, serial, code, onRotated }: {
  sourceTournamentId: string; serial: number; code: string; onRotated: () => void;
}) {
  const attempt = useRef<string | null>(null);
  const lock = useRef(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rotate = async () => {
    const trimmed = reason.trim();
    if (lock.current || !confirmed || trimmed.length < 8 || trimmed.length > 240) return;
    lock.current = true; setBusy(true); setError(null);
    attempt.current ??= crypto.randomUUID();
    try {
      const { data, error: rpcError } = await rpc("satellite_rotate_ticket_code_v1", {
        p_source_tournament_id: sourceTournamentId, p_serial: serial,
        p_expected_code: code, p_reason: trimmed, p_request_id: attempt.current,
      });
      if (rpcError) throw rpcError;
      const result = data as { ok?: boolean; serial?: number; code?: string } | null;
      if (result?.ok !== true || result.serial !== serial || !result.code || result.code === code) {
        throw new Error("Server did not confirm a new code. Refresh the ticket ledger before retrying.");
      }
      setOpen(false); setConfirmed(false); setReason(""); attempt.current = null;
      onRotated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not replace code");
    } finally { lock.current = false; setBusy(false); }
  };

  return <div className="space-y-2 border-t border-border pt-2">
    {!open ? <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
      Replace private code
    </Button> : <>
      <p>Lost or misprinted ticket: invalidate the current code and issue a new one. Serial #{serial} and the prize obligation stay unchanged.</p>
      <Input aria-label={`Replacement reason for ticket ${serial}`} value={reason} maxLength={240}
        onChange={event => { setReason(event.target.value); setConfirmed(false); attempt.current = null; }}
        placeholder="Reason, at least 8 characters" />
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed}
        onChange={event => setConfirmed(event.target.checked)} />I checked the ticket is not yet redeemed and will securely deliver only the new code.</label>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="flex gap-2"><Button type="button" size="sm"
        disabled={busy || !confirmed || reason.trim().length < 8} onClick={() => void rotate()}>
        Invalidate old code + issue replacement
      </Button><Button type="button" size="sm" variant="ghost" disabled={busy}
        onClick={() => { setOpen(false); setError(null); }}>Cancel</Button></div>
    </>}
  </div>;
}
