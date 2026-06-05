export const formatVND = (n: number) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(n);

export const formatStack = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

const VN_TZ = "Asia/Ho_Chi_Minh";

export const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("vi-VN", {
    weekday: "short", day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit", timeZone: VN_TZ,
  });
};

const formatDateKey = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString("vi-VN", {
    weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: VN_TZ,
  });
};

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: VN_TZ });

export const formatShortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", timeZone: VN_TZ });

export const formatBuyInShort = (n: number) => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return Math.round(n / 1_000) + "K";
  return n.toString();
};
