"use client";
import { useEffect, useState } from "react";
import { Field, MultiCheck, Pager, pageSlice, useSortable, Th } from "@/components/ui";
import { fmtVND, errMsg, downloadXLSX } from "@/lib/format";

// Bao cao xuat nhap ton phu tung theo ky (Hien tai / Quy / Nam / Tuy chon)
const vnNow = () => new Date(Date.now() + 7 * 3600e3);
const iso = (d) => d.toISOString().slice(0, 10);
function kyOf(loai, quy, nam) {
  const now = vnNow(); const y = Number(nam) || now.getUTCFullYear();
  if (loai === "HIEN_TAI") return [iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), iso(now)];
  if (loai === "QUY") { const q = Number(quy) || 1; return [iso(new Date(Date.UTC(y, (q - 1) * 3, 1))), iso(new Date(Date.UTC(y, q * 3, 0)))]; }
  if (loai === "NAM") return [`${y}-01-01`, `${y}-12-31`];
  return null;
}

export default function BaoCaoXNT({ supabase, locations, notify }) {
  const now = vnNow();
  const [loai, setLoai] = useState("HIEN_TAI");
  const [quy, setQuy] = useState(String(Math.floor(now.getUTCMonth() / 3) + 1));
  const [nam, setNam] = useState(String(now.getUTCFullYear()));
  const [from, setFrom] = useState(iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))));
  const [to, setTo] = useState(iso(now));
  const [locs, setLocs] = useState([]);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [soDong, setSoDong] = useState(20);
  const sort = useSortable();
  const ky = kyOf(loai, quy, nam) || [from, to];

  const load = async () => {
    if (!ky[0] || !ky[1] || ky[0] > ky[1]) return notify("Khoảng thời gian không hợp lệ.", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_pt_xnt", { p_from: ky[0], p_to: ky[1], p_locs: locs.length ? locs : null });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    setRows(data || []); setPage(1);
  };
  useEffect(() => { load(); }, [loai, quy, nam, from, to, locs.join(",")]);

  const kw = q.trim().toLowerCase();
  const list = sort.sortFn(rows.filter((r) => !kw || `${r.ma} ${r.ten} ${r.vi_tri}`.toLowerCase().includes(kw)),
    { ma: (r) => r.ma, ten: (r) => r.ten, kho: (r) => r.kho, dau: (r) => r.ton_dau, nhap: (r) => r.nhap, xuat: (r) => r.xuat, cuoi: (r) => r.ton_cuoi, gia: (r) => r.gia_goc });
  const sum = (k) => list.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const gtCuoi = list.reduce((a, r) => a + (Number(r.ton_cuoi) || 0) * (Number(r.gia_goc) || 0), 0);
  const fmtD = (s) => s.split("-").reverse().join("/");

  const xuat = () => downloadXLSX(`bao_cao_xnt_phu_tung_${ky[0]}_${ky[1]}.xlsx`, [
    [`BÁO CÁO XUẤT NHẬP TỒN PHỤ TÙNG từ ${fmtD(ky[0])} đến ${fmtD(ky[1])}`],
    ["Mã PT", "Tên phụ tùng", "ĐVT", "Kho", "Vị trí", "Tồn đầu", "Nhập", "Xuất", "Tồn cuối", "Giá gốc", "Giá trị tồn cuối"],
    ...list.map((r) => [r.ma, r.ten, r.dvt, r.kho, r.vi_tri, Number(r.ton_dau), Number(r.nhap), Number(r.xuat), Number(r.ton_cuoi), Number(r.gia_goc), Number(r.ton_cuoi) * Number(r.gia_goc)]),
    ["Tổng cộng", "", "", "", "", sum("ton_dau"), sum("nhap"), sum("xuat"), sum("ton_cuoi"), "", gtCuoi],
  ], "XNT");

  return (
    <div className="card">
      <div className="flex gap-2 items-center mb-3 flex-wrap">
        <div className="font-extrabold mr-auto">Báo cáo Xuất – Nhập – Tồn <span className="text-[12px] font-semibold text-[#5A6572]">({fmtD(ky[0])} → {fmtD(ky[1])})</span></div>
        <button className="btn-primary !text-xs" disabled={!list.length} onClick={xuat}>⬇ Xuất dữ liệu</button>
      </div>
      <div className="flex gap-2 items-end mb-3 flex-wrap">
        <div className="flex gap-1">{[["HIEN_TAI", "Hiện tại"], ["QUY", "Quý"], ["NAM", "Năm"], ["TUY_CHON", "Tùy chọn"]].map(([k, v]) => (
          <button key={k} className={`btn !px-3 !py-2 !text-xs ${loai === k ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => setLoai(k)}>{v}</button>))}</div>
        {loai === "QUY" && <Field label="Quý"><select className="inp" value={quy} onChange={(e) => setQuy(e.target.value)}>{[1, 2, 3, 4].map((x) => <option key={x} value={x}>Quý {x}</option>)}</select></Field>}
        {(loai === "QUY" || loai === "NAM") && <Field label="Năm"><input type="number" className="inp !w-24" value={nam} onChange={(e) => setNam(e.target.value)} /></Field>}
        {loai === "TUY_CHON" && <><Field label="Từ ngày"><input type="date" className="inp" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="Đến ngày"><input type="date" className="inp" value={to} onChange={(e) => setTo(e.target.value)} /></Field></>}
        <Field label="Kho"><MultiCheck label="Tất cả kho" value={locs} onChange={setLocs} options={locations.filter((l) => l.status !== "Đã xóa").map((l) => ({ key: l.code, label: l.name }))} /></Field>
        <input className="inp !w-56" placeholder="Tìm mã, tên, vị trí…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      </div>
      <div className="text-[11.5px] text-[#8A93A0] mb-2">“Hiện tại” = từ đầu tháng đến hôm nay. Nhập gồm nhập kho, hoàn trả, điều chỉnh tăng; Xuất gồm xuất cho lệnh sửa chữa, xuất nội bộ, điều chỉnh giảm.</div>
      <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
        <thead><tr><Th label="Mã PT" k="ma" sort={sort} /><Th label="Tên phụ tùng" k="ten" sort={sort} /><th className="th">ĐVT</th><Th label="Kho" k="kho" sort={sort} /><th className="th">Vị trí</th>
          <Th label="Tồn đầu" k="dau" sort={sort} className="text-right" /><Th label="Nhập" k="nhap" sort={sort} className="text-right" /><Th label="Xuất" k="xuat" sort={sort} className="text-right" /><Th label="Tồn cuối" k="cuoi" sort={sort} className="text-right" /><Th label="Giá gốc" k="gia" sort={sort} className="text-right" /></tr></thead>
        <tbody>{pageSlice(list, page, soDong).map((r) => (
          <tr key={r.part_id + r.location_code} className="hover:bg-[#F8FAFC]">
            <td data-label="Mã PT" className="td font-mono text-xs">{r.ma}</td><td data-label="Tên" className="td text-[13px] font-semibold">{r.ten}</td><td data-label="ĐVT" className="td text-xs">{r.dvt}</td>
            <td data-label="Kho" className="td text-xs">{r.kho}</td><td data-label="Vị trí" className="td text-xs">{r.vi_tri || "—"}</td>
            <td data-label="Tồn đầu" className="td text-right tabular-nums">{r.ton_dau}</td><td data-label="Nhập" className="td text-right tabular-nums text-[#0E7A4A]">{r.nhap || ""}</td>
            <td data-label="Xuất" className="td text-right tabular-nums text-danger">{r.xuat || ""}</td><td data-label="Tồn cuối" className="td text-right tabular-nums font-bold">{r.ton_cuoi}</td>
            <td data-label="Giá gốc" className="td text-right">{fmtVND(r.gia_goc)}</td>
          </tr>))}
          {list.length === 0 && <tr><td className="td text-[#8A93A0]" colSpan={10}>{busy ? "Đang tải…" : "Không có phát sinh / tồn kho trong kỳ này."}</td></tr>}
        </tbody>
        {list.length > 0 && <tfoot><tr className="bg-[#F8FAFB] font-bold"><td className="td" colSpan={5}>Tổng cộng ({list.length} dòng)</td><td className="td text-right">{sum("ton_dau")}</td><td className="td text-right">{sum("nhap")}</td><td className="td text-right">{sum("xuat")}</td><td className="td text-right">{sum("ton_cuoi")}</td><td className="td text-right text-[11px]">GT tồn cuối: {fmtVND(gtCuoi)}</td></tr></tfoot>}
      </table></div>
      <Pager total={list.length} page={page} setPage={setPage} pageSize={soDong} setPageSize={setSoDong} />
    </div>
  );
}
