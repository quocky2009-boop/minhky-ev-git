"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, Field } from "@/components/ui";
import { fmtVND, fmtDate, fmtTime, errMsg } from "@/lib/format";
import { printOrder, printOrderBill } from "@/lib/print";

export default function DonBanChiTiet() {
  const { id } = useParams();
  const router = useRouter();
  const { supabase, vehicles, locations, settings, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [o, setO] = useState(null);
  const [items, setItems] = useState([]);
  const [pays, setPays] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data: ord } = await supabase.from("sales_orders").select("*").eq("id", id).single();
    if (!ord) return;
    const code = ord.code;
    const [{ data: its }, { data: ps }] = await Promise.all([
      supabase.from("sale_items").select("*").eq("sale_code", code),
      supabase.from("sale_payments").select("*").eq("sale_code", code),
    ]);
    setO(ord);
    setItems(its || []);
    setPays(ps || []);
  };
  useEffect(() => { if (!loading) load(); }, [loading, id]);

  if (loading || !o) return <div className="card">Đang tải đơn…</div>;

  const v = vehicles.find((x) => x.id === o.vehicle_id);
  const loc = locations.find((x) => x.code === o.location_code);
  const locName = (c) => locations.find((l) => l.code === c)?.name || c || "—";
  const tienXe = (o.sale_price || 0) * (o.quantity || 1);
  const ckXe = o.vehicle_discount_type === "percent"
    ? Math.round(tienXe * (o.vehicle_discount_value || 0) / 100)
    : (o.vehicle_discount_value || 0);
  const tongKem = items.reduce((s, x) => s + x.amount, 0);
  const tamTinh = tienXe - ckXe + tongKem;
  const ckTong = o.discount_type === "percent" ? Math.round(tamTinh * (o.discount_value || 0) / 100) : (o.discount_value || 0);
  const tongDon = Math.max(tamTinh - ckTong, 0);
  const daTra = o.paid_amount || 0;
  const conLai = Math.max(tongDon - daTra, 0);

  const statusBadge = o.status === "Đã hủy" ? "red" : o.status === "Đã trả hàng" ? "red"
    : o.invoice_status === "Đã xuất HĐ" ? "green" : "amber";
  const statusLabel = o.status === "Đã hủy" ? "Đã hủy"
    : o.status === "Đã trả hàng" ? "Đã trả hàng"
    : o.invoice_status === "Đã xuất HĐ" ? "Hoàn thành" : "Chờ xuất HĐ";
  const isDone = o.invoice_status === "Đã xuất HĐ";
  const isClosed = ["Đã hủy", "Đã trả hàng"].includes(o.status);

  const huyDon = async () => {
    if (profile.role !== "CEO") return notify("Chỉ BGĐ được hủy đơn.", "err");
    const ly = prompt(`Hủy đơn ${o.code}?\nXe sẽ hoàn về tồn kho, tiền cọc/thu đã có sẽ được hoàn quỹ.\n\nNhập LÝ DO hủy (bắt buộc):`);
    if (ly === null) return;
    if (!ly.trim()) return notify("Phải nhập lý do.", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_xoa_don", { p_id: o.id, p_ly_do: ly });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã hủy đơn. Xe hoàn về kho, tiền đã hoàn quỹ.");
    load();
  };

  const traHang = async () => {
    if (profile.role !== "CEO") return notify("Chỉ BGĐ được duyệt trả hàng.", "err");
    const ly = prompt(`Trả lại hàng bán — đơn ${o.code}\nXe nhập lại kho, tiền khách đã trả được hoàn quỹ.\n\nNhập LÝ DO trả hàng:`);
    if (ly === null) return;
    if (!ly.trim()) return notify("Phải nhập lý do.", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_tra_hang_ban", { p: { id: o.id, ly_do: ly, location_code: o.location_code } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã trả hàng, hoàn quỹ thành công.");
    load();
  };

  const steps = [
    { label: "Đặt hàng", done: true, at: o.created_at },
    { label: "Duyệt", done: true, at: o.created_at },
    { label: "Đóng gói", done: daTra > 0 || isDone, at: daTra > 0 ? o.updated_at : null },
    { label: "Xuất kho", done: isDone, at: isDone ? o.invoice_at : null },
    { label: "Hoàn thành", done: isDone, at: isDone ? o.invoice_at : null },
  ];

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Toast toast={toast} />

      {/* HEADER */}
      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-ghost !text-xs" onClick={() => router.back()}>← Quay lại danh sách đơn hàng</button>
        <div className="ml-auto flex gap-2">
          {!isClosed && !isDone && profile.role === "CEO" && (
            <button className="btn-ghost !text-xs hover:!text-danger" disabled={busy} onClick={huyDon}>Hủy đơn hàng</button>
          )}
          {!isClosed && !isDone && (
            <Link href={`/ban-hang?sua=${o.id}`} className="btn-primary !text-xs">Sửa đơn hàng</Link>
          )}
          {isDone && profile.role === "CEO" && (
            <button className="btn-primary !text-xs bg-danger border-danger" disabled={busy} onClick={traHang}>↩ Đổi trả hàng</button>
          )}
        </div>
      </div>

      {/* MÃ ĐƠN + TRẠNG THÁI */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xl font-extrabold">{o.code}</span>
        <Badge tone={statusBadge}>{statusLabel}</Badge>
      </div>

      {/* TIMELINE */}
      <div className="card !py-4 overflow-hidden">
        <div className="relative flex items-start justify-between">
          {/* Đường line nối các bước */}
          <div className="absolute top-3 left-0 right-0 h-0.5 bg-[#E3E8EF]" style={{ zIndex: 0 }} />
          <div className="absolute top-3 left-0 h-0.5 bg-brand" style={{ zIndex: 0, width: `${(steps.filter((s) => s.done).length - 1) / (steps.length - 1) * 100}%` }} />
          {steps.map((s, i) => (
            <div key={i} className="flex flex-col items-center relative" style={{ zIndex: 1, flex: 1 }}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[11px] font-bold border-2 ${s.done ? "bg-brand border-brand" : "bg-white border-[#D5DBE3]"}`}>
                {s.done ? "✓" : ""}
              </div>
              <div className="text-[10.5px] font-semibold text-center mt-1 px-0.5">{s.label}</div>
              {s.at && <div className="text-[9.5px] text-[#8A93A0] text-center">{fmtTime(s.at)}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* CẢnh báo hủy/trả */}
      {isClosed && (
        <div className="p-3 rounded-xl bg-[#FDEDED] text-[13px]">
          <b className="text-danger">{o.status}</b> — {o.cancel_reason}
          <div className="text-[11px] text-[#8A93A0] mt-0.5">bởi {o.cancelled_by_name} · {fmtDate(o.cancelled_at)}</div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* THÔNG TIN KHÁCH */}
          <div className="card">
            <div className="font-extrabold mb-2">Thông tin khách hàng</div>
            <div className="text-brand font-bold text-[15px]">{o.customer_name} — {o.customer_phone}</div>
            {o.customer_type && <div className="text-[12px] text-[#5A6572] mt-0.5">{o.customer_type}</div>}
            <div className="text-[12px] text-[#5A6572] mt-2 uppercase font-semibold tracking-wide">Địa chỉ giao hàng</div>
            <div className="text-[13px]">{o.customer_phone}</div>
            {o.customer_address && <div className="text-[13px]">{o.customer_address}</div>}
          </div>

          {/* THANH TOÁN */}
          <div className="card">
            <div className={`flex items-center gap-2 mb-3 font-semibold text-[14px] ${conLai === 0 ? "text-[#0E7A4A]" : "text-danger"}`}>
              <span>{conLai === 0 ? "✓ Đã thanh toán toàn bộ" : `⚠ Còn phải trả ${fmtVND(conLai)}`}</span>
            </div>
            <div className="flex flex-wrap gap-6 mb-3 text-[13px]">
              <div><span className="text-[#8A93A0]">Khách phải trả: </span><b>{fmtVND(tongDon)}</b></div>
              <div><span className="text-[#8A93A0]">Đã thanh toán: </span><b>{fmtVND(daTra)}</b></div>
              <div><span className="text-[#8A93A0]">Còn phải trả: </span><b className={conLai > 0 ? "text-danger" : ""}>{fmtVND(conLai)}</b></div>
            </div>
            {pays.map((p, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-[#F8FAFC] text-[13px] mb-1">
                <div className="w-2 h-2 rounded-full bg-brand shrink-0" />
                <span className="font-semibold">{p.method} {fmtVND(p.amount)}</span>
                {p.note && <span className="text-[#8A93A0]">— {p.note}</span>}
                <span className="text-[10.5px] text-[#8A93A0] ml-auto">{fmtTime(p.created_at)}</span>
              </div>
            ))}
          </div>

          {/* THÔNG TIN SẢN PHẨM */}
          <div className="card">
            <div className="font-extrabold mb-3">Thông tin sản phẩm</div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead><tr className="text-[11.5px] text-[#8A93A0] uppercase border-b border-[#E3E8EF]">
                  <th className="text-left py-2 pl-2">Tên sản phẩm</th>
                  <th className="text-right py-2">Số lượng</th>
                  <th className="text-right py-2">Đơn giá</th>
                  <th className="text-right py-2">Chiết khấu</th>
                  <th className="text-right py-2 pr-2">Thành tiền</th>
                </tr></thead>
                <tbody>
                  {/* Xe chính */}
                  <tr className="border-b border-dashed border-[#F0F2F5]">
                    <td className="py-2.5 pl-2">
                      <div className="font-semibold">{v ? `${v.brand} ${v.name} ${v.color}` : o.vehicle_id}</div>
                      <div className="text-[10.5px] text-[#8A93A0] font-mono">SK: {o.frame_number}</div>
                      <div className="text-[10.5px] text-[#8A93A0]">Kho: {locName(o.location_code)}</div>
                      {o.coc_giao && <Badge tone="green">COC đã giao</Badge>}
                    </td>
                    <td className="py-2.5 text-right">{o.quantity}</td>
                    <td className="py-2.5 text-right">{fmtVND(o.sale_price)}</td>
                    <td className="py-2.5 text-right">{ckXe > 0 ? fmtVND(ckXe) : "0"}</td>
                    <td className="py-2.5 pr-2 text-right font-bold">{fmtVND(tienXe - ckXe)}</td>
                  </tr>
                  {/* Bán kèm */}
                  {items.map((x, i) => (
                    <tr key={i} className="border-b border-dashed border-[#F0F2F5]">
                      <td className="py-2 pl-2"><div>{x.name}</div><div className="text-[10.5px] text-[#8A93A0]">{x.item_type}</div></td>
                      <td className="py-2 text-right">{x.qty}</td>
                      <td className="py-2 text-right">{fmtVND(x.unit_price)}</td>
                      <td className="py-2 text-right">{x.discount_value > 0 ? fmtVND(x.discount_value) : "0"}</td>
                      <td className="py-2 pr-2 text-right font-bold">{fmtVND(x.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="text-[13px]"><td colSpan={4} className="py-1.5 pl-2 text-[#5A6572]">Tổng chưa chiết khấu đơn</td><td className="py-1.5 pr-2 text-right">{fmtVND(tamTinh)}</td></tr>
                  {ckTong > 0 && <tr className="text-[13px] text-[#A25F00]"><td colSpan={4} className="py-1.5 pl-2">Chiết khấu đơn hàng</td><td className="py-1.5 pr-2 text-right">−{fmtVND(ckTong)}</td></tr>}
                  <tr className="font-extrabold text-[14px] bg-[#EAF2FF]"><td colSpan={4} className="py-2 pl-2">Tổng đơn</td><td className="py-2 pr-2 text-right text-brand">{fmtVND(tongDon)}</td></tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {/* CỘT PHẢI */}
        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="font-extrabold mb-3">Thông tin đơn hàng</div>
            <div className="flex flex-col gap-1 text-[13px]">
              {[
                ["Bán tại", locName(o.location_code)],
                ["Bán bởi", o.seller_name || "—"],
                ["Ngày bán", fmtTime(o.sale_date)],
                ["Trạng thái HĐ", o.invoice_status || "Chờ xuất HĐ"],
                o.invoice_no && ["Số hóa đơn", o.invoice_no],
                o.invoice_date && ["Ngày xuất HĐ", fmtDate(o.invoice_date)],
                o.invoice_by_name && ["Người xác nhận HĐ", o.invoice_by_name],
                ["Bảo hành", o.warranty_activated ? "✓ Đã kích hoạt" : "Chưa"],
                o.app_activated && ["App VF eScooter", "✓ Đã kích hoạt"],
                ["Giấy COC", o.coc_giao ? "✓ Đã giao cho khách" : "Chưa giao"],
                o.document_status && ["Đăng ký xe", o.document_status],
              ].filter(Boolean).map(([k, val]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-[#8A93A0] w-36 shrink-0">{k}</span>
                  <span className="font-semibold">{val}</span>
                </div>
              ))}
            </div>
          </div>
          {o.note && (
            <div className="card">
              <div className="font-extrabold mb-1">Ghi chú</div>
              <div className="text-[13px]">{o.note}</div>
            </div>
          )}
          {o.invoice_status === "Đã xuất HĐ" && o.checklist_giao_xe && Object.keys(o.checklist_giao_xe).length > 0 && (
            <div className="card">
              <div className="font-extrabold mb-2 text-[13px]">✅ Checklist giao xe</div>
              <div className="flex flex-col gap-1">
                {[["da_thu_du_tien","💰 Thu đủ tiền"],["dung_so_khung","🔢 Đúng số khung"],["bao_hanh","🛡 Bảo hành"],["app_vf","📱 App VF"],["coc_giao","📄 Giấy COC"],["phu_kien","🎁 Phụ kiện/sạc/chìa"],["anh_khach","📸 Ảnh nhận xe"]].map(([k, label]) => (
                  <div key={k} className={`flex items-center gap-1.5 text-[12px] ${o.checklist_giao_xe[k] ? "text-[#0E7A4A]" : "text-[#C6CDD6]"}`}>
                    <span>{o.checklist_giao_xe[k] ? "✓" : "○"}</span><span>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="card !py-3 flex gap-2 flex-wrap">
            <button className="btn-ghost !text-xs flex-1" onClick={() => printOrder({ supabase, o, vehicles, locations, settings, notify })}>🖨 In phiếu</button>
            <button className="btn-ghost !text-xs flex-1" onClick={() => printOrderBill({ supabase, o, vehicles, locations, settings, notify })}>🧾 In bill</button>
          </div>
        </div>
      </div>
    </div>
  );
}
