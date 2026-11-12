"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { usePerms } from "@/lib/usePerms";
import NhapKhachLeHangLoat from "@/components/NhapKhachLeHangLoat";
import { Badge, Toast, KPI, Pager, pageSlice, MultiCheck, LocGon } from "@/components/ui";
import { fmtDate, fmtVND, downloadXLSX, errMsg } from "@/lib/format";

// XE KY GUI TAI KHACH BUON: xe da xuat cho khach buon (don ban loai "Khách buôn") nhung CHUA co khach le sau cung
// -> dai ly chua xuat hoa don cho khach le, coi nhu xe van ton ky gui tai khach buon do.
const nf = (n) => (Number.isFinite(n) ? n.toLocaleString("vi-VN") : "—");
const f1 = (n) => (Number.isFinite(n) ? n.toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—");
const soNgay = (d) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000));
const mau = (n, c) => (n > 0 ? c : "text-[#C6CDD6]");
const gom = (ds, keyOf, them) => {
  const m = new Map();
  ds.forEach((x) => {
    const k = keyOf(x);
    if (!m.has(k)) m.set(k, { key: k, ton: 0, b30: 0, b60: 0, b90: 0, b90p: 0, tt: 0, gt: 0, ...them(x) });
    const o = m.get(k);
    o.ton += x.sl; o.tt += x.tuoi * x.sl; o.gt += x.gt;
    o[x.tuoi <= 30 ? "b30" : x.tuoi <= 60 ? "b60" : x.tuoi <= 90 ? "b90" : "b90p"] += x.sl;
  });
  return [...m.values()].sort((a, b) => b.ton - a.ton || String(a.ten).localeCompare(String(b.ten)));
};

