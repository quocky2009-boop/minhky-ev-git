"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, VehicleSearch, LocPicker, FramePicker, Pager, pageSlice } from "@/components/ui";
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
  const { supabase, vehicles, locations, profile, loading, getQty, refresh, customFields, taxRate, settings } = useCatalog();
  const { toast, notify } = useToast();
  const [orders, setOrders] = useState([]);
  const [units, setUnits] = useState([]);
  const [frames, setFrames] = useState([]);
  const empty = { vehicle_id: params.get("xe") || "", location_code: "", customer_name: "", customer_phone: "", customer_cccd: "", customer_address: "", customer_type: "Khách lẻ", customer_source: "Khách vãng lai", sale_price: "", paid_amount: "", payment_method: "Chuyển khoản", document_status: "Đang làm đăng ký", note: "", extra: {} };
  const [f, setF] = useState(empty);
  const [show, setShow] = useState(!!params.get("xe"));
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [items, setItems] = useState([]);   // dong ban kem
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const setExtra = (k, v) => setF((p) => ({ ...p, extra: { ...p.extra, [k]: v } }));

  const [itemSum, setItemSum] = useState({}); // sale_code -> tong ban kem
  const loadOrders = async () => {
    const [{ data }, { data: si }] = await Promise.all([
      supabase.from("sales_orders").select("*").order("created_at", { ascending: false }).limit(1000),
      supabase.from("sale_items").select("sale_code, amount").limit(5000),
    ]);
    setOrders(data || []);
    const m = {};
    (si || []).forEach((x) => { m[x.sale_code] = (m[x.sale_code] || 0) + x.amount; });
    setItemSum(m);
  };

  const orderTotal = (o) => o.sale_price * o.quantity + (itemSum[o.code] || 0);
  const payBadge = (o) => {
    const t = orderTotal(o), paid = o.paid_amount || 0;
    if (paid <= 0) return <Badge tone="red">Chưa TT</Badge>;
    if (paid < t) return <Badge tone="amber">Còn lại {fmtVND(t - paid)}</Badge>;
    return <Badge tone="green">Đã đủ</Badge>;
  };
  const updatePaid = async (o, val) => {
    const { error } = await supabase.rpc("fn_cap_nhat_thanh_toan", { p_id: o.id, p_paid: Number(val) || 0 });
    if (error) return notify(errMsg(error), "err");
    notify("Đã cập nhật số tiền đã thanh toán (có lưu vết trong ghi chú đơn).");
    loadOrders(); if (detail?.id === o.id) setDetail(null);
  };
  useEffect(() => { loadOrders(); }, []);

  // Go so khung -> tim xe san sang toan he thong -> tu dien mau xe + kho + tick so khung
  const [fq, setFq] = useState("");
  const [fHits, setFHits] = useState([]);
  useEffect(() => {
    const q = fq.trim().toUpperCase();
    if (q.length < 3) { setFHits([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("vehicle_units")
        .select("frame_number, vehicle_id, location_code")
        .eq("status", "TON_KHO").ilike("frame_number", `%${q}%`).limit(10);
      setFHits(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [fq]);
  const pickFrame = (u) => {
    if (f.vehicle_id && (f.vehicle_id !== u.vehicle_id || f.location_code !== u.location_code) && frames.length > 0) {
      if (!confirm("Xe này khác mẫu/kho với các số khung đã chọn — chuyển sang xe/kho mới và bỏ chọn cũ?")) return;
      setFrames([]);
    }
    setF((p) => ({ ...p, vehicle_id: u.vehicle_id, location_code: u.location_code }));
    setFrames((p) => (p.includes(u.frame_number) ? p : [...p, u.frame_number]));
    setFq(""); setFHits([]);
  };

  // ===== Dieu chinh don ban (2 cap) — hooks phai nam TRUOC return som =====
  const [adjF, setAdjF] = useState({ new_price: "", reason: "" });
  const [pendAdj, setPendAdj] = useState([]);
  const loadPendAdj = async () => {
    const { data } = await supabase.from("sale_adjust_requests").select("*").eq("status", "Chờ duyệt").order("created_at");
    setPendAdj(data || []);
  };
  useEffect(() => { loadPendAdj(); }, []);

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
      p: { ...f, frames, extra, sale_price: f.sale_price ? Number(f.sale_price) : null,
        paid_amount: Number(f.paid_amount) || 0,
        items: items.map((it) => ({ ...it, qty: Number(it.qty) || 1, unit_price: Number(it.unit_price) || 0 })) },
    });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã lưu đơn ${data} (${frames.length} xe). Tồn kho đã trừ tự động. Phần thu tiền ghi nhận ở app thu-chi riêng.`);
    setF(empty); setFrames([]); setItems([]); setShow(false); refresh(); loadOrders();
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

  // ===== Ban kem & thanh toan =====
  const catalog = (key) => (settings[key] || "").split(/\n+/).map((l) => {
    const [name, price] = l.split("|"); return name?.trim() ? { name: name.trim(), price: Number(price) || 0 } : null;
  }).filter(Boolean);
  const pkList = catalog("phu_kien"), bhList = catalog("bao_hiem");
  const giaDangKy = Number(settings.gia_dang_ky) || 350000;

  const tongXe = (Number(f.sale_price) || 0) * Math.max(frames.length, 1);
  const tongKem = items.reduce((sm, it) => sm + (Number(it.qty) || 1) * (Number(it.unit_price) || 0), 0);
  const tongDon = tongXe + tongKem;


  const addItem = (item_type, name, unit_price) => setItems((p) => [...p, { item_type, name, qty: 1, unit_price }]);
  const setItem = (i, k, v) => setItems((p) => p.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  const openDetail = async (o) => {
    setDetail({ ...o, _items: null, _pays: null, _adjs: null });
    setAdjF({ new_price: "", reason: "" });
    const [{ data: di }, { data: dp }, { data: da }] = await Promise.all([
      supabase.from("sale_items").select("*").eq("sale_code", o.code),
      supabase.from("sale_payments").select("*").eq("sale_code", o.code),
      supabase.from("sale_adjust_requests").select("*").eq("sale_code", o.code).order("created_at", { ascending: false }),
    ]);
    setDetail({ ...o, _items: di || [], _pays: dp || [], _adjs: da || [] });
  };

  const sendAdj = async () => {
    const { data, error } = await supabase.rpc("fn_yeu_cau_sua_don", {
      p: { sale_code: detail.code, new_price: Number(adjF.new_price), reason: adjF.reason },
    });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã gửi yêu cầu điều chỉnh ${data} — chờ BGĐ/Admin duyệt. Tồn và tiền chưa thay đổi.`);
    openDetail(detail); loadPendAdj();
  };

  const decideAdj = async (rq, ok) => {
    const { error } = await supabase.rpc("fn_duyet_sua_don", { p_id: rq.id, p_approve: ok, p_account: null, p_note: "" });
    if (error) return notify(errMsg(error), "err");
    notify(ok ? `Đã duyệt ${rq.code}: giá đơn đã cập nhật, lưu vết đầy đủ. Phần tiền hoàn/thu thêm xử lý ở app thu-chi riêng.` : `Đã từ chối ${rq.code}.`);
    loadPendAdj(); loadOrders();
  };
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
          <div className="font-extrabold text-base mb-3">Tạo đơn bán — chọn xe theo số khung</div>
          <div className="mb-3 relative">
            <label className="lbl">⚡ Tìm nhanh: gõ 3–6 ký tự cuối số khung (tự điền mẫu xe + kho)</label>
            <input className="inp font-mono !text-[14px]" placeholder="VD: 429407…" value={fq} onChange={(e) => setFq(e.target.value.toUpperCase())} />
            {fq.trim().length >= 3 && (
              <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-[#D5DBE3] rounded-xl shadow-lg overflow-hidden">
                {fHits.length === 0 && <div className="px-3 py-2.5 text-sm text-[#8A93A0]">Không có xe sẵn sàng nào khớp — xe đã bán/đang chuyển sẽ không hiện ở đây.</div>}
                {fHits.map((u) => {
                  const v = vehicles.find((x) => x.id === u.vehicle_id);
                  return (
                    <button key={u.frame_number} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b border-[#F2F4F7] last:border-0 hover:bg-[#F0FDF6]" onClick={() => pickFrame(u)}>
                      <span className="font-mono font-bold text-[13px]">{u.frame_number}</span>
                      <span className="text-xs text-[#5A6572]">{v ? `${v.name} ${v.color}` : u.vehicle_id}</span>
                      <span className="ml-auto text-[11px] text-[#8A93A0]">{locations.find((l) => l.code === u.location_code)?.name || u.location_code}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
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

          {/* ===== BAN KEM ===== */}
          <div className="bg-[#F8FAFC] rounded-xl p-3.5 mb-3">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <div className="font-extrabold text-[13.5px] mr-auto">Bán kèm (phụ kiện · đăng ký · bảo hiểm)</div>
              <select className="inp !w-auto !py-1.5 !text-xs" value="" onChange={(e) => { const pk = pkList.find((x) => x.name === e.target.value); if (pk) addItem("PHU_KIEN", pk.name, pk.price); }}>
                <option value="">+ Phụ kiện…</option>{pkList.map((x) => <option key={x.name} value={x.name}>{x.name} — {fmtVND(x.price)}</option>)}
              </select>
              <button className="btn-ghost !py-1.5 !text-xs" onClick={() => addItem("DANG_KY", "Dịch vụ đăng ký xe trọn gói", giaDangKy)}>+ DV đăng ký</button>
              <select className="inp !w-auto !py-1.5 !text-xs" value="" onChange={(e) => { const bh = bhList.find((x) => x.name === e.target.value); if (bh) addItem("BAO_HIEM", bh.name, bh.price); }}>
                <option value="">+ Bảo hiểm…</option>{bhList.map((x) => <option key={x.name} value={x.name}>{x.name} — {fmtVND(x.price)}</option>)}
              </select>
            </div>
            {items.length === 0 && <div className="text-xs text-[#8A93A0]">Chưa có dòng bán kèm. Danh mục phụ kiện/bảo hiểm và giá mặc định chỉnh trong Cài đặt.</div>}
            {items.map((it, i) => (
              <div key={i} className="flex gap-1.5 items-center flex-wrap py-1 border-t border-[#EEF1F4]">
                <Badge tone={it.item_type === "PHU_KIEN" ? "blue" : it.item_type === "DANG_KY" ? "purple" : "green"}>
                  {it.item_type === "PHU_KIEN" ? "PK" : it.item_type === "DANG_KY" ? "ĐK" : "BH"}</Badge>
                <input className="inp !py-1.5 !text-xs flex-1 min-w-[150px]" value={it.name} onChange={(e) => setItem(i, "name", e.target.value)} />
                <input type="number" min="1" className="inp !py-1.5 !text-xs !w-16" title="Số lượng" value={it.qty} onChange={(e) => setItem(i, "qty", e.target.value)} />
                <input type="number" className="inp !py-1.5 !text-xs !w-28" title="Đơn giá" value={it.unit_price} onChange={(e) => setItem(i, "unit_price", e.target.value)} />
                <b className="text-[13px] tabular-nums w-24 text-right">{fmtVND((Number(it.qty) || 1) * (Number(it.unit_price) || 0))}</b>
                <button className="text-[#C6CDD6] hover:text-danger" onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>

          <div className="bg-[#F8FAFC] rounded-xl p-3.5 mb-3 flex items-center gap-3 flex-wrap">
            <div className="font-extrabold text-[13.5px]">Tổng đơn: <span className="text-brand">{fmtVND(tongDon)}</span>
              <span className="text-[11px] font-normal text-[#8A93A0]"> (xe {fmtVND(tongXe)}{tongKem ? ` + bán kèm ${fmtVND(tongKem)}` : ""})</span></div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#5A6572]">Đã thanh toán:</span>
              <input type="number" min="0" className="inp !w-36 !py-1.5 !text-xs" value={f.paid_amount} onChange={(e) => set("paid_amount", e.target.value)} placeholder="0" />
              <button className="btn-ghost !px-2 !py-1.5 !text-[10.5px]" onClick={() => set("paid_amount", tongDon)}>Đủ 100%</button>
              {f.paid_amount !== "" && Number(f.paid_amount) < tongDon && (
                <span className="text-xs font-bold text-[#A25F00]">Còn lại: {fmtVND(tongDon - (Number(f.paid_amount) || 0))}</span>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-[#5A6572]">Hình thức thanh toán:</span>
              <select className="inp !w-auto !py-1.5 !text-xs" value={f.payment_method} onChange={(e) => set("payment_method", e.target.value)}>
                {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="w-full text-[10.5px] text-[#8A93A0]">Các trường thanh toán chỉ để tra cứu giao dịch bán xe — không phải sổ quỹ. Ghi sổ tiền ở app thu-chi riêng.</div>
          </div>

          <div className="flex gap-2.5">
            <button className="btn-ok" disabled={busy || frames.length === 0} onClick={submit}>{busy ? "Đang lưu…" : `Lưu đơn (${frames.length} xe) & trừ tồn`}</button>
            <button className="btn-ghost" onClick={() => { setShow(false); setF(empty); setFrames([]); setItems([]); }}>Hủy</button>
          </div>
        </div>
      )}

      {["CEO", "ADMIN"].includes(profile.role) && pendAdj.length > 0 && (
        <div className="card !border-[#F5C542] !border-2">
          <div className="font-extrabold mb-2.5">⚠ Yêu cầu điều chỉnh đơn bán chờ duyệt ({pendAdj.length})</div>
          <div className="overflow-x-auto"><table className="w-full border-collapse">
            <thead><tr><th className="th">Phiếu</th><th className="th">Đơn</th><th className="th">Giá cũ → mới</th><th className="th">Chênh</th><th className="th">Lý do</th><th className="th">Người gửi</th><th className="th"></th></tr></thead>
            <tbody>{pendAdj.map((rq) => (
              <tr key={rq.id}>
                <td className="td font-bold">{rq.code}<div className="text-[11px] text-[#8A93A0]">{fmtTime(rq.created_at)}</div></td>
                <td className="td font-bold">{rq.sale_code}</td>
                <td className="td">{fmtVND(rq.old_price)} → <b>{fmtVND(rq.new_price)}</b>{rq.quantity > 1 ? ` ×${rq.quantity}` : ""}</td>
                <td className="td"><b className={rq.diff_total >= 0 ? "text-[#0E7A4A]" : "text-danger"}>{rq.diff_total > 0 ? "+" : ""}{fmtVND(rq.diff_total)}</b>
                  <div className="text-[10.5px] text-[#8A93A0]">{rq.diff_total > 0 ? "thu thêm của khách" : "hoàn lại khách"}</div></td>
                <td className="td text-xs max-w-[180px]">{rq.reason}</td>
                <td className="td text-xs">{rq.requested_by_name}</td>
                <td className="td"><div className="flex gap-1.5">
                  <button className="btn-ok !px-2.5 !py-1.5 !text-xs" onClick={() => decideAdj(rq, true)}>Duyệt</button>
                  <button className="btn-danger !px-2.5 !py-1.5 !text-xs" onClick={() => decideAdj(rq, false)}>Từ chối</button>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      <div className="card">
        <div className="font-extrabold mb-2.5">{canEdit ? "Đơn bán gần đây" : "Đơn bán của tôi"} ({orders.length})</div>
        <div className="overflow-x-auto"><table className="w-full border-collapse">
          <thead><tr><th className="th">Mã đơn</th><th className="th">Ngày</th><th className="th">Xe · Số khung</th><th className="th">Kho xuất</th><th className="th">Khách</th><th className="th">Giá bán</th><th className="th">Thanh toán</th><th className="th">NV bán</th><th className="th">Hồ sơ</th><th className="th">Bảo hành</th><th className="th"></th></tr></thead>
          <tbody>{pageSlice(orders, page, pageSize).map((s) => {
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
                <td className="td">{payBadge(s)}</td>
                <td className="td">{s.seller_name}</td>
                <td className="td">{canEdit ? (
                  <select className="inp !w-auto !py-1 !text-xs" value={s.document_status} onChange={(e) => updateOrder(s.id, "p_doc", e.target.value)}>{DOC_STATUSES.map((c) => <option key={c}>{c}</option>)}</select>
                ) : (["Đủ hồ sơ","Đã xong đăng ký"].includes(s.document_status) ? <Badge tone="green">{s.document_status}</Badge> : <Badge tone="amber">{s.document_status}</Badge>)}</td>
                <td className="td">{canEdit ? (
                  <select className="inp !w-auto !py-1 !text-xs" value={s.warranty_status} onChange={(e) => updateOrder(s.id, "p_warranty", e.target.value)}><option>Chưa kích hoạt</option><option>Đã kích hoạt</option></select>
                ) : (s.warranty_status === "Đã kích hoạt" ? <Badge tone="green">Đã kích hoạt</Badge> : <Badge tone="gray">Chưa kích hoạt</Badge>)}</td>
                <td className="td"><button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => openDetail(s)}>Chi tiết</button></td>
              </tr>
            );
          })}</tbody>
        </table></div>
        <Pager total={orders.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
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
                <div><span className="text-[#8A93A0]">Hình thức TT:</span> {detail.payment_method}</div>
                <div><span className="text-[#8A93A0]">Trạng thái TT:</span> {payBadge(detail)}</div>
                <div><span className="text-[#8A93A0]">Đã thanh toán:</span> <b>{fmtVND(detail.paid_amount || 0)}</b></div>
                <div><span className="text-[#8A93A0]">Còn lại:</span> <b className={orderTotal(detail) - (detail.paid_amount || 0) > 0 ? "text-danger" : "text-[#0E7A4A]"}>{fmtVND(Math.max(orderTotal(detail) - (detail.paid_amount || 0), 0))}</b></div>
                {["CEO", "MANAGER", "ADMIN"].includes(profile.role) && (
                  <div className="col-span-2 flex gap-1.5 items-center">
                    <span className="text-[#8A93A0] text-xs">Khách trả thêm → cập nhật tổng đã TT:</span>
                    <input type="number" min="0" className="inp !w-36 !py-1.5 !text-xs" id="mk-paid-input" defaultValue={detail.paid_amount || 0} />
                    <button className="btn-ghost !py-1.5 !text-xs" onClick={() => updatePaid(detail, document.getElementById("mk-paid-input").value)}>Cập nhật</button>
                  </div>
                )}
                <div><span className="text-[#8A93A0]">NV bán:</span> {detail.seller_name}</div>
                <div><span className="text-[#8A93A0]">Hồ sơ:</span> <Badge tone="blue">{detail.document_status}</Badge></div>
                <div><span className="text-[#8A93A0]">Bảo hành:</span> <Badge tone={detail.warranty_status === "Đã kích hoạt" ? "green" : "gray"}>{detail.warranty_status}</Badge></div>
                {cfieldsAll.map((c) => (
                  <div key={c.id}><span className="text-[#8A93A0]">{c.label}:</span> <b>{fieldValText(c, detail.extra?.[c.field_key])}</b></div>
                ))}
                {detail._items?.length > 0 && (
                  <div className="col-span-2 pt-1 border-t border-dashed border-[#E6EAEF]">
                    <div className="text-[#8A93A0] mb-1">Bán kèm:</div>
                    {detail._items.map((it) => (
                      <div key={it.id} className="flex justify-between"><span>{it.name} ×{it.qty}</span><b>{fmtVND(it.amount)}</b></div>
                    ))}
                    <div className="flex justify-between mt-1 pt-1 border-t border-[#EEF1F4]"><b>Tổng đơn (xe + bán kèm)</b>
                      <b className="text-brand">{fmtVND(detail.sale_price * detail.quantity + detail._items.reduce((sm, x) => sm + x.amount, 0))}</b></div>
                  </div>
                )}
                {detail._pays?.length > 0 && (
                  <div className="col-span-2 pt-1 border-t border-dashed border-[#E6EAEF]">
                    <div className="text-[#8A93A0] mb-1">Thanh toán (bản ghi cũ — nay quản ở app thu-chi riêng):</div>
                    {detail._pays.map((x) => (
                      <div key={x.id} className="flex justify-between items-center gap-2">
                        <span>{x.method}{x.finance_company ? ` · ${x.finance_company}` : ""}{x.cash_txn_code ? ` · ${x.cash_txn_code}` : ""}{x.expected_date ? ` · dự kiến ${fmtDate(x.expected_date)}` : ""}</span>
                        <span className="flex items-center gap-1.5"><b>{fmtVND(x.amount)}</b>
                          <Badge tone={x.status === "Đã thu" || x.status === "Đã giải ngân" ? "green" : "amber"}>{x.status}</Badge></span>
                      </div>
                    ))}
                  </div>
                )}
                {detail.note && <div className="col-span-2"><span className="text-[#8A93A0]">Ghi chú:</span> {detail.note}</div>}

                {detail._adjs && detail._adjs.length > 0 && (
                  <div className="col-span-2 pt-2 border-t border-dashed border-[#E6EAEF]">
                    <div className="font-bold text-xs mb-1">Lịch sử điều chỉnh giá</div>
                    {detail._adjs.map((a) => (
                      <div key={a.id} className="text-[12px] py-1 flex gap-2 flex-wrap items-center">
                        <b>{a.code}</b>
                        <span>{fmtVND(a.old_price)} → <b>{fmtVND(a.new_price)}</b></span>
                        <Badge tone={a.status === "Đã duyệt" ? "green" : a.status === "Chờ duyệt" ? "amber" : "gray"}>{a.status}</Badge>
                        <span className="text-[#8A93A0]">{a.reason}</span>
                        <span className="text-[10.5px] text-[#8A93A0]">Gửi: {a.requested_by_name}{a.approved_by_name ? ` · Duyệt: ${a.approved_by_name}` : ""}{a.cash_txn_code ? ` · Phiếu ${a.cash_txn_code}` : ""}</span>
                      </div>
                    ))}
                  </div>
                )}

                {(["CEO", "MANAGER", "ADMIN"].includes(profile.role) || detail.seller_id === profile.id) &&
                 !(detail._adjs || []).some((a) => a.status === "Chờ duyệt") && (
                  <div className="col-span-2 pt-2 border-t border-dashed border-[#E6EAEF]">
                    <div className="font-bold text-xs mb-1.5">Yêu cầu điều chỉnh giá bán (sai sót nhập liệu)</div>
                    <div className="flex gap-1.5 flex-wrap items-end">
                      <div><label className="lbl">Giá bán đúng (đ/xe)</label>
                        <input type="number" min="0" className="inp !py-2 !w-40" value={adjF.new_price} onChange={(e) => setAdjF((p) => ({ ...p, new_price: e.target.value }))} placeholder={String(detail.sale_price)} /></div>
                      <div className="flex-1 min-w-[180px]"><label className="lbl">Lý do (bắt buộc)</label>
                        <input className="inp !py-2" value={adjF.reason} onChange={(e) => setAdjF((p) => ({ ...p, reason: e.target.value }))} placeholder="VD: Gõ nhầm 19.9tr thành 15tr…" /></div>
                      <button className="btn-primary !py-2 !text-xs" onClick={sendAdj}>Gửi yêu cầu</button>
                    </div>
                    <div className="text-[10.5px] text-[#8A93A0] mt-1">Sau khi BGĐ/Admin duyệt: giá đơn được cập nhật và lưu vết đầy đủ (giá cũ → mới, ai gửi, ai duyệt). Phần tiền hoàn/thu thêm của khách xử lý ở app thu-chi riêng.</div>
                  </div>
                )}

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
