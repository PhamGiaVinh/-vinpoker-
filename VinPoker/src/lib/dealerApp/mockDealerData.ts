// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Mobile App — deterministic in-memory demo data (Phase 1 / flag OFF).
// Pure functions keyed off an explicit anchor date so the app is fully demoable
// with NO database and tests stay deterministic.
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  CareerApplicationView,
  CareerProgramView,
  CareerSessionView,
  DealerDirectoryRow,
  DealerProfileView,
  DealerShiftView,
} from "@/types/dealerApp";
import { weekDates } from "./selectors";
import { addDays } from "./clock";

const MOCK_DEALER_ID = "mock-dealer-001";
const MOCK_DEALER_ID_2 = "mock-dealer-002";

function iso(date: string, time: string): string {
  return `${date}T${time}:00+07:00`;
}

// Two demo memberships for ONE user (multi-club): a dealer of both Grand Poker
// Club and VinPoker Club, so the club switcher + per-club schedule are demoable.
interface ClubMock {
  dealerId: string;
  clubId: string;
  clubName: string;
  floor: string;
  tier: string;
}
const CLUBS: ClubMock[] = [
  { dealerId: MOCK_DEALER_ID, clubId: "mock-club-001", clubName: "Grand Poker Club", floor: "Tầng 2", tier: "B" },
  { dealerId: MOCK_DEALER_ID_2, clubId: "mock-club-002", clubName: "VinPoker Club", floor: "Tầng 1", tier: "A" },
];
function clubOf(dealerId?: string): ClubMock {
  return CLUBS.find((c) => c.dealerId === dealerId) ?? CLUBS[0];
}

/** All dealer memberships linked to the current (mock) user — one row per club. */
export function mockDealerMemberships(): DealerProfileView[] {
  return CLUBS.map((c) => ({
    dealerId: c.dealerId,
    userId: "mock-user-001",
    clubId: c.clubId,
    clubName: c.clubName,
    fullName: "Nguyễn Thu Hà",
    tier: c.tier,
    status: "active",
    region: "VN",
    avatarUrl: null,
    isVerified: true,
  }));
}

/** Back-compat single-membership accessor (first club). */
export function mockDealerProfile(): DealerProfileView {
  return mockDealerMemberships()[0];
}

export function mockTodayShift(workDate: string, dealerId?: string): DealerShiftView {
  const c = clubOf(dealerId);
  const second = c.dealerId === MOCK_DEALER_ID_2;
  return {
    id: `mock-shift-today-${c.dealerId}`,
    dealerId: c.dealerId,
    clubId: c.clubId,
    workDate,
    scheduledStartAt: iso(workDate, second ? "16:00" : "11:00"),
    scheduledEndAt: iso(workDate, second ? "00:00" : "19:00"),
    role: "Dealer",
    status: second ? "published" : "confirmed",
    checkedInAt: null,
    checkedOutAt: null,
    gameType: second ? "Poker" : "Baccarat",
    tableName: second ? "Bàn P1" : "Bàn B2",
    venueName: c.clubName,
    floorName: c.floor,
  };
}

