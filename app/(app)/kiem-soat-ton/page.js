"use client";
import { useEffect, useMemo, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, Pager, pageSlice } from "@/components/ui";
import { fmtDate, errMsg } from "@/lib/format";

const iso = (d) => d.toLocaleDateString("sv-SE");
const TRANG = { TON_KHO: "Khả dụng", GIU_CHO: "Giữ chỗ", DANG_CHUYEN: "Đang chuyển" };
const nf = (n) => (Number.isFinite(n) ? n.toLocaleString("vi-VN") : "—");
const f1 = (n) => (Number.isFinite(n) ? n.toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—");
const sum = (arr, k) => arr.reduce((a, b) => a + (Number(b[k]) || 0), 0);
const gt30 = (r) => (Number(r.b60) || 0) + (Number(r.b90) || 0) + (Number(r.b90p) || 0);

function Delta({ cur, prev }) {
  if (prev == null) return null;
  const d = cur - prev;
  if (d === 0) return <span className="text-[10.5px] text-[#8A93A0] ml-1">= so sánh</span>;
  return <span className={`text-[10.5px] ml-1 font-bold ${d > 0 ? "text-[#A25F00]" : "text-[#0E7A4A]"}`}>{d > 0 ? "▲" : "▼"}{Math.abs(d)}</span>;
}

export default function KiemSoatTon() {
  const { supabase, vehicles, locations, brands, profile, loading, regions } = useCatalog();
  const { toast, notify } = useToast();
  const hom_nay = iso(new Date());
  const [ngay, setNgay] = useState(hom_nay);
  const [soSanh, setSoSanh] = useState("");
  const [fRegion, setFRegion] = useState("");
  const [fLoc, setFLoc] = useState("");
  const [fBrand, setFBrand] = useState("");
  const [fModel, setFModel] = useState("");
  const [fColor, setFColor] = useState("");
  const [fTrang, setFTrang] = useState("TON_KHO");
  const [rows, setRows] = useState(null);
  const [cmp, setCmp] = useState(null);
  const [ban, setBan] = useState([]);
  const [ngayLuu, setNgayLuu] = useState([]);
  const [busy, setBusy] = useState(false);
  const [sk, setSk] = useState(null);       // danh sach so khung
  const [skPage, setSkPage] = useState(1);

  const allowed = ["CEO", "MANAGER", "ADMIN"].includes(profile?.role);

  useEffect(() => {
    if (loading || !profile || !allowed) return;
    let dead = false;
    (async () => {
      setRows(null); setSk(null);
      const [a, b, c, d] = await Promise.all([
        supabase.rpc("fn_ton_tong_hop", { p_ngay: ngay }),
        supabase.rpc("fn_ban_theo_diem", { p_ngay: ngay, p_so_ngay: 30 }),
        soSanh ? supabase.rpc("fn_ton_tong_hop", { p_ngay: soSanh }) : Promise.resolve({ data: null }),
        supabase.rpc("fn_ton_ngay_da_luu"),
      ]);
      if (dead) return;
      if (a.error) notify(errMsg(a.error), "err");
      setRows(a.data || []); setBan(b.data || []); setCmp(soSanh ? (c.data || []) : null); setNgayLuu(d.data || []);
    })();
    return () => { dead = true; };
  }, [loading, profile, ngay, soSanh]);

  const vMap = useMemo(() => Object.fromEntries(vehicles.map((v) => [v.id, v])), [vehicles]);
  const lMap = useMemo(() => Object.fromEntries(locations.map((l) => [l.code, l])), [locations]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  if (!allowed) return <div className="card">Bạn không có quyền xem kiểm soát tồn kho.</div>;

  const locsOfRegion = locations.filter((l) => l.status !== "Đã xóa" && (!fRegion || l.region === fRegion));
  const brandList = [...new Set(vehicles.map((v) => v.brand))].sort();
  const modelList = [...new Set(vehicles.filter((v) => !fBrand || v.brand === fBrand).map((v) => v.name))].sort();
  const colorList = [...new Set(vehicles.filter((v) => (!fBrand || v.brand === fBrand) && (!fModel || v.name === fModel)).map((v) => v.color))].sort();

  const match = (r) => {
    const v = vMap[r.vehicle_id]; const l = lMap[r.location_code];
    if (!v || !l) return false;
    if (fRegion && l.region !== fRegion) return false;
    if (fLoc && r.location_code !== fLoc) return false;
    if (fBrand && v.brand !== fBrand) return false;
    if (fModel && v.name !== fModel) return false;
    if (fColor && v.color !== fColor) return false;
    return true;
  };
  const base = (rows || []).filter(match);            // chưa lọc theo trạng thái
  const sel = base.filter((r) => fTrang === "all" || r.trang_thai === fTrang);
  const cmpBase = cmp ? cmp.filter(match) : null;
  const cmpSel = cmpBase ? cmpBase.filter((r) => fTrang === "all" || r.trang_thai === fTrang) : null;

  const tong = (arr, tt) => sum(arr.filter((r) => !tt || r.trang_thai === tt), "so_xe");
  const kpiTon = tong(base, "TON_KHO"), kpiGc = tong(base, "GIU_CHO"), kpiDc = tong(base, "DANG_CHUYEN");
  const kha = base.filter((r) => r.trang_thai === "TON_KHO");
  const khaCmp = cmpBase ? cmpBase.filter((r) => r.trang_thai === "TON_KHO") : null;
  const kGt30 = kha.reduce((a, r) => a + gt30(r), 0);
  const kTuoi = kpiTon ? sum(kha, "tong_tuoi") / kpiTon : NaN;

  // ===== Theo điểm =====
  const byLoc = (() => {
    const m = {};
    sel.forEach((r) => { const k = r.location_code; (m[k] = m[k] || []).push(r); });
    const cm = {};
    (cmpSel || []).forEach((r) => { cm[r.location_code] = (cm[r.location_code] || 0) + r.so_xe; });
    const out = Object.entries(m).map(([code, arr]) => ({
      code, name: lMap[code]?.name || code, region: lMap[code]?.region || "",
      ton: sum(arr, "so_xe"), b30: sum(arr, "b30"), b60: sum(arr, "b60"), b90: sum(arr, "b90"), b90p: sum(arr, "b90p"), tt: sum(arr, "tong_tuoi"), prev: cmpSel ? (cm[code] || 0) : null,
    }));
    return out.sort((a, b) => (a.region === "Thành phố" ? 0 : 1) - (b.region === "Thành phố" ? 0 : 1) || a.region.localeCompare(b.region) || b.ton - a.ton);
  })();

  // ===== Theo model (gộp màu) =====
  const byModel = (() => {
    const m = {};
    sel.forEach((r) => {
      const v = vMap[r.vehicle_id]; const k = v.name;
      const o = (m[k] = m[k] || { name: k, brand: v.brand, ton: 0, b30: 0, b60: 0, b90: 0, b90p: 0, tt: 0, le: 0, buon: 0, prev: cmpSel ? 0 : null });
      o.ton += r.so_xe; o.b30 += r.b30; o.b60 += r.b60; o.b90 += r.b90; o.b90p += r.b90p; o.tt += r.tong_tuoi;
    });
    (cmpSel || []).forEach((r) => { const k = vMap[r.vehicle_id]?.name; if (k && m[k]) m[k].prev += r.so_xe; });
    ban.forEach((b) => {
      const v = vMap[b.vehicle_id]; const l = lMap[b.location_code];
      if (!v) return;
      if (fBrand && v.brand !== fBrand) return;
      if (fModel && v.name !== fModel) return;
      if (fColor && v.color !== fColor) return;
      if (fRegion && l?.region !== fRegion) return;
      if (fLoc && b.location_code !== fLoc) return;
      const o = (m[v.name] = m[v.name] || { name: v.name, brand: v.brand, ton: 0, b30: 0, b60: 0, b90: 0, b90p: 0, tt: 0, le: 0, buon: 0, prev: cmpSel ? 0 : null });
      o.le += Number(b.so_xe_le) || 0; o.buon += Number(b.so_xe_buon) || 0;
    });
    return Object.values(m).filter((o) => o.ton > 0 || o.le + o.buon > 0).sort((a, b) => b.ton - a.ton || a.name.localeCompare(b.name));
  })();
  const flagOf = (o) => {
    const days = o.le > 0 ? o.ton / (o.le / 30) : null;
    if (o.ton > 0 && days != null && days < 10) return { tone: "red", t: "Sắp hết" };
    if (o.ton > 0 && (gt30(o) * 2 >= o.ton || (days != null && days > 90))) return { tone: "amber", t: "Tồn lâu" };
    return null;
  };

  const locatTuoi = (o) => (o.ton ? f1(o.tt / o.ton) : "—");

  const resetLoc = () => { setFLoc(""); };
  const xemSoKhung = async () => {
    if (ngay !== hom_nay) return;
    setBusy(true);
    let q = supabase.from("vehicle_units").select("frame_number,vehicle_id,location_code,status,imported_at")
      .in("status", fTrang === "all" ? ["TON_KHO", "GIU_CHO", "DANG_CHUYEN"] : [fTrang]).order("imported_at").limit(5000);
    if (fLoc) q = q.eq("location_code", fLoc);
    else if (fRegion) q = q.in("location_code", locations.filter((l) => l.region === fRegion).map((l) => l.code));
    const { data, error } = await q;
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    const now = Date.now();
    const list = (data || []).filter((u) => {
      const v = vMap[u.vehicle_id];
      return v && (!fBrand || v.brand === fBrand) && (!fModel || v.name === fModel) && (!fColor || v.color === fColor);
    }).map((u) => ({ ...u, v: vMap[u.vehicle_id], tuoi: Math.max(0, Math.floor((now - new Date(u.imported_at).getTime()) / 86400000)) }))
      .sort((a, b) => b.tuoi - a.tuoi);
    setSk(list); setSkPage(1);
  };

  const guiDiscord = async () => {
    if (!confirm("Gửi báo cáo tồn kho (số hiện tại) về kênh Tồn kho trên Discord ngay bây giờ? Hệ thống cũng lưu số tồn hôm nay.")) return;
    setBusy(true);
    const { error } = await supabase.rpc("fn_ton_bao_cao_now");
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã gửi báo cáo tồn kho về Discord.");
  };

  const exportXLSX = async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const sh1 = [["Khu vực", "Điểm", "Tồn", "≤30 ngày", "31–60", "61–90", ">90", "Trên 30 ngày", "Tuổi TB (ngày)"],
      ...byLoc.map((o) => [o.region, o.name, o.ton, o.b30, o.b60, o.b90, o.b90p, o.b60 + o.b90 + o.b90p, o.ton ? Math.round(o.tt / o.ton * 10) / 10 : ""])];
    const sh2 = [["Hãng", "Model", "Tồn", "≤30 ngày", "31–60", "61–90", ">90", "Trên 30 ngày", "Bán lẻ 30 ngày", "Bán buôn 30 ngày", "Tốc độ lẻ/ngày", "Đủ hàng (ngày)", "Cảnh báo"],
      ...byModel.map((o) => [o.brand, o.name, o.ton, o.b30, o.b60, o.b90, o.b90p, o.b60 + o.b90 + o.b90p, o.le, o.buon, Math.round(o.le / 30 * 100) / 100, o.le > 0 ? Math.round(o.ton / (o.le / 30) * 10) / 10 : "", flagOf(o)?.t || ""])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh1), "Theo diem");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh2), "Theo model");
    if (sk) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Số khung", "Hãng", "Model", "Màu", "Điểm", "Trạng thái", "Ngày nhập", "Tuổi tồn"],
      ...sk.map((u) => [u.frame_number, u.v.brand, u.v.name, u.v.color, lMap[u.location_code]?.name || u.location_code, TRANG[u.status] || u.status, fmtDate(u.imported_at), u.tuoi])]), "So khung");
    XLSX.writeFile(wb, `kiem_soat_ton_${ngay}.xlsx`);
  };

  const mauTuoi = (n, cls) => (n > 0 ? cls : "text-[#C6CDD6]");
  const thTable = (first) => (
    <thead><tr>
      <th className="th">{first}</th><th className="th text-right">Tồn</th><th className="th text-right">≤30</th><th className="th text-right">31–60</th>
      <th className="th text-right">61–90</th><th className="th text-right">&gt;90</th><th className="th text-right">Trên 30 ngày</th><th className="th text-right">Tuổi TB</th>
    </tr></thead>
  );

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Kiểm soát tồn kho xe</div>
        <button className="btn-ghost !text-xs" onClick={exportXLSX} disabled={!rows}>⬇ Xuất Excel</button>
        <button className="btn-ghost !text-xs" onClick={guiDiscord} disabled={busy}>📤 Gửi báo cáo Discord ngay</button>
      </div>

      <div className="card">
        <div className="grid gap-2.5 md:grid-cols-4 sm:grid-cols-2">
          <div><label className="lbl">Xem tồn ngày</label>
            <div className="flex gap-1.5"><input type="date" className="inp" max={hom_nay} value={ngay} onChange={(e) => setNgay(e.target.value || hom_nay)} />
              {ngay !== hom_nay && <button className="btn-ghost !text-xs" onClick={() => setNgay(hom_nay)}>Hôm nay</button>}</div></div>
          <div><label className="lbl">So sánh với ngày</label>
            <div className="flex gap-1.5"><input type="date" className="inp" max={hom_nay} value={soSanh} onChange={(e) => setSoSanh(e.target.value)} />
              {soSanh && <button className="btn-ghost !text-xs" onClick={() => setSoSanh("")}>✕</button>}</div></div>
          <div><label className="lbl">Khu vực</label>
            <select className="inp" value={fRegion} onChange={(e) => { setFRegion(e.target.value); setFLoc(""); }}>
              <option value="">Tất cả khu vực</option>{regions.map((r) => <option key={r}>{r}</option>)}</select></div>
          <div><label className="lbl">Điểm cửa hàng / kho</label>
            <select className="inp" value={fLoc} onChange={(e) => setFLoc(e.target.value)}>
              <option value="">Tất cả điểm</option>{locsOfRegion.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select></div>
          <div><label className="lbl">Hãng</label>
            <select className="inp" value={fBrand} onChange={(e) => { setFBrand(e.target.value); setFModel(""); setFColor(""); }}>
              <option value="">Tất cả hãng</option>{brandList.map((b) => <option key={b}>{b}</option>)}</select></div>
          <div><label className="lbl">Model xe</label>
            <select className="inp" value={fModel} onChange={(e) => { setFModel(e.target.value); setFColor(""); }}>
              <option value="">Tất cả model</option>{modelList.map((m) => <option key={m}>{m}</option>)}</select></div>
          <div><label className="lbl">Màu</label>
            <select className="inp" value={fColor} onChange={(e) => setFColor(e.target.value)}>
              <option value="">Tất cả màu</option>{colorList.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label className="lbl">Trạng thái xe</label>
            <select className="inp" value={fTrang} onChange={(e) => setFTrang(e.target.value)}>
              <option value="TON_KHO">Khả dụng</option><option value="GIU_CHO">Giữ chỗ</option><option value="DANG_CHUYEN">Đang chuyển</option><option value="all">Tất cả</option></select></div>
        </div>
        <p className="text-[11px] text-[#8A93A0] mt-2">
          {ngay === hom_nay ? "Đang xem số tồn hiện tại (tính trực tiếp)." : rows && rows.length === 0 ? "Chưa có số tồn đã lưu cho ngày này — hệ thống chỉ lưu từ ngày bắt đầu dùng chức năng này, mỗi ngày lúc 17h30." : "Đang xem số tồn đã lưu của ngày này."}
          {" "}Ngày đã lưu: {ngayLuu.length ? ngayLuu.slice(0, 8).map((x) => fmtDate(x.ngay)).join(" · ") + (ngayLuu.length > 8 ? " …" : "") : "chưa có"}. Số bán dùng 30 ngày kết thúc ở ngày xem; bán lẻ và bán buôn (Khách buôn) tính riêng.
        </p>
      </div>

      {!rows ? <div className="card text-sm text-[#8A93A0]">Đang tải số liệu…</div> : (
        <>
          <div className="flex gap-3 flex-wrap">
            <KPI label="Tồn khả dụng" value={<>{nf(kpiTon)}<Delta cur={kpiTon} prev={khaCmp ? tong(khaCmp) : null} /></>} tone="dark" />
            <KPI label="Giữ chỗ" value={nf(kpiGc)} tone="amber" />
            <KPI label="Đang chuyển" value={nf(kpiDc)} tone="purple" />
            <KPI label="Trên 30 ngày" value={<>{nf(kGt30)}<Delta cur={kGt30} prev={khaCmp ? khaCmp.reduce((a, r) => a + gt30(r), 0) : null} /></>} sub={kpiTon ? `${f1(100 * kGt30 / kpiTon)}% tồn khả dụng` : ""} tone={kGt30 ? "red" : "dark"} />
            <KPI label="Tuổi tồn bình quân" value={Number.isFinite(kTuoi) ? `${f1(kTuoi)} ngày` : "—"} tone="blue" />
          </div>

          {(fRegion || fLoc || fBrand || fModel || fColor) && (
            <div className="flex gap-1.5 flex-wrap items-center text-xs">
              <span className="text-[#8A93A0]">Đang lọc:</span>
              {fRegion && <Badge tone="blue">{fRegion}</Badge>}
              {fLoc && <Badge tone="blue">{lMap[fLoc]?.name}</Badge>}
              {fBrand && <Badge tone="blue">{fBrand}</Badge>}
              {fModel && <Badge tone="blue">{fModel}</Badge>}
              {fColor && <Badge tone="blue">{fColor}</Badge>}
              <button className="btn-ghost !px-2 !py-0.5 !text-xs" onClick={() => { setFRegion(""); setFLoc(""); setFBrand(""); setFModel(""); setFColor(""); }}>✕ Bỏ lọc</button>
            </div>
          )}

          <div className="card">
            <div className="font-extrabold mb-2">📍 Theo điểm ({byLoc.length}) <span className="text-[11px] font-normal text-[#8A93A0]">· bấm một điểm để lọc</span></div>
            <div className="tbl-scroll"><table className="w-full border-collapse">
              {thTable("Điểm")}
              <tbody>
                {byLoc.map((o) => (
                  <tr key={o.code} className={`hover:bg-[#F8FAFC] cursor-pointer ${fLoc === o.code ? "bg-[#EAF2FF]" : ""}`} onClick={() => setFLoc(fLoc === o.code ? "" : o.code)}>
                    <td className="td font-semibold text-[13px]">{o.name} <span className="text-[10.5px] text-[#8A93A0]">· {o.region}</span></td>
                    <td className="td text-right font-extrabold tabular-nums">{nf(o.ton)}<Delta cur={o.ton} prev={o.prev} /></td>
                    <td className="td text-right tabular-nums">{nf(o.b30)}</td>
                    <td className={`td text-right tabular-nums ${mauTuoi(o.b60, "text-[#A25F00] font-bold")}`}>{nf(o.b60)}</td>
                    <td className={`td text-right tabular-nums ${mauTuoi(o.b90, "text-[#C2410C] font-bold")}`}>{nf(o.b90)}</td>
                    <td className={`td text-right tabular-nums ${mauTuoi(o.b90p, "text-danger font-bold")}`}>{nf(o.b90p)}</td>
                    <td className="td text-right tabular-nums font-bold">{nf(o.b60 + o.b90 + o.b90p)} <span className="text-[10.5px] text-[#8A93A0] font-normal">({o.ton ? Math.round(100 * (o.b60 + o.b90 + o.b90p) / o.ton) : 0}%)</span></td>
                    <td className="td text-right tabular-nums">{locatTuoi(o)}</td>
                  </tr>
                ))}
                {byLoc.length > 0 && (
                  <tr className="bg-[#F3F5F8] font-extrabold">
                    <td className="td">TỔNG</td><td className="td text-right">{nf(sum(byLoc, "ton"))}</td><td className="td text-right">{nf(sum(byLoc, "b30"))}</td><td className="td text-right">{nf(sum(byLoc, "b60"))}</td>
                    <td className="td text-right">{nf(sum(byLoc, "b90"))}</td><td className="td text-right">{nf(sum(byLoc, "b90p"))}</td>
                    <td className="td text-right">{nf(sum(byLoc, "b60") + sum(byLoc, "b90") + sum(byLoc, "b90p"))}</td>
                    <td className="td text-right">{sum(byLoc, "ton") ? f1(sum(byLoc, "tt") / sum(byLoc, "ton")) : "—"}</td>
                  </tr>
                )}
                {byLoc.length === 0 && <tr><td className="td" colSpan={8}>Không có xe nào khớp bộ lọc.</td></tr>}
              </tbody>
            </table></div>
          </div>

          <div className="card">
            <div className="font-extrabold mb-1">🛵 Theo model — tồn & tốc độ bán 30 ngày ({byModel.length}) <span className="text-[11px] font-normal text-[#8A93A0]">· bấm một model để lọc</span></div>
            <p className="text-[11px] text-[#8A93A0] mb-2">Đủ hàng (ngày) = tồn ÷ (bán lẻ 30 ngày ÷ 30). Bán buôn tính riêng, không đưa vào tốc độ bán. Chỉ là cảnh báo sớm, chưa phải căn cứ đặt hàng hay điều chuyển chắc chắn.</p>
            <div className="tbl-scroll"><table className="w-full border-collapse">
              <thead><tr>
                <th className="th">Model</th><th className="th text-right">Tồn</th><th className="th text-right">Trên 30 ngày</th>
                <th className="th text-right">Bán lẻ 30n</th><th className="th text-right">Bán buôn 30n</th><th className="th text-right">Lẻ/ngày</th><th className="th text-right">Đủ hàng (ngày)</th><th className="th">Cảnh báo</th>
              </tr></thead>
              <tbody>
                {byModel.map((o) => {
                  const fl = flagOf(o); const days = o.le > 0 ? o.ton / (o.le / 30) : null;
                  return (
                    <tr key={o.name} className={`hover:bg-[#F8FAFC] cursor-pointer ${fModel === o.name ? "bg-[#EAF2FF]" : ""}`} onClick={() => { setFModel(fModel === o.name ? "" : o.name); setFColor(""); }}>
                      <td className="td font-semibold text-[13px]">{o.name} <span className="text-[10.5px] text-[#8A93A0]">· {o.brand}</span></td>
                      <td className="td text-right font-extrabold tabular-nums">{nf(o.ton)}<Delta cur={o.ton} prev={o.prev} /></td>
                      <td className={`td text-right tabular-nums ${gt30(o) ? "font-bold text-[#A25F00]" : "text-[#C6CDD6]"}`}>{nf(gt30(o))}{o.ton ? <span className="text-[10.5px] text-[#8A93A0] font-normal"> ({Math.round(100 * gt30(o) / o.ton)}%)</span> : null}</td>
                      <td className="td text-right tabular-nums">{nf(o.le)}</td>
                      <td className="td text-right tabular-nums text-[#5A6572]">{nf(o.buon)}</td>
                      <td className="td text-right tabular-nums">{o.le ? (o.le / 30).toLocaleString("vi-VN", { maximumFractionDigits: 2 }) : "—"}</td>
                      <td className="td text-right tabular-nums font-bold">{days != null ? f1(days) : o.ton > 0 ? "∞" : "—"}</td>
                      <td className="td">{fl ? <Badge tone={fl.tone}>{fl.t}</Badge> : null}</td>
                    </tr>
                  );
                })}
                {byModel.length === 0 && <tr><td className="td" colSpan={8}>Không có dữ liệu khớp bộ lọc.</td></tr>}
              </tbody>
            </table></div>
          </div>

          <div className="card">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <div className="font-extrabold mr-auto">Danh sách số khung{sk ? ` (${sk.length})` : ""}</div>
              <button className="btn-primary !text-xs" onClick={xemSoKhung} disabled={busy || ngay !== hom_nay}>{sk ? "Tải lại" : "Xem số khung theo bộ lọc"}</button>
            </div>
            {ngay !== hom_nay && <div className="text-[12px] text-[#8A93A0]">Danh sách số khung chỉ xem được cho hôm nay. Ngày cũ chỉ lưu số tổng hợp.</div>}
            {sk && (
              <>
                <div className="tbl-scroll"><table className="w-full border-collapse">
                  <thead><tr><th className="th">Số khung</th><th className="th">Model · màu</th><th className="th">Điểm</th><th className="th">Trạng thái</th><th className="th">Ngày nhập</th><th className="th text-right">Tuổi tồn</th></tr></thead>
                  <tbody>{pageSlice(sk, skPage, 20).map((u) => (
                    <tr key={u.frame_number} className="hover:bg-[#F8FAFC]">
                      <td className="td font-mono text-[12px] font-bold">{u.frame_number}</td>
                      <td className="td text-[13px]">{u.v.name} <span className="text-[#8A93A0]">· {u.v.color}</span></td>
                      <td className="td text-xs">{lMap[u.location_code]?.name || u.location_code}</td>
                      <td className="td"><Badge tone={u.status === "TON_KHO" ? "green" : u.status === "GIU_CHO" ? "amber" : "purple"}>{TRANG[u.status]}</Badge></td>
                      <td className="td text-xs whitespace-nowrap">{fmtDate(u.imported_at)}</td>
                      <td className="td text-right"><b className={u.tuoi > 90 ? "text-danger" : u.tuoi > 60 ? "text-[#C2410C]" : u.tuoi > 30 ? "text-[#A25F00]" : ""}>{u.tuoi}</b></td>
                    </tr>
                  ))}
                  {sk.length === 0 && <tr><td className="td" colSpan={6}>Không có xe nào khớp bộ lọc.</td></tr>}</tbody>
                </table></div>
                <Pager total={sk.length} page={skPage} setPage={setSkPage} pageSize={20} setPageSize={() => {}} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
