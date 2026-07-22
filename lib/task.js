"use client";

export const TASK_STATUS = {
  not_started:    { label: "Chưa thực hiện", tone: "dark",   short: "Chưa làm" },
  in_progress:    { label: "Đang thực hiện", tone: "blue",   short: "Đang làm" },
  pending_review: { label: "Chờ xác nhận",   tone: "amber",  short: "Chờ duyệt" },
  needs_revision: { label: "Cần bổ sung",    tone: "purple", short: "Cần bổ sung" },
  completed:      { label: "Đã hoàn thành",  tone: "green",  short: "Xong" },
  cancelled:      { label: "Đã hủy",         tone: "red",    short: "Hủy" },
};

export const PRIORITY = {
  "Thấp":        { tone: "dark",  icon: "○" },
  "Bình thường": { tone: "blue",  icon: "◔" },
  "Cao":         { tone: "amber", icon: "◕" },
  "Khẩn cấp":    { tone: "red",   icon: "●" },
};

// Nhãn thời gian: "Quá hạn 2 ngày" / "Còn 3 giờ" / "Hạn hôm nay"
export function hanLabel(due_at, status) {
  if (["completed", "cancelled"].includes(status)) return null;
  const ms = new Date(due_at) - new Date();
  const gio = ms / 3600000;
  if (gio < 0) {
    const q = Math.abs(gio);
    return { text: q < 24 ? `Quá hạn ${Math.round(q)} giờ` : `Quá hạn ${Math.round(q / 24)} ngày`, tone: "red", overdue: true };
  }
  if (gio < 1) return { text: `Còn ${Math.round(gio * 60)} phút`, tone: "red", overdue: false };
  if (gio < 24) return { text: `Còn ${Math.round(gio)} giờ`, tone: "amber", overdue: false };
  if (gio < 48) return { text: "Còn 1 ngày", tone: "amber", overdue: false };
  return { text: `Còn ${Math.round(gio / 24)} ngày`, tone: "dark", overdue: false };
}

// Thứ tự ưu tiên hiển thị (mục XIV của spec)
export function sortTasks(list) {
  const rank = (t) => {
    const h = hanLabel(t.due_at, t.status);
    if (h?.overdue) return 1;
    if (t.priority === "Khẩn cấp") return 2;
    if (t.status === "needs_revision") return 3;
    if (h && h.tone === "red") return 4;      // đến hạn hôm nay
    if (h && h.tone === "amber") return 5;    // sắp đến hạn
    if (t.status === "in_progress") return 6;
    if (t.status === "not_started") return 7;
    return 8;
  };
  return [...list].sort((a, b) => rank(a) - rank(b) || new Date(a.due_at) - new Date(b.due_at));
}

export const fmtHan = (d) => {
  const x = new Date(d);
  return x.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
};

// Chuyển datetime-local <-> ISO
export const toLocalInput = (d) => {
  const x = new Date(d);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
