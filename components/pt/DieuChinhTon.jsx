"use client";
import { useEffect, useRef, useState } from "react";
import { Badge, Field, LocSearch, Pager, pageSlice } from "@/components/ui";
import { fmtTime, errMsg, downloadXLSX } from "@/lib/format";
import { coQuyenExcel, baoKhongCoQuyenExcel } from "@/lib/excelPerm";

// Dieu chinh ton kho phu tung: danh sach yeu cau ADJ-..., tao thu cong hoac tai file Excel
const TT = { HOAN_THANH: ["Hoàn thành", "green"], MOT_PHAN: ["Hoàn thành một phần", "amber"], LOI: ["Lỗi", "red"] };
const PT = { THU_CONG: "Thủ công", FILE: "Tải file lên" };
const norm = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

export default function DieuChinhTon({ supabase, locations, parts, stock, canEdit, notify, onChanged }) {
  const [list, setList] = useState([]);
  const [fLoc, setFLoc] = useState("");
  const [from, setFrom] = useState(() => { const d = new Date(Date.now() + 7 * 3600e3); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(today());
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [soDong, setSoDong] = useState(20);
  const [mode, setMode] = useState(null); // null | "THU_CONG" | "FILE"
  const [form, setForm] = useState({ location_code: "", note: "", lines: [], file_name: "" });
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null); // { h, lines }
  const fileRef = useRef(null);

  const load = async () => {
    let qq = supabase.from("pt_dieu_chinh").select("*").order("created_at", { ascending: false }).limit(1000)
      .gte("created_at", new Date(from + "T00:00:00+07:00").toISOString()).lt("created_at", new Date(new Date(to + "T00:00:00+07:00").getTime() + 864e5).toISOString());
    if (fLoc) qq = qq.eq("location_code", fLoc);
    const { data, error } = await qq;
    if (error) return notify(errMsg(error), "err");
    setList(data || []);
  };
  useEffect(() => { load(); }, [fLoc, from, to]);

  const locName = (c) => locations.find((l) => l.code === c)?.name || c;
  const qtyOf = (pid, loc) => stock.find((s) => s.part_id === pid && s.location_code === loc)?.qty || 0;
  const kw = q.trim().toLowerCase();
  const rows = list.filter((r) => !kw || `${r.code} ${r.by_name} ${r.note} ${r.file_name}`.toLowerCase().includes(kw));

  const moTao = (m) => { setMode(m); setForm({ location_code: fLoc || "", note: "", lines: [], file_name: "" }); setPick(""); setDetail(null); };
  const themDong = (p) => { if (form.lines.some((l) => l.part_id === p.id)) return notify("Phụ tùng này đã có trong phiếu.", "err"); setForm((f) => ({ ...f, lines: [...f.lines, { part_id: p.id, ma: p.code, ten: p.name, unit: p.unit, serial: p.track_serial, qty_moi: "", vi_tri: "", ly_do: "" }] })); setPick(""); };
  const upDong = (i, k, v) => setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));

  const taiMau = () => {
    const ds = form.location_code ? parts.filter((p) => stock.some((s) => s.part_id === p.id && s.location_code === form.location_code)) : [];
    downloadXLSX("mau_dieu_chinh_ton_phu_tung.xlsx", [["Ma_PT", "Ten_Phu_Tung", "Ton_Hien_Tai", "Ton_Thuc_Te", "Vi_Tri", "Ly_Do"],
      ...(ds.length ? ds.map((p) => [p.code, p.name, qtyOf(p.id, form.location_code), "", stock.find((s) => s.part_id === p.id && s.location_code === form.location_code)?.vi_tri || "", ""]) : [["LOP-90", "Lốp xe 90/90-10", 10, 8, "Kệ A1", "Kiểm kê cuối tháng"]])], "Dieu_chinh", "nhap");
  };
  const docFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = "";
    if (!coQuyenExcel("nhap")) return baoKhongCoQuyenExcel("nhap");
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const lines = raw.map((r0) => { const r = {}; Object.keys(r0).forEach((k) => { r[norm(k)] = r0[k]; }); return r; })
        .filter((r) => String(r.ma_pt || "").trim() || String(r.ton_thuc_te ?? "").trim())
        .map((r) => { const p = parts.find((x) => x.code.toUpperCase() === String(r.ma_pt || "").trim().toUpperCase()); return { part_id: p?.id || null, ma: String(r.ma_pt || "").trim(), ten: p?.name || String(r.ten_phu_tung || ""), unit: p?.unit || "", serial: !!p?.track_serial, qty_moi: String(r.ton_thuc_te ?? "").trim(), vi_tri: String(r.vi_tri || "").trim(), ly_do: String(r.ly_do || "").trim() }; });
      if (!lines.length) return notify("File không có dòng dữ liệu. Tải file mẫu để xem đúng định dạng.", "err");
      setForm((f) => ({ ...f, lines, file_name: file.name }));
    } catch (ex) { notify("Không đọc được file: " + (ex.message || ex), "err"); }
  };

  const gui = async () => {
    if (!form.location_code) return notify("Chọn kho cần điều chỉnh.", "err");
    if (!form.lines.length) return notify("Chưa có dòng phụ tùng nào.", "err");
    if (mode === "THU_CONG" && form.lines.some((l) => String(l.qty_moi).trim() === "")) return notify("Nhập tồn thực tế cho tất cả các dòng.", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_pt_dieu_chinh", { p: { location_code: form.location_code, phuong_thuc: mode, file_name: form.file_name, note: form.note,
      lines: form.lines.map((l) => ({ part_id: l.part_id, ma: l.ma, qty_moi: l.qty_moi, vi_tri: l.vi_tri, ly_do: l.ly_do })) } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã tạo ${data.code}: ${data.thanh_cong}/${data.tong} dòng thành công${data.loi ? `, ${data.loi} dòng lỗi` : ""}.`, data.loi ? "err" : "ok");
    setMode(null); load(); onChanged && onChanged(); xem({ id: data.id });
  };

  const xem = async (h) => {
    const [{ data: hh }, { data: ls }] = await Promise.all([supabase.from("pt_dieu_chinh").select("*").eq("id", h.id).maybeSingle(), supabase.from("pt_dieu_chinh_dong").select("*").eq("dc_id", h.id).order("stt")]);
    setDetail({ h: hh, lines: ls || [] }); setMode(null);
  };
  const xuatLoi = () => downloadXLSX(`${detail.h.code}_loi.xlsx`, [["Ma_PT", "Ten_Phu_Tung", "Ton_Thuc_Te", "Vi_Tri", "Ly_Do", "Loi"], ...detail.lines.filter((l) => l.ket_qua === "LOI").map((l) => [l.ma, l.ten, l.qty_moi ?? "", l.vi_tri, l.ly_do, l.loi])], "Loi");

  const goiY = pick.trim() ? parts.filter((p) => p.status === "Hoạt động" && `${p.code} ${p.name}`.toLowerCase().includes(pick.trim().toLowerCase())).slice(0, 10) : [];

  return (
    <div className="flex flex-col gap-3">
      {mode && (
        <div className="card !p-4 border-2 border-brand">
          <div className="flex items-center mb-3"><div className="font-extrabold mr-auto">Tạo yêu cầu điều chỉnh tồn — {PT[mode]}</div><button className="btn-ghost !text-xs" onClick={() => setMode(null)}>Đóng</button></div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Kho điều chỉnh" required><LocSearch locations={locations} value={form.location_code} onChange={(v) => setForm((f) => ({ ...f, location_code: v }))} placeholder="Chọn kho…" /></Field>
            <div className="md:col-span-2"><Field label="Ghi chú"><input className="inp" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="VD: Kiểm kê cuối tháng 10" /></Field></div>
          </div>
          <div className="text-[12px] text-[#5A6572] my-2">Nhập <b>tồn thực tế</b> của phụ tùng tại kho — hệ thống tự tính chênh lệch so với tồn trên sổ và ghi lịch sử “Điều chỉnh”. Phụ tùng theo dõi serial (pin) không điều chỉnh ở đây.</div>
          {mode === "FILE" && (
            <div className="flex gap-2 flex-wrap mb-2">
              <button className="btn-ghost !text-xs" onClick={taiMau}>⬇ Tải file mẫu{form.location_code ? " (kèm tồn hiện tại của kho)" : ""}</button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={docFile} />
              <button className="btn-primary !text-xs" onClick={() => fileRef.current?.click()}>Chọn file Excel…</button>
              {form.file_name && <span className="text-xs self-center text-[#5A6572]">{form.file_name} · {form.lines.length} dòng</span>}
            </div>)}
          {mode === "THU_CONG" && (
            <div className="relative mb-2 max-w-md">
              <input className="inp" placeholder="Gõ mã / tên phụ tùng để thêm dòng…" value={pick} onChange={(e) => setPick(e.target.value)} />
              {goiY.length > 0 && <div className="absolute z-20 left-0 right-0 bg-white border border-[#E3E8EF] rounded-lg shadow-lg max-h-64 overflow-y-auto">{goiY.map((p) => (
                <button key={p.id} className="w-full text-left px-3 py-2 border-b border-[#F2F4F7] hover:bg-[#F0FDF6] text-[13px]" onClick={() => themDong(p)}><b>{p.code}</b> · {p.name}{form.location_code && <span className="text-[#8A93A0]"> · tồn: {qtyOf(p.id, form.location_code)}</span>}{p.track_serial && <span className="text-danger"> · serial</span>}</button>))}</div>}
            </div>)}
          {form.lines.length > 0 && (
            <div className="tbl-scroll max-h-[420px] overflow-y-auto"><table className="w-full border-collapse text-[12.5px]">
              <thead><tr><th className="th">#</th><th className="th">Mã PT</th><th className="th">Tên phụ tùng</th><th className="th text-right">Tồn sổ</th><th className="th text-right">Tồn thực tế</th><th className="th text-right">Chênh lệch</th><th className="th">Vị trí</th><th className="th">Lý do</th><th className="th"></th></tr></thead>
              <tbody>{form.lines.map((l, i) => { const so = l.part_id && form.location_code ? qtyOf(l.part_id, form.location_code) : null; const cl = l.qty_moi !== "" && so != null ? Number(l.qty_moi) - so : null; return (
                <tr key={i} className={!l.part_id || l.serial ? "bg-[#FFF6F6]" : ""}>
                  <td className="td text-[#8A93A0]">{i + 1}</td><td className="td font-mono text-[11.5px]">{l.ma}</td>
                  <td className="td">{l.ten || "—"}{!l.part_id && <div className="text-[10.5px] text-danger">Không tìm thấy mã — dòng này sẽ báo lỗi</div>}{l.serial && <div className="text-[10.5px] text-danger">Theo serial — dòng này sẽ báo lỗi</div>}</td>
                  <td className="td text-right">{so ?? "—"}</td>
                  <td className="td text-right"><input type="number" min="0" className="inp !py-1 !text-xs !w-20 text-right" value={l.qty_moi} onChange={(e) => upDong(i, "qty_moi", e.target.value)} /></td>
                  <td className={`td text-right font-bold ${cl > 0 ? "text-[#0E7A4A]" : cl < 0 ? "text-danger" : ""}`}>{cl == null || Number.isNaN(cl) ? "" : (cl > 0 ? "+" : "") + cl}</td>
                  <td className="td"><input className="inp !py-1 !text-xs !w-24" value={l.vi_tri} onChange={(e) => upDong(i, "vi_tri", e.target.value)} placeholder="giữ nguyên" /></td>
                  <td className="td"><input className="inp !py-1 !text-xs !w-36" value={l.ly_do} onChange={(e) => upDong(i, "ly_do", e.target.value)} /></td>
                  <td className="td"><button className="text-danger font-bold" onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))}>✕</button></td>
                </tr>); })}</tbody>
            </table></div>)}
          <button className="btn-ok mt-3" disabled={busy || !form.lines.length} onClick={gui}>{busy ? "Đang xử lý…" : `Thực hiện điều chỉnh (${form.lines.length} dòng)`}</button>
        </div>)}

      {detail && (
        <div className="card !p-4">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <div className="font-extrabold mr-auto">{detail.h.code} · {locName(detail.h.location_code)} <Badge tone={TT[detail.h.trang_thai]?.[1]}>{TT[detail.h.trang_thai]?.[0]}</Badge></div>
            {detail.h.loi > 0 && <button className="btn-ghost !text-xs" onClick={xuatLoi}>⬇ Tải dòng lỗi</button>}
            <button className="btn-ghost !text-xs" onClick={() => setDetail(null)}>Đóng</button>
          </div>
          <div className="text-[12px] text-[#5A6572] mb-2">{PT[detail.h.phuong_thuc]}{detail.h.file_name ? ` (${detail.h.file_name})` : ""} · {detail.h.by_name} · {fmtTime(detail.h.created_at)}{detail.h.note ? ` · ${detail.h.note}` : ""}</div>
          <div className="tbl-scroll max-h-[420px] overflow-y-auto"><table className="w-full border-collapse text-[12.5px]">
            <thead><tr><th className="th">#</th><th className="th">Mã PT</th><th className="th">Tên</th><th className="th text-right">Tồn trước</th><th className="th text-right">Tồn sau</th><th className="th text-right">Chênh lệch</th><th className="th">Vị trí</th><th className="th">Lý do</th><th className="th">Kết quả</th></tr></thead>
            <tbody>{detail.lines.map((l) => (
              <tr key={l.id}><td className="td text-[#8A93A0]">{l.stt}</td><td className="td font-mono text-[11.5px]">{l.ma}</td><td className="td">{l.ten}</td>
                <td className="td text-right">{l.qty_truoc ?? "—"}</td><td className="td text-right">{l.ket_qua === "THANH_CONG" ? l.qty_moi : "—"}</td>
                <td className={`td text-right font-bold ${l.chenh_lech > 0 ? "text-[#0E7A4A]" : l.chenh_lech < 0 ? "text-danger" : ""}`}>{l.chenh_lech == null ? "" : (l.chenh_lech > 0 ? "+" : "") + l.chenh_lech}</td>
                <td className="td">{l.vi_tri}</td><td className="td">{l.ly_do}</td>
                <td className="td">{l.ket_qua === "THANH_CONG" ? <Badge tone="green">Thành công</Badge> : <><Badge tone="red">Lỗi</Badge><div className="text-[10.5px] text-danger">{l.loi}</div></>}</td></tr>))}</tbody>
          </table></div>
        </div>)}

      <div className="card">
        <div className="flex gap-2 items-end mb-3 flex-wrap">
          <div className="font-extrabold mr-auto self-center">Yêu cầu điều chỉnh tồn kho ({rows.length})</div>
          {canEdit && <button className="btn-ghost !text-xs" onClick={() => moTao("FILE")}>⬆ Tải file lên</button>}
          {canEdit && <button className="btn-primary !text-xs" onClick={() => moTao("THU_CONG")}>+ Điều chỉnh thủ công</button>}
        </div>
        <div className="flex gap-2 items-end mb-3 flex-wrap">
          <div className="w-56"><Field label="Kho"><LocSearch locations={locations} value={fLoc} onChange={(v) => { setFLoc(v); setPage(1); }} placeholder="Tất cả kho" /></Field></div>
          <Field label="Từ ngày"><input type="date" className="inp" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Đến ngày"><input type="date" className="inp" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <input className="inp !w-56" placeholder="Tìm mã yêu cầu, người tạo…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        {!canEdit && <div className="text-[12px] text-[#8A93A0] mb-2">Bạn chỉ xem được. Quyền tạo điều chỉnh: “Kiểm kê phụ tùng”.</div>}
        <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
          <thead><tr><th className="th">Mã yêu cầu</th><th className="th">Ngày tạo</th><th className="th">Người tạo</th><th className="th">Kho</th><th className="th">Phương thức</th><th className="th text-right">Tổng bản ghi</th><th className="th text-right">Thành công</th><th className="th text-right">Lỗi</th><th className="th">Trạng thái</th></tr></thead>
          <tbody>{pageSlice(rows, page, soDong).map((r) => (
            <tr key={r.id} className="hover:bg-[#F8FAFC] cursor-pointer" onClick={() => xem(r)}>
              <td data-label="Mã yêu cầu" className="td font-mono font-bold text-[12px] text-brand">{r.code}</td><td data-label="Ngày tạo" className="td text-xs">{fmtTime(r.created_at)}</td>
              <td data-label="Người tạo" className="td text-[13px]">{r.by_name}</td><td data-label="Kho" className="td text-xs">{locName(r.location_code)}</td>
              <td data-label="Phương thức" className="td text-xs">{PT[r.phuong_thuc]}</td><td data-label="Tổng" className="td text-right">{r.tong}</td>
              <td data-label="Thành công" className="td text-right text-[#0E7A4A] font-bold">{r.thanh_cong}</td><td data-label="Lỗi" className={`td text-right font-bold ${r.loi ? "text-danger" : ""}`}>{r.loi}</td>
              <td data-label="Trạng thái" className="td"><Badge tone={TT[r.trang_thai]?.[1]}>{TT[r.trang_thai]?.[0]}</Badge></td>
            </tr>))}
            {rows.length === 0 && <tr><td className="td text-[#8A93A0]" colSpan={9}>Chưa có yêu cầu điều chỉnh nào trong khoảng này.</td></tr>}
          </tbody>
        </table></div>
        <Pager total={rows.length} page={page} setPage={setPage} pageSize={soDong} setPageSize={setSoDong} />
      </div>
    </div>
  );
}
