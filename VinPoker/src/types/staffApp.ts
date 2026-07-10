export type StaffDataSource = "mock" | "live";

export type StaffDepartment = "floor" | "cashier" | "tracker" | "service" | "security";
export type StaffEmploymentType = "full_time" | "part_time";
export type StaffAttendanceStatus = "checked_in" | "checked_out";

export interface StaffProfileView {
  staffId: string;
  userId: string | null;
  clubId: string;
  clubName: string;
  fullName: string;
  phone?: string | null;
  department: StaffDepartment;
  employmentType: StaffEmploymentType;
  monthlySalaryVnd?: number | null;
  hourlyRateVnd?: number | null;
  standardHoursPerShift?: number | null;
  status: string;
}

export interface StaffAttendanceView {
  id: string;
  staffId: string;
  shiftDate: string;
  checkInTime: string;
  checkOutTime?: string | null;
  status: StaffAttendanceStatus;
  totalWorkedMinutesToday?: number | null;
}

export const STAFF_DEPARTMENT_LABELS: Record<StaffDepartment, string> = {
  floor: "Floor",
  cashier: "Thu ngân",
  tracker: "Tracker",
  service: "Service",
  security: "Bảo an",
};

