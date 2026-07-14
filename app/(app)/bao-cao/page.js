"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, KPI, Pager, pageSlice } from "@/components/ui";
import { fmtVND, fmtNum, fmtTime, fmtDate, downloadCSV } from "@/lib/format";

const iso = (d) => d.toISOString().slice(0, 10);
const PRESETS = [
  { key: "today", label: "Hôm nay" },
  { key: "week", label: "Tuần này" },
  { key: "month", label: "Tháng này" },
  { key: "quarter", label: "Quý này" },
  { key: "year", label: "Năm nay" },
  { key: "custom", label: "Tùy chọn…" },
];
function rangeOf(preset) {
  const now = new Date();
  const to = iso(now);
  if (preset === "today") return [to, to];
  if (preset === "week") { const d = new Date(now); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return [iso(d), to]; }
  if (preset === "month") return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), to];
  if (preset === "quarter") return [iso(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)), to];
  if (preset === "year") return [iso(new Date(now.getFullYear(), 0, 1)), to];
  return [to, to];
}

const TYPES = [
  { key: "ban", label: "Bán hàng" },
  { key: "dieuchuyen", label: "Điều chuyển" },
  { key: "lichsu", label: "Lịch sử giao dịch tồn" },
  { key: "ton", label: "Tồn kho hiện tại" },
];

