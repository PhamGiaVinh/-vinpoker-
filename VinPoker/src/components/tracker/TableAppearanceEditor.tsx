import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Palette, Upload, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { compressImage } from '@/lib/compressImage';
import { SpectatorMiniTable } from '@/components/cashier/tournament-live/viewer-hub/SpectatorMiniTable';
import type { PublicTableSnapshot } from '@/components/cashier/tournament-live/viewer-hub/publicSnapshotTypes';
import { DEFAULT_TABLE_APPEARANCE, TABLE_COLOR_PRESETS, type TableAppearance } from './tableAppearance';
import { tableAppearanceKey, useTournamentTableAppearance } from './useTournamentTableAppearance';

export function TableAppearanceForm({ initial, onSave, onUpload }: { initial: TableAppearance; onSave: (value: TableAppearance) => Promise<void>; onUpload: (file: File) => Promise<string> }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const preview: PublicTableSnapshot = { tableId: 'preview', tableSessionId: null, handId: 'preview', handNumber: 1, name: t('tableAppearance.preview'), buttonSeat: 1,
    street: 'flop', board: ['AS', 'TH', '7C'], pot: 7500, smallBlind: 500, bigBlind: 1000, levelNumber: 8, ante: 1000, trackerState: 'live',
    players: Array.from({ length: 9 }, (_, i) => ({ entryId: null, playerId: `preview-${i}`, entryNumber: 1, seatNumber: i + 1,
      name: t('liveHub.seat', { n: i + 1 }), avatarUrl: null, stack: 40000, holeCards: i === 7 ? ['AH', 'AD'] : [], isFolded: i === 2 || i === 5, isAllIn: false })) };
  const upload = async (file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) { toast.error(t('tableAppearance.fileHelp')); return; }
    setBusy(true);
    try { const logoUrl = await onUpload(file); setDraft(value => ({ ...value, logoUrl })); }
    catch { toast.error(t('tableAppearance.uploadError')); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const save = async () => {
    setBusy(true);
    try { await onSave(draft); }
    catch { toast.error(t('tableAppearance.saveError')); }
    finally { setBusy(false); }
  };
  return <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(230px,0.7fr)_minmax(0,1.3fr)]">
    <fieldset disabled={busy} className="min-w-0 space-y-5">
      <p className="text-sm text-muted-foreground">{t('tableAppearance.description')}</p>
      <div className="space-y-2"><label htmlFor="table-felt-color" className="text-sm font-semibold">{t('tableAppearance.feltColor')}</label>
        <div className="flex flex-wrap gap-2">{TABLE_COLOR_PRESETS.map(color => <button type="button" key={color} aria-label={`${t('tableAppearance.feltColor')} ${color}`} aria-pressed={draft.feltColor === color} onClick={() => setDraft({ ...draft, feltColor: color })} className="h-11 w-11 rounded-lg border-2 border-white/30 aria-pressed:ring-2 aria-pressed:ring-primary aria-pressed:ring-offset-2 aria-pressed:ring-offset-background focus-visible:outline focus-visible:outline-2" style={{ backgroundColor: color }} />)}</div>
        <input id="table-felt-color" type="color" value={draft.feltColor} onChange={e => setDraft({ ...draft, feltColor: e.target.value })} className="h-11 w-full cursor-pointer rounded-md border border-border bg-background p-1" />
      </div>
      <div className="space-y-2"><label htmlFor="table-rail-color" className="text-sm font-semibold">{t('tableAppearance.railColor')}</label><input id="table-rail-color" type="color" value={draft.railColor} onChange={e => setDraft({ ...draft, railColor: e.target.value })} className="h-11 w-full cursor-pointer rounded-md border border-border bg-background p-1" /></div>
      <div className="space-y-2"><p className="text-sm font-semibold">{t('tableAppearance.logo')}</p><input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-label={t('tableAppearance.uploadLogo')} onChange={e => void upload(e.target.files?.[0])} />
        <Button type="button" variant="outline" className="min-h-11 w-full gap-2" onClick={() => input.current?.click()}><Upload className="h-4 w-4" />{t('tableAppearance.uploadLogo')}</Button>
        <p className="text-xs text-muted-foreground">{t('tableAppearance.fileHelp')}</p>
        {draft.logoUrl && <Button type="button" variant="ghost" className="min-h-11" onClick={() => setDraft({ ...draft, logoUrl: null })}>{t('tableAppearance.removeLogo')}</Button>}
      </div>
      <Button type="button" variant="ghost" className="min-h-11 gap-2" onClick={() => setDraft(DEFAULT_TABLE_APPEARANCE)}><RotateCcw className="h-4 w-4" />{t('tableAppearance.reset')}</Button>
    </fieldset>
    <div className="min-w-0 space-y-3"><div><h3 className="font-semibold">{t('tableAppearance.preview')}</h3><p className="text-xs text-muted-foreground">{t('tableAppearance.previewNote')}</p></div><div className="rounded-xl border border-border bg-black/30 p-2 [container-type:inline-size]"><SpectatorMiniTable table={preview} appearance={draft} /></div></div>
    <div className="flex justify-end border-t border-border pt-4 md:col-span-2"><Button type="button" disabled={busy} className="min-h-11 px-6" onClick={() => void save()}>{t(busy ? 'tableAppearance.saving' : 'tableAppearance.save')}</Button></div>
  </div>;
}

export function TableAppearanceEditor({ tournamentId }: { tournamentId: string }) {
  const { t } = useTranslation();
  const { user, isClubOwner, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const query = useTournamentTableAppearance(tournamentId);
  const cache = useQueryClient();
  if (!isClubOwner && !isAdmin) return null;
  const save = async (value: TableAppearance) => {
    const { data, error } = await supabase.from('tournament_table_appearance' as never).upsert({ tournament_id: tournamentId, felt_color: value.feltColor, rail_color: value.railColor, logo_url: value.logoUrl } as never).select('tournament_id').single();
    if (error || !data) throw error ?? new Error('No saved row');
    await cache.invalidateQueries({ queryKey: tableAppearanceKey(tournamentId) });
    toast.success(t('tableAppearance.saved')); setOpen(false);
  };
  const upload = async (raw: File) => {
    if (!user) throw new Error('Authentication required');
    const file = await compressImage(raw, { maxEdge: 512, quality: .9 });
    const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${user.id}/table-logo/${tournamentId}/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from('backing-proofs').upload(path, file, { upsert: false, contentType: file.type });
    if (error) throw error;
    return supabase.storage.from('backing-proofs').getPublicUrl(path).data.publicUrl;
  };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="outline" className="min-h-11 gap-2"><Palette className="h-4 w-4" />{t('tableAppearance.title')}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>{t('tableAppearance.title')}</DialogTitle></DialogHeader>
      {query.isLoading ? <p role="status">{t('tableAppearance.loading')}</p> : query.isError ? <div role="alert"><p>{t('tableAppearance.loadError')}</p><Button variant="outline" className="mt-3 min-h-11" onClick={() => void query.refetch()}>{t('tableAppearance.retry')}</Button></div> : <TableAppearanceForm key={tournamentId} initial={query.data ?? DEFAULT_TABLE_APPEARANCE} onSave={save} onUpload={upload} />}
    </DialogContent></Dialog>;
}
