"use client";

// Chuan hoa URL phia client (bam sat ham _mkt_normalize_url ben SQL) —
// chi de HIEN THI/canh bao som; chot chan trung that su nam o database.
const DROP = new Set(["utm_source","utm_medium","utm_campaign","utm_content","utm_term",
  "fbclid","gclid","mc_cid","mc_eid","mibextid","igshid","si","feature"]);

export function normalizeMarketingUrl(raw) {
  let u = (raw || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    const url = new URL(u);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const keep = [];
    for (const [k, v] of url.searchParams.entries()) if (!DROP.has(k.toLowerCase())) keep.push([k, v]);
    keep.sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
    let path = url.pathname.replace(/\/+$/, "");
    const qs = keep.map(([k, v]) => `${k}=${v}`).join("&");
    return `https://${url.hostname}${path}${qs ? "?" + qs : ""}`;
  } catch { return u.replace(/\/+$/, ""); }
}

export const KPI_TYPE_LABEL = { social_post: "Bài viết", short_video: "Video ngắn", test_drive: "Lái thử", share: "Chia sẻ", custom: "Tùy chỉnh" };
export const NEED_LABEL = { cold: "Tham khảo", warm: "Có nhu cầu", hot: "Nhu cầu cao" };
export const RESULT_LABEL = { undecided: "Chưa quyết định", interested: "Có quan tâm", follow_up: "Cần chăm sóc", quotation_sent: "Đã gửi báo giá", deposit: "Đã đặt cọc", purchased: "Đã mua xe", no_longer_interested: "Không còn nhu cầu" };
export const SUB_STATUS = {
  draft: { label: "Nháp", tone: "dark" }, submitted: { label: "Chờ duyệt", tone: "amber" },
  needs_revision: { label: "Cần bổ sung", tone: "purple" }, approved: { label: "Đã duyệt", tone: "green" },
  rejected: { label: "Từ chối", tone: "red" }, cancelled: { label: "Đã hủy", tone: "dark" },
};
export const CAMP_STATUS = {
  draft: { label: "Nháp", tone: "dark" }, scheduled: { label: "Lên lịch", tone: "blue" },
  active: { label: "Đang chạy", tone: "green" }, ended: { label: "Kết thúc", tone: "amber" },
  completed: { label: "Hoàn thành", tone: "green" }, cancelled: { label: "Đã hủy", tone: "red" },
};
export const PART_LABEL = { required: "Bắt buộc", encouraged: "Khuyến khích", exempted: "Được miễn" };
