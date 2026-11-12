// Phan quyen nhap / xuat Excel theo vai tro (role_perms). AppShell nap quyen vao window.__mkQuyen.
// Day la lop chan o giao dien: an nut va chan thao tac tai file; du lieu tren man hinh van theo quyen xem cua tung trang.
export const EXCEL_PERMS = [
  { key: "excel_xuat_ban_hang", label: "Xuất Excel — nhóm Bán hàng", desc: "Khách hàng, Đơn bán, Đơn bán buôn, Khách buôn (sao kê), Cơ hội, Chăm sóc, Đặt cọc" },
  { key: "excel_xuat_kho", label: "Xuất Excel — nhóm Kho & Nhập xe", desc: "Tồn kho xe, Đơn nhập xe, Điều chuyển, Điều chỉnh, Kiểm kê, Kho phụ tùng, Hàng hóa, Danh mục xe, Giấy COC, Lịch sử" },
  { key: "excel_xuat_tai_chinh", label: "Xuất Excel — nhóm Tài chính & Báo cáo", desc: "Phiếu thu/chi, Sổ quỹ, Công nợ, Lãi gộp, Giải ngân, Báo cáo" },
  { key: "excel_xuat_khac", label: "Xuất Excel — Dịch vụ, Công việc và các trang khác", desc: "Lệnh sửa chữa, Báo cáo LSC, Việc đội nhóm…" },
  { key: "excel_nhap", label: "Nhập dữ liệu hàng loạt từ file Excel", desc: "Danh mục xe/phụ tùng/hàng hóa/công việc, tồn kho, điều chỉnh tồn, đơn đặt hàng nhập… (vẫn cần quyền nghiệp vụ tương ứng)" },
];
const NHOM = {
  ban_hang: ["/khach-hang", "/don-ban", "/ban-buon", "/khach-buon", "/co-hoi", "/cham-soc", "/viec-cham-soc", "/dat-coc", "/lai-thu", "/khuyen-mai", "/ban-hang"],
  kho: ["/tra-cuu", "/ton-tong-hop", "/kiem-soat-ton", "/ton-ky-gui", "/nhap-hang", "/dat-hang-nhap", "/dieu-chuyen", "/dieu-chinh", "/kiem-ke", "/phu-tung", "/hang-hoa", "/lich-su", "/giay-coc", "/quet-gom", "/kho", "/danh-muc-xe", "/nha-cung-cap"],
  tai_chinh: ["/phieu-thu", "/phieu-chi", "/thu-chi", "/cong-no", "/lai-gop", "/giai-ngan", "/bao-cao", "/doi-soat", "/claim-hang", "/dich-vu-ngoai", "/giu-ho-phap-nhan", "/chi-tieu"],
};
export function nhomExcelCuaTrang(path) {
  const p = String(path || "");
  for (const [k, ds] of Object.entries(NHOM)) if (ds.some((h) => p === h || p.startsWith(h + "/"))) return k;
  return "khac";
}
// loai: "xuat" | "nhap"
export function coQuyenExcel(loai, path) {
  if (typeof window === "undefined") return true;
  const q = window.__mkQuyen;
  if (!q) return false;               // chua nap quyen -> chua cho
  if (q.role === "CEO") return true;
  if (loai === "nhap") return !!q.perms.excel_nhap;
  return !!q.perms["excel_xuat_" + nhomExcelCuaTrang(path ?? window.location.pathname)];
}
export function baoKhongCoQuyenExcel(loai) {
  const m = loai === "nhap" ? "Bạn chưa được cấp quyền NHẬP dữ liệu từ Excel. Liên hệ Ban giám đốc để được cấp ở Quản trị › Phân quyền." : "Bạn chưa được cấp quyền XUẤT Excel ở trang này. Liên hệ Ban giám đốc để được cấp ở Quản trị › Phân quyền.";
  if (typeof window !== "undefined") window.alert(m);
  return m;
}
// Nut nao la nut xuat / nhap Excel (de an khi khong co quyen)
export const RE_NUT_XUAT = /Xuất (Excel|file|dữ liệu|sao kê|biên bản)|⬇\s*Excel|Excel\s*⬇|Tải dòng lỗi/i;
export const RE_NUT_NHAP = /Nhập Excel|Import (Excel|đơn|file)|Tải file lên|Chọn file Excel/i;
