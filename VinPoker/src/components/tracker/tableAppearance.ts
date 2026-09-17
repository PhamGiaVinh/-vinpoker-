import type { CSSProperties } from 'react';

export interface TableAppearance { feltColor: string; railColor: string; logoUrl: string | null }
export const DEFAULT_TABLE_APPEARANCE: TableAppearance = { feltColor: '#143d32', railColor: '#a68b4c', logoUrl: null };
export const TABLE_COLOR_PRESETS = ['#143d32', '#521b23', '#15384c', '#292c32'] as const;
export const isTableColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export function tableAppearanceStyle(appearance: TableAppearance = DEFAULT_TABLE_APPEARANCE): CSSProperties {
  return {
    '--table-felt': isTableColor(appearance.feltColor) ? appearance.feltColor : DEFAULT_TABLE_APPEARANCE.feltColor,
    '--table-rail': isTableColor(appearance.railColor) ? appearance.railColor : DEFAULT_TABLE_APPEARANCE.railColor,
  } as CSSProperties;
}
