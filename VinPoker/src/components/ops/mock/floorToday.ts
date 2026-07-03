// DỮ LIỆU MẪU (mock) for the mobileOpsV2 "Floor hôm nay" prototype. NO Supabase / RPC / network.
// Fictional names + example amounts only — never real player data. Used only when FEATURES.mobileOpsV2
// is previewed; nothing here reaches production while the flag is OFF.

export interface MockTournament {
  name: string;
  status: string;
  level: number;
  blinds: string;
  ante: string;
  remaining: number;
  total: number;
  avgStack: string;
  timeToBreak: string;
}

export interface MockAlert {
  id: string;
  icon: string;
  subject: string;
  status: "todo" | "late" | "provisional";
}

export interface MockTableCounts {
  running: number;
  open: number;
  paused: number;
  closed: number;
}

export const MOCK_TOURNAMENT: MockTournament = {
  name: "HSOP Main Event",
  status: "Đang chạy",
  level: 12,
  blinds: "5.000/10.000",
  ante: "10.000",
  remaining: 84,
  total: 210,
  avgStack: "42.000",
  timeToBreak: "14:32",
};

export const MOCK_TABLE_COUNTS: MockTableCounts = { running: 12, open: 3, paused: 1, closed: 0 };

export const MOCK_NEXT_TASK = {
  severity: "warning" as const,
  title: "Bàn 7 cần bốc lại (final table)",
  context: "9 → 8 người · đảo ghế toàn giải",
};

export const MOCK_ALERTS: MockAlert[] = [
  { id: "a1", icon: "⚠", subject: "Bàn 12 · thiếu dealer", status: "late" },
  { id: "a2", icon: "•", subject: "Ghế 3/Bàn 5 · late reg", status: "todo" },
  { id: "a3", icon: "•", subject: "Lệch đối soát quầy", status: "provisional" },
];

export const MOCK_LAST_UPDATED = "14:30";
