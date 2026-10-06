"use client";
import { useRef, useState } from "react";
import { fmtDate, errMsg } from "@/lib/format";

// Import Excel hang loat "Don dat hang nhap" (ke hoach nhap xe).
// Mau: sheet Don_dat_hang (Chi_Nhanh, Nha_Cung_Cap, Ngay_Du_Kien, Ma_Hang, Ma_Xe, So_Luong, Ghi_Chu_Dong, Ghi_Chu_Don)
// Cac dong cung (Chi_Nhanh + Nha_Cung_Cap + Ngay_Du_Kien + Ghi_Chu_Don) gop thanh 1 don dat hang.
const norm = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();
const hdr = (s) => norm(s).replace(/ /g, "_");
const pad = (n) => String(n).padStart(2, "0");

function parseDate(v) {
  if (v === "" || v == null) return { ok: true, val: null };
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (isNaN(d)) return { ok: false };
    return { ok: true, val: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` };
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { ok: true, val: `${m[1]}-${pad(m[2])}-${pad(m[3])}` };
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) return { ok: true, val: `${m[3]}-${pad(m[2])}-${pad(m[1])}` };
  return { ok: false };
}

export default function ImportDatHang({ supabase, vehicles, locations, notify, onDone, onClose }) {
  const fileRef = useRef(null);
  const [groups, setGroups] = useState(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const locs = locations.filter((l) => l.status !== "Đã xóa");
  const vName = (id) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.brand} ${v.name} ${v.color}` : id; };

  const taiMau = async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const l0 = locs[0], l1 = locs[1] || locs[0];
    const vs = vehicles.filter((v) => v.mfr_code).slice(0, 2);
    const v0 = vs[0] || vehicles[0], v1 = vs[1] || vehicles[1] || vehicles[0];
    const don = [
      ["Chi_Nhanh", "Nha_Cung_Cap", "Ngay_Du_Kien", "Ma_Hang", "Ma_Xe", "So_Luong", "Ghi_Chu_Dong", "Ghi_Chu_Don"],
      [l0?.code || "", "VinFast", "15/10/2026", v0?.mfr_code || "", v0?.mfr_code ? "" : (v0?.id || ""), 10, "", "Đợt nhập giữa tháng 10"],
      [l0?.code || "", "VinFast", "15/10/2026", v1?.mfr_code || "", v1?.mfr_code ? "" : (v1?.id || ""), 5, "Ưu tiên màu trắng", "Đợt nhập giữa tháng 10"],
      [l1?.code || "", "TAILG", "20/10/2026", "", v0?.id || "", 8, "", ""],
    ];
    const ws = XLSX.utils.aoa_to_sheet(don);
    ws["!cols"] = [{ wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 10 }, { wch: 26 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, "Don_dat_hang");
    const hd = [
      ["HƯỚNG DẪN IMPORT ĐƠN ĐẶT HÀNG NHẬP"],
      [""],
      ["1. Điền các dòng ở sheet Don_dat_hang (xóa 3 dòng ví dụ). Mỗi dòng = 1 mã xe + số lượng."],
      ["2. Chi_Nhanh (bắt buộc): Ma_Diem hoặc Ten_Diem — xem sheet Danh_muc_diem."],
      ["3. Ma_Hang hoặc Ma_Xe (bắt buộc 1 trong 2): Ma_Hang = mã hãng trong Danh mục xe; Ma_Xe = mã nội bộ — xem sheet Danh_muc_xe."],
      ["4. So_Luong (bắt buộc): số nguyên lớn hơn 0."],
      ["5. Nha_Cung_Cap, Ngay_Du_Kien (dd/mm/yyyy), Ghi_Chu_Dong, Ghi_Chu_Don: không bắt buộc."],
      ["6. Các dòng cùng Chi_Nhanh + Nha_Cung_Cap + Ngay_Du_Kien + Ghi_Chu_Don sẽ gộp thành MỘT đơn đặt hàng."],
      ["7. Hệ thống kiểm tra toàn bộ file và cho xem trước; đơn nào có dòng lỗi sẽ không được tạo, đơn hợp lệ vẫn tạo bình thường."],
    ];
    const wsh = XLSX.utils.aoa_to_sheet(hd); wsh["!cols"] = [{ wch: 120 }];
    XLSX.utils.book_append_sheet(wb, wsh, "Huong_dan");
    const wsx = XLSX.utils.aoa_to_sheet([["Ma_Xe", "Ma_Hang", "Hang", "Ten_Xe", "Mau"], ...vehicles.map((v) => [v.id, v.mfr_code || "", v.brand, v.name, v.color])]);
    wsx["!cols"] = [{ wch: 26 }, { wch: 18 }, { wch: 12 }, { wch: 22 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsx, "Danh_muc_xe");
    const wsd = XLSX.utils.aoa_to_sheet([["Ma_Diem", "Ten_Diem", "Khu_Vuc"], ...locs.map((l) => [l.code, l.name, l.region || ""])]);
    wsd["!cols"] = [{ wch: 22 }, { wch: 28 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsd, "Danh_muc_diem");
    XLSX.writeFile(wb, "mau_import_don_dat_hang_nhap.xlsx");
  };

  const doc = async (file) => {
    setDone(null); setGroups(null); setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets["Don_dat_hang"] || wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true });
      if (raw.length === 0) return notify("File không có dòng dữ liệu nào.", "err");
      const rows = raw.map((r, i) => {
        const o = { _row: i + 2 };
        Object.entries(r).forEach(([k, v]) => { o[hdr(k)] = v; });
        return o;
      }).filter((o) => Object.entries(o).some(([k, v]) => k !== "_row" && String(v).trim() !== ""));
      if (rows.length === 0) return notify("File không có dòng dữ liệu nào.", "err");

      const byCode = Object.fromEntries(locs.map((l) => [l.code.toLowerCase(), l]));
      const byName = {}; locs.forEach((l) => { byName[norm(l.name)] = l; });
      const vById = Object.fromEntries(vehicles.map((v) => [v.id.toLowerCase(), v]));
      const vByMfr = {}; vehicles.forEach((v) => { if (v.mfr_code) (vByMfr[norm(v.mfr_code)] = vByMfr[norm(v.mfr_code)] || []).push(v); });

      const gm = {};
      rows.forEach((r) => {
        const cn = String(r.chi_nhanh ?? "").trim(), ncc = String(r.nha_cung_cap ?? "").trim(), gcd = String(r.ghi_chu_don ?? r.ghi_chu ?? "").trim();
        const dt = parseDate(r.ngay_du_kien);
        const key = [norm(cn), norm(ncc), String(r.ngay_du_kien ?? "").trim(), norm(gcd)].join("|");
        const g = (gm[key] = gm[key] || { key, cn, ncc, gcd, loc: null, ngay: null, lines: [], errors: [] });
        const err = (m) => g.errors.push({ row: r._row, msg: m });
        if (!cn) err("Thiếu Chi_Nhanh");
        else { const l = byCode[cn.toLowerCase()] || byName[norm(cn)]; if (!l) err(`Không tìm thấy điểm "${cn}"`); else g.loc = l; }
        if (!dt.ok) err(`Ngày dự kiến không hợp lệ (${r.ngay_du_kien}) — dùng dd/mm/yyyy`); else g.ngay = dt.val;
        const mx = String(r.ma_xe ?? "").trim(), mh = String(r.ma_hang ?? "").trim();
        let v = null;
        if (!mx && !mh) err("Thiếu Ma_Hang hoặc Ma_Xe");
        else {
          const a = mx ? vById[mx.toLowerCase()] : null;
          const bl = mh ? (vByMfr[norm(mh)] || []) : [];
          if (mx && !a) err(`Không có Ma_Xe "${mx}"`);
          else if (mh && bl.length === 0) err(`Không có Ma_Hang "${mh}"`);
          else if (mh && bl.length > 1) err(`Ma_Hang "${mh}" trùng nhiều xe — dùng Ma_Xe`);
          else if (a && bl.length === 1 && a.id !== bl[0].id) err(`Ma_Xe "${mx}" và Ma_Hang "${mh}" không cùng một xe`);
          else v = a || bl[0];
        }
        const q = Number(String(r.so_luong ?? "").replace(/[,\s]/g, ""));
        if (!Number.isInteger(q) || q <= 0) err(`So_Luong không hợp lệ (${r.so_luong})`);
        if (v && Number.isInteger(q) && q > 0) g.lines.push({ vehicle_id: v.id, qty: q, note: String(r.ghi_chu_dong ?? "").trim(), row: r._row });
      });
      setGroups(Object.values(gm));
    } catch (e) {
      notify("Không đọc được file Excel: " + (e.message || e), "err");
    }
  };

  const hopLe = (groups || []).filter((g) => g.errors.length === 0 && g.lines.length > 0);
  const loi = (groups || []).filter((g) => g.errors.length > 0);

  const tao = async () => {
    if (hopLe.length === 0) return;
    if (!confirm(`Tạo ${hopLe.length} đơn đặt hàng nhập từ file "${fileName}"?${loi.length ? `\n${loi.length} đơn có lỗi sẽ bị bỏ qua.` : ""}`)) return;
    setBusy(true);
    const ok = [], fail = [];
    for (const g of hopLe) {
      // gop cac dong trung xe trong cung don
      const m = {};
      g.lines.forEach((l) => { const k = l.vehicle_id; if (m[k]) { m[k].qty += l.qty; if (l.note) m[k].note = (m[k].note ? m[k].note + "; " : "") + l.note; } else m[k] = { ...l }; });
      const { data, error } = await supabase.rpc("fn_tao_don_dat_hang", { p: {
        location_code: g.loc.code, supplier: g.ncc, ngay_du_kien: g.ngay || null, note: g.gcd,
        lines: Object.values(m).map((l) => ({ vehicle_id: l.vehicle_id, qty: l.qty, note: l.note })),
      } });
      if (error) fail.push(`${g.loc.name}/${g.ncc || "—"}: ${errMsg(error)}`); else ok.push(data.code);
    }
    setBusy(false);
    setDone({ ok, fail });
    setGroups(null);
    if (ok.length) onDone && onDone();
  };

  return (
    <div className="card !p-4 border-2 border-brand">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="font-extrabold mr-auto">⬆ Import đơn đặt hàng nhập từ Excel</div>
        <button className="btn-ghost !text-xs" onClick={taiMau}>⬇ Tải file mẫu</button>
        <button className="btn-ghost !text-xs" onClick={() => fileRef.current?.click()}>Chọn file Excel…</button>
        <button className="btn-ghost !text-xs" onClick={onClose}>✕ Đóng</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) doc(f); }} />
      </div>
      <p className="text-[12px] text-[#5A6572]">Dùng file mẫu: mỗi dòng là một mã xe + số lượng; các dòng cùng chi nhánh, nhà cung cấp, ngày dự kiến và ghi chú đơn sẽ gộp thành một đơn. Hệ thống kiểm tra toàn bộ file trước khi tạo.</p>

      {done && (
        <div className="mt-3 text-[13px]">
          {done.ok.length > 0 && <div className="text-[#0E7A4A] font-semibold">✓ Đã tạo {done.ok.length} đơn: {done.ok.join(", ")}</div>}
          {done.fail.map((m, i) => <div key={i} className="text-danger">✗ {m}</div>)}
        </div>
      )}

      {groups && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="text-[13px]"><b>{fileName}</b>: {groups.length} đơn · <span className="text-[#0E7A4A] font-semibold">{hopLe.length} hợp lệ</span>{loi.length > 0 && <> · <span className="text-danger font-semibold">{loi.length} có lỗi</span></>}</div>
          {hopLe.map((g) => (
            <div key={g.key} className="p-2.5 rounded-xl border border-[#BBE3CC] bg-[#F4FBF7] text-[13px]">
              <div className="font-semibold">{g.loc.name} · NCC {g.ncc || "—"} · dự kiến {g.ngay ? fmtDate(g.ngay) : "—"}{g.gcd ? ` · ${g.gcd}` : ""} · <span className="text-brand">{g.lines.reduce((a, l) => a + l.qty, 0)} xe</span></div>
              <div className="text-[12px] text-[#5A6572]">{g.lines.map((l) => `${vName(l.vehicle_id)} ×${l.qty}`).join(" · ")}</div>
            </div>
          ))}
          {loi.map((g) => (
            <div key={g.key} className="p-2.5 rounded-xl border border-[#F2C4C8] bg-[#FFF6F6] text-[13px]">
              <div className="font-semibold">{g.cn || "(thiếu chi nhánh)"} · NCC {g.ncc || "—"} — không tạo được</div>
              {g.errors.map((e, i) => <div key={i} className="text-[12px] text-danger">Dòng {e.row}: {e.msg}</div>)}
            </div>
          ))}
          <div className="flex gap-2">
            <button className="btn-ok" disabled={busy || hopLe.length === 0} onClick={tao}>{busy ? "Đang tạo…" : `Tạo ${hopLe.length} đơn hợp lệ`}</button>
            <button className="btn-ghost" onClick={() => { setGroups(null); setFileName(""); }}>Bỏ file</button>
          </div>
        </div>
      )}
    </div>
  );
}
