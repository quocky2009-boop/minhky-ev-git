export const fmtVND = (n) => (Number(n) || 0).toLocaleString("vi-VN") + " đ";
export const fmtNum = (n) => (Number(n) || 0).toLocaleString("vi-VN");
export const fmtTime = (iso) => iso ? new Date(iso).toLocaleString("vi-VN", { hour12: false }) : "—";
export const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("vi-VN") : "—";
export const errMsg = (e) => {
  const m = e?.message || String(e);
  if (m.includes("TON_KHONG_DU")) return "Không đủ tồn kho: " + m.split("TON_KHONG_DU:")[1]?.trim();
  if (m.includes("KHONG_CO_QUYEN")) return "Không có quyền: " + (m.split("KHONG_CO_QUYEN:")[1]?.trim() || "thao tác này không thuộc vai trò của bạn.");
  if (m.includes("THIEU_LY_DO")) return "Điều chỉnh tồn bắt buộc phải có lý do.";
  if (m.includes("KHONG_CHENH_LECH")) return "Tồn thực tế bằng tồn hệ thống — không cần điều chỉnh.";
  if (m.includes("KHO_TRUNG")) return "Kho đi và kho đến không được trùng nhau.";
  if (m.includes("THIEU_THONG_TIN")) return "Thiếu thông tin: " + (m.split("THIEU_THONG_TIN:")[1]?.split("\n")[0]?.trim() || "vui lòng nhập đủ các trường bắt buộc.");
  if (m.includes("SO_LUONG_SAI")) return "Số lượng phải lớn hơn 0.";
  if (m.includes("TRANG_THAI_SAI")) return "Phiếu không còn ở trạng thái cho phép thao tác này.";
  return m;
};

// Tach file CSV don gian (ho tro dau ngoac kep)
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (cell !== "" || row.length) { row.push(cell); rows.push(row); row = []; cell = ""; }
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

export function downloadCSV(name, rows) {
  const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

// Xuat file Excel THAT (.xlsx) - khac CSV, ho tro tu co gian do rong cot
// theo noi dung, vi CSV (van ban thuan) khong co khai niem do rong cot.
// Dung import() DONG (khong phai require tinh) de webpack tach rieng thu
// vien xlsx thanh 1 chunk lazy-load, tranh phinh bundle CHO MOI TRANG
// chi vi import ham nay tu lib/format.js.
export async function downloadXLSX(name, rows, sheetName = "Sheet1") {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const colCount = Math.max(...rows.map((r) => r.length));
  const cols = [];
  for (let c = 0; c < colCount; c++) {
    let maxLen = 8;
    for (const r of rows) {
      const v = r[c];
      if (v === undefined || v === null) continue;
      const len = String(v).length;
      if (len > maxLen) maxLen = len;
    }
    cols.push({ wch: Math.min(maxLen + 2, 60) });
  }
  ws["!cols"] = cols;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, name.replace(/\.csv$/i, ".xlsx"));
}