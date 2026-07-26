"use client";
import { useEffect, useState } from "react";

const iso = (d) => d.toISOString().slice(0, 10);
function rangeOf(preset) {
  const now = new Date(); const to = iso(now);
  if (preset === "today") return [to, to];
  if (preset === "week") { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [iso(d), to]; }
  if (preset === "month") return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), to];
  if (preset === "quarter") return [iso(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)), to];
  if (preset === "year") return [iso(new Date(now.getFullYear(), 0, 1)), to];
  return [to, to];
}
const PRESETS = [["today","Hôm nay"],["week","Tuần này"],["month","Tháng này"],["quarter","Quý này"],["year","Năm nay"]];
import { useCatalog } from "@/lib/useData";
import { Badge, Pager, pageSlice, useSelection, ThCheck, TdCheck, SelectionBar } from "@/components/ui";
import { InfoRows, MoneyRows } from "@/components/detail";
import { fmtTime, downloadCSV } from "@/lib/format";

export default function LichSu() {
  const { supabase, vehicles, locations, loading } = useCatalog();
  const [txns, setTxns] = useState([]);
  const sel = useSelection();
  const [type, setType] = useState(""); const [loc, setLoc] = useState(""); const [q, setQ] = useState("");
  const [preset, setPreset] = useState("month");
  const [from, setFrom] = useState(rangeOf("month")[0]);
  const [to, setTo] = useState(rangeOf("month")[1]);
  const [docSet, setDocSet] = useState(new Set()); // ma phieu tim duoc tu so khung
  // Mo chi tiet giao dich: tra du lieu goc theo tung loai
  const openDetail = async (t) => {
    setDetail({ txn: t, loading: true });
    const doc = t.doc_code || "";
    let extra = {};
    try {
      if (t.txn_type === "Bán hàng" || t.txn_type === "Hủy đơn bán") {
        const [{ data: o }, { data: its }, { data: pays }, { data: units }] = await Promise.all([
          supabase.from("sales_orders").select("*").eq("code", doc).maybeSingle(),
          supabase.from("sale_items").select("*").eq("sale_code", doc),
          supabase.from("sale_payments").select("*").eq("sale_code", doc),
          supabase.from("vehicle_units").select("frame_number,vehicle_id,cost_price").eq("sale_code", doc),
        ]);
        extra = { don: o, items: its || [], pays: pays || [], units: units || [] };
      } else if (t.txn_type === "Nhập hàng") {
        const { data: units } = await supabase.from("vehicle_units")
          .select("frame_number,vehicle_id,cost_price,location_code,imported_at").eq("import_doc", doc).limit(300);
        extra = { units: units || [] };
      } else if (t.txn_type === "Điều chuyển") {
        const { data: tos } = await supabase.from("transfer_orders").select("*").eq("code", doc);
        const allFrames = (tos || []).flatMap((x) => x.frames || []);
        const { data: units } = allFrames.length
          ? await supabase.from("vehicle_units").select("frame_number,vehicle_id,location_code,status").in("frame_number", allFrames)
          : { data: [] };
        extra = { phieu: tos || [], units: units || [] };
      } else if (t.txn_type === "Điều chỉnh" || t.txn_type === "Kiểm kê") {
        const { data: adj } = await supabase.from("stock_adjustments").select("*").eq("code", doc).maybeSingle();
        extra = { dieuChinh: adj };
      }
    } catch (e) { /* van hien thong tin co ban */ }
    setDetail({ txn: t, loading: false, ...extra });
  };

  const pickPreset = (k) => { setPreset(k); const [a, b] = rangeOf(k); setFrom(a); setTo(b); };
  const [detail, setDetail] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("inventory_txns").select("*")
        .gte("created_at", from).lte("created_at", to + "T23:59:59")
        .order("created_at", { ascending: false }).limit(3000);
      setTxns(data || []);
    })();
  }, [from, to]);

  // Tim theo SO KHUNG: tra bang xe -> lay ma phieu nhap / phieu ban lien quan
  useEffect(() => {
    const kw = q.trim().toUpperCase();
    if (kw.length < 4) { setDocSet(new Set()); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("vehicle_units")
        .select("frame_number, import_doc, sale_code, transfer_code")
        .ilike("frame_number", `%${kw}%`).limit(100);
      const st = new Set();
      (data || []).forEach((u) => { [u.import_doc, u.sale_code, u.transfer_code].forEach((d) => d && st.add(d)); });
      setDocSet(st);
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  if (loading) return <div className="card">Đang tải dữ liệu…</div>;
  const locName = (c) => locations.find((l) => l.code === c)?.name || c || "—";
  const list = txns.filter((t) => {
    if (type && t.txn_type !== type) return false;
    if (loc && t.from_location !== loc && t.to_location !== loc) return false;
    const v = vehicles.find((x) => x.id === t.vehicle_id);
    const text = ((v ? v.name + v.color : "") + t.vehicle_id + (t.created_by_name || "") + (t.doc_code || "") + (t.note || "")).toLowerCase();
    if (q && !text.includes(q.toLowerCase()) && !docSet.has(t.doc_code)) return false;
    return true;
  });
  const tb = (t) => t === "Nhập hàng" ? <Badge tone="green">Nhập hàng</Badge> : t === "Bán hàng" ? <Badge tone="blue">Bán hàng</Badge> : t === "Điều chuyển" ? <Badge tone="purple">Điều chuyển</Badge> : <Badge tone="amber">{t}</Badge>;

  return (
    <div className="card">
      <div className="flex gap-1.5 mb-2 flex-wrap items-end">
        {PRESETS.map(([k, lb]) => (
          <button key={k} className={`btn !px-3 !py-2 !text-xs ${preset === k ? "bg-navy-900 text-white" : "bg-[#EEF1F4] text-[#3B4552]"}`} onClick={() => pickPreset(k)}>{lb}</button>
        ))}
        <div><label className="lbl">Từ ngày</label><input type="date" className="inp !w-auto" value={from} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }} /></div>
        <div><label className="lbl">Đến ngày</label><input type="date" className="inp !w-auto" value={to} onChange={(e) => { setTo(e.target.value); setPreset("custom"); }} /></div>
      </div>
      <div className="flex gap-2 mb-3 flex-wrap">
        <input className="inp !w-auto flex-[2] min-w-[220px]" placeholder="Tìm theo số khung, tên khách, xe, người thao tác, mã phiếu…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inp !w-auto flex-1 min-w-[130px]" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Loại: tất cả</option><option>Nhập hàng</option><option>Bán hàng</option><option>Điều chuyển</option><option>Điều chỉnh</option><option>Kiểm kê</option>
        </select>
        <select className="inp !w-auto flex-1 min-w-[160px]" value={loc} onChange={(e) => setLoc(e.target.value)}>
          <option value="">Kho: tất cả</option>{locations.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </div>
      <div className="text-xs text-[#8A93A0] mb-2.5">{list.length} giao dịch · Lịch sử không thể xóa/sửa — sai sót xử lý bằng giao dịch điều chỉnh mới.</div>
      <SelectionBar sel={sel}>
        <button className="btn-ghost !text-xs !py-1" onClick={() => {
          const rs = list.filter((t) => sel.has(t.id));
          downloadCSV(`lich_su_chon.csv`, [["Thời gian", "Loại", "Xe", "Kho", "SL", "Tồn trước", "Tồn sau", "Người", "Phiếu", "Ghi chú"],
            ...rs.map((t) => { const v = vehicles.find((x) => x.id === t.vehicle_id); return [fmtTime(t.created_at), t.txn_type, v ? `${v.name} ${v.color}` : t.vehicle_id, t.from_location && t.to_location ? `${locName(t.from_location)} → ${locName(t.to_location)}` : locName(t.from_location || t.to_location), t.qty, t.stock_before, t.stock_after, t.created_by_name, t.doc_code, t.note]; })]);
        }}>⬇ Xuất Excel</button>
      </SelectionBar>
      <div className="overflow-x-auto"><table className="w-full border-collapse">
        <thead><tr><ThCheck sel={sel} rows={pageSlice(list, page, pageSize)} idOf={(t) => t.id} /><th className="th">Thời gian</th><th className="th">Loại</th><th className="th">Xe</th><th className="th">Kho</th><th className="th">SL</th><th className="th">Tồn trước → sau</th><th className="th">Người</th><th className="th">Phiếu / Ghi chú</th></tr></thead>
        <tbody>{pageSlice(list, page, pageSize).map((t) => {
          const v = vehicles.find((x) => x.id === t.vehicle_id);
          return (
            <tr key={t.id} className={`hover:bg-[#F8FAFC] cursor-pointer ${sel.has(t.id) ? "bg-[#EAF2FF]" : ""}`} onClick={() => openDetail(t)}>
              <TdCheck sel={sel} id={t.id} />
              <td className="td whitespace-nowrap">{fmtTime(t.created_at)}</td>
              <td className="td">{tb(t.txn_type)}</td>
              <td className="td">{v ? `${v.name} ${v.color}` : t.vehicle_id}</td>
              <td className="td">{t.from_location && t.to_location ? `${locName(t.from_location)} → ${locName(t.to_location)}` : locName(t.from_location || t.to_location)}</td>
              <td className="td"><b className={t.qty < 0 ? "text-danger" : "text-[#0E7A4A]"}>{t.qty > 0 ? "+" : ""}{t.qty}</b></td>
              <td className="td">{t.stock_before} → <b>{t.stock_after}</b></td>
              <td className="td">{t.created_by_name}</td>
              <td className="td"><b className="text-brand underline">{t.doc_code}</b>{t.note && <div className="text-[11px] text-[#8A93A0]">{t.note}</div>}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <Pager total={list.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />

      {detail && (() => {
        const t = detail.txn;
        const v = vehicles.find((x) => x.id === t.vehicle_id);
        const vN = (id) => { const x = vehicles.find((y) => y.id === id); return x ? `${x.brand} ${x.name} ${x.color}` : id; };
        return (
          <div className="fixed inset-0 z-[95] bg-black/50 flex items-center justify-center p-3" onClick={() => setDetail(null)}>
            <div className="bg-white rounded-2xl w-[600px] max-w-full max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 p-3.5 border-b border-[#EEF1F4]">
                {tb(t.txn_type)}
                <div className="font-extrabold text-base text-brand mr-auto">{t.doc_code || "—"}</div>
                <button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => setDetail(null)}>✕</button>
              </div>

              <div className="p-3.5 flex flex-col gap-3">
                <InfoRows rows={[
                  ["Thời gian", fmtTime(t.created_at)],
                  ["Loại giao dịch", t.txn_type],
                  ["Xe", v ? `${v.brand} · ${v.name} · ${v.color}` : t.vehicle_id],
                  ["Kho", t.from_location && t.to_location
                    ? `${locName(t.from_location)} → ${locName(t.to_location)}`
                    : locName(t.from_location || t.to_location)],
                  ["Số lượng", <b key="q" className={t.qty < 0 ? "text-danger" : "text-[#0E7A4A]"}>{t.qty > 0 ? "+" : ""}{t.qty}</b>],
                  ["Tồn trước → sau", `${t.stock_before} → ${t.stock_after}`],
                  ["Người thực hiện", t.created_by_name],
                  ["Ghi chú", t.note],
                ]} />

                {detail.loading && <div className="text-sm text-[#8A93A0]">Đang tải chi tiết…</div>}

                {/* BÁN HÀNG */}
                {detail.don && (
                  <>
                    <div className="font-extrabold text-[13.5px]">Đơn bán {detail.don.code}</div>
                    <InfoRows rows={[
                      ["Khách hàng", <span key="k">{detail.don.customer_name}<span className="block text-[11px] text-[#8A93A0]">{detail.don.customer_phone}</span></span>],
                      ["NV bán", detail.don.seller_name],
                      ["Hóa đơn", detail.don.invoice_status === "Đã xuất HĐ"
                        ? `${detail.don.invoice_no} · ${detail.don.invoice_date}` : "Chưa xuất"],
                    ]} />
                    <MoneyRows
                      lines={[
                        ["Giá xe × " + detail.don.quantity, fmtVND(detail.don.sale_price * detail.don.quantity)],
                        ...(detail.items || []).map((i) => [`${i.name} × ${i.qty}`, fmtVND(i.amount), "font-semibold text-[#5A6572]"]),
                        ...(detail.don.discount_amount > 0 ? [["Chiết khấu", "−" + fmtVND(detail.don.discount_amount), "font-bold text-danger"]] : []),
                        ["Đã thanh toán", fmtVND(detail.don.paid_amount || 0), "font-bold text-[#0E7A4A]"],
                      ]}
                      total={{
                        label: "Tổng đơn",
                        value: fmtVND(Math.max(0, detail.don.sale_price * detail.don.quantity
                          + (detail.items || []).reduce((a, b) => a + b.amount, 0) - (detail.don.discount_amount || 0))),
                        done: true,
                      }}
                    />
                    {(detail.pays || []).length > 0 && (
                      <div>
                        <div className="text-[12px] text-[#5A6572] mb-1.5">Các khoản thu:</div>
                        {detail.pays.map((p) => (
                          <div key={p.id} className="flex items-center gap-2 text-[12.5px] py-1 border-b border-dashed border-[#EEF1F4]">
                            <Badge tone="green">{p.method}</Badge>
                            <span className="text-[#8A93A0] mr-auto">{p.created_by_name}</span>
                            <b>{fmtVND(p.amount)}</b>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* DANH SÁCH XE (nhập hàng / bán hàng / điều chuyển) */}
                {(detail.units || []).length > 0 && (
                  <div>
                    <div className="font-extrabold text-[13.5px] mb-1.5">Chi tiết {detail.units.length} xe</div>
                    <div className="tbl-scroll"><table className="w-full border-collapse">
                      <thead><tr>
                        <th className="th w-8">#</th><th className="th">Số khung</th><th className="th">Xe</th>
                        {detail.units[0]?.cost_price !== undefined && <th className="th">Giá vốn</th>}
                        {detail.units[0]?.status !== undefined && <th className="th">Trạng thái</th>}
                      </tr></thead>
                      <tbody>{detail.units.map((u, i) => (
                        <tr key={u.frame_number} className="hover:bg-[#F8FAFC]">
                          <td className="td text-center text-xs text-[#8A93A0]">{i + 1}</td>
                          <td className="td font-mono text-[12px] font-bold">{u.frame_number}</td>
                          <td className="td text-[12.5px]">{vN(u.vehicle_id)}</td>
                          {u.cost_price !== undefined && <td className="td">{u.cost_price ? fmtVND(u.cost_price) : <span className="text-[#C6CDD6]">—</span>}</td>}
                          {u.status !== undefined && <td className="td text-[11px]">{
                            { TON_KHO: "Tồn kho", DA_BAN: "Đã bán", DANG_CHUYEN: "Đang chuyển", GIU_CHO: "Giữ chỗ" }[u.status] || u.status}</td>}
                        </tr>
                      ))}</tbody>
                    </table></div>
                  </div>
                )}

                {/* ĐIỀU CHUYỂN */}
                {(detail.phieu || []).length > 0 && (
                  <InfoRows rows={[
                    ["Trạng thái phiếu", detail.phieu[0].status],
                    ["Người tạo", detail.phieu[0].requested_by_name],
                    ["Người nhận", detail.phieu[0].confirmed_by_name || "chưa xác nhận"],
                    ["Tổng số xe", detail.phieu.reduce((a, b) => a + b.quantity, 0) + " xe"],
                  ]} />
                )}

                {/* ĐIỀU CHỈNH */}
                {detail.dieuChinh && (
                  <InfoRows rows={[
                    ["Tồn hệ thống", detail.dieuChinh.system_qty],
                    ["Thực tế đếm", detail.dieuChinh.actual_qty],
                    ["Chênh lệch", <b key="d" className={detail.dieuChinh.diff_qty < 0 ? "text-danger" : "text-[#0E7A4A]"}>{detail.dieuChinh.diff_qty > 0 ? "+" : ""}{detail.dieuChinh.diff_qty}</b>],
                    ["Lý do", detail.dieuChinh.reason],
                    ["Người đề xuất", detail.dieuChinh.requested_by_name],
                    ["Người duyệt", detail.dieuChinh.approved_by_name || "chưa duyệt"],
                  ]} />
                )}

                {!detail.loading && !detail.don && (detail.units || []).length === 0
                  && (detail.phieu || []).length === 0 && !detail.dieuChinh && (
                  <div className="text-[13px] text-[#8A93A0] p-2.5 rounded-xl bg-[#F8FAFC]">
                    Không tìm thấy chứng từ gốc — có thể đơn đã bị xóa hoặc giao dịch cũ chưa có mã chứng từ.
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
