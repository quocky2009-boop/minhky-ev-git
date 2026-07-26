"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, Field, LocSearch, Pager, pageSlice, useSortable, Th, useSelection, ThCheck, TdCheck, SelectionBar } from "@/components/ui";
import { fmtDate, errMsg, downloadCSV } from "@/lib/format";

const iso = (d) => d.toLocaleDateString("sv-SE");
const HAN_NGAY = 7; // qua 7 ngay ke tu ngay nhap ma chua co COC -> bao do

const COC_TT = {
  CHUA_VE: { label: "Chưa về", tone: "amber" },
  DA_VE: { label: "Đã về kho", tone: "green" },
  DA_GIAO: { label: "Đã giao khách", tone: "blue" },
  THAT_LAC: { label: "Thất lạc", tone: "red" },
};

export default function GiayCOC() {
  const { supabase, vehicles, locations, brands, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [units, setUnits] = useState([]);
  const [los, setLos] = useState([]);
  const [tab, setTab] = useState("xe"); // xe | lo
  const [fTT, setFTT] = useState("CHUA_VE");
  const [fBrand, setFBrand] = useState("");
  const [fLoc, setFLoc] = useState("");
  const [fLo, setFLo] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [busy, setBusy] = useState(false);
  const sort = useSortable();
  const sel = useSelection();

  const canSua = profile && ["CEO", "MANAGER", "ADMIN"].includes(profile.role);

  const load = async () => {
    setBusy(true);
    const [{ data: u }, { data: l }] = await Promise.all([
      supabase.from("vehicle_units").select("*").neq("status", "DA_XOA").order("imported_at", { ascending: false }).limit(5000),
      supabase.from("v_coc_lo").select("*").order("ngay_nhap", { ascending: false }).limit(500),
    ]);
    setUnits(u || []); setLos(l || []);
    setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  const vOf = (id) => vehicles.find((x) => x.id === id);
  const locName = (c) => locations.find((l) => l.code === c)?.name || c || "—";
  const soNgay = (u) => Math.floor((Date.now() - new Date(u.imported_at)) / 86400000);
  const treHan = (u) => u.coc_status === "CHUA_VE" && soNgay(u) > HAN_NGAY;

  const kw = q.trim().toLowerCase();
  const rows = units.filter((u) => {
    if (fTT && u.coc_status !== fTT) return false;
    if (fBrand && vOf(u.vehicle_id)?.brand !== fBrand) return false;
    if (fLoc && u.location_code !== fLoc) return false;
    if (fLo && (u.import_doc || "") !== fLo) return false;
    if (!kw) return true;
    const v = vOf(u.vehicle_id);
    return `${u.frame_number} ${u.import_doc} ${v ? v.brand + " " + v.name + " " + v.color : u.vehicle_id}`.toLowerCase().includes(kw);
  });
  const sorted = sort.sortFn(rows, {
    frame: (u) => u.frame_number, xe: (u) => { const v = vOf(u.vehicle_id); return v ? `${v.brand} ${v.name}` : u.vehicle_id; },
    kho: (u) => locName(u.location_code), lo: (u) => u.import_doc, nhap: (u) => u.imported_at,
    ngay: (u) => soNgay(u), tt: (u) => u.coc_status, nhan: (u) => u.coc_received_at,
  });

  // KPI tren toan bo xe (khong theo bo loc trang thai)
  const all = units.filter((u) => (!fBrand || vOf(u.vehicle_id)?.brand === fBrand) && (!fLoc || u.location_code === fLoc));
  const nChua = all.filter((u) => u.coc_status === "CHUA_VE").length;
  const nTre = all.filter(treHan).length;
  const nCo = all.filter((u) => u.coc_status === "DA_VE").length;
  const nGiao = all.filter((u) => u.coc_status === "DA_GIAO").length;
  const nMat = all.filter((u) => u.coc_status === "THAT_LAC").length;

  const chon = () => sorted.filter((u) => sel.has(u.frame_number));

  const nhanCOC = async () => {
    const rs = chon();
    const ngay = prompt(`Đánh dấu ĐÃ NHẬN giấy COC cho ${rs.length} xe.\n\nNgày nhận (YYYY-MM-DD):`, iso(new Date()));
    if (ngay === null) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_coc_nhan", { p: { frames: rs.map((u) => u.frame_number), received_at: ngay } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    sel.clear();
    notify(`Đã cập nhật ${data} xe có giấy COC.`);
    load();
  };

  const datTT = async (tt) => {
    const rs = chon();
    if (!confirm(`Đặt trạng thái COC = "${COC_TT[tt].label}" cho ${rs.length} xe?`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_coc_dat_trang_thai", { p: { frames: rs.map((u) => u.frame_number), status: tt } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    sel.clear();
    notify(`Đã cập nhật ${data} xe.`);
    load();
  };

  const xuat = (rs, ten) => {
    downloadCSV(ten, [["Số khung", "Xe", "Kho", "Lô nhập", "Ngày nhập", "Số ngày", "Trạng thái COC", "Ngày nhận COC"],
      ...rs.map((u) => { const v = vOf(u.vehicle_id); return [u.frame_number, v ? `${v.brand} ${v.name} ${v.color}` : u.vehicle_id, locName(u.location_code), u.import_doc, fmtDate(u.imported_at), soNgay(u), COC_TT[u.coc_status]?.label || u.coc_status, u.coc_received_at ? fmtDate(u.coc_received_at) : ""]; })]);
    notify(`Đã xuất ${rs.length} dòng.`);
  };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Giấy COC (chứng nhận xuất xưởng)</div>
        <button className="btn-ghost !text-xs" onClick={() => xuat(sorted, `giay_coc_${iso(new Date())}.csv`)}>⬇ Xuất file</button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <KPI label="Chưa có COC" value={nChua} tone="amber" />
        <KPI label={`Quá ${HAN_NGAY} ngày chưa có`} value={nTre} tone={nTre > 0 ? "red" : "dark"} />
        <KPI label="Đã về kho" value={nCo} tone="green" />
        <KPI label="Đã giao khách" value={nGiao} tone="blue" />
        {nMat > 0 && <KPI label="Thất lạc" value={nMat} tone="red" />}
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {[["xe", "Theo từng xe"], ["lo", `Theo lô nhập (${los.length})`]].map(([k, v]) => (
          <button key={k} className={`btn !px-3 !py-2 !text-xs ${tab === k ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => { setTab(k); setPage(1); }}>{v}</button>
        ))}
      </div>

      {tab === "xe" && (
        <div className="card">
          <div className="flex gap-2 items-center mb-3 flex-wrap">
            <div className="font-extrabold mr-auto">Danh sách xe ({sorted.length})</div>
            <select className="inp !w-auto" value={fTT} onChange={(e) => { setFTT(e.target.value); setPage(1); sel.clear(); }}>
              <option value="">Trạng thái: tất cả</option>
              {Object.entries(COC_TT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select className="inp !w-auto" value={fBrand} onChange={(e) => { setFBrand(e.target.value); setPage(1); }}>
              <option value="">Hãng: tất cả</option>
              {(brands || []).map((b) => <option key={b.name}>{b.name}</option>)}
            </select>
            <div className="!w-48"><LocSearch locations={locations} value={fLoc} onChange={(v) => { setFLoc(v); setPage(1); }} placeholder="Lọc kho…" /></div>
            <select className="inp !w-auto" value={fLo} onChange={(e) => { setFLo(e.target.value); setPage(1); }}>
              <option value="">Lô: tất cả</option>
              {[...new Set(units.map((u) => u.import_doc).filter(Boolean))].map((d) => <option key={d}>{d}</option>)}
            </select>
            <input className="inp !w-48" placeholder="Tìm số khung, lô, tên xe…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>

          {canSua && (
            <SelectionBar sel={sel}>
              <button className="btn-ok !text-xs !py-1" disabled={busy} onClick={nhanCOC}>✓ Đã nhận COC</button>
              <button className="btn-ghost !text-xs !py-1 !text-danger" disabled={busy} onClick={() => datTT("THAT_LAC")}>⚠ Báo thất lạc</button>
              <button className="btn-ghost !text-xs !py-1" disabled={busy} onClick={() => datTT("CHUA_VE")}>↩ Đặt lại Chưa về</button>
              <button className="btn-ghost !text-xs !py-1" onClick={() => xuat(chon(), "giay_coc_chon.csv")}>⬇ Xuất Excel</button>
            </SelectionBar>
          )}

          <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
            <thead><tr>
              <ThCheck sel={sel} rows={pageSlice(sorted, page, pageSize)} idOf={(u) => u.frame_number} />
              <Th label="Số khung" k="frame" sort={sort} />
              <Th label="Xe" k="xe" sort={sort} />
              <Th label="Kho" k="kho" sort={sort} />
              <Th label="Lô nhập" k="lo" sort={sort} />
              <Th label="Ngày nhập" k="nhap" sort={sort} />
              <Th label="Số ngày" k="ngay" sort={sort} />
              <Th label="Giấy COC" k="tt" sort={sort} />
            </tr></thead>
            <tbody>{pageSlice(sorted, page, pageSize).map((u) => {
              const v = vOf(u.vehicle_id);
              const tre = treHan(u);
              return (
                <tr key={u.frame_number} className={`${sel.has(u.frame_number) ? "bg-[#EAF2FF]" : tre ? "bg-[#FFF6F6]" : "hover:bg-[#F8FAFC]"}`}>
                  <TdCheck sel={sel} id={u.frame_number} />
                  <td data-label="Số khung" className="td font-mono text-[12.5px]">{u.frame_number}</td>
                  <td data-label="Xe" className="td text-[13px]">{v ? `${v.brand} ${v.name}` : u.vehicle_id}<div className="text-[11px] text-[#8A93A0]">{v?.color}</div></td>
                  <td data-label="Kho" className="td text-xs">{locName(u.location_code)}</td>
                  <td data-label="Lô nhập" className="td text-xs">{u.import_doc || "—"}</td>
                  <td data-label="Ngày nhập" className="td text-xs whitespace-nowrap">{fmtDate(u.imported_at)}</td>
                  <td data-label="Số ngày" className="td text-center"><span className={tre ? "text-danger font-bold" : ""}>{soNgay(u)}</span></td>
                  <td data-label="Giấy COC" className="td">
                    <Badge tone={COC_TT[u.coc_status]?.tone || "gray"}>{COC_TT[u.coc_status]?.label || u.coc_status}</Badge>
                    {u.coc_received_at && <div className="text-[10.5px] text-[#8A93A0] mt-0.5">nhận {fmtDate(u.coc_received_at)}</div>}
                    {tre && <div className="text-[10.5px] text-danger font-bold mt-0.5">quá {HAN_NGAY} ngày!</div>}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && <tr><td className="td" colSpan={8}>Không có xe nào khớp bộ lọc.</td></tr>}
            </tbody>
          </table></div>
          <Pager total={sorted.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
        </div>
      )}

      {tab === "lo" && (
        <div className="card">
          <div className="font-extrabold mb-1">Tiến độ COC theo lô nhập</div>
          <p className="text-xs text-[#5A6572] mb-3">Lô nào còn thiếu COC sẽ hiện nền đỏ. Bấm "Xem xe thiếu" để lọc nhanh sang tab từng xe và đánh dấu hàng loạt.</p>
          <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
            <thead><tr>
              <th className="th">Lô nhập</th><th className="th">Ngày nhập</th><th className="th">Hãng</th><th className="th">Kho</th>
              <th className="th">Tổng xe</th><th className="th">Chưa về</th><th className="th">Đã về</th><th className="th">Đã giao</th><th className="th">Tiến độ</th><th className="th"></th>
            </tr></thead>
            <tbody>{los.map((l, i) => {
              const xong = l.tong_xe - l.chua_ve - l.that_lac;
              const pct = l.tong_xe ? Math.round((xong / l.tong_xe) * 100) : 0;
              const tre = l.chua_ve > 0 && l.so_ngay > HAN_NGAY;
              return (
                <tr key={l.lo + i} className={tre ? "bg-[#FFF6F6]" : "hover:bg-[#F8FAFC]"}>
                  <td data-label="Lô" className="td font-bold">{l.lo}</td>
                  <td data-label="Ngày nhập" className="td text-xs whitespace-nowrap">{fmtDate(l.ngay_nhap)}<div className={`text-[10.5px] ${tre ? "text-danger font-bold" : "text-[#8A93A0]"}`}>{l.so_ngay} ngày trước</div></td>
                  <td data-label="Hãng" className="td text-[13px]">{l.hang}</td>
                  <td data-label="Kho" className="td text-xs">{locName(l.location_code)}</td>
                  <td data-label="Tổng xe" className="td text-center font-bold">{l.tong_xe}</td>
                  <td data-label="Chưa về" className="td text-center">{l.chua_ve > 0 ? <b className="text-danger">{l.chua_ve}</b> : <span className="text-[#C6CDD6]">0</span>}</td>
                  <td data-label="Đã về" className="td text-center text-[#0E7A4A] font-bold">{l.da_ve}</td>
                  <td data-label="Đã giao" className="td text-center">{l.da_giao}</td>
                  <td data-label="Tiến độ" className="td">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-2 rounded-full bg-[#EEF1F4] overflow-hidden min-w-[60px]">
                        <div className={`h-full ${pct === 100 ? "bg-[#0E7A4A]" : tre ? "bg-danger" : "bg-brand"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] font-bold">{pct}%</span>
                    </div>
                  </td>
                  <td className="td">{l.chua_ve > 0 && (
                    <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => { setFLo(l.lo === "(không rõ lô)" ? "" : l.lo); setFTT("CHUA_VE"); setTab("xe"); setPage(1); }}>Xem xe thiếu</button>
                  )}</td>
                </tr>
              );
            })}
            {los.length === 0 && <tr><td className="td" colSpan={10}>Chưa có lô nhập nào.</td></tr>}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}