export default function BaoCao() {
  const { supabase, vehicles, locations, brands, loading, getQty, totalQty, regionQty, regions , customFields } = useCatalog();
  const { toast, notify } = useToast();
  const [type, setType] = useState("ban");
  const [preset, setPreset] = useState("month");
  const [from, setFrom] = useState(rangeOf("month")[0]);
  const [to, setTo] = useState(rangeOf("month")[1]);
  const [fLoc, setFLoc] = useState("");
  const [fBrand, setFBrand] = useState("");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const pickPreset = (k) => {
    setPreset(k);
    if (k !== "custom") { const [a, b] = rangeOf(k); setFrom(a); setTo(b); }
  };

  const locName = (c) => locations.find((l) => l.code === c)?.name || c || "";
  const vOf = (id) => vehicles.find((x) => x.id === id);

  const [itemsMap, setItemsMap] = useState({}); // sale_code -> dong ban kem

  // ===== Nap du lieu xem truoc =====
  const load = async () => {
    setBusy(true);
    const toEnd = to + "T23:59:59";
    if (type === "ban") {
      let q = supabase.from("sales_orders").select("*").gte("sale_date", from).lte("sale_date", to).order("sale_date", { ascending: false }).limit(3000);
      if (fLoc) q = q.eq("location_code", fLoc);
      const [{ data }, { data: si }] = await Promise.all([q, supabase.from("sale_items").select("sale_code, item_type, name, qty, unit_price, amount").limit(10000)]);
      const im = {};
      (si || []).forEach((x) => { (im[x.sale_code] = im[x.sale_code] || []).push(x); });
      setItemsMap(im);
      setRows((data || []).filter((s) => !fBrand || vOf(s.vehicle_id)?.brand === fBrand));
    } else if (type === "dieuchuyen") {
      let q = supabase.from("transfer_orders").select("*").gte("requested_at", from).lte("requested_at", toEnd).order("requested_at", { ascending: false }).limit(3000);
      const { data } = await q;
      setRows((data || []).filter((t) => !fLoc || t.from_location === fLoc || t.to_location === fLoc));
    } else if (type === "lichsu") {
      let q = supabase.from("inventory_txns").select("*").gte("created_at", from).lte("created_at", toEnd).order("created_at", { ascending: false }).limit(5000);
      const { data } = await q;
      setRows((data || []).filter((t) => !fLoc || t.from_location === fLoc || t.to_location === fLoc));
    } else {
      // Ton hien tai: khong theo ngay
      setRows(vehicles.filter((v) => (!fBrand || v.brand === fBrand) && (fLoc ? getQty(v.id, fLoc) > 0 : totalQty(v.id) > 0)));
    }
    setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading, type, from, to, fLoc, fBrand]);

  if (loading) return <div className="card">Đang tải dữ liệu…</div>;

  // ===== Tong hop nhanh cho preview =====
  const sums = (() => {
    if (type === "ban") {
      const soXe = rows.reduce((s, o) => s + o.quantity, 0);
      const dt = rows.reduce((s, o) => s + o.sale_price * o.quantity, 0);
      return [{ l: "Số đơn", v: fmtNum(rows.length) }, { l: "Số xe bán", v: fmtNum(soXe) }, { l: "Doanh thu", v: fmtVND(dt) }];
    }
    if (type === "dieuchuyen") return [{ l: "Số phiếu", v: fmtNum(rows.length) }, { l: "Số xe", v: fmtNum(rows.reduce((s, t) => s + t.quantity, 0)) }, { l: "Chưa xác nhận", v: fmtNum(rows.filter((t) => t.status === "Đang chuyển").length) }];
    if (type === "lichsu") return [{ l: "Số giao dịch", v: fmtNum(rows.length) }];
    return [{ l: "Số mã xe", v: fmtNum(rows.length) }, { l: "Tổng tồn", v: fmtNum(rows.reduce((s, v) => s + (fLoc ? getQty(v.id, fLoc) : totalQty(v.id)), 0)) }];
  })();

  // ===== Xuat CSV theo dung du lieu dang preview =====
  const doExport = () => {
    if (rows.length === 0) return notify("Không có dữ liệu trong phạm vi đã chọn.", "err");
    const suffix = type === "ton" ? iso(new Date()) : `${from}_den_${to}`;
    if (type === "ban") {
      const cfs = customFields.filter((c) => c.entity === "sales_order");
      downloadCSV(`ban_hang_${suffix}.csv`,
        [["Ma_Don","Ngay_Ban","Kho_Ban","Hang","Ma_Xe","Ten_Xe","Mau","So_Khung","SL",
          "Khach_Hang","SDT","CCCD","Dia_Chi","Loai_Khach","Nguon_Khach",
          "Gia_Niem_Yet","Gia_Ban","Thanh_Tien_Xe","Tong_Ban_Kem","Tong_Don",
          "Da_Thanh_Toan","Con_Lai","Trang_Thai_TT","Hinh_Thuc_TT",
          "Trang_Thai_Ho_So","Bao_Hanh","NV_Ban","Tra_Gop_Cong_Ty","Tra_Gop_So_Tien","Ghi_Chu","Chi_Tiet_Ban_Kem",
          ...cfs.map((c) => c.label.replace(/,/g, " "))],
         ...rows.map((s) => {
           const v = vOf(s.vehicle_id);
           const its = itemsMap[s.code] || [];
           const kem = its.reduce((sm, x) => sm + x.amount, 0);
           const tienXe = s.sale_price * s.quantity;
           const tong = tienXe + kem;
           const paid = s.paid_amount || 0;
           const ttTrangThai = paid <= 0 ? "Chưa TT" : paid < tong ? "Một phần" : "Đã đủ";
           const kemText = its.map((x) => `${x.name} x${x.qty} = ${x.amount}`).join(" ; ");
           return [s.code, s.sale_date, locName(s.location_code), v?.brand || "", s.vehicle_id, v?.name || s.vehicle_id, v?.color || "",
             s.frame_number, s.quantity,
             s.customer_name, s.customer_phone, s.customer_cccd || "", s.customer_address || "", s.customer_type, s.customer_source,
             s.list_price, s.sale_price, tienXe, kem, tong,
             paid, Math.max(tong - paid, 0), ttTrangThai, s.payment_method,
             s.document_status, s.warranty_status, s.seller_name, s.extra?.tra_gop_cong_ty || "", s.extra?.tra_gop_so_tien || "", (s.note || "").replace(/\n/g, " "), kemText,
             ...cfs.map((c) => { const val = s.extra?.[c.field_key]; return val === undefined || val === null || val === "" ? "" : (c.field_type === "checkbox" ? (val ? "Có" : "Không") : String(val)); })];
         })]);
    }
    else if (type === "dieuchuyen") downloadCSV(`dieu_chuyen_${suffix}.csv`,
      [["Phieu","Ngay_Tao","Xe","Kho_Di","Kho_Den","SL","Nguoi_Tao","Nguoi_Nhan","Trang_Thai","Ghi_Chu"],
       ...rows.map((t) => { const v = vOf(t.vehicle_id);
         return [t.code, fmtTime(t.requested_at), v ? `${v.name} ${v.color}` : t.vehicle_id, locName(t.from_location), locName(t.to_location), t.quantity, t.requested_by_name, t.confirmed_by_name, t.status, t.note]; })]);
    else if (type === "lichsu") downloadCSV(`lich_su_${suffix}.csv`,
      [["Thoi_Gian","Loai","Xe","Kho_Di","Kho_Den","SL","Ton_Truoc","Ton_Sau","Nguoi","Phieu","Ghi_Chu"],
       ...rows.map((t) => { const v = vOf(t.vehicle_id);
         return [fmtTime(t.created_at), t.txn_type, v ? `${v.name} ${v.color}` : t.vehicle_id, locName(t.from_location), locName(t.to_location), t.qty, t.stock_before, t.stock_after, t.created_by_name, t.doc_code, t.note]; })]);
    else downloadCSV(`ton_kho_${suffix}.csv`,
      [["Ma_Xe","Hang","Ten_Xe","Mau", ...(fLoc ? [locName(fLoc)] : [...regions, "Tong"]), "Ton_Toi_Thieu"],
       ...rows.map((v) => [v.id, v.brand, v.name, v.color,
         ...(fLoc ? [getQty(v.id, fLoc)] : [...regions.map((r) => regionQty(v.id, r)), totalQty(v.id)]), v.min_stock])]);
    notify("Đã xuất file CSV (mở được bằng Excel).");
  };

  const exportTonChiTiet = async () => {
    let q = supabase.from("vehicle_units")
      .select("frame_number, vehicle_id, location_code, status, imported_at, import_doc, is_placeholder, note")
      .in("status", ["TON_KHO", "DANG_CHUYEN"])
      .order("location_code").order("vehicle_id").limit(10000);
    if (fLoc) q = q.eq("location_code", fLoc);
    const { data } = await q;
    let units = (data || []).filter((u) => !fBrand || vOf(u.vehicle_id)?.brand === fBrand);
    if (units.length === 0) return notify("Không có xe tồn nào khớp bộ lọc.", "err");
    const today = new Date();
    downloadCSV(`ton_kho_chi_tiet_${iso(today)}.csv`,
      [["Khu_Vuc", "Kho", "Hang", "Ma_Xe", "Ten_Xe", "Mau", "So_Khung", "So_Khung_Tam", "Ngay_Nhap_Kho", "So_Ngay_Ton", "Trang_Thai", "Phieu_Nhap", "Gia_Niem_Yet", "Ghi_Chu"],
       ...units.map((u) => {
         const v = vOf(u.vehicle_id);
         const l = locations.find((x) => x.code === u.location_code);
         const days = Math.floor((today - new Date(u.imported_at)) / 86400000);
         return [l?.region || "", l?.name || u.location_code, v?.brand || "", u.vehicle_id, v?.name || "", v?.color || "",
           u.frame_number, u.is_placeholder ? "Tạm" : "", fmtTime(u.imported_at), days,
           u.status === "TON_KHO" ? "Tồn kho" : "Đang chuyển", u.import_doc || "", v?.list_price ?? "", (u.note || "").replace(/\n/g, " ")];
       })]);
    notify(`Đã xuất ${units.length} xe tồn chi tiết theo số khung.`);
  };

  const preview = pageSlice(rows, page, pageSize);

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="card">
        <div className="font-extrabold mb-3">Chọn báo cáo & phạm vi</div>
        <div className="flex gap-1.5 flex-wrap mb-3">
          {TYPES.map((t) => (
            <button key={t.key} className={`btn !px-3 !py-2 !text-xs ${type === t.key ? "bg-brand text-white" : "bg-[#EEF1F4] text-[#3B4552]"}`} onClick={() => setType(t.key)}>{t.label}</button>
          ))}
        </div>
        {type !== "ton" && (
          <div className="flex gap-1.5 flex-wrap items-end mb-1">
            {PRESETS.map((p) => (
              <button key={p.key} className={`btn !px-3 !py-2 !text-xs ${preset === p.key ? "bg-navy-900 text-white" : "bg-[#EEF1F4] text-[#3B4552]"}`} onClick={() => pickPreset(p.key)}>{p.label}</button>
            ))}
            <div><label className="lbl">Từ ngày</label><input type="date" className="inp !w-auto" value={from} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }} /></div>
            <div><label className="lbl">Đến ngày</label><input type="date" className="inp !w-auto" value={to} onChange={(e) => { setTo(e.target.value); setPreset("custom"); }} /></div>
          </div>
        )}
        <div className="flex gap-2 flex-wrap mt-2">
          <select className="inp !w-auto" value={fLoc} onChange={(e) => setFLoc(e.target.value)}>
            <option value="">Kho: tất cả</option>{locations.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
          {(type === "ban" || type === "ton") && (
            <select className="inp !w-auto" value={fBrand} onChange={(e) => setFBrand(e.target.value)}>
              <option value="">Hãng: tất cả</option>{brands.map((b) => <option key={b.name}>{b.name}</option>)}
            </select>
          )}
          <button className="btn-primary ml-auto" onClick={doExport} disabled={busy || rows.length === 0}>⬇ Xuất CSV ({fmtNum(rows.length)} dòng)</button>
          {type === "ton" && <button className="btn-ghost !text-xs" onClick={exportTonChiTiet}>⬇ CSV chi tiết theo số khung</button>}
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        {sums.map((s) => <KPI key={s.l} label={s.l} value={s.v} tone="dark" />)}
      </div>

      <div className="card">
        <div className="font-extrabold mb-2.5">Xem trước {busy ? "· đang tải…" : `· ${fmtNum(rows.length)} dòng`}<span className="text-xs font-normal text-[#8A93A0]"> (file CSV xuất luôn có đủ toàn bộ)</span></div>
        <div className="overflow-x-auto">
          {type === "ban" && (
            <table className="w-full border-collapse">
              <thead><tr><th className="th">Mã đơn</th><th className="th">Ngày</th><th className="th">Xe</th><th className="th">Kho</th><th className="th">Khách</th><th className="th">Giá bán</th><th className="th">NV</th></tr></thead>
              <tbody>{preview.map((s) => { const v = vOf(s.vehicle_id);
                return <tr key={s.id}><td className="td font-bold">{s.code}</td><td className="td">{fmtDate(s.sale_date)}</td><td className="td">{v ? `${v.name} ${v.color}` : s.vehicle_id} ×{s.quantity}</td><td className="td">{locName(s.location_code)}</td><td className="td">{s.customer_name}</td><td className="td font-bold">{fmtVND(s.sale_price)}</td><td className="td">{s.seller_name}</td></tr>; })}</tbody>
            </table>
          )}
          {type === "dieuchuyen" && (
            <table className="w-full border-collapse">
              <thead><tr><th className="th">Phiếu</th><th className="th">Ngày</th><th className="th">Xe</th><th className="th">Đi → Đến</th><th className="th">SL</th><th className="th">Trạng thái</th></tr></thead>
              <tbody>{preview.map((t) => { const v = vOf(t.vehicle_id);
                return <tr key={t.id}><td className="td font-bold">{t.code}</td><td className="td">{fmtTime(t.requested_at)}</td><td className="td">{v ? `${v.name} ${v.color}` : t.vehicle_id}</td><td className="td">{locName(t.from_location)} → {locName(t.to_location)}</td><td className="td font-bold">{t.quantity}</td><td className="td"><Badge tone={t.status === "Đã nhận" ? "green" : t.status === "Đang chuyển" ? "blue" : "gray"}>{t.status}</Badge></td></tr>; })}</tbody>
            </table>
          )}
          {type === "lichsu" && (
            <table className="w-full border-collapse">
              <thead><tr><th className="th">Thời gian</th><th className="th">Loại</th><th className="th">Xe</th><th className="th">Kho</th><th className="th">SL</th><th className="th">Tồn trước → sau</th><th className="th">Người</th></tr></thead>
              <tbody>{preview.map((t) => { const v = vOf(t.vehicle_id);
                return <tr key={t.id}><td className="td whitespace-nowrap">{fmtTime(t.created_at)}</td><td className="td">{t.txn_type}</td><td className="td">{v ? `${v.name} ${v.color}` : t.vehicle_id}</td><td className="td">{t.from_location && t.to_location ? `${locName(t.from_location)} → ${locName(t.to_location)}` : locName(t.from_location || t.to_location)}</td><td className="td"><b className={t.qty < 0 ? "text-danger" : "text-[#0E7A4A]"}>{t.qty > 0 ? "+" : ""}{t.qty}</b></td><td className="td">{t.stock_before} → <b>{t.stock_after}</b></td><td className="td">{t.created_by_name}</td></tr>; })}</tbody>
            </table>
          )}
          {type === "ton" && (
            <table className="w-full border-collapse">
              <thead><tr><th className="th">Xe</th><th className="th">Hãng</th><th className="th">Màu</th>{fLoc ? <th className="th">{locName(fLoc)}</th> : <>{regions.map((r) => <th key={r} className="th">{r}</th>)}<th className="th">Tổng</th></>}</tr></thead>
              <tbody>{preview.map((v) => (
                <tr key={v.id}><td className="td font-bold">{v.name}</td><td className="td">{v.brand}</td><td className="td">{v.color}</td>
                  {fLoc ? <td className="td font-bold">{getQty(v.id, fLoc)}</td>
                    : <>{regions.map((r) => <td key={r} className="td">{regionQty(v.id, r)}</td>)}<td className="td font-bold">{totalQty(v.id)}</td></>}
                </tr>
              ))}</tbody>
            </table>
          )}
          {rows.length === 0 && !busy && <div className="text-sm text-[#8A93A0] py-4">Không có dữ liệu trong phạm vi đã chọn — thử nới khung ngày hoặc bỏ bớt bộ lọc.</div>}
        </div>
        <Pager total={rows.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
      </div>
    </div>
  );
}