export default function TonKyGui() {
  const { supabase, vehicles, locations, regions, loading, settings, profile, refresh } = useCatalog();
  const { toast, notify } = useToast();
  const can = usePerms(supabase, profile);
  const [nhac, setNhac] = useState(null); // { ngay, lap } dang sua
  const [nhacBusy, setNhacBusy] = useState(false);
  const nguong = parseInt((settings || {}).ky_gui_nhac_ngay ?? "30", 10) || 0;
  const lapLai = parseInt((settings || {}).ky_gui_nhac_lap_ngay ?? "7", 10) || 7;
  const luuNhac = async () => {
    const ngay = Math.max(0, parseInt(nhac.ngay, 10) || 0), lap = Math.max(1, parseInt(nhac.lap, 10) || 7);
    setNhacBusy(true);
    const r1 = await supabase.rpc("fn_set_setting", { p_key: "ky_gui_nhac_ngay", p_value: String(ngay) });
    const r2 = r1.error ? r1 : await supabase.rpc("fn_set_setting", { p_key: "ky_gui_nhac_lap_ngay", p_value: String(lap) });
    setNhacBusy(false);
    if (r2.error) return notify(errMsg(r2.error), "err");
    notify(ngay ? `Đã lưu: nhắc khi xe ký gửi quá ${ngay} ngày.` : "Đã tắt nhắc xe ký gửi."); setNhac(null); refresh && refresh();
  };
  const chayNhac = async () => {
    if (!confirm("Chạy nhắc ngay bây giờ? Hệ thống sẽ tạo việc cho Cửa hàng trưởng và gửi thông báo Discord cho các khách buôn có xe ký gửi quá hạn (bỏ qua khách đã có việc đang mở hoặc vừa nhắc).")) return;
    setNhacBusy(true);
    const { data, error } = await supabase.rpc("fn_ky_gui_nhac_now");
    setNhacBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(data?.tat ? "Tính năng nhắc đang tắt." : `Quá hạn: ${data?.so_xe || 0} xe · đã tạo ${data?.viec_moi || 0} việc mới.`);
  };
  const [rows, setRows] = useState(null);
  const [moNhap, setMoNhap] = useState(false);
  const [lanTai, setLanTai] = useState(0);
  const [loi, setLoi] = useState("");
  const [chiVF, setChiVF] = useState(false);
  const [fKh, setFKh] = useState([]);
  const [fModel, setFModel] = useState("");
  const [fRegion, setFRegion] = useState("");
  const [fTuoi, setFTuoi] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [soDong, setSoDong] = useState(20);

  useEffect(() => {
    if (loading) return;
    (async () => {
      const all = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from("sales_orders")
          .select("id, code, sale_date, status, customer_id, customer_name, customer_phone, vehicle_id, frame_number, location_code, quantity, sale_price, seller_name, don_buon_id")
          .eq("customer_type", "Khách buôn").is("end_customer_id", null)
          .not("status", "in", '("Đã hủy","Đã trả hàng")').order("sale_date").range(from, from + 999);
        if (error) { setLoi(error.message || String(error)); break; }
        all.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      setRows(all);
    })();
  }, [loading, supabase, lanTai]);

  const ds = useMemo(() => (rows || []).map((o) => {
    const v = vehicles.find((x) => x.id === o.vehicle_id) || {};
    const l = locations.find((x) => x.code === o.location_code) || {};
    const sl = Number(o.quantity) || 1;
    return { ...o, v, l, sl, tuoi: soNgay(o.sale_date), gt: (Number(o.sale_price) || 0) * sl, vf: (v.brand || "").toUpperCase().includes("VINFAST") };
  }), [rows, vehicles, locations]);

  if (loading || rows === null) return <div className="card">{loi ? `Lỗi tải dữ liệu: ${loi}` : "Đang tải…"}</div>;

  const kw = q.trim().toLowerCase();
  const loc = ds.filter((x) => (!chiVF || x.vf) && (!fKh.length || fKh.includes(String(x.customer_id))) && (!fModel || x.v.name === fModel)
    && (!fRegion || x.l.region === fRegion)
    && (!fTuoi || (fTuoi === "30" ? x.tuoi <= 30 : fTuoi === "60" ? x.tuoi > 30 && x.tuoi <= 60 : fTuoi === "90" ? x.tuoi > 60 && x.tuoi <= 90 : x.tuoi > 90))
    && (!kw || `${x.frame_number} ${x.code} ${x.customer_name} ${x.customer_phone} ${x.v.name} ${x.v.color}`.toLowerCase().includes(kw)));
  const tong = loc.reduce((s, x) => s + x.sl, 0);
  const tren30 = loc.filter((x) => x.tuoi > 30).reduce((s, x) => s + x.sl, 0);
  const tuoiTB = tong ? loc.reduce((s, x) => s + x.tuoi * x.sl, 0) / tong : NaN;
  const theoKh = gom(loc, (x) => String(x.customer_id), (x) => ({ ten: x.customer_name, phone: x.customer_phone }));
  const theoModel = gom(loc, (x) => x.v.name || x.vehicle_id, (x) => ({ ten: x.v.name || x.vehicle_id, brand: x.v.brand }));
  const sk = [...loc].sort((a, b) => b.tuoi - a.tuoi);
  const khOpts = [...new Map(ds.filter((x) => !chiVF || x.vf).map((x) => [String(x.customer_id), { key: String(x.customer_id), label: x.customer_name }])).values()].sort((a, b) => a.label.localeCompare(b.label));
  const modelOpts = [...new Set(ds.filter((x) => !chiVF || x.vf).map((x) => x.v.name).filter(Boolean))].sort();
  const dangLoc = fKh.length || fModel || fRegion || fTuoi || q || chiVF;
  const boLoc = () => { setFKh([]); setFModel(""); setFRegion(""); setFTuoi(""); setQ(""); setChiVF(false); setPage(1); };
  const tuoiCls = (t) => (t > 90 ? "text-danger" : t > 60 ? "text-[#C2410C]" : t > 30 ? "text-[#A25F00]" : "");

  const xuat = () => downloadXLSX("xe_ky_gui_khach_buon.xlsx", [
    ["STT", "Khách buôn", "SĐT", "Hãng", "Mã xe", "Tên xe", "Màu", "Số khung", "Ngày xuất cho khách buôn", "Số ngày ký gửi", "Mã đơn bán", "Cửa hàng xuất", "Khu vực", "Giá niêm yết", "NV bán"],
    ...[...loc].sort((a, b) => String(a.customer_name).localeCompare(String(b.customer_name)) || b.tuoi - a.tuoi).map((x, i) => [i + 1, x.customer_name, x.customer_phone || "", x.v.brand || "", x.vehicle_id, x.v.name || "", x.v.color || "",
      x.frame_number || "", x.sale_date, x.tuoi, x.code, x.l.name || x.location_code || "", x.l.region || "", x.gt, x.seller_name || ""]),
  ], "Xe_ky_gui");

  const BangTuoi = ({ first, data, onPick, picked, sub }) => (
    <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
      <thead><tr>
        <th className="th">{first}</th><th className="th text-right">Số xe</th><th className="th text-right">≤30</th><th className="th text-right">31–60</th>
        <th className="th text-right">61–90</th><th className="th text-right">&gt;90</th><th className="th text-right">Trên 30 ngày</th><th className="th text-right">Tuổi TB</th><th className="th text-right">Giá niêm yết</th>
      </tr></thead>
      <tbody>
        {data.map((o) => (
          <tr key={o.key} className={`hover:bg-[#F8FAFC] cursor-pointer ${picked(o) ? "bg-[#EAF2FF]" : ""}`} onClick={() => { onPick(o); setPage(1); }}>
            <td data-m="title" className="td font-semibold text-[13px]">{o.ten} {sub(o) && <span className="text-[10.5px] text-[#8A93A0] font-normal">· {sub(o)}</span>}</td>
            <td data-m="end" className="td text-right font-extrabold tabular-nums">{nf(o.ton)}</td>
            <td data-label="≤30" data-m={o.b30 ? undefined : "hide"} className="td text-right tabular-nums">{nf(o.b30)}</td>
            <td data-label="31–60" data-m={o.b60 ? undefined : "hide"} className={`td text-right tabular-nums ${mau(o.b60, "text-[#A25F00] font-bold")}`}>{nf(o.b60)}</td>
            <td data-label="61–90" data-m={o.b90 ? undefined : "hide"} className={`td text-right tabular-nums ${mau(o.b90, "text-[#C2410C] font-bold")}`}>{nf(o.b90)}</td>
            <td data-label=">90" data-m={o.b90p ? undefined : "hide"} className={`td text-right tabular-nums ${mau(o.b90p, "text-danger font-bold")}`}>{nf(o.b90p)}</td>
            <td data-label="Trên 30 ngày" className="td text-right tabular-nums"><b>{nf(o.ton - o.b30)}</b> <span className="text-[10.5px] text-[#8A93A0]">({o.ton ? Math.round(100 * (o.ton - o.b30) / o.ton) : 0}%)</span></td>
            <td data-label="Tuổi TB" className="td text-right tabular-nums">{f1(o.tt / o.ton)}</td>
            <td data-label="Giá niêm yết" className="td text-right tabular-nums">{fmtVND(o.gt)}</td>
          </tr>))}
        {data.length > 0 && (
          <tr className="bg-[#F3F5F8] font-extrabold">
            <td data-m="title" className="td">TỔNG</td><td data-m="end" className="td text-right">{nf(tong)}</td>
            <td data-label="≤30" className="td text-right">{nf(tong - tren30)}</td>
            <td data-label="31–60" className="td text-right">{nf(data.reduce((s, o) => s + o.b60, 0))}</td>
            <td data-label="61–90" className="td text-right">{nf(data.reduce((s, o) => s + o.b90, 0))}</td>
            <td data-label=">90" className="td text-right">{nf(data.reduce((s, o) => s + o.b90p, 0))}</td>
            <td data-label="Trên 30 ngày" className="td text-right">{nf(tren30)}</td>
            <td data-label="Tuổi TB" className="td text-right">{f1(tuoiTB)}</td>
            <td data-label="Giá niêm yết" className="td text-right">{fmtVND(data.reduce((s, o) => s + o.gt, 0))}</td>
          </tr>)}
        {data.length === 0 && <tr><td className="td" colSpan={9}>Không có xe ký gửi nào khớp bộ lọc.</td></tr>}
      </tbody>
    </table></div>
  );

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      {moNhap && <NhapKhachLeHangLoat supabase={supabase} ds={loc} notify={notify} onDone={() => setLanTai((n) => n + 1)} onClose={() => setMoNhap(false)} />}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Xe ký gửi tại khách buôn</div>
        {(can("xuat_ban") || can("sua_khach")) && <button className="btn-primary !text-xs" onClick={() => setMoNhap(true)}>👤 Nhập khách lẻ hàng loạt</button>}
        <button className="btn-ghost !text-xs" onClick={xuat}>⬇ Xuất Excel</button>
      </div>
      <div className="rounded-xl bg-[#EAF2FF] text-[#1E3A6E] text-[12.5px] px-3 py-2">
        Xe đã xuất cho <b>khách buôn</b> nhưng <b>chưa có khách lẻ sau cùng</b> (chưa xuất hóa đơn cho khách lẻ) — coi như xe đang tồn ký gửi tại khách buôn đó.
        Số ngày ký gửi tính từ ngày bán trên đơn. Khi nhập khách lẻ sau cùng ở Đơn bán, xe tự rời khỏi báo cáo này.
      </div>

      <div className="rounded-xl border border-[#F0C000] bg-[#FFFCF0] text-[12.5px] px-3 py-2 flex items-center gap-2 flex-wrap">
        <span className="mr-auto">🔔 {nguong > 0
          ? <>Tự động nhắc lúc <b>8h sáng hằng ngày</b>: khách buôn có xe ký gửi quá <b>{nguong} ngày</b> → tạo việc cho <b>Cửa hàng trưởng</b> khu vực xuất xe (hạn 3 ngày) và báo Discord. Mỗi khách buôn nhắc lại sau <b>{lapLai} ngày</b> nếu việc trước đã xong mà xe vẫn chưa bán.</>
          : <>Nhắc xe ký gửi quá hạn đang <b>tắt</b>.</>}</span>
        {can("cai_dat") && !nhac && <button className="btn-ghost !text-xs" onClick={() => setNhac({ ngay: String(nguong), lap: String(lapLai) })}>⚙ Cài đặt nhắc</button>}
        {can("cai_dat") && !nhac && nguong > 0 && <button className="btn-ghost !text-xs" disabled={nhacBusy} onClick={chayNhac}>{nhacBusy ? "Đang chạy…" : "▶ Chạy nhắc ngay"}</button>}
        {nhac && (
          <div className="flex items-center gap-2 flex-wrap w-full">
            <span>Nhắc khi ký gửi quá</span><input type="number" min="0" className="inp !w-20 !py-1 !text-xs" value={nhac.ngay} onChange={(e) => setNhac({ ...nhac, ngay: e.target.value })} /><span>ngày (0 = tắt) · nhắc lại sau</span>
            <input type="number" min="1" className="inp !w-20 !py-1 !text-xs" value={nhac.lap} onChange={(e) => setNhac({ ...nhac, lap: e.target.value })} /><span>ngày</span>
            <button className="btn-ok !text-xs" disabled={nhacBusy} onClick={luuNhac}>Lưu</button><button className="btn-ghost !text-xs" onClick={() => setNhac(null)}>Hủy</button>
          </div>)}
      </div>

      <div className="card">
        <div className="flex gap-2 flex-wrap items-center">
          <input className="inp !w-64 max-md:!w-full" placeholder="Tìm số khung, mã đơn, khách buôn, tên xe…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <LocGon n={(fKh.length ? 1 : 0) + (fModel ? 1 : 0) + (fRegion ? 1 : 0) + (fTuoi ? 1 : 0) + (chiVF ? 1 : 0)}>
            <MultiCheck label="Khách buôn: tất cả" value={fKh} onChange={(v) => { setFKh(v); setPage(1); }} options={khOpts} />
            <select className="inp !w-auto" value={fModel} onChange={(e) => { setFModel(e.target.value); setPage(1); }}><option value="">Model: tất cả</option>{modelOpts.map((m) => <option key={m}>{m}</option>)}</select>
            <select className="inp !w-auto" value={fRegion} onChange={(e) => { setFRegion(e.target.value); setPage(1); }}><option value="">Khu vực xuất: tất cả</option>{regions.map((r) => <option key={r}>{r}</option>)}</select>
            <select className="inp !w-auto" value={fTuoi} onChange={(e) => { setFTuoi(e.target.value); setPage(1); }}>
              <option value="">Số ngày ký gửi: tất cả</option><option value="30">≤ 30 ngày</option><option value="60">31–60 ngày</option><option value="90">61–90 ngày</option><option value="90p">Trên 90 ngày</option></select>
            <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer" title="Chỉ xem xe VinFast (hãng bắt buộc nhập khách lẻ sau cùng)">
              <input type="checkbox" className="w-4 h-4" checked={chiVF} onChange={(e) => { setChiVF(e.target.checked); setFKh([]); setFModel(""); setPage(1); }} />Chỉ xe VinFast</label>
          </LocGon>
          {dangLoc ? <button className="btn-ghost !text-xs" onClick={boLoc}>✕ Bỏ lọc</button> : null}
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <KPI label="Xe đang ký gửi" value={nf(tong)} tone="dark" />
        <KPI label="Khách buôn đang giữ xe" value={nf(theoKh.length)} tone="blue" />
        <KPI label="Trên 30 ngày" value={nf(tren30)} tone="red" sub={tong ? `${Math.round(100 * tren30 / tong)}% xe ký gửi` : ""} />
        <KPI label="Tuổi ký gửi bình quân" value={`${f1(tuoiTB)} ngày`} tone="blue" />
        <KPI label="Giá trị theo giá niêm yết" value={fmtVND(loc.reduce((s, x) => s + x.gt, 0))} tone="dark" />
      </div>

      <div className="card">
        <div className="font-extrabold mb-2">📍 Theo khách buôn ({theoKh.length}) <span className="text-[11px] font-normal text-[#8A93A0]">· bấm một dòng để lọc</span></div>
        <BangTuoi first="Khách buôn" data={theoKh} sub={(o) => o.phone} picked={(o) => fKh.length === 1 && fKh[0] === o.key} onPick={(o) => setFKh(fKh.length === 1 && fKh[0] === o.key ? [] : [o.key])} />
      </div>

      <div className="card">
        <div className="font-extrabold mb-2">🛵 Theo model ({theoModel.length})</div>
        <BangTuoi first="Model" data={theoModel} sub={(o) => o.brand} picked={(o) => fModel === o.key} onPick={(o) => setFModel(fModel === o.key ? "" : o.key)} />
      </div>

      <div className="card">
        <div className="font-extrabold mb-2">Danh sách xe ký gửi ({sk.length})</div>
        <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
          <thead><tr><th className="th">Số khung</th><th className="th">Model · màu</th><th className="th">Khách buôn</th><th className="th">Ngày xuất</th><th className="th text-right">Số ngày ký gửi</th><th className="th">Đơn bán</th><th className="th">Cửa hàng xuất</th><th className="th text-right">Giá niêm yết</th></tr></thead>
          <tbody>{pageSlice(sk, page, soDong).map((x) => (
            <tr key={x.id} className="hover:bg-[#F8FAFC]">
              <td data-m="title" className="td font-mono text-[12px] font-bold">{x.frame_number || <span className="text-[#8A93A0] font-sans font-normal">(chưa có số khung)</span>}{x.sl > 1 && <span className="font-sans"> ×{x.sl}</span>}</td>
              <td data-m="nolabel full" className="td text-[13px]">{x.v.name || x.vehicle_id} <span className="text-[#8A93A0]">· {x.v.color}</span></td>
              <td data-m="nolabel" className="td text-[13px] font-semibold">{x.customer_name}</td>
              <td data-label="Xuất" className="td text-xs whitespace-nowrap">{fmtDate(x.sale_date)}</td>
              <td data-m="end" className="td text-right"><b className={tuoiCls(x.tuoi)}>{x.tuoi}</b><span className="md:hidden text-[11px] font-normal text-[#8A93A0]"> ngày</span></td>
              <td data-label="Đơn" className="td text-xs"><Link href={`/don-ban/${x.id}`} className="text-brand hover:underline font-semibold">{x.code}</Link>{x.don_buon_id ? <span className="ml-1"><Badge tone="blue">Đơn buôn</Badge></span> : null}</td>
              <td data-label="Xuất từ" className="td text-xs">{x.l.name || x.location_code}</td>
              <td data-label="Niêm yết" className="td text-right text-xs tabular-nums">{fmtVND(x.gt)}</td>
            </tr>))}
            {sk.length === 0 && <tr><td className="td" colSpan={8}>Không có xe ký gửi nào khớp bộ lọc.</td></tr>}
          </tbody>
        </table></div>
        <Pager total={sk.length} page={page} setPage={setPage} pageSize={soDong} setPageSize={setSoDong} />
      </div>
    </div>
  );
}
