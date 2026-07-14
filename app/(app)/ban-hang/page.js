"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, VehicleSearch, LocSearch, FramePicker, Pager, pageSlice , useSortable, Th, CustomerSearch } from "@/components/ui";
import Scanner from "@/components/Scanner";
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
  const empty = { vehicle_id: params.get("xe") || "", location_code: "", customer_name: "", customer_phone: "", customer_cccd: "", customer_address: "", customer_type: "Khách lẻ", customer_source: "Khách vãng lai", sale_price: "", paid_amount: "", payment_method: "Chuyển khoản", tra_gop_ct: "", tra_gop_tien: "", document_status: "Đang làm đăng ký", note: "", extra: {} };
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
  const sort = useSortable();
  const [custs, setCusts] = useState([]);
  const [custId, setCustId] = useState("");   // khach da chon tu CSDL
  const loadCusts = async () => {
    const { data } = await supabase.from("customers").select("id, code, name, phone, cccd, address, customer_type, source, status").order("updated_at", { ascending: false }).limit(1000);
    setCusts(data || []);
  };
  useEffect(() => { loadCusts(); }, []);
  const pickCust = (c) => {
    if (!c) { setCustId(""); setF((p) => ({ ...p, customer_name: "", customer_phone: "", customer_cccd: "", customer_address: "" })); return; }
    setCustId(c.id);
    setF((p) => ({ ...p, customer_name: c.name, customer_phone: c.phone, customer_cccd: c.cccd || "", customer_address: c.address || "", customer_type: c.customer_type || p.customer_type, customer_source: c.source || p.customer_source }));
  };
  const createCust = (name) => { setCustId(""); setF((p) => ({ ...p, customer_name: name || "", customer_phone: "", customer_cccd: "", customer_address: "" })); };

  // ===== BAN BUON =====
  const [wholesale, setWholesale] = useState(false);
  const [wRows, setWRows] = useState([]);   // {frame, vehicle_id, location_code, price, paid}
  const [wq, setWq] = useState("");
  const [wHits, setWHits] = useState([]);
  const [wScan, setWScan] = useState(false);
  useEffect(() => {
    const q = wq.trim().toUpperCase();
    if (q.length < 3) { setWHits([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("vehicle_units").select("frame_number, vehicle_id, location_code").eq("status", "TON_KHO").ilike("frame_number", `%${q}%`).limit(10);
      setWHits(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [wq]);
  const wAdd = (u) => {
    if (wRows.some((r) => r.frame === u.frame_number)) { notify("Xe này đã có trong đơn buôn.", "err"); return; }
    const v = vehicles.find((x) => x.id === u.vehicle_id);
    setWRows((p) => [...p, { frame: u.frame_number, vehicle_id: u.vehicle_id, location_code: u.location_code, price: v?.list_price || 0, paid: 0 }]);
    setWq(""); setWHits([]);
  };
  const wScanAdd = async (list) => {
    for (const code of list.map((x) => x.trim().toUpperCase()).filter(Boolean)) {
      const { data: u } = await supabase.from("vehicle_units").select("frame_number, vehicle_id, location_code, status").eq("frame_number", code).maybeSingle();
      if (!u) { notify(`Số khung ${code} không có trên hệ thống.`, "err"); continue; }
      if (u.status !== "TON_KHO") { notify(`Xe ${code} không sẵn sàng bán.`, "err"); continue; }
      wAdd(u);
    }
  };
  const wTong = wRows.reduce((s, r) => s + (Number(r.price) || 0), 0);
  const submitBuon = async () => {
    if (!f.customer_name.trim() || !f.customer_phone.trim()) return notify("Nhập tên và SĐT khách hàng.", "err");
    if (wRows.length === 0) return notify("Chưa có xe nào trong đơn buôn.", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_ban_buon", {
      p: { customer_name: f.customer_name, customer_phone: f.customer_phone, customer_cccd: f.customer_cccd, customer_address: f.customer_address,
        customer_type: f.customer_type, customer_source: f.customer_source, payment_method: f.payment_method, document_status: f.document_status, note: f.note,
        lines: wRows.map((r) => ({ frame_number: r.frame, sale_price: Number(r.price) || 0, paid_amount: Number(r.paid) || 0 })) },
    });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã tạo ${data.count} đơn bán (lô buôn ${data.lo}) cho khách ${f.customer_name}. Tồn kho đã trừ.`);
    setF(empty); setCustId(""); setWRows([]); setWholesale(false); setShow(false); refresh(); loadOrders(); loadCusts();
  };

  // Go so khung -> tim xe san sang toan he thong -> tu dien mau xe + kho + tick so khung
  const [fq, setFq] = useState("");
  const [fHits, setFHits] = useState([]);
  const [showScan, setShowScan] = useState(false);
  const scanPickFrames = async (list) => {
    for (const code of list.map((x) => x.trim().toUpperCase()).filter(Boolean)) {
      const { data: u } = await supabase.from("vehicle_units")
        .select("frame_number, vehicle_id, location_code, status").eq("frame_number", code).maybeSingle();
      if (!u) { notify(`Số khung ${code} không có trên hệ thống.`, "err"); continue; }
      if (u.status !== "TON_KHO") { notify(`Xe ${code} không sẵn sàng bán (${u.status === "DA_BAN" ? "đã bán" : "đang chuyển"}).`, "err"); continue; }
      pickFrame(u);
    }
  };
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
    if (f.payment_method === "Trả góp") {
      if (!f.tra_gop_ct) { setBusy(false); return notify("Chọn đơn vị trả góp.", "err"); }
      extra.tra_gop_cong_ty = f.tra_gop_ct;
      extra.tra_gop_so_tien = Number(f.tra_gop_tien) || 0;
    } else { delete extra.tra_gop_cong_ty; delete extra.tra_gop_so_tien; }
    const { data, error } = await supabase.rpc("fn_ban_hang", {
      p: { ...f, frames, extra, sale_price: f.sale_price ? Number(f.sale_price) : null,
        paid_amount: Number(f.paid_amount) || 0,
        items: items.map((it) => ({ ...it, qty: Number(it.qty) || 1, unit_price: Number(it.unit_price) || 0 })) },
    });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã lưu đơn ${data} (${frames.length} xe). Tồn kho đã trừ tự động — bấm "🖨 In phiếu" trong cửa sổ chi tiết để in cho khách.`);
    setF(empty); setFrames([]); setItems([]); setShow(false); setCustId(""); refresh(); loadOrders(); loadCusts();
    const { data: newO } = await supabase.from("sales_orders").select("*").eq("code", data).single();
    if (newO) openDetail(newO);
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

  // ===== IN PHIEU XUAT BAN =====
  const printOrder = async (o) => {
    const { data: its } = await supabase.from("sale_items").select("*").eq("sale_code", o.code);
    const v = vehicles.find((x) => x.id === o.vehicle_id);
    const l = locations.find((x) => x.code === o.location_code);
    const items = its || [];
    const kem = items.reduce((sm, x) => sm + x.amount, 0);
    const tienXe = o.sale_price * o.quantity;
    const tong = tienXe + kem;
    const paid = o.paid_amount || 0;
    const row = (t, r) => `<tr><td>${t}</td><td class="r">${r}</td></tr>`;
    const money = (n) => new Intl.NumberFormat("vi-VN").format(n) + " đ";
    const html = `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>${o.code}</title><style>
      *{margin:0;padding:0;box-sizing:border-box;font-family:'Segoe UI',Arial,sans-serif}
      body{padding:24px;max-width:720px;margin:0 auto;color:#111;font-size:13px;line-height:1.5}
      .hd{display:flex;justify-content:space-between;gap:12px;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:12px}
      .cty{font-size:15px;font-weight:800}.sub{font-size:11.5px;color:#444}
      h1{font-size:19px;text-align:center;margin:14px 0 2px;letter-spacing:.5px}
      .mid{text-align:center;font-size:12px;color:#444;margin-bottom:14px}
      h2{font-size:12.5px;text-transform:uppercase;margin:14px 0 6px;border-bottom:1px solid #bbb;padding-bottom:3px}
      table{width:100%;border-collapse:collapse}
      .kv td{padding:2.5px 0;vertical-align:top}.kv td:first-child{color:#555;width:34%}
      .bill td,.bill th{border:1px solid #999;padding:5px 8px}.bill th{background:#f0f0f0;text-align:left;font-size:12px}
      .r{text-align:right}.b{font-weight:800}
      .chu{font-style:italic;margin-top:6px}
      .sig{display:flex;justify-content:space-between;margin-top:34px;text-align:center}
      .sig div{width:45%}.sig .t{font-weight:700}.sig .s{font-size:11px;color:#555;margin-bottom:56px}
      .ft{text-align:center;font-size:11.5px;color:#555;margin-top:24px;border-top:1px dashed #aaa;padding-top:8px}
      @media print{body{padding:8px}.noprint{display:none}}
    </style></head><body>
      <div class="hd">
        <div>
          <div class="cty">${settings.cty_ten || "HỆ THỐNG XE ĐIỆN MINH KỲ"}</div>
          <div class="sub">${settings.cty_diachi || ""}</div>
          <div class="sub">${settings.cty_sdt ? "ĐT: " + settings.cty_sdt : ""}</div>
        </div>
        <div class="sub" style="text-align:right">Số phiếu: <b>${o.code}</b><br/>Ngày: ${new Date(o.sale_date).toLocaleDateString("vi-VN")}<br/>Điểm bán: ${l?.name || o.location_code}</div>
      </div>
      <h1>PHIẾU XUẤT BÁN XE</h1>
      <div class="mid">(Kiêm biên nhận giao xe cho khách hàng)</div>
      <h2>Thông tin khách hàng</h2>
      <table class="kv">
        ${row("Họ tên khách hàng", `<b>${o.customer_name}</b>`)}
        ${row("Số điện thoại", o.customer_phone)}
        ${o.customer_cccd ? row("CCCD", o.customer_cccd) : ""}
        ${o.customer_address ? row("Địa chỉ", o.customer_address) : ""}
      </table>
      <h2>Thông tin xe</h2>
      <table class="kv">
        ${row("Loại xe", `<b>${v ? v.brand + " " + v.name + " — màu " + v.color : o.vehicle_id}</b>`)}
        ${row("Số khung", `<b style="font-family:monospace">${o.frame_number}</b>`)}
        ${row("Số lượng", o.quantity + " xe")}
      </table>
      <h2>Thanh toán</h2>
      <table class="bill">
        <tr><th>Nội dung</th><th style="width:60px">SL</th><th style="width:110px" class="r">Đơn giá</th><th style="width:120px" class="r">Thành tiền</th></tr>
        <tr><td>${v ? v.name + " " + v.color : o.vehicle_id}</td><td>${o.quantity}</td><td class="r">${money(o.sale_price)}</td><td class="r">${money(tienXe)}</td></tr>
        ${items.map((x) => `<tr><td>${x.name}</td><td>${x.qty}</td><td class="r">${money(x.unit_price)}</td><td class="r">${money(x.amount)}</td></tr>`).join("")}
        <tr><td colspan="3" class="r b">TỔNG CỘNG</td><td class="r b">${money(tong)}</td></tr>
        <tr><td colspan="3" class="r">Đã thanh toán (${o.payment_method})</td><td class="r">${money(paid)}</td></tr>
        <tr><td colspan="3" class="r b">Còn lại</td><td class="r b">${money(Math.max(tong - paid, 0))}</td></tr>
      </table>
      <div class="chu">Bằng chữ (tổng cộng): <b>${docTien(tong)}</b></div>
      ${o.extra?.tra_gop_cong_ty ? `<div style="margin-top:6px"><b>Trả góp:</b> ${o.extra.tra_gop_cong_ty}${Number(o.extra.tra_gop_so_tien) > 0 ? " — số tiền trả góp " + money(Number(o.extra.tra_gop_so_tien)) : ""}</div>` : ""}
      ${o.note ? `<div style="margin-top:8px"><b>Ghi chú:</b> ${o.note}</div>` : ""}
      <div class="sig">
        <div><div class="t">KHÁCH HÀNG</div><div class="s">(Ký, ghi rõ họ tên)</div><div>${o.customer_name}</div></div>
        <div><div class="t">NHÂN VIÊN BÁN HÀNG</div><div class="s">(Ký, ghi rõ họ tên)</div><div>${o.seller_name}</div></div>
      </div>
      <div class="ft">${settings.phieu_footer || "Cảm ơn Quý khách đã tin tưởng Minh Kỳ EV. Kính chúc Quý khách thượng lộ bình an!"}</div>
      <div class="noprint" style="text-align:center;margin-top:18px"><button onclick="window.print()" style="padding:10px 26px;font-size:14px;font-weight:700;cursor:pointer">🖨 In / Lưu PDF</button></div>
    </body></html>`;
    const w = window.open("", "_blank");
    if (!w) return notify("Trình duyệt chặn cửa sổ mới — cho phép popup cho trang này rồi bấm In lại.", "err");
    w.document.write(html); w.document.close();
    setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
  };

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
      {showScan && <Scanner onClose={() => setShowScan(false)} onAdd={scanPickFrames} />}
      {!show && <button className="btn-primary self-start" onClick={() => setShow(true)}>+ Tạo đơn bán mới</button>}
      {show && (
        <div className="card">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <div className="font-extrabold text-base mr-auto">Tạo đơn bán</div>
            <div className="flex gap-1 bg-[#EEF1F4] rounded-lg p-0.5">
              <button className={`!px-4 !py-2 !text-xs rounded-md font-bold ${!wholesale ? "bg-white shadow text-brand" : "text-[#5A6572]"}`} onClick={() => setWholesale(false)}>🛵 Bán lẻ (1 xe/đơn)</button>
              <button className={`!px-4 !py-2 !text-xs rounded-md font-bold ${wholesale ? "bg-white shadow text-brand" : "text-[#5A6572]"}`} onClick={() => setWholesale(true)}>📦 Bán buôn (nhiều xe)</button>
            </div>
          </div>
          {!wholesale && <><div className="mb-3 relative">
            <label className="lbl">⚡ Tìm nhanh: gõ 3–6 ký tự cuối số khung (tự điền mẫu xe + kho)</label>
            <div className="flex gap-1.5">
              <input className="inp font-mono !text-[14px]" placeholder="VD: 429407…" value={fq} onChange={(e) => setFq(e.target.value.toUpperCase())} />
              <button className="btn-primary !px-4 whitespace-nowrap" title="Quét mã QR/mã vạch số khung" onClick={() => setShowScan(true)}>📷 Quét</button>
            </div>
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
            <Field label="Kho / cửa hàng xuất xe (gõ để tìm)" required><LocSearch locations={locations} value={f.location_code} onChange={(v) => set("location_code", v)} /></Field>
            <Field label={`Chọn xe bán (${units.length} xe sẵn sàng tại kho)`} required>
              {f.vehicle_id && f.location_code
                ? <FramePicker units={units} selected={frames} onToggle={(fr) => setFrames((p) => p.includes(fr) ? p.filter((x) => x !== fr) : [...p, fr])} />
                : <div className="text-sm text-[#8A93A0] border border-dashed border-[#D5DBE3] rounded-xl px-3 py-4">Chọn xe và kho trước để hiện danh sách số khung.</div>}
            </Field>
            <Field label="Khách hàng (gõ mã/tên/SĐT tìm khách cũ, hoặc tạo mới)" required>
              <CustomerSearch customers={custs} value={custId} onPick={pickCust} onCreate={createCust} />
            </Field>
            <Field label="Họ tên khách hàng" required><input className="inp" value={f.customer_name} onChange={(e) => { set("customer_name", e.target.value); setCustId(""); }} /></Field>
            <Field label="Số điện thoại" required><input className="inp" value={f.customer_phone} onChange={(e) => { set("customer_phone", e.target.value); setCustId(""); }} /></Field>
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
            {f.payment_method === "Trả góp" && (
              <div className="w-full flex items-center gap-2 flex-wrap bg-[#FDF6E3] rounded-lg px-3 py-2">
                <span className="text-xs font-bold text-[#A25F00]">Trả góp:</span>
                <select className="inp !w-auto !py-1.5 !text-xs" value={f.tra_gop_ct} onChange={(e) => set("tra_gop_ct", e.target.value)}>
                  <option value="">— Chọn đơn vị trả góp —</option>
                  {(settings.cong_ty_tra_gop || "Home Credit\nShinhanbank\nHD Saison\nFE Credit").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean).map((x) => <option key={x}>{x}</option>)}
                </select>
                <span className="text-xs text-[#5A6572]">Số tiền trả góp:</span>
                <input type="number" min="0" className="inp !w-36 !py-1.5 !text-xs" value={f.tra_gop_tien} onChange={(e) => set("tra_gop_tien", e.target.value)} placeholder="0" />
              </div>
            )}
            <div className="w-full text-[10.5px] text-[#8A93A0]">Các trường thanh toán chỉ để tra cứu giao dịch bán xe — không phải sổ quỹ. Ghi sổ tiền ở app thu-chi riêng.</div>
          </div>

          </>}

          {wholesale && (
            <div>
              {wScan && <Scanner onClose={() => setWScan(false)} onAdd={wScanAdd} />}
              <div className="bg-[#F0FDF6] border border-[#B6E9CE] rounded-xl p-3 mb-3">
                <div className="text-xs font-bold text-[#0E7A4A] mb-1.5">Thêm xe vào đơn buôn — gõ/quét số khung, mỗi xe tự nhận mẫu xe + kho + giá niêm yết (sửa giá từng dòng bên dưới)</div>
                <div className="flex gap-1.5 relative">
                  <input className="inp font-mono !text-[14px]" placeholder="Gõ 3–6 ký tự cuối số khung…" value={wq} onChange={(e) => setWq(e.target.value.toUpperCase())} />
                  <button className="btn-primary !px-4 whitespace-nowrap" onClick={() => setWScan(true)}>📷 Quét</button>
                  {wq.trim().length >= 3 && (
                    <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border border-[#D5DBE3] rounded-xl shadow-lg overflow-hidden">
                      {wHits.length === 0 && <div className="px-3 py-2.5 text-sm text-[#8A93A0]">Không có xe sẵn sàng nào khớp.</div>}
                      {wHits.map((u) => { const v = vehicles.find((x) => x.id === u.vehicle_id);
                        return <button key={u.frame_number} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b border-[#F2F4F7] last:border-0 hover:bg-[#F0FDF6]" onClick={() => wAdd(u)}>
                          <span className="font-mono font-bold text-[13px]">{u.frame_number}</span>
                          <span className="text-xs text-[#5A6572]">{v ? `${v.name} ${v.color}` : u.vehicle_id}</span>
                          <span className="ml-auto text-[11px] text-[#8A93A0]">{locations.find((l) => l.code === u.location_code)?.name || u.location_code}</span>
                        </button>; })}
                    </div>
                  )}
                </div>
              </div>

              {wRows.length === 0 ? <div className="text-sm text-[#8A93A0] border border-dashed border-[#D5DBE3] rounded-xl px-3 py-4 mb-3">Chưa có xe nào. Gõ/quét số khung phía trên để thêm.</div> : (
                <div className="overflow-x-auto mb-3"><table className="w-full border-collapse">
                  <thead><tr><th className="th w-10">STT</th><th className="th">Xe</th><th className="th">Kho</th><th className="th">Số khung</th><th className="th">Giá bán / xe</th><th className="th">Đã TT / xe</th><th className="th w-8"></th></tr></thead>
                  <tbody>{wRows.map((r, i) => { const v = vehicles.find((x) => x.id === r.vehicle_id);
                    return <tr key={r.frame}>
                      <td className="td text-center text-xs text-[#8A93A0]">{i + 1}</td>
                      <td className="td text-[13px] font-semibold">{v ? `${v.name} ${v.color}` : r.vehicle_id}</td>
                      <td className="td text-xs">{locations.find((l) => l.code === r.location_code)?.name || r.location_code}</td>
                      <td className="td font-mono text-[12px]">{r.frame}</td>
                      <td className="td"><input type="number" min="0" className="inp !py-1.5 !text-xs !w-32" value={r.price} onChange={(e) => setWRows((p) => p.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} /></td>
                      <td className="td"><input type="number" min="0" className="inp !py-1.5 !text-xs !w-32" value={r.paid} onChange={(e) => setWRows((p) => p.map((x, j) => j === i ? { ...x, paid: e.target.value } : x))} /></td>
                      <td className="td"><button className="text-[#C6CDD6] hover:text-danger" onClick={() => setWRows((p) => p.filter((_, j) => j !== i))}>✕</button></td>
                    </tr>; })}
                    <tr className="bg-[#F3F5F8] font-extrabold"><td className="td" colSpan={4}>TỔNG {wRows.length} xe</td><td className="td">{fmtVND(wTong)}</td><td className="td" colSpan={2}></td></tr>
                  </tbody>
                </table></div>
              )}

              <div className="grid gap-x-4 md:grid-cols-3 sm:grid-cols-2">
                <Field label="Khách hàng (gõ mã/tên/SĐT tìm khách cũ, hoặc tạo mới)" required>
                  <CustomerSearch customers={custs} value={custId} onPick={pickCust} onCreate={createCust} />
                </Field>
                <Field label="Họ tên khách hàng" required><input className="inp" value={f.customer_name} onChange={(e) => { set("customer_name", e.target.value); setCustId(""); }} /></Field>
                <Field label="Số điện thoại" required><input className="inp" value={f.customer_phone} onChange={(e) => { set("customer_phone", e.target.value); setCustId(""); }} /></Field>
                <Field label="CCCD"><input className="inp" value={f.customer_cccd} onChange={(e) => set("customer_cccd", e.target.value)} /></Field>
                <Field label="Địa chỉ"><input className="inp" value={f.customer_address} onChange={(e) => set("customer_address", e.target.value)} /></Field>
                <Field label="Hình thức thanh toán"><select className="inp" value={f.payment_method} onChange={(e) => set("payment_method", e.target.value)}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
                <Field label="Trạng thái hồ sơ"><select className="inp" value={f.document_status} onChange={(e) => set("document_status", e.target.value)}>{DOC_STATUSES.map((c) => <option key={c}>{c}</option>)}</select></Field>
                <Field label="Ghi chú chung"><input className="inp" value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
              </div>
              <div className="flex gap-2.5 mt-2">
                <button className="btn-ok" disabled={busy || wRows.length === 0} onClick={submitBuon}>{busy ? "Đang tạo…" : `Tạo ${wRows.length} đơn bán buôn & trừ tồn`}</button>
                <button className="btn-ghost" onClick={() => { setShow(false); setF(empty); setWRows([]); setCustId(""); setWholesale(false); }}>Hủy</button>
              </div>
              <p className="text-[11px] text-[#8A93A0] mt-2">Mỗi xe tạo thành 1 đơn riêng (cùng khách, cùng lô buôn) — in phiếu / tra cứu từng xe như bình thường, gom nhóm theo mã lô LB- trong ghi chú.</p>
            </div>
          )}

          {!wholesale && <div className="flex gap-2.5">
            <button className="btn-ok" disabled={busy || frames.length === 0} onClick={submit}>{busy ? "Đang lưu…" : `Lưu đơn (${frames.length} xe) & trừ tồn`}</button>
            <button className="btn-ghost" onClick={() => { setShow(false); setF(empty); setFrames([]); setItems([]); }}>Hủy</button>
          </div>}
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
          <thead><tr><Th label="Mã đơn" k="code" sort={sort} /><Th label="Ngày" k="date" sort={sort} /><Th label="Xe · Số khung" k="xe" sort={sort} /><Th label="Kho xuất" k="kho" sort={sort} /><Th label="Khách" k="kh" sort={sort} /><Th label="Giá bán" k="gia" sort={sort} /><Th label="Thanh toán" k="tt" sort={sort} /><Th label="NV bán" k="nv" sort={sort} /><th className="th">Hồ sơ</th><th className="th">Bảo hành</th><th className="th"></th></tr></thead>
          <tbody>{pageSlice(sort.sortFn(orders, { code: (o) => o.code, date: (o) => o.sale_date, xe: (o) => vehicles.find((x) => x.id === o.vehicle_id)?.name || o.vehicle_id, kho: (o) => locations.find((l) => l.code === o.location_code)?.name || o.location_code, kh: (o) => o.customer_name, gia: (o) => o.sale_price * o.quantity, tt: (o) => (o.paid_amount || 0) - orderTotal(o), nv: (o) => o.seller_name }), page, pageSize).map((s) => {
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
                <td className="td"><div className="flex gap-1.5"><button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => openDetail(s)}>Chi tiết</button><button className="btn-ghost !px-2 !py-1 !text-xs" title="In phiếu xuất" onClick={() => printOrder(s)}>🖨</button></div></td>
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
                <button className="btn-primary !px-3 !py-1.5 !text-xs" onClick={() => printOrder(detail)}>🖨 In phiếu</button>
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
                <div><span className="text-[#8A93A0]">Hình thức TT:</span> {detail.payment_method}{detail.extra?.tra_gop_cong_ty ? ` — ${detail.extra.tra_gop_cong_ty}${detail.extra.tra_gop_so_tien ? ` (${fmtVND(Number(detail.extra.tra_gop_so_tien))})` : ""}` : ""}</div>
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

// Doc so tien bang chu tieng Viet
const DOC_SO = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
function doc3so(n, full) {
  const tr = Math.floor(n / 100), ch = Math.floor((n % 100) / 10), dv = n % 10;
  let out = "";
  if (full || tr > 0) out += DOC_SO[tr] + " trăm";
  if (ch > 1) { out += " " + DOC_SO[ch] + " mươi"; if (dv === 1) out += " mốt"; else if (dv === 5) out += " lăm"; else if (dv > 0) out += " " + DOC_SO[dv]; }
  else if (ch === 1) { out += " mười"; if (dv === 5) out += " lăm"; else if (dv > 0) out += " " + DOC_SO[dv]; }
  else if (dv > 0) { if (out) out += " lẻ"; out += " " + DOC_SO[dv]; }
  return out.trim();
}
function docTien(n) {
  if (!n || n <= 0) return "Không đồng";
  const ty = Math.floor(n / 1e9), tr = Math.floor((n % 1e9) / 1e6), ng = Math.floor((n % 1e6) / 1e3), le = n % 1e3;
  let out = "";
  if (ty > 0) out += doc3so(ty, false) + " tỷ ";
  if (tr > 0) out += doc3so(tr, ty > 0) + " triệu ";
  if (ng > 0) out += doc3so(ng, ty > 0 || tr > 0) + " nghìn ";
  if (le > 0) out += doc3so(le, out !== "");
  out = out.trim() + " đồng";
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export default function BanHang() {
  return <Suspense fallback={<div className="card">Đang tải…</div>}><BanHangInner /></Suspense>;
}
