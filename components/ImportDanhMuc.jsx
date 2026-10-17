"use client";
import { useRef, useState } from "react";
import { errMsg } from "@/lib/format";

// Import Excel danh muc: mode "cv" (cong viec dich vu) hoac "pt" (phu tung + ton dau ky theo kho)
const norm = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();
const hdr = (s) => norm(s).replace(/ /g, "_");
const num = (v) => { if (v === "" || v == null) return null; const n = Number(String(v).replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : NaN; };

const CFG = {
  cv: {
    title: "Import danh mục công việc từ Excel", sheet: "Cong_viec", file: "mau_danh_muc_cong_viec.xlsx", rpc: "fn_cv_import",
    cols: ["Ma_CV", "Ten_Cong_Viec", "Loai_CV", "Nhom", "Gia"],
    sample: [["DVC-101", "Bảo dưỡng định kỳ 1000km", "Bảo dưỡng", "Bảo dưỡng", 205000], ["DVC-102", "Thay má phanh (chưa gồm má)", "Sửa chữa", "Phanh", 40000]],
    note: "Mã trùng sẽ được CẬP NHẬT tên/giá; mã mới được thêm. Loại CV: Bảo dưỡng / Sửa chữa / Bảo hành / Lắp đặt.",
  },
  pt: {
    title: "Import danh mục phụ tùng + tồn đầu kỳ từ Excel", sheet: "Phu_tung", file: "mau_danh_muc_phu_tung.xlsx", rpc: "fn_pt_import",
    cols: ["Ma_PT", "Ten_Phu_Tung", "Nhom", "DVT", "Gia_Von", "Gia_Ban", "Ton_Toi_Thieu", "Kho", "Ton_Dau_Ky"],
    sample: [["LOP-90", "Lốp xe máy điện 90/90-10", "Săm lốp", "cái", 250000, 350000, 5, "TP_KHO_36SH", 10], ["MA-PHANH", "Má phanh trước", "Phanh", "bộ", 45000, 80000, 5, "", ""]],
    note: "Mã trùng sẽ CẬP NHẬT thông tin; Ton_Dau_Ky > 0 sẽ được CỘNG vào tồn kho (cột Kho là mã hoặc tên kho/cửa hàng). Import lại cùng file sẽ cộng tồn thêm lần nữa.",
  },
};

export default function ImportDanhMuc({ mode, supabase, locations, notify, onDone, onClose }) {
  const c = CFG[mode];
  const fileRef = useRef(null);
  const [rows, setRows] = useState(null);
  const [errs, setErrs] = useState([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const taiMau = async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([c.cols, ...c.sample]), c.sheet);
    if (mode === "pt") XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Ma_Kho", "Ten_Kho"], ...locations.filter((l) => l.status !== "Đã xóa").map((l) => [l.code, l.name])]), "Danh_sach_kho");
    XLSX.writeFile(wb, c.file);
  };

  const locOf = (v) => { const t = String(v || "").trim(); if (!t) return ""; const l = locations.find((x) => x.code.toLowerCase() === t.toLowerCase() || x.name.toLowerCase() === t.toLowerCase()); return l ? l.code : null; };

  const docFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setFileName(file.name); setDone(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { defval: "" });
      const out = [], er = [];
      raw.forEach((r0, i) => {
        const r = {}; Object.keys(r0).forEach((k) => { r[hdr(k)] = r0[k]; });
        const dong = i + 2;
        if (mode === "cv") {
          const code = String(r.ma_cv || "").trim(), name = String(r.ten_cong_viec || "").trim();
          if (!code && !name) return;
          if (!code || !name) return er.push(`Dòng ${dong}: thiếu Mã hoặc Tên công việc`);
          const gia = num(r.gia); if (Number.isNaN(gia)) return er.push(`Dòng ${dong}: Giá không hợp lệ`);
          out.push({ code, name, loai_cv: String(r.loai_cv || "").trim(), group_name: String(r.nhom || "").trim(), price: gia ?? 0 });
        } else {
          const code = String(r.ma_pt || "").trim(), name = String(r.ten_phu_tung || "").trim();
          if (!code && !name) return;
          if (!code || !name) return er.push(`Dòng ${dong}: thiếu Mã hoặc Tên phụ tùng`);
          const gv = num(r.gia_von), gb = num(r.gia_ban), tt = num(r.ton_toi_thieu), ton = num(r.ton_dau_ky);
          if ([gv, gb, tt, ton].some(Number.isNaN)) return er.push(`Dòng ${dong}: số không hợp lệ (giá/tồn)`);
          const kho = locOf(r.kho); if (kho === null) return er.push(`Dòng ${dong}: kho "${r.kho}" không tồn tại`);
          if ((ton || 0) > 0 && !kho) return er.push(`Dòng ${dong}: có Tồn đầu kỳ nhưng thiếu Kho`);
          out.push({ code, name, group_name: String(r.nhom || "").trim(), unit: String(r.dvt || "").trim(), cost_price: gv ?? 0, sell_price: gb ?? 0, min_stock: tt ?? 0, location_code: kho, qty: ton ?? 0 });
        }
      });
      const seen = new Set(); out.forEach((o, i) => { const k = o.code.toUpperCase(); if (seen.has(k)) er.push(`Mã "${o.code}" bị lặp trong file`); seen.add(k); });
      if (out.length === 0 && er.length === 0) er.push("File không có dòng dữ liệu. Tải file mẫu để xem đúng định dạng.");
      setRows(out); setErrs(er);
    } catch (ex) { setRows(null); setErrs(["Không đọc được file: " + (ex.message || ex)]); }
  };

  const nhap = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc(c.rpc, { p: { rows } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    setDone(data); notify("Import thành công."); onDone && onDone();
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-start justify-center p-3 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl w-[760px] max-w-full p-4 my-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center mb-2"><div className="font-extrabold text-base">{c.title}</div><button className="ml-auto text-[#8A93A0] text-lg" onClick={onClose}>✕</button></div>
        <p className="text-[12px] text-[#5A6572] mb-3">{c.note}</p>
        <div className="flex gap-2 flex-wrap mb-3">
          <button className="btn-ghost !text-xs" onClick={taiMau}>⬇ Tải file mẫu</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={docFile} />
          <button className="btn-primary !text-xs" onClick={() => fileRef.current?.click()}>Chọn file Excel…</button>
          {fileName && <span className="text-xs self-center text-[#5A6572]">{fileName}</span>}
        </div>
        {errs.length > 0 && <div className="rounded-lg bg-[#FDE8EA] text-[#B01E2C] text-[12.5px] p-2.5 mb-3 max-h-40 overflow-y-auto">{errs.slice(0, 30).map((x, i) => <div key={i}>• {x}</div>)}{errs.length > 30 && <div>… và {errs.length - 30} lỗi khác</div>}</div>}
        {rows && rows.length > 0 && !done && (<>
          <div className="text-[12.5px] mb-1.5"><b>{rows.length}</b> dòng hợp lệ{errs.length > 0 ? " — sửa các lỗi ở trên rồi chọn lại file để import" : ""}</div>
          <div className="tbl-scroll max-h-64 overflow-y-auto border border-[#E3E8EF] rounded-lg"><table className="w-full border-collapse text-[12px]">
            <thead><tr>{Object.keys(rows[0]).map((k) => <th key={k} className="th">{k}</th>)}</tr></thead>
            <tbody>{rows.slice(0, 50).map((r, i) => <tr key={i}>{Object.values(r).map((v, j) => <td key={j} className="td">{String(v)}</td>)}</tr>)}</tbody></table></div>
          <div className="flex gap-2 mt-3"><button className="btn-ok" disabled={busy || errs.length > 0} onClick={nhap}>{busy ? "Đang import…" : `Import ${rows.length} dòng`}</button><button className="btn-ghost" onClick={onClose}>Hủy</button></div>
        </>)}
        {done && <div className="rounded-lg bg-[#E5F6EE] text-[#0E7A4A] text-[13px] p-3">✓ Đã thêm <b>{done.them}</b> · cập nhật <b>{done.sua}</b>{done.nhap_ton != null ? <> · nhập tồn <b>{done.nhap_ton}</b> dòng (phiếu {done.phieu})</> : null}.<div className="mt-2"><button className="btn-ghost !text-xs" onClick={onClose}>Đóng</button></div></div>}
      </div>
    </div>
  );
}
