// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Mobile App — deterministic in-memory demo data (Phase 1 / flag OFF).
// Pure functions keyed off an explicit anchor date so the app is fully demoable
// with NO database and tests stay deterministic.
// ═══════════════════════════════════════════════════════════════════════════════

import type { CareerProgramView, DealerProfileView, DealerShiftView } from "@/types/dealerApp";
import { weekDates } from "./selectors";

const MOCK_DEALER_ID = "mock-dealer-001";
const MOCK_CLUB_ID = "mock-club-001";

function iso(date: string, time: string): string {
  return `${date}T${time}:00+07:00`;
}

export function mockDealerProfile(): DealerProfileView {
  return {
    dealerId: MOCK_DEALER_ID,
    userId: "mock-user-001",
    clubId: MOCK_CLUB_ID,
    clubName: "Grand Poker Club",
    fullName: "Nguyễn Thu Hà",
    tier: "B",
    status: "active",
    region: "VN",
    avatarUrl: null,
    isVerified: true,
  };
}

export function mockTodayShift(workDate: string): DealerShiftView {
  return {
    id: "mock-shift-today",
    dealerId: MOCK_DEALER_ID,
    clubId: MOCK_CLUB_ID,
    workDate,
    scheduledStartAt: iso(workDate, "11:00"),
    scheduledEndAt: iso(workDate, "19:00"),
    role: "Dealer",
    status: "confirmed",
    checkedInAt: null,
    checkedOutAt: null,
    gameType: "Baccarat",
    tableName: "Bàn B2",
    venueName: "Grand Poker Club",
    floorName: "Tầng 2",
  };
}

export function mockWeekShifts(anchorDate: string): DealerShiftView[] {
  const d = weekDates(anchorDate); // [Mon..Sun]
  const mk = (i: number, start: string, end: string, extra: Partial<DealerShiftView> = {}): DealerShiftView => ({
    id: `mock-wk-${i}`,
    dealerId: MOCK_DEALER_ID,
    clubId: MOCK_CLUB_ID,
    workDate: d[i],
    scheduledStartAt: iso(d[i], start),
    scheduledEndAt: iso(d[i], end),
    role: "Dealer",
    status: "published",
    checkedInAt: null,
    checkedOutAt: null,
    gameType: "Baccarat",
    tableName: "Bàn B2",
    venueName: "Grand Poker Club",
    floorName: "Tầng 2",
    ...extra,
  });
  // Mon off · Tue 11–19 · Wed 11–19 (confirmed) · Thu 16–00 (overnight) · Fri 11–19
  // · Sat 18–02 (overnight night shift) · Sun off
  return [
    mk(1, "11:00", "19:00"),
    mk(2, "11:00", "19:00", { status: "confirmed" }),
    mk(3, "16:00", "00:00", { gameType: "Poker", tableName: "Bàn P3" }),
    mk(4, "11:00", "19:00"),
    mk(5, "18:00", "02:00", { gameType: "Poker", tableName: "Bàn P1" }),
  ];
}

export function mockCareerPrograms(): CareerProgramView[] {
  return [
    {
      id: "rp1",
      kind: "job",
      title: "Tuyển Dealer Baccarat",
      subtitle: "Grand Poker Club · Tầng 2",
      region: "VN",
      location: "Hà Nội",
      gameTypes: ["Baccarat"],
      payRange: "18–25tr / tháng",
      status: "open",
      description: "Chia bài Baccarat, ca linh hoạt, có đào tạo.",
    },
    {
      id: "rp2",
      kind: "senior_upgrade",
      title: "Nâng cấp Senior Dealer",
      subtitle: "Lộ trình thăng tiến rõ ràng",
      status: "open",
      description: "Đánh giá kỹ năng + đào tạo nâng bậc lên Senior.",
    },
    {
      id: "rp3",
      kind: "tournament",
      title: "Đào tạo Tournament",
      subtitle: "Kỹ năng chia bài giải đấu",
      status: "open",
      description: "Khóa đào tạo dealer giải đấu (clock, color-up, redraw).",
    },
    {
      id: "rp4",
      kind: "job",
      title: "International Tournament Dealer",
      subtitle: "APT / WSOP Circuit · Asia",
      region: "Intl",
      location: "Asia",
      gameTypes: ["NLH", "PLO"],
      payRange: "Thỏa thuận",
      status: "open",
      description: "Cơ hội làm việc tại các giải quốc tế trong khu vực.",
    },
  ];
}
