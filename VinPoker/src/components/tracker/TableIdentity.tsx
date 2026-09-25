import './tableIdentity.css';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatViewerChipCompact } from '@/lib/tracker-poker/viewerAmounts';

export function TableLogo({ url }: { url?: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <div className="table-center-logo" aria-hidden="true">
    {url && failedUrl !== url ? <img src={url} alt="" onError={() => setFailedUrl(url)} /> : <span>VBacker</span>}
  </div>;
}

export function TableBlinds({ level, sb, bb, ante }: { level?: number | null; sb?: number | null; bb?: number | null; ante?: number | null }) {
  const { t } = useTranslation();
  if (bb == null || !Number.isFinite(bb) || bb <= 0 || sb == null || !Number.isFinite(sb) || sb < 0) return <span className="table-center-blinds">{t('tableAppearance.blindsUnavailable')}</span>;
  return <div className="table-center-blinds" data-testid="table-center-blinds">
    {level != null && level > 0 ? <span>{t('tableAppearance.level', { n: level })} · </span> : null}
    <strong>{formatViewerChipCompact(sb)}/{formatViewerChipCompact(bb)}</strong>
    {ante != null && <span> · Ante {formatViewerChipCompact(ante)}</span>}
  </div>;
}
