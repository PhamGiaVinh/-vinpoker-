import { addDays, localTodayDate } from "@/lib/dealerApp/clock";
import type { StaffAttendanceView, StaffProfileView, StaffSalaryView } from "@/types/staffApp";

const ATT_KEY = "vinpoker.staff.mockAttendance";

export function mockStaffMemberships(): StaffProfileView[] {
  return [
    {
      staffId: "staff-demo-floor",
      userId: "mock-user",
      clubId: "club-saigon",
      clubName: "VinPoker Sài Gòn",
      fullName: "Minh Anh",
      phone: "090 000 1122",
      department: "floor",
      employmentType: "full_time",
      monthlySalaryVnd: 18_000_000,
      standardHoursPerShift: 8,
      status: "active",
    },
    {
      staffId: "staff-demo-cashier",
      userId: "mock-user",
      clubId: "club-danang",
      clubName: "VinPoker Đà Nẵng",
      fullName: "Minh Anh",
      phone: "090 000 1122",
      department: "cashier",
      employmentType: "part_time",
      hourlyRateVnd: 55_000,
      standardHoursPerShift: 6,
      status: "active",
    },
  ];
}

function seedRows(staffId: string): StaffAttendanceView[] {
  const today = localTodayDate();
  const yesterday = addDays(today, -1);
  const twoDaysAgo = addDays(today, -2);
  return [
    {
      id: `${staffId}-seed-1`,
      staffId,
      shiftDate: yesterday,
      checkInTime: `${yesterday}T09:02:00+07:00`,
      checkOutTime: `${yesterday}T17:11:00+07:00`,
      status: "checked_out",
      totalWorkedMinutesToday: 489,
    },
    {
      id: `${staffId}-seed-2`,
      staffId,
      shiftDate: twoDaysAgo,
      checkInTime: `${twoDaysAgo}T10:01:00+07:00`,
      checkOutTime: `${twoDaysAgo}T16:05:00+07:00`,
      status: "checked_out",
      totalWorkedMinutesToday: 364,
    },
  ];
}

function readAll(): Record<string, StaffAttendanceView[]> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(ATT_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeAll(value: Record<string, StaffAttendanceView[]>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ATT_KEY, JSON.stringify(value));
}

export function readMockAttendance(staffId: string): StaffAttendanceView[] {
  const all = readAll();
  if (!all[staffId]) {
    all[staffId] = seedRows(staffId);
    writeAll(all);
  }
  return all[staffId].slice().sort((a, b) => b.checkInTime.localeCompare(a.checkInTime));
}

export function mockStaffCheckIn(staffId: string): StaffAttendanceView {
  const all = readAll();
  const rows = all[staffId] ?? seedRows(staffId);
  const open = rows.find((r) => r.status === "checked_in" && !r.checkOutTime);
  if (open) return open;

  const now = new Date();
  const row: StaffAttendanceView = {
    id: `${staffId}-${now.getTime()}`,
    staffId,
    shiftDate: localTodayDate(),
    checkInTime: now.toISOString(),
    checkOutTime: null,
    status: "checked_in",
    totalWorkedMinutesToday: null,
  };
  all[staffId] = [row, ...rows];
  writeAll(all);
  return row;
}

export function mockStaffCheckOut(staffId: string): StaffAttendanceView {
  const all = readAll();
  const rows = all[staffId] ?? seedRows(staffId);
  const openIndex = rows.findIndex((r) => r.status === "checked_in" && !r.checkOutTime);
  if (openIndex < 0) throw new Error("Không có ca đang mở để check-out.");

  const now = new Date();
  const open = rows[openIndex];
  const worked = Math.max(0, Math.min(1440, Math.round((now.getTime() - Date.parse(open.checkInTime)) / 60_000)));
  const updated: StaffAttendanceView = {
    ...open,
    checkOutTime: now.toISOString(),
    status: "checked_out",
    totalWorkedMinutesToday: worked,
  };
  rows[openIndex] = updated;
  all[staffId] = rows;
  writeAll(all);
  return updated;
}

export function readMockSalary(profile: StaffProfileView): StaffSalaryView {
  const isPartTime = profile.employmentType === "part_time";
  const rate = profile.hourlyRateVnd ?? 55_000;
  const accrued = isPartTime ? 495 : 0; // 8h 15p demo balance
  const today = localTodayDate();
  return {
    staffId: profile.staffId,
    employmentType: profile.employmentType,
    hourlyRateVnd: rate,
    accruedMinutes: accrued,
    balanceVnd: isPartTime ? Math.floor((accrued / 60) * rate) : 0,
    lastResetAt: null,
    currentShiftOpen: isPartTime,
    currentShiftStart: isPartTime ? new Date(Date.now() - accrued * 60_000).toISOString() : null,
    monthlySalaryVnd: profile.monthlySalaryVnd ?? null,
    recentPayments: isPartTime
      ? [
          {
            id: `${profile.staffId}-pay-1`,
            amountVnd: 2_000_000,
            minutesPaid: 1500,
            paidAt: `${addDays(today, -5)}T18:00:00+07:00`,
            coveredFrom: null,
            coveredTo: null,
            paymentMethod: "cash",
            paymentReference: null,
          },
          {
            id: `${profile.staffId}-pay-2`,
            amountVnd: 1_800_000,
            minutesPaid: 1350,
            paidAt: `${addDays(today, -12)}T18:00:00+07:00`,
            coveredFrom: null,
            coveredTo: null,
            paymentMethod: "bank",
            paymentReference: "VCB-0092",
          },
        ]
      : [],
  };
}