export function mockWeekShifts(anchorDate: string, dealerId?: string): DealerShiftView[] {
  const c = clubOf(dealerId);
  const second = c.dealerId === MOCK_DEALER_ID_2;
  const d = weekDates(anchorDate); // [Mon..Sun]
  const mk = (i: number, start: string, end: string, extra: Partial<DealerShiftView> = {}): DealerShiftView => ({
    id: `mock-wk-${c.dealerId}-${i}`,
    dealerId: c.dealerId,
    clubId: c.clubId,
    workDate: d[i],
    scheduledStartAt: iso(d[i], start),
    scheduledEndAt: iso(d[i], end),
    role: "Dealer",
    status: "published",
    checkedInAt: null,
    checkedOutAt: null,
    gameType: second ? "Poker" : "Baccarat",
    tableName: second ? "Bàn P1" : "Bàn B2",
    venueName: c.clubName,
    floorName: c.floor,
    ...extra,
  });
  if (second) {
    // VinPoker Club: lighter evening pattern (Mon / Wed / Fri).
    return [
      mk(0, "16:00", "00:00"),
      mk(2, "16:00", "00:00", { status: "confirmed" }),
      mk(4, "18:00", "02:00"),
    ];
  }
  // Grand Poker Club: Tue 11–19 · Wed 11–19 (confirmed) · Thu 16–00 (overnight)
  // · Fri 11–19 · Sat 18–02 (overnight night shift).
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
      description: "Chia bài Baccarat tại sàn, ca linh hoạt, có đào tạo nội bộ.",
      requirements: ["Kinh nghiệm chia bài ≥ 6 tháng", "Giao tiếp tốt", "Chấp nhận ca xoay"],
    },
    {
      id: "rp2",
      kind: "senior_upgrade",
      title: "Nâng cấp Senior Dealer",
      subtitle: "Lộ trình thăng tiến rõ ràng",
      status: "open",
      description: "Đánh giá kỹ năng + đào tạo nâng bậc lên Senior Dealer.",
      requirements: ["Đang là dealer chính thức", "Đạt đánh giá kỹ năng ≥ 80%"],
    },
    {
      id: "rp3",
      kind: "tournament",
      title: "Đào tạo Tournament",
      subtitle: "Kỹ năng chia bài giải đấu",
      status: "open",
      description: "Khóa đào tạo dealer giải đấu: clock, color-up, redraw, payout.",
      requirements: ["Mở cho mọi dealer", "Cam kết hoàn thành khóa"],
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
      description: "Cơ hội làm việc tại các giải quốc tế trong khu vực châu Á.",
      requirements: ["English communication", "Tournament dealing certificate a plus", "Willing to travel"],
    },
  ];
}

export function mockApplications(anchorDate: string): CareerApplicationView[] {
  return [
    {
      id: "app1",
      programId: "rp3",
      programTitle: "Đào tạo Tournament",
      kind: "tournament",
      status: "interview",
      createdAt: `${addDays(anchorDate, -5)}T09:30:00+07:00`,
      note: "Mong muốn học chia bài giải đấu.",
    },
    {
      id: "app2",
      programId: "rp2",
      programTitle: "Nâng cấp Senior Dealer",
      kind: "senior_upgrade",
      status: "screening",
      createdAt: `${addDays(anchorDate, -12)}T14:00:00+07:00`,
    },
  ];
}

export function mockTrainingSessions(anchorDate: string): CareerSessionView[] {
  return [
    {
      id: "s1",
      kind: "interview",
      title: "Phỏng vấn — Đào tạo Tournament",
      scheduledAt: `${addDays(anchorDate, 2)}T15:00:00+07:00`,
      mode: "online",
      joinUrl: "https://meet.example.com/vbk-td",
      status: "scheduled",
      programTitle: "Đào tạo Tournament",
    },
    {
      id: "s2",
      kind: "training",
      title: "Buổi 1 — Kỹ năng chia bài giải đấu",
      scheduledAt: `${addDays(anchorDate, 5)}T18:00:00+07:00`,
      mode: "onsite",
      location: "Grand Poker Club · Tầng 2",
      status: "scheduled",
      programTitle: "Đào tạo Tournament",
    },
    {
      id: "s3",
      kind: "training",
      title: "Buổi định hướng Senior Dealer",
      scheduledAt: `${addDays(anchorDate, -3)}T10:00:00+07:00`,
      mode: "onsite",
      location: "Grand Poker Club",
      status: "done",
      programTitle: "Nâng cấp Senior Dealer",
    },
  ];
}

/** Staff "invite dealer to app" directory (mock). */
export function mockUnlinkedDealers(): DealerDirectoryRow[] {
  return [
    { id: "d1", fullName: "Trần Văn Minh", phone: "09xx xxx 101", region: "VN", status: "active", linked: false },
    { id: "d2", fullName: "Lê Thị Hồng", phone: "09xx xxx 202", region: "VN", status: "active", linked: false },
    { id: "d3", fullName: "Somchai P.", phone: "+66 xx xxx 303", region: "TH", status: "active", linked: true },
    { id: "d4", fullName: "Nguyễn Thu Hà", phone: "09xx xxx 404", region: "VN", status: "active", linked: true },
  ];
}
