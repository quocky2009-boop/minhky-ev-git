"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, VehicleSearch, LocPicker, FramePicker } from "@/components/ui";
import { fmtVND, fmtDate, fmtTime, errMsg } from "@/lib/format";
import { CUSTOMER_TYPES, CUSTOMER_SOURCES, PAYMENT_METHODS, DOC_STATUSES } from "@/lib/const";

// Tinh gia tri truong cong thuc (vd: gia truoc thue = gia ban / (1 + thue))
function calcFormula(formula, base, taxRate) {
  if (!formula || base === "" || base === null || isNaN(Number(base))) return "";
  const operand = formula.operand === "TAX" ? 1 + taxRate : Number(formula.operand || 0);
  const b = Number(base);
  let r = b;
  if (formula.op === "divide") r = operand ? b / operand : 0;
  if (formula.op === "multiply") r = b * operand;
  if (formula.op === "add") r = b + operand;
  if (formula.op === "subtract") r = b - operand;
  return Math.round(r);
}

function BanHangInner() {
  const params = useSearchParams();
  const { supabase, vehicles, locations, profile, loading, getQty, refresh, customFields, taxRate } = useCatalog();
  const { toast, notify } = useToast();
  const [orders, setOrders] = useState([]);
  const [units, setUnits] = useState([]);
  const [frames, setFrames] = useState([]);
  const empty = { vehicle_id: params.get("xe") || "", location_code: "", customer_name: "", customer_phone: "", customer_cccd: "", customer_address: "", customer_type: "Khách lẻ", customer_source: "Khách vãng lai", sale_price: "", payment_method: "Chuyển khoản", document_status: "Đang làm đăng ký", note: "", extra: {} };
  const [f, setF] = useState(empty);
  const [show, setShow] = useState(!!params.get("xe"));
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const setExtra = (k, v) => setF((p) => ({ ...p, extra: { ...p.extra, [k]: v } }));

  const loadOrders = async () => {
    const { data } = await supabase.from("sales_orders").select("*").order("created_at", { ascending: false }).limit(100);
    setOrders(data || []);
  };
  useEffect(() => { loadOrders(); }, []);

  // Nap danh sach xe (so khung) san sang khi da chon xe + kho
  useEffect(() => {
    setFrames([]);
    if (!f.vehicle_id || !f.location_code) { setUnits([]); return; }
    (async () => {
      const { data } = await supabase.from("vehicle_units").select("*")
        .eq("vehicle_id", f.vehicle_id).eq("location_code", f.location_code).eq("status", "TON_KHO")
        .order("imported_at");
      setUnits(data || []);
    })();
  }, [f.vehicle_id, f.location_code]);

  const vehicle = vehicles.find((v) => v.id === f.vehicle_id);
  const cfields = customFields.filter((c) => c.entity === "sales_order");

  const submit = async () => {
    setBusy(true);
    // Chot gia tri cac truong cong thuc tai thoi diem luu
    const extra = { ...f.extra };
    cfields.forEach((c) => {
      if (c.field_type === "formula") extra[c.field_key] = calcFormula(c.formula, f.sale_price || vehicle?.list_price, taxRate);
    });
    const { data, error } = await supabase.rpc("fn_ban_hang", {
      p: { ...f, frames, extra, sale_price: f.sale_price ? Number(f.sale_price) : null },
    });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã lưu đơn ${data} (${frames.length} xe). Tồn kho đã trừ tự động.`);
    setF(empty); setFrames([]); setShow(false); refresh(); loadOrders();
  };

  const updateOrder = async (id, field, value) => {
    const args = { p_id: id, p_doc: null, p_warranty: null, p_app: null };
    args[field] = value;
    const { error } = await supabase.rpc("fn_cap_nhat_don", args);
    if (error) return notify(errMsg(error), "err");
    loadOrders();
  };

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  const canEdit = ["CEO", "MANAGER", "ADMIN"].includes(profile.role);
  const cfieldsAll = customFields.filter((c) => c.entity === "sales_order");
  const fieldValText = (c, val) => {
    if (val === undefined || val === null || val === "") return "—";
    if (c.field_type === "formula") return fmtVND(val);
    if (c.field_type === "checkbox") return val ? "Có" : "Không";
    return String(val);
  };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      {!show && <button className="btn-primary self-start" onClick={() => setShow(true)}>+ Tạo đơn bán mới</button>}
      {show && (
        <div className="card">
          <div className="font-extrabold text-base mb-4">Tạo đơn bán — chọn xe theo số khung</div>
          <div className="grid gap-x-4 md:grid-cols-3 sm:grid-cols-2">
            <Field label="Xe (gõ để tìm)" required><VehicleSearch vehicles={vehicles} value={f.vehicle_id} onChange={(v) => set("vehicle_id", v)} /></Field>
            <Field label="Kho / cửa hàng xuất xe" required><LocPicker locations={locations} value={f.location_code} onChange={(v) => set("location_code", v)} /></Field>
            <Field label={`Chọn xe bán (${units.length} xe sẵn sàng tại kho)`} required>
              {f.vehicle_id && f.location_code
                ? <FramePicker units={units} selected={frames} onToggle={(fr) => setFrames((p) => p.includes(fr) ? p.filter((x) => x !== fr) : [...p, fr])} />
                : <div className="text-sm text-[#8A93A0] border border-dashed border-[#D5DBE3] rounded-xl px-3 py-4">Chọn xe và kho trước để hiện danh sách số khung.</div>}
            </Field>
            <Field label="Họ tên khách hàng" required><input className="inp" value={f.customer_name} onChange={(e) => set("customer_name", e.target.value)} /></Field>
            <Field label="Số điện thoại" required><input className="inp" value={f.customer_phone} onChange={(e) => set("customer_phone", e.target.value)} /></Field>
            <Field label="CCCD"><input className="inp" value={f.customer_cccd} onChange={(e) => set("customer_cccd", e.target.value)} /></Field>
            <Field label="Địa chỉ"><input className="inp" value={f.customer_address} onChange={(e) => set("customer_address", e.target.value)} /></Field>
            <Field label="Loại khách"><select className="inp" value={f.customer_type} onChange={(e) => set("customer_type", e.target.value)}>{CUSTOMER_TYPES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Nguồn khách"><select className="inp" value={f.customer_source} onChange={(e) => set("customer_source", e.target.value)}>{CUSTOMER_SOURCES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label={`Giá bán thực tế / xe ${vehicle ? `(niêm yết ${fmtVND(vehicle.list_price)})` : ""}`}>
              <input type="number" className="inp" value={f.sale_price} onChange={(e) => set("sale_price", e.target.value)} placeholder={vehicle ? String(vehicle.list_price) : ""} />
            </Field>
            <Field label="Thanh toán"><select className="inp" value={f.payment_method} onChange={(e) => set("payment_method", e.target.value)}>{PAYMENT_METHODS.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Trạng thái hồ sơ"><select className="inp" value={f.document_status} onChange={(e) => set("document_status", e.target.value)}>{DOC_STATUSES.map((c) => <option key={c}>{c}</option>)}</select></Field>

            {cfields.map((c) => {
              if (c.field_type === "formula") {
                const val = calcFormula(c.formula, f.sale_price || vehicle?.list_price || "", taxRate);
                return <Field key={c.id} label={`${c.label} (tự tính, thuế ${Math.round(taxRate * 100)}%)`}>
                  <input className="inp bg-[#F8FAFC]" value={val === "" ? "" : fmtVND(val)} readOnly />
                </Field>;
              }
              if (c.field_type === "dropdown") return <Field key={c.id} label={c.label} required={c.required}>
                <select className="inp" value={f.extra[c.field_key] || ""} onChange={(e) => setExtra(c.field_key, e.target.value)}>
                  <option value="">— Chọn —</option>
                  {(c.options || []).map((o) => <option key={o}>{o}</option>)}
                </select>
              </Field>;
              if (c.field_type === "checkbox") return <Field key={c.id} label={c.label}>
                <label className="flex items-center gap-2 text-sm py-2"><input type="checkbox" checked={!!f.extra[c.field_key]} onChange={(e) => setExtra(c.field_key, e.target.checked)} /> Có</label>
              </Field>;
              return <Field key={c.id} label={c.label} required={c.required}>
                <input type={c.field_type === "number" ? "number" : "text"} className="inp" value={f.extra[c.field_key] || ""} onChange={(e) => setExtra(c.field_key, e.target.value)} />
              </Field>;
            })}

            <Field label="Ghi chú"><input className="inp" value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
          </div>
          <div className="flex gap-2.5">
            <button className="btn-ok" disabled={busy || frames.length === 0} onClick={submit}>{busy ? "Đang lưu…" : `Lưu đơn (${frames.length} xe) & trừ tồn`}</button>
            <button className="btn-ghost" onClick={() => { setShow(false); setF(empty); setFrames([]); }}>Hủy</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="font-extrabold mb-2.5">{canEdit ? "Đơn bán gần đây" : "Đơn bán của tôi"} ({orders.length})</div>
        <div className="overflow-x-auto"><table className="w-full border-collapse">
          <thead><tr><th className="th">Mã đơn</th><th className="th">Ngày</th><th className="th">Xe · Số khung</th><th className="th">Kho xuất</th><th className="th">Khách</th><th className="th">Giá bán</th><th className="th">NV bán</th><th className="th">Hồ sơ</th><th className="th">Bảo hành</th><th className="th"></th></tr></thead>
          <tbody>{orders.map((s) => {
            const v = vehicles.find((x) => x.id === s.vehicle_id);
            const l = locations.find((x) => x.code === s.location_code);
            return (
              <tr key={s.id}>
                <td className="td font-bold">{s.code}</td>
                <td className="td">{fmtDate(s.sale_date)}</td>
                <td className="td">{v ? `${v.name} ${v.color}` : s.vehicle_id} × {s.quantity}<div className="text-[11px] text-[#8A93A0] font-mono">{s.frame_number}</div></td>
                <td className="td">{l?.name || s.location_code}</td>
                <td className="td">{s.customer_name}<div className="text-[11px] text-[#8A93A0]">{s.customer_phone} · {s.customer_source}</div></td>
                <td className="td font-bold">{fmtVND(s.sale_price)}</td>
                <td className="td">{s.seller_name}</td>
                <td className="td">{canEdit ? (
                  <select className="inp !w-auto !py-1 !text-xs" value={s.document_status} onChange={(e) => updateOrder(s.id, "p_doc", e.target.value)}>{DOC_STATUSES.map((c) => <option key={c}>{c}</option>)}</select>
                ) : (["Đủ hồ sơ","Đã xong đăng ký"].includes(s.document_status) ? <Badge tone="green">{s.document_status}</Badge> : <Badge tone="amber">{s.document_status}</Badge>)}</td>
                <td className="td">{canEdit ? (
                  <select className="inp !w-auto !py-1 !text-xs" value={s.warranty_status} onChange={(e) => updateOrder(s.id, "p_warranty", e.target.value)}><option>Chưa kích hoạt</option><option>Đã kích hoạt</option></select>
                ) : (s.warranty_status === "Đã kích hoạt" ? <Badge tone="green">Đã kích hoạt</Badge> : <Badge tone="gray">Chưa kích hoạt</Badge>)}</td>
                <td className="td"><button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => setDetail(s)}>Chi tiết</button></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </div>
      {detail && (() => {
        const v = vehicles.find((x) => x.id === detail.vehicle_id);
        const l = locations.find((x) => x.code === detail.location_code);
        return (
          <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-3" onClick={() => setDetail(null)}>
            <div className="bg-white rounded-2xl w-[560px] max-w-full max-h-[88vh] overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center mb-3">
                <div className="font-extrabold text-base mr-auto">Chi tiết đơn {detail.code}</div>
                <button className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => setDetail(null)}>✕</button>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                <div><span className="text-[#8A93A0]">Ngày bán:</span> <b>{fmtDate(detail.sale_date)}</b></div>
                <div><span className="text-[#8A93A0]">Kho xuất:</span> <b>{l?.name || detail.location_code}</b></div>
                <div className="col-span-2"><span className="text-[#8A93A0]">Xe:</span> <b>{v ? `${v.brand} · ${v.name} · ${v.color}` : detail.vehicle_id}</b> × {detail.quantity}</div>
                {detail.frame_number && <div className="col-span-2"><span className="text-[#8A93A0]">Số khung:</span> <span className="font-mono font-bold">{detail.frame_number}</span></div>}
                <div><span className="text-[#8A93A0]">Khách hàng:</span> <b>{detail.customer_name}</b></div>
                <div><span className="text-[#8A93A0]">SĐT:</span> <b>{detail.customer_phone}</b></div>
                <div><span className="text-[#8A93A0]">CCCD:</span> {detail.customer_cccd || "—"}</div>
                <div><span className="text-[#8A93A0]">Địa chỉ:</span> {detail.customer_address || "—"}</div>
                <div><span className="text-[#8A93A0]">Loại khách:</span> {detail.customer_type}</div>
                <div><span className="text-[#8A93A0]">Nguồn khách:</span> {detail.customer_source}</div>
                <div><span className="text-[#8A93A0]">Giá niêm yết:</span> {fmtVND(detail.list_price)}</div>
                <div><span className="text-[#8A93A0]">Giá bán:</span> <b className="text-brand">{fmtVND(detail.sale_price)}</b></div>
                <div><span className="text-[#8A93A0]">Thanh toán:</span> {detail.payment_method}</div>
                <div><span className="text-[#8A93A0]">NV bán:</span> {detail.seller_name}</div>
                <div><span className="text-[#8A93A0]">Hồ sơ:</span> <Badge tone="blue">{detail.document_status}</Badge></div>
                <div><span className="text-[#8A93A0]">Bảo hành:</span> <Badge tone={detail.warranty_status === "Đã kích hoạt" ? "green" : "gray"}>{detail.warranty_status}</Badge></div>
                {cfieldsAll.map((c) => (
                  <div key={c.id}><span className="text-[#8A93A0]">{c.label}:</span> <b>{fieldValText(c, detail.extra?.[c.field_key])}</b></div>
                ))}
                {detail.note && <div className="col-span-2"><span className="text-[#8A93A0]">Ghi chú:</span> {detail.note}</div>}
                <div className="col-span-2 text-[11px] text-[#8A93A0] pt-1 border-t border-dashed border-[#E6EAEF] mt-1">Tạo lúc {fmtTime(detail.created_at)}</div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default function BanHang() {
  return <Suspense fallback={<div className="card">Đang tải…</div>}><BanHangInner /></Suspense>;
}
