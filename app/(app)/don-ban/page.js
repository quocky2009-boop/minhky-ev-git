"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, Pager, pageSlice, pageClamp, useSortable, Th, LocSearch } from "@/components/ui";
import { fmtVND, fmtDate, fmtTime, errMsg, downloadCSV } from "@/lib/format";
import { printOrder } from "@/lib/print";
import Link from "next/link";

const iso = (d) => d.toLocaleDateString("sv-SE");
const firstOfMonth = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };

export default function DonBan() {
  const { supabase, vehicles, locations, settings, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [rows, setRows] = useState([]);
  const [itemSum, setItemSum] = useState({});
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(iso(new Date()));
  const [fLoc, setFLoc] = useState("");
  const [fInv, setFInv] = useState("");
  const [q, setQ] = useState("");
  const _params = useSearchParams();
  useEffect(() => { const v = _params.get("q"); if (v) setQ(v); }, [_params]);
  // Tu mo chi tiet khi den tu o tim kiem toan cuc (khop dung 1 don)
  const [_autoOpened, _setAutoOpened] = useState(false);
  useEffect(() => {
    const v = _params.get("q");
    if (!v || _autoOpened || rows.length === 0) return;
    const hit = rows.filter((o) => o.code.toLowerCase() === v.toLowerCase());
    if (hit.length === 1) { _setAutoOpened(true); openDetail(hit[0]); }
  }, [_params, rows]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const sort = useSortable();
  const [invId, setInvId] = useState(null);
  const [invF, setInvF] = useState({ no: "", date: iso(new Date()), bh: false, app: false });
  const [detail, setDetail] = useState(null);

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

  const isVF = (o) => (vOf(o.vehicle_id)?.brand || "").toUpperCase().includes("VINFAST");
  const confirmInv = async (o) => {
    if (!invF.no.trim()) return notify("Bắt buộc nhập số hóa đơn.", "err");
    if (!invF.bh) return notify("Phải tích xác nhận đã kích hoạt bảo hành cho xe.", "err");
    if (isVF(o) && !invF.app) return notify("Xe VinFast: phải tích xác nhận đã kích hoạt app VF eScooter.", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_xac_nhan_hoa_don", { p: { id: o.id, invoice_no: invF.no, invoice_date: invF.date, warranty_activated: invF.bh, app_activated: invF.app } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đơn ${o.code} hoàn thành: HĐ ${invF.no}, đã kích hoạt bảo hành${invF.app ? " + app VF eScooter" : ""}.`);
    setInvId(null); setInvF({ no: "", date: iso(new Date()), bh: false, app: false }); load();
  };

  const cancelInv = async (o) => {
    const ly = prompt(`Hủy xác nhận HĐ ${o.invoice_no} của đơn ${o.code}?\nNhập lý do:`);
    if (ly === null) return;
    const { error } = await supabase.rpc("fn_huy_xac_nhan_hoa_don", { p_id: o.id, p_ly_do: ly });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã hủy xác nhận HĐ đơn ${o.code} (có lưu vết).`); load();
  };

  const openDetail = async (o) => {
    setDetail({ ...o, _items: null });
    const { data: di } = await supabase.from("sale_items").select("*").eq("sale_code", o.code);
    setDetail((d) => (d && d.id === o.id ? { ...d, _items: di || [] } : d));
  };

  const deleteOrder = async (o) => {
    const ly = prompt("XOA VINH VIEN don " + o.code + "?\n- Xe " + o.frame_number + " se HOAN VE TON KHO (neu chua ban lai)\n- Xoa ca ban kem + yeu cau sua gia + anh dinh kem\n- Co luu vet vao lich su kho\n\nNhap LY DO xoa (bat buoc):");
    if (ly === null) return;
    if (!ly.trim()) return notify("Phải nhập lý do xóa đơn.", "err");
    setBusy(true);
    try {
      const paths = (o.photos || []).map((ph) => ph.path).filter(Boolean);
      if (paths.length > 0) await supabase.storage.from("don-ban").remove(paths);
    } catch (e) {}
    const { error } = await supabase.rpc("fn_xoa_don", { p_id: o.id, p_ly_do: ly });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã xóa đơn " + o.code + " — xe hoàn về tồn kho (nếu hợp lệ), có lưu vết.");
    setDetail(null); load();
  };

  const exportCSV = () => {
    downloadCSV(`don_ban_${from}_den_${to}.csv`,
      [["Ma_Don","Ngay_Ban","Kho","Xe","Mau","So_Khung","Khach","SDT","Tong_Don","Da_TT","Trang_Thai_HD","So_HD","Ngay_HD","Nguoi_Xac_Nhan","Kich_Hoat_Bao_Hanh","Kich_Hoat_App","NV_Ban"],
       ...sorted.map((o) => { const v = vOf(o.vehicle_id);
         return [o.code, o.sale_date, locName(o.location_code), v?.name || o.vehicle_id, v?.color || "", o.frame_number,
           o.customer_name, o.customer_phone, total(o), o.paid_amount || 0,
           o.invoice_status || "Chờ xuất HĐ", o.invoice_no || "", o.invoice_date || "", o.invoice_by_name || "", o.warranty_activated ? "Có" : "Chưa", o.app_activated ? "Có" : "Chưa", o.seller_name]; })]);
    notify(`Đã xuất ${sorted.length} đơn.`);
  };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex gap-3 flex-wrap">
        <KPI label="Chờ hoàn thiện (HĐ/BH/App)" value={nCho} tone={nCho ? "amber" : "dark"} />
        <KPI label="Đã hoàn thành" value={nXong} tone="green" />
        <KPI label="Tổng đơn" value={rows.length} tone="dark" />
        <KPI label="Doanh số" value={fmtVND(doanhSo)} tone="blue" />
      </div>

      <div className="card">
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <div className="font-extrabold mr-auto">Danh sách đơn bán ({sorted.length})</div>
          <Link href="/ban-hang?new=1" className="btn-primary !text-xs">+ Tạo đơn bán mới</Link>
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
            <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
              <thead><tr><th className="th w-10">STT</th><Th label="Mã đơn" k="code" sort={sort} /><Th label="Ngày" k="date" sort={sort} /><Th label="Xe · Số khung" k="xe" sort={sort} /><Th label="Kho" k="kho" sort={sort} /><Th label="Khách" k="kh" sort={sort} /><Th label="Tổng đơn" k="tien" sort={sort} /><Th label="Hóa đơn" k="hd" sort={sort} /><Th label="NV bán" k="nv" sort={sort} /><th className="th"></th></tr></thead>
              <tbody>{pageSlice(sorted, page, pageSize).map((o, i) => {
                const v = vOf(o.vehicle_id);
                const st = o.invoice_status || "Chờ xuất HĐ";
                const done = st === "Đã xuất HĐ";
                return [
                  <tr key={o.id} className={invId === o.id ? "bg-[#FDF6E3]" : done ? "hover:bg-[#F8FAFC]" : "bg-[#FFFCF5] hover:bg-[#FDF6E3]"}>
                    <td data-label="STT" className="td text-center text-xs text-[#8A93A0]">{(pageClamp(page, sorted.length, pageSize) - 1) * pageSize + i + 1}</td>
                    <td data-label="Mã đơn" className="td font-bold">{o.code}</td>
                    <td data-label="Ngày" className="td text-xs whitespace-nowrap">{fmtDate(o.sale_date)}</td>
                    <td data-label="Xe" className="td text-[13px]">{v ? `${v.name} ${v.color}` : o.vehicle_id}<div className="font-mono text-[10.5px] text-[#8A93A0]">{o.frame_number}</div></td>
                    <td data-label="Kho" className="td text-xs">{locName(o.location_code)}</td>
                    <td data-label="Khách" className="td text-[13px]">{o.customer_name}<div className="text-[10.5px] text-[#8A93A0]">{o.customer_phone}</div></td>
                    <td data-label="Tổng đơn" className="td font-bold">{fmtVND(total(o))}</td>
                    <td data-label="Hóa đơn" className="td">{done
                      ? <><Badge tone="green">✓ Hoàn thành</Badge><div className="text-[10.5px] text-[#8A93A0] mt-0.5">HĐ {o.invoice_no} · {fmtDate(o.invoice_date)}<br/>{o.invoice_by_name}<br/>BH ✓{o.app_activated ? " · App ✓" : ""}</div></>
                      : <Badge tone="amber">Chờ xuất HĐ</Badge>}</td>
                    <td data-label="NV bán" className="td text-xs">{o.seller_name}</td>
                    <td className="td"><div className="flex gap-1.5">
                      {!done && canConfirm && <button className={`!px-2.5 !py-1 !text-xs ${invId === o.id ? "btn-primary" : "btn-ok"}`} onClick={() => { setInvId(invId === o.id ? null : o.id); setInvF({ no: "", date: iso(new Date()), bh: false, app: false }); }}>{invId === o.id ? "Đóng" : "✓ Xác nhận HĐ"}</button>}
                      <button className="btn-ghost !px-2 !py-1 !text-xs" title="Chi tiết đơn" onClick={() => openDetail(o)}>👁</button>
                      <button className="btn-ghost !px-2 !py-1 !text-xs" title="In phiếu xuất" onClick={() => printOrder({ supabase, o, vehicles, locations, settings, notify })}>🖨</button>
                      {done && canCancel && <button className="btn-ghost !px-2 !py-1 !text-xs hover:text-danger" title="Hủy xác nhận" onClick={() => cancelInv(o)}>↺</button>}
                    </div></td>
                  </tr>,
                  invId === o.id && (
                    <tr key={o.id + "f"}><td colSpan={10} className="td bg-[#FFFDF5]">
                      <div className="flex gap-1.5 items-end flex-wrap">
                        <div><label className="lbl">Số hóa đơn (bắt buộc)</label><input className="inp !py-2 !w-48" autoFocus value={invF.no} onChange={(e) => setInvF((p) => ({ ...p, no: e.target.value }))} placeholder="VD: 00012345" /></div>
                        <div><label className="lbl">Ngày xuất HĐ</label><input type="date" className="inp !py-2 !w-40" value={invF.date} onChange={(e) => setInvF((p) => ({ ...p, date: e.target.value }))} /></div>
                        <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer bg-white border border-[#D5DBE3] rounded-lg px-2.5 py-2">
                          <input type="checkbox" className="w-4 h-4" checked={invF.bh} onChange={(e) => setInvF((p) => ({ ...p, bh: e.target.checked }))} />
                          🛡 Đã kích hoạt bảo hành
                        </label>
                        {isVF(o) && (
                          <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer bg-white border border-[#D5DBE3] rounded-lg px-2.5 py-2">
                            <input type="checkbox" className="w-4 h-4" checked={invF.app} onChange={(e) => setInvF((p) => ({ ...p, app: e.target.checked }))} />
                            📱 Đã kích hoạt app VF eScooter
                          </label>
                        )}
                        <button className="btn-ok !py-2 !text-xs" disabled={busy} onClick={() => confirmInv(o)}>Xác nhận hoàn thành</button>
                        <span className="text-[10.5px] text-[#8A93A0]">Đủ số HĐ + bảo hành{isVF(o) ? " + app VF eScooter" : ""} thì đơn mới chuyển "Hoàn thành". Lưu vết người xác nhận + thời gian.</span>
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
        {detail && (() => {
          const v = vOf(detail.vehicle_id);
          const st = detail.invoice_status || "Chờ xuất HĐ";
          const kem = (detail._items || []).reduce((sm, it) => sm + it.amount, 0);
          const tong = detail.sale_price * detail.quantity + kem;
          return (
            <div className="fixed inset-0 z-[95] bg-black/50 flex items-center justify-center p-3" onClick={() => setDetail(null)}>
              <div className="bg-white rounded-2xl w-[600px] max-w-full max-h-[88vh] overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                  <div className="font-extrabold text-base mr-auto">Chi tiết đơn {detail.code}</div>
                  <button className="btn-primary !px-3 !py-1.5 !text-xs" onClick={() => printOrder({ supabase, o: detail, vehicles, locations, settings, notify })}>🖨 In phiếu</button>
                  {profile.role === "CEO" && <button className="btn-ghost !px-3 !py-1.5 !text-xs !text-danger" disabled={busy} onClick={() => deleteOrder(detail)}>🗑 Xóa đơn</button>}
                  <button className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => setDetail(null)}>✕</button>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                  <div><span className="text-[#8A93A0]">Ngày bán:</span> <b>{fmtDate(detail.sale_date)}</b></div>
                  <div><span className="text-[#8A93A0]">Kho xuất:</span> <b>{locName(detail.location_code)}</b></div>
                  <div className="col-span-2"><span className="text-[#8A93A0]">Xe:</span> <b>{v ? v.brand + " · " + v.name + " · " + v.color : detail.vehicle_id}</b> × {detail.quantity}</div>
                  {detail.frame_number && <div className="col-span-2"><span className="text-[#8A93A0]">Số khung:</span> <span className="font-mono font-bold">{detail.frame_number}</span></div>}
                  <div><span className="text-[#8A93A0]">Khách hàng:</span> <b>{detail.customer_name}</b></div>
                  <div><span className="text-[#8A93A0]">SĐT:</span> <b>{detail.customer_phone}</b></div>
                  <div><span className="text-[#8A93A0]">Giá xe:</span> <b>{fmtVND(detail.sale_price)}</b></div>
                  <div><span className="text-[#8A93A0]">Tổng đơn:</span> <b className="text-brand">{fmtVND(tong)}</b></div>
                  <div><span className="text-[#8A93A0]">Đã thanh toán:</span> <b>{fmtVND(detail.paid_amount || 0)}</b></div>
                  <div><span className="text-[#8A93A0]">HTTT giá xe:</span> <b>{detail.payment_method || "—"}</b></div>
                  {detail._items && detail._items.length > 0 && (() => {
                    const m = {}; const hx = detail.payment_method || "Chuyển khoản";
                    m[hx] = (m[hx] || 0) + detail.sale_price * detail.quantity;
                    detail._items.forEach((it) => { const k = it.payment_method || hx; m[k] = (m[k] || 0) + it.amount; });
                    return <div className="col-span-2 flex flex-wrap gap-1.5 mt-1">
                      <span className="text-[#8A93A0] text-xs self-center">Thu theo hình thức:</span>
                      {Object.entries(m).map(([k, v]) => <span key={k} className="inline-flex items-center gap-1 bg-[#F3F5F8] rounded-lg px-2 py-0.5 text-[11px]"><b>{k}:</b> {fmtVND(v)}</span>)}
                    </div>;
                  })()}
                  <div><span className="text-[#8A93A0]">NV bán:</span> <b>{detail.seller_name}</b></div>
                  <div className="col-span-2"><span className="text-[#8A93A0]">Trạng thái:</span> {st === "Đã xuất HĐ"
                    ? <><Badge tone="green">✓ Hoàn thành</Badge> <span className="text-xs">HĐ <b>{detail.invoice_no}</b> · {fmtDate(detail.invoice_date)} · {detail.invoice_by_name} · BH ✓{detail.app_activated ? " · App ✓" : ""}</span></>
                    : <Badge tone="amber">Chờ xuất HĐ</Badge>}</div>
                  {detail.note && <div className="col-span-2"><span className="text-[#8A93A0]">Ghi chú:</span> {detail.note}</div>}
                  {detail._items === null ? <div className="col-span-2 text-xs text-[#8A93A0]">Đang tải bán kèm…</div> : detail._items.length > 0 && (
                    <div className="col-span-2">
                      <span className="text-[#8A93A0]">Bán kèm:</span>
                      {detail._items.map((it, i) => <div key={i} className="text-xs ml-2">• {it.name} × {it.qty} <span className="text-[10px] text-[#8A93A0]">({it.payment_method || "—"})</span> = <b>{fmtVND(it.amount)}</b></div>)}
                    </div>
                  )}
                  {(detail.photos || []).length > 0 && (
                    <div className="col-span-2">
                      <span className="text-[#8A93A0]">Ảnh đính kèm ({detail.photos.length}):</span>
                      <div className="flex gap-2 flex-wrap mt-1">
                        {detail.photos.map((ph, i) => (
                          <a key={i} href={ph.url} target="_blank" rel="noreferrer"><img src={ph.url} alt="" className="w-20 h-20 object-cover rounded-lg border border-[#E3E8EF]" /></a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        <p className="text-[11px] text-[#8A93A0] mt-2">Đơn nền vàng = chưa xuất hóa đơn. Sales/Cửa hàng trưởng/Admin/BGĐ xác nhận sau khi đã xuất HĐ trên hệ thống hóa đơn điện tử; Admin/BGĐ hủy xác nhận được nếu ghi nhầm (có lưu vết).</p>
      </div>
    </div>
  );
}
