"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, LocSearch, Pager, pageSlice, useSortable, Th } from "@/components/ui";
import { fmtVND, fmtDate, errMsg, downloadCSV } from "@/lib/format";

const iso = (d) => d.toLocaleDateString("sv-SE");
const firstOfMonth = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };

export default function LaiGopCongNo() {
  const { supabase, vehicles, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [tab, setTab] = useState("lai");
  const [rows, setRows] = useState([]);
  const [noDon, setNoDon] = useState([]);
  const [noKhach, setNoKhach] = useState([]);
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(iso(new Date()));
  const [fLoc, setFLoc] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const sort = useSortable();
  const sortN = useSortable();

  const load = async () => {
    setBusy(true);
    let qy = supabase.from("v_lai_gop_don").select("*").gte("sale_date", from).lte("sale_date", to).order("sale_date", { ascending: false }).limit(3000);
    if (fLoc) qy = qy.eq("location_code", fLoc);
    const [{ data: lg }, { data: nd }, { data: nk }] = await Promise.all([
      qy,
      supabase.from("v_cong_no_don").select("*").order("tuoi_no", { ascending: false }).limit(2000),
      supabase.from("v_cong_no_khach").select("*").order("tong_no", { ascending: false }).limit(500),
    ]);
    setRows(lg || []); setNoDon(nd || []); setNoKhach(nk || []); setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading, from, to, fLoc]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  if (!["CEO", "ADMIN", "MANAGER"].includes(profile.role)) return <div className="card">Bạn không có quyền xem báo cáo lãi gộp / công nợ.</div>;

  const vName = (id) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.name} ${v.color}` : id; };
  const locName = (c) => locations.find((l) => l.code === c)?.name || c;

  const doanhThu = rows.reduce((a, b) => a + b.doanh_thu, 0);
  const giaVon = rows.reduce((a, b) => a + b.gia_von, 0);
  const laiGop = rows.reduce((a, b) => a + b.lai_gop, 0);
  const chuaCoGiaVon = rows.filter((r) => r.gia_von === 0).length;
  const tyLe = doanhThu > 0 ? Math.round((laiGop / doanhThu) * 1000) / 10 : 0;

  // Gom theo mau xe
  const theoXe = {};
  rows.forEach((r) => {
    const k = r.vehicle_id;
    theoXe[k] = theoXe[k] || { xe: vName(k), sl: 0, dt: 0, gv: 0, lg: 0 };
    theoXe[k].sl += r.quantity; theoXe[k].dt += r.doanh_thu; theoXe[k].gv += r.gia_von; theoXe[k].lg += r.lai_gop;
  });
  const xeRows = Object.values(theoXe).sort((a, b) => b.lg - a.lg);

  const kw = q.trim().toLowerCase();
  const laiRows = sort.sortFn(rows.filter((r) => !kw || `${r.code} ${r.customer_name} ${r.frame_number} ${vName(r.vehicle_id)}`.toLowerCase().includes(kw)),
    { code: (r) => r.code, ngay: (r) => r.sale_date, xe: (r) => vName(r.vehicle_id), kh: (r) => r.customer_name,
      dt: (r) => r.doanh_thu, gv: (r) => r.gia_von, lg: (r) => r.lai_gop });

  const khachRows = sortN.sortFn(noKhach.filter((k) => !kw || `${k.customer_name} ${k.customer_phone}`.toLowerCase().includes(kw)),
    { ten: (k) => k.customer_name, no: (k) => k.tong_no, tuoi: (k) => k.tuoi_no_max, don: (k) => k.so_don });

  const tongNo = noKhach.reduce((a, b) => a + Number(b.tong_no), 0);
  const noQua30 = noDon.filter((d) => d.tuoi_no > 30);

  const thuThem = async (d) => {
    const a = prompt(`Đơn ${d.code} — tổng ${fmtVND(d.tong_don)}, đã trả ${fmtVND(d.da_tra)}.\nNhập TỔNG số tiền khách đã trả (sau khi thu thêm):`, d.da_tra);
    if (a === null) return;
    const n = prompt("Ghi chú (VD: thu thêm 2tr tiền mặt ngày 22/7):") || "";
    const { error } = await supabase.rpc("fn_cap_nhat_da_tra", { p_id: d.id, p_paid: Number(a) || 0, p_note: n });
    if (error) return notify(errMsg(error), "err");
    notify("Đã cập nhật thanh toán."); load();
  };

  const exportLai = () => {
    downloadCSV(`lai_gop_${from}_den_${to}.csv`,
      [["Mã đơn", "Ngày", "Kho", "Xe", "Số khung", "Khách", "NV bán", "Doanh thu", "Giá vốn", "Lãi gộp", "Tỷ lệ %"],
       ...laiRows.map((r) => [r.code, r.sale_date, locName(r.location_code), vName(r.vehicle_id), r.frame_number,
         r.customer_name, r.seller_name, r.doanh_thu, r.gia_von, r.lai_gop, r.doanh_thu ? Math.round(r.lai_gop / r.doanh_thu * 1000) / 10 : 0])]);
    notify(`Đã xuất ${laiRows.length} đơn.`);
  };
  const exportNo = () => {
    downloadCSV(`cong_no_${iso(new Date())}.csv`,
      [["Mã đơn", "Ngày bán", "Khách", "SĐT", "Loại khách", "Tổng đơn", "Đã trả", "Còn nợ", "Tuổi nợ (ngày)", "NV bán"],
       ...noDon.map((d) => [d.code, d.sale_date, d.customer_name, d.customer_phone, d.customer_type, d.tong_don, d.da_tra, d.con_no, d.tuoi_no, d.seller_name])]);
    notify(`Đã xuất ${noDon.length} đơn còn nợ.`);
  };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Lãi gộp & Công nợ</div>
        <input type="date" className="inp !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="inp !w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
        <div className="!w-48"><LocSearch locations={locations} value={fLoc} onChange={setFLoc} placeholder="Lọc kho…" /></div>
      </div>

      <div className="flex gap-1.5">
        <button className={`btn !px-3 !py-2 !text-xs ${tab === "lai" ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => { setTab("lai"); setPage(1); }}>Lãi gộp</button>
        <button className={`btn !px-3 !py-2 !text-xs ${tab === "no" ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => { setTab("no"); setPage(1); }}>Công nợ khách ({noKhach.length})</button>
      </div>

      {tab === "lai" && (
        <>
          <div className="flex gap-3 flex-wrap">
            <KPI label="Doanh thu" value={fmtVND(doanhThu)} tone="blue" />
            <KPI label="Giá vốn" value={fmtVND(giaVon)} tone="dark" />
            <KPI label="Lãi gộp" value={fmtVND(laiGop)} tone={laiGop >= 0 ? "green" : "red"} />
            <KPI label="Tỷ lệ lãi" value={tyLe + "%"} tone={tyLe >= 10 ? "green" : "amber"} />
            <KPI label="Đơn chưa có giá vốn" value={chuaCoGiaVon} tone={chuaCoGiaVon ? "red" : "green"} />
          </div>
          {chuaCoGiaVon > 0 && (
            <div className="card !py-2.5 bg-[#FFF6E5] border border-[#F0C000]">
              <div className="text-[13px]"><b>⚠ {chuaCoGiaVon} đơn chưa có giá vốn</b> — lãi gộp đang tính thiếu. Vào <b>Danh mục xe → tab # Theo số khung</b> để nhập giá vốn từng chiếc, hoặc đặt <b>giá vốn mặc định</b> cho mẫu xe.</div>
            </div>
          )}

          <div className="card">
            <div className="font-extrabold mb-2">Lãi gộp theo mẫu xe ({xeRows.length})</div>
            <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
              <thead><tr><th className="th">Mẫu xe</th><th className="th text-center">SL bán</th><th className="th">Doanh thu</th><th className="th">Giá vốn</th><th className="th">Lãi gộp</th><th className="th">Tỷ lệ</th></tr></thead>
              <tbody>{xeRows.map((x, i) => (
                <tr key={i} className="hover:bg-[#F8FAFC]">
                  <td className="td font-semibold text-[13px]">{x.xe}</td>
                  <td className="td text-center">{x.sl}</td>
                  <td className="td">{fmtVND(x.dt)}</td>
                  <td className="td text-[#8A93A0]">{fmtVND(x.gv)}</td>
                  <td className="td"><b className={x.lg >= 0 ? "text-[#0E7A4A]" : "text-danger"}>{fmtVND(x.lg)}</b></td>
                  <td className="td text-xs">{x.dt ? Math.round(x.lg / x.dt * 1000) / 10 : 0}%</td>
                </tr>
              ))}
              {xeRows.length === 0 && <tr><td className="td" colSpan={6}>Chưa có đơn bán nào trong khoảng ngày này.</td></tr>}
              </tbody>
            </table></div>
          </div>

          <div className="card">
            <div className="flex gap-2 items-center mb-2 flex-wrap">
              <div className="font-extrabold mr-auto">Chi tiết từng đơn ({laiRows.length})</div>
              <input className="inp !w-56" placeholder="Tìm mã đơn, khách, số khung…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
              <button className="btn-ghost !text-xs" onClick={exportLai}>⬇ CSV</button>
            </div>
            <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
              <thead><tr>
                <Th label="Mã đơn" k="code" sort={sort} /><Th label="Ngày" k="ngay" sort={sort} /><Th label="Xe" k="xe" sort={sort} />
                <Th label="Khách" k="kh" sort={sort} /><Th label="Doanh thu" k="dt" sort={sort} /><Th label="Giá vốn" k="gv" sort={sort} /><Th label="Lãi gộp" k="lg" sort={sort} />
              </tr></thead>
              <tbody>{pageSlice(laiRows, page, 20).map((r) => (
                <tr key={r.id} className={r.gia_von === 0 ? "bg-[#FFFCF5]" : "hover:bg-[#F8FAFC]"}>
                  <td className="td font-bold text-xs">{r.code}</td>
                  <td className="td text-xs whitespace-nowrap">{fmtDate(r.sale_date)}</td>
                  <td className="td text-[13px]">{vName(r.vehicle_id)}<div className="font-mono text-[10px] text-[#8A93A0]">{r.frame_number}</div></td>
                  <td className="td text-[13px]">{r.customer_name}</td>
                  <td className="td">{fmtVND(r.doanh_thu)}</td>
                  <td className="td text-[#8A93A0]">{r.gia_von === 0 ? <span className="text-danger text-xs">chưa có</span> : fmtVND(r.gia_von)}</td>
                  <td className="td"><b className={r.lai_gop >= 0 ? "text-[#0E7A4A]" : "text-danger"}>{fmtVND(r.lai_gop)}</b></td>
                </tr>
              ))}</tbody>
            </table></div>
            <Pager total={laiRows.length} page={page} setPage={setPage} pageSize={20} setPageSize={() => {}} />
          </div>
        </>
      )}

      {tab === "no" && (
        <>
          <div className="flex gap-3 flex-wrap">
            <KPI label="Tổng công nợ" value={fmtVND(tongNo)} tone={tongNo ? "red" : "green"} />
            <KPI label="Số khách nợ" value={noKhach.length} tone="amber" />
            <KPI label="Đơn còn nợ" value={noDon.length} tone="dark" />
            <KPI label="Nợ quá 30 ngày" value={noQua30.length} tone={noQua30.length ? "red" : "green"} />
          </div>

          <div className="card">
            <div className="flex gap-2 items-center mb-2 flex-wrap">
              <div className="font-extrabold mr-auto">Công nợ theo khách ({khachRows.length})</div>
              <input className="inp !w-56" placeholder="Tìm tên / SĐT khách…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
              <button className="btn-ghost !text-xs" onClick={exportNo}>⬇ CSV</button>
            </div>
            <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
              <thead><tr><Th label="Khách hàng" k="ten" sort={sortN} /><th className="th">SĐT</th><th className="th">Loại</th>
                <Th label="Số đơn" k="don" sort={sortN} /><Th label="Tổng nợ" k="no" sort={sortN} /><Th label="Nợ lâu nhất" k="tuoi" sort={sortN} /></tr></thead>
              <tbody>{pageSlice(khachRows, page, 20).map((k, i) => (
                <tr key={i} className={k.tuoi_no_max > 30 ? "bg-[#FFF6F6]" : "hover:bg-[#F8FAFC]"}>
                  <td className="td font-semibold text-[13px]">{k.customer_name}</td>
                  <td className="td text-xs">{k.customer_phone}</td>
                  <td className="td text-xs">{k.customer_type}</td>
                  <td className="td text-center">{k.so_don}</td>
                  <td className="td"><b className="text-danger">{fmtVND(k.tong_no)}</b></td>
                  <td className="td"><Badge tone={k.tuoi_no_max > 60 ? "red" : k.tuoi_no_max > 30 ? "amber" : "dark"}>{k.tuoi_no_max} ngày</Badge></td>
                </tr>
              ))}
              {khachRows.length === 0 && <tr><td className="td" colSpan={6}>Không có công nợ nào. 👍</td></tr>}
              </tbody>
            </table></div>
            <Pager total={khachRows.length} page={page} setPage={setPage} pageSize={20} setPageSize={() => {}} />
          </div>

          <div className="card">
            <div className="font-extrabold mb-2">Chi tiết đơn còn nợ ({noDon.length})</div>
            <div className="flex flex-col gap-1.5">
              {noDon.slice(0, 50).map((d) => (
                <div key={d.id} className={`flex items-center gap-2 p-2.5 rounded-xl border text-[13px] ${d.tuoi_no > 30 ? "border-[#F5B5B5] bg-[#FFF6F6]" : "border-[#E3E8EF]"}`}>
                  <div className="mr-auto min-w-0">
                    <div className="font-semibold">{d.code} · {d.customer_name} <span className="text-[11px] text-[#8A93A0]">{d.customer_phone}</span></div>
                    <div className="text-[11px] text-[#8A93A0]">{fmtDate(d.sale_date)} · {locName(d.location_code)} · {d.seller_name} · tổng {fmtVND(d.tong_don)}, đã trả {fmtVND(d.da_tra)}</div>
                  </div>
                  <Badge tone={d.tuoi_no > 60 ? "red" : d.tuoi_no > 30 ? "amber" : "dark"}>{d.tuoi_no} ngày</Badge>
                  <b className="text-danger whitespace-nowrap">{fmtVND(d.con_no)}</b>
                  <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => thuThem(d)}>Thu thêm</button>
                </div>
              ))}
              {noDon.length > 50 && <div className="text-xs text-[#8A93A0]">Hiển thị 50 đơn nợ lâu nhất — xuất CSV để xem đầy đủ.</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
