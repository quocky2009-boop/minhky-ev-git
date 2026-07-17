"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, Pager, pageSlice, pageClamp, useSortable, Th, LocSearch } from "@/components/ui";
import { fmtVND, fmtDate, fmtTime, errMsg, downloadCSV } from "@/lib/format";

const iso = (d) => d.toLocaleDateString("sv-SE");
const firstOfMonth = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };

export default function DonBan() {
  const { supabase, vehicles, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [rows, setRows] = useState([]);
  const [itemSum, setItemSum] = useState({});
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(iso(new Date()));
  const [fLoc, setFLoc] = useState("");
  const [fInv, setFInv] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const sort = useSortable();
  const [invId, setInvId] = useState(null);
  const [invF, setInvF] = useState({ no: "", date: iso(new Date()) });

  const load = async () => {
    setBusy(true);
    let qy = supabase.from("sales_orders").select("*").gte("sale_date", from).lte("sale_date", to)
      .order("created_at", { ascending: false }).limit(3000);
    if (fLoc) qy = qy.eq("location_code", fLoc);
    const [{ data }, { data: si }] = await Promise.all([qy, supabase.from("sale_items").select("sale_code, amount").limit(10000)]);
    setRows(data || []);
    const m = {};
    (si || []).forEach((x) => { m[x.sale_code] = (m[x.sale_code] || 0) + x.amount; });
    setItemSum(m); setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading, from, to, fLoc]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  const vOf = (id) => vehicles.find((x) => x.id === id);
  const locName = (c) => locations.find((l) => l.code === c)?.name || c;
  const total = (o) => o.sale_price * o.quantity + (itemSum[o.code] || 0);
  const canConfirm = ["SALES", "MANAGER", "ADMIN", "CEO"].includes(profile.role);
  const canCancel = ["ADMIN", "CEO"].includes(profile.role);

  const filtered = rows.filter((o) => {
    if (fInv && (o.invoice_status || "Chờ xuất HĐ") !== fInv) return false;
    if (!q) return true;
    const kw = q.toLowerCase();
    const v = vOf(o.vehicle_id);
    return `${o.code} ${o.customer_name} ${o.customer_phone} ${o.frame_number} ${o.invoice_no || ""} ${v ? v.name : ""} ${o.seller_name}`.toLowerCase().includes(kw);
  });
  const sorted = sort.sortFn(filtered, {
    code: (o) => o.code, date: (o) => o.sale_date, xe: (o) => vOf(o.vehicle_id)?.name || o.vehicle_id,
    kho: (o) => locName(o.location_code), kh: (o) => o.customer_name, tien: (o) => total(o),
    hd: (o) => o.invoice_status || "Chờ xuất HĐ", nv: (o) => o.seller_name,
  });
  const nCho = rows.filter((o) => (o.invoice_status || "Chờ xuất HĐ") === "Chờ xuất HĐ").length;
  const nXong = rows.length - nCho;
  const doanhSo = rows.reduce((s, o) => s + total(o), 0);

  const confirmInv = async (o) => {
    if (!invF.no.trim()) return notify("Bắt buộc nhập số hóa đơn.", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_xac_nhan_hoa_don", { p: { id: o.id, invoice_no: invF.no, invoice_date: invF.date } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đơn ${o.code} đã xác nhận xuất HĐ ${invF.no} — đơn hoàn thành.`);
    setInvId(null); setInvF({ no: "", date: iso(new Date()) }); load();
  };

  const cancelInv = async (o) => {
    const ly = prompt(`Hủy xác nhận HĐ ${o.invoice_no} của đơn ${o.code}?\nNhập lý do:`);
    if (ly === null) return;
    const { error } = await supabase.rpc("fn_huy_xac_nhan_hoa_don", { p_id: o.id, p_ly_do: ly });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã hủy xác nhận HĐ đơn ${o.code} (có lưu vết).`); load();
  };

  const exportCSV = () => {
    downloadCSV(`don_ban_${from}_den_${to}.csv`,
      [["Ma_Don","Ngay_Ban","Kho","Xe","Mau","So_Khung","Khach","SDT","Tong_Don","Da_TT","Trang_Thai_HD","So_HD","Ngay_HD","Nguoi_Xac_Nhan","NV_Ban"],
       ...sorted.map((o) => { const v = vOf(o.vehicle_id);
         return [o.code, o.sale_date, locName(o.location_code), v?.name || o.vehicle_id, v?.color || "", o.frame_number,
           o.customer_name, o.customer_phone, total(o), o.paid_amount || 0,
           o.invoice_status || "Chờ xuất HĐ", o.invoice_no || "", o.invoice_date || "", o.invoice_by_name || "", o.seller_name]; })]);
    notify(`Đã xuất ${sorted.length} đơn.`);
  };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex gap-3 flex-wrap">
        <KPI label="Chờ xuất HĐ" value={nCho} tone={nCho ? "amber" : "dark"} />
        <KPI label="Đã hoàn thành" value={nXong} tone="green" />
        <KPI label="Tổng đơn" value={rows.length} tone="dark" />
        <KPI label="Doanh số" value={fmtVND(doanhSo)} tone="blue" />
      </div>

      <div className="card">
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <div className="font-extrabold mr-auto">Danh sách đơn bán ({sorted.length})</div>
          <input type="date" className="inp !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" className="inp !w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
          <div className="!w-52"><LocSearch locations={locations} value={fLoc} onChange={setFLoc} placeholder="Lọc kho…" /></div>
          <select className="inp !w-auto" value={fInv} onChange={(e) => { setFInv(e.target.value); setPage(1); }}>
            <option value="">Hóa đơn: tất cả</option><option>Chờ xuất HĐ</option><option>Đã xuất HĐ</option>
          </select>
          <input className="inp !w-56" placeholder="Tìm mã đơn, khách, số khung, số HĐ…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <button className="btn-ghost !text-xs" onClick={exportCSV}>⬇ CSV</button>
        </div>

        {busy && rows.length === 0 ? <div className="text-sm text-[#8A93A0] py-4">Đang tải đơn bán…</div> : (
          <>
            <div className="overflow-x-auto"><table className="w-full border-collapse">
              <thead><tr><th className="th w-10">STT</th><Th label="Mã đơn" k="code" sort={sort} /><Th label="Ngày" k="date" sort={sort} /><Th label="Xe · Số khung" k="xe" sort={sort} /><Th label="Kho" k="kho" sort={sort} /><Th label="Khách" k="kh" sort={sort} /><Th label="Tổng đơn" k="tien" sort={sort} /><Th label="Hóa đơn" k="hd" sort={sort} /><Th label="NV bán" k="nv" sort={sort} /><th className="th"></th></tr></thead>
              <tbody>{pageSlice(sorted, page, pageSize).map((o, i) => {
                const v = vOf(o.vehicle_id);
                const st = o.invoice_status || "Chờ xuất HĐ";
                const done = st === "Đã xuất HĐ";
                return [
                  <tr key={o.id} className={invId === o.id ? "bg-[#FDF6E3]" : done ? "hover:bg-[#F8FAFC]" : "bg-[#FFFCF5] hover:bg-[#FDF6E3]"}>
                    <td className="td text-center text-xs text-[#8A93A0]">{(pageClamp(page, sorted.length, pageSize) - 1) * pageSize + i + 1}</td>
                    <td className="td font-bold">{o.code}</td>
                    <td className="td text-xs whitespace-nowrap">{fmtDate(o.sale_date)}</td>
                    <td className="td text-[13px]">{v ? `${v.name} ${v.color}` : o.vehicle_id}<div className="font-mono text-[10.5px] text-[#8A93A0]">{o.frame_number}</div></td>
                    <td className="td text-xs">{locName(o.location_code)}</td>
                    <td className="td text-[13px]">{o.customer_name}<div className="text-[10.5px] text-[#8A93A0]">{o.customer_phone}</div></td>
                    <td className="td font-bold">{fmtVND(total(o))}</td>
                    <td className="td">{done
                      ? <><Badge tone="green">✓ Hoàn thành</Badge><div className="text-[10.5px] text-[#8A93A0] mt-0.5">HĐ {o.invoice_no} · {fmtDate(o.invoice_date)}<br/>{o.invoice_by_name}</div></>
                      : <Badge tone="amber">Chờ xuất HĐ</Badge>}</td>
                    <td className="td text-xs">{o.seller_name}</td>
                    <td className="td"><div className="flex gap-1.5">
                      {!done && canConfirm && <button className={`!px-2.5 !py-1 !text-xs ${invId === o.id ? "btn-primary" : "btn-ok"}`} onClick={() => { setInvId(invId === o.id ? null : o.id); setInvF({ no: "", date: iso(new Date()) }); }}>{invId === o.id ? "Đóng" : "✓ Xác nhận HĐ"}</button>}
                      {done && canCancel && <button className="btn-ghost !px-2 !py-1 !text-xs hover:text-danger" title="Hủy xác nhận" onClick={() => cancelInv(o)}>↺</button>}
                    </div></td>
                  </tr>,
                  invId === o.id && (
                    <tr key={o.id + "f"}><td colSpan={10} className="td bg-[#FFFDF5]">
                      <div className="flex gap-1.5 items-end flex-wrap">
                        <div><label className="lbl">Số hóa đơn (bắt buộc)</label><input className="inp !py-2 !w-48" autoFocus value={invF.no} onChange={(e) => setInvF((p) => ({ ...p, no: e.target.value }))} placeholder="VD: 00012345" /></div>
                        <div><label className="lbl">Ngày xuất HĐ</label><input type="date" className="inp !py-2 !w-40" value={invF.date} onChange={(e) => setInvF((p) => ({ ...p, date: e.target.value }))} /></div>
                        <button className="btn-ok !py-2 !text-xs" disabled={busy} onClick={() => confirmInv(o)}>Xác nhận đã xuất HĐ</button>
                        <span className="text-[10.5px] text-[#8A93A0]">Xác nhận xong đơn chuyển "Hoàn thành", lưu vết người xác nhận + thời gian.</span>
                      </div>
                    </td></tr>
                  ),
                ];
              })}
              {sorted.length === 0 && <tr><td className="td" colSpan={10}>Không có đơn bán nào khớp bộ lọc.</td></tr>}
              </tbody>
            </table></div>
            <Pager total={sorted.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
          </>
        )}
        <p className="text-[11px] text-[#8A93A0] mt-2">Đơn nền vàng = chưa xuất hóa đơn. Sales/Cửa hàng trưởng/Admin/BGĐ xác nhận sau khi đã xuất HĐ trên hệ thống hóa đơn điện tử; Admin/BGĐ hủy xác nhận được nếu ghi nhầm (có lưu vết).</p>
      </div>
    </div>
  );
}
