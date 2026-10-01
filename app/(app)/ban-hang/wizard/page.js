"use client";
import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, LocSearch, CustomerSearch, MoneyInput, FrameSearch, VehicleSearch } from "@/components/ui";
import { fmtVND, fmtDate, errMsg } from "@/lib/format";
import { CUSTOMER_SOURCES } from "@/lib/const";

const iso = (d) => d.toLocaleDateString("sv-SE");
const STEPS = ["Đơn hàng & khách hàng", "Xe & ưu đãi", "Thanh toán & xuất HĐ", "Xác nhận"];
const KIND_LABELS = { GIAM_GIA: "Giảm giá", QUY_DOI_TIEN_MAT: "Quy đổi tiền mặt", HO_TRO_SAU_BAN: "Hỗ trợ sau bán" };

// Dat o MODULE-LEVEL (giong RowCK trong ban-hang/page.js) de khong bi
// unmount/remount gay mat trang thai moi lan component cha re-render.
// "coc" luon lay truc tiep tu state hien tai (khong phai gia tri da
// snapshot trong bangGia) de "Con lai phai thu" nhay theo ngay khi go,
// khong can bam Lam moi (coc khong lam doi KM nao ap dung/so tien).
const BangGiaPanel = ({ picked, bangGiaCu, bangGiaLoi, busy, tinhBangGia, bangGia, coc, cocLabel = "Đã đặt cọc" }) => (
  <div className="card self-start">
    <div className="font-extrabold mb-2.5">💰 Bảng giá</div>
    {!picked ? (
      <div className="text-xs text-[#8A93A0]">Chọn xe để xem bảng giá.</div>
    ) : (
      <>
        {bangGiaCu && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[#FFF8E5] text-[#A25F00] text-[12.5px] mb-3">
            ⚠ Bạn vừa thay đổi ưu đãi/giá — bấm "Làm mới" để cập nhật Bảng giá.
          </div>
        )}
        {bangGiaLoi && <div className="p-2.5 rounded-lg bg-[#FDE8EA] text-[#B01E2C] text-[12.5px] mb-3">{bangGiaLoi}</div>}
        <button className="btn-primary !text-xs w-full mb-3" disabled={busy} onClick={tinhBangGia}>{busy ? "Đang tính…" : "🔄 Làm mới Bảng giá"}</button>
        {bangGia && (
          <div className="rounded-xl border border-[#E3E8EF] overflow-hidden text-[13px]">
            <div className="flex justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF]"><span className="text-[#5A6572]">Giá niêm yết</span><b>{fmtVND(bangGia.gia_xe)}</b></div>
            {(bangGia.khuyen_mai || []).map((k) => (
              <div key={k.id} className="flex justify-between px-3 py-1.5 border-b border-dashed border-[#F0F2F5] text-[12px]">
                <span className="text-[#5A6572]">🏷 {k.name} <span className="text-[10.5px]">({KIND_LABELS[k.kind]})</span></span>
                <span className={k.amount > 0 ? "text-danger font-semibold" : "text-[#8A93A0]"}>{k.amount > 0 ? `-${fmtVND(k.amount)}` : "—"}</span>
              </div>
            ))}
            <div className="flex justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF] bg-[#EAF2FF]"><span className="font-bold">Giá cần thanh toán</span><b className="text-brand">{fmtVND(bangGia.gia_can_thanh_toan)}</b></div>
            <div className="flex justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF]"><span className="text-[#5A6572]">Tổng tiền xuất hóa đơn</span><b>{fmtVND(bangGia.tong_xuat_hd)}</b></div>
            {Number(coc) > 0 && <div className="flex justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF]"><span className="text-[#5A6572]">{cocLabel}</span><span>{fmtVND(coc)}</span></div>}
            <div className="flex justify-between px-3 py-2.5 bg-[#FFF6E5]"><span className="font-bold">Còn lại phải thu</span><b className="text-[18px] text-[#A25F00]">{fmtVND(Math.max((bangGia.gia_can_thanh_toan || 0) - (Number(coc) || 0), 0))}</b></div>
          </div>
        )}
      </>
    )}
  </div>
);

function TaoDonWizardInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { supabase, vehicles, locations, brands, profile, loading, settings, diaBan, customFields, paymentMethods, refresh } = useCatalog();
  const { toast, notify } = useToast();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [ketQua, setKetQua] = useState(null);
  const [suaId, setSuaId] = useState(null);     // id don dang sua (che do sua)
  const [suaCode, setSuaCode] = useState("");
  const [lyDo, setLyDo] = useState("");
  const [itemsGoc, setItemsGoc] = useState([]); // ban kem cua don (giu nguyen khi sua)
  const [dTongGoc, setDTongGoc] = useState({ type: "amount", value: 0 });
  const [giaGoc, setGiaGoc] = useState(null);   // gia niem yet ghi tren snapshot (khi sua, chua doi xe)

  // ===== BƯỚC 1: Đơn hàng & khách hàng =====
  const [cocDatTruoc, setCocDatTruoc] = useState(false);
  const [banCheo, setBanCheo] = useState(false);
  const [ngayLayGia, setNgayLayGia] = useState(iso(new Date()));
  const [tuVanId, setTuVanId] = useState("");
  const [tuVanName, setTuVanName] = useState("");
  const [nguonDon, setNguonDon] = useState("Khách vãng lai");
  const [ghiChu1, setGhiChu1] = useState("");
  const [staff, setStaff] = useState([]);
  const [custs, setCusts] = useState([]);
  const [custId, setCustId] = useState("");
  const [kh, setKh] = useState({ customer_name: "", customer_phone: "", customer_cccd: "", customer_address: "" });
  const [newC, setNewC] = useState(null);

  useEffect(() => {
    if (loading) return;
    supabase.from("profiles").select("id,name,role").eq("status", "Hoạt động").order("name").then(({ data }) => setStaff(data || []));
    supabase.from("customers").select("id,code,name,phone,cccd,address,status,customer_type").order("created_at", { ascending: false }).limit(2000).then(({ data }) => setCusts(data || []));
  }, [loading]);
  useEffect(() => { if (profile && !tuVanId) { setTuVanId(profile.id); setTuVanName(profile.name); } }, [profile]);

  const pickCust = (c) => {
    if (!c) { setCustId(""); return; }
    setCustId(c.id);
    setKh({ customer_name: c.name || "", customer_phone: c.phone || "", customer_cccd: c.cccd || "", customer_address: c.address || "" });
  };
  const luuCustMoi = async () => {
    if (!newC.name.trim() || !newC.phone.trim()) return notify("Nhập tên và SĐT.", "err");
    if (!newC.email?.trim()) return notify("Bắt buộc nhập Email.", "err");
    if (!newC.gender) return notify("Bắt buộc chọn Giới tính.", "err");
    if (!newC.birthday) return notify("Bắt buộc nhập Ngày sinh.", "err");
    const { data, error } = await supabase.rpc("fn_luu_khach_hang_v2", { p: { name: newC.name, phone: newC.phone, address: newC.address || "", email: newC.email, gender: newC.gender, birthday: newC.birthday, source: "Bán hàng" } });
    if (error) return notify(errMsg(error), "err");
    const { data: c2 } = await supabase.from("customers").select("id,code,name,phone,cccd,address,status,customer_type").order("created_at", { ascending: false }).limit(2000);
    setCusts(c2 || []);
    setCustId(data);
    setKh({ customer_name: newC.name, customer_phone: newC.phone, customer_cccd: "", customer_address: newC.address || "" });
    setNewC(null); notify("Đã tạo khách mới.");
  };

  // ===== BƯỚC 2: Xe & ưu đãi =====
  const [diemBan, setDiemBan] = useState("");
  const [cheDoTim, setCheDoTim] = useState("sk");
  const [modelChon, setModelChon] = useState("");
  const [xeTheoModel, setXeTheoModel] = useState([]);
  const [picked, setPicked] = useState(null); // {frame_number, vehicle_id, location_code, status}
  const [batteryOption, setBatteryOption] = useState("");
  const [coc, setCoc] = useState(0);
  const [promos, setPromos] = useState([]);
  const [promoChon, setPromoChon] = useState([]);
  const [showPromoDrawer, setShowPromoDrawer] = useState(false);
  const [bangGia, setBangGia] = useState(null);
  const [bangGiaLoi, setBangGiaLoi] = useState("");
  const [bangGiaKey, setBangGiaKey] = useState(null); // khoa lua chon luc tinh Bang gia gan nhat

  const [bankAccounts, setBankAccounts] = useState([]);
  useEffect(() => {
    if (loading) return;
    supabase.from("promotions").select("*").eq("status", "Đang áp dụng").then(({ data }) => setPromos(data || []));
    supabase.from("cash_accounts").select("id, name, company_id, bank_info").eq("status", "Hoạt động").eq("type", "Ngân hàng").then(({ data }) => setBankAccounts(data || []));
  }, [loading]);

  const vehicleObj = vehicles.find((v) => v.id === picked?.vehicle_id);
  const giaXe = giaGoc ?? (vehicleObj?.list_price || 0);
  // Bang gia "cu" khi lua chon hien tai khac lua chon luc tinh (so sanh theo gia tri)
  const keyHienTai = JSON.stringify([[...promoChon].sort(), giaXe, ngayLayGia, batteryOption]);
  const bangGiaCu = bangGiaKey !== keyHienTai;
  // Luu y: KHONG dua coc vao day — coc doi khong lam thay doi KM nao ap
  // dung hay so tien cua tung KM, chi tru vao "con lai" hien thi truc tiep
  // o client (xem BangGiaPanel) — khong can goi lai RPC/danh dau cu.

  const chonXe = async (u) => {
    setPicked(u);
    setBatteryOption("");
    setPromoChon([]); setBangGia(null); setBangGiaLoi(""); setBangGiaKey(null); setGiaGoc(null);
    if (suaId) return; // sua don: giu nguyen so da thu (coc + cac khoan thu truoc)
    if (u.status === "GIU_CHO") {
      const { data: deps } = await supabase.from("deposits").select("amount").eq("frame_number", u.frame_number).eq("status", "DANG_GIU");
      setCoc((deps || []).reduce((t, d) => t + (Number(d.amount) || 0), 0));
    } else {
      setCoc(0);
    }
  };

  const timXeTheoModel = async (vehicleId) => {
    setModelChon(vehicleId);
    if (!vehicleId) { setXeTheoModel([]); return; }
    const { data } = await supabase.from("vehicle_units").select("frame_number, vehicle_id, location_code, status")
      .eq("vehicle_id", vehicleId).in("status", ["TON_KHO", "GIU_CHO"]).order("frame_number");
    setXeTheoModel(data || []);
  };

  // ===== SUA DON (?sua=id) =====
  const [suaDone, setSuaDone] = useState(false);
  useEffect(() => {
    const id = params.get("sua");
    if (!id || suaDone || loading || custs.length === 0 || vehicles.length === 0) return;
    setSuaDone(true);
    (async () => {
      const chk = await supabase.rpc("fn_don_co_sua_duoc", { p_id: Number(id) });
      if (chk.error) return notify(errMsg(chk.error), "err");
      if (!chk.data.ok) return notify(chk.data.ly_do, "err");
      const { data: o } = await supabase.from("sales_orders").select("*").eq("id", id).single();
      if (!o) return notify("Không tìm thấy đơn.", "err");
      if (!o.price_snapshot) { router.replace(`/ban-hang?sua=${o.id}`); return; }
      const sk0 = String(o.frame_number || "").split(",")[0].trim();
      const [{ data: its }, { data: sop }, { data: unit }] = await Promise.all([
        supabase.from("sale_items").select("*").eq("sale_code", o.code),
        supabase.from("sale_order_promotions").select("promotion_id").eq("sale_code", o.code),
        supabase.from("vehicle_units").select("frame_number, vehicle_id, location_code, status").eq("frame_number", sk0).maybeSingle(),
      ]);
      const ids = (sop || []).map((x) => x.promotion_id);
      const gia = Number(o.price_snapshot.gia_xe) || 0;
      setSuaId(o.id); setSuaCode(o.code);
      setKh({ customer_name: o.customer_name || "", customer_phone: o.customer_phone || "", customer_cccd: o.customer_cccd || "", customer_address: o.customer_address || "" });
      const c = custs.find((x) => (x.phone || "").replace(/\D/g, "") === (o.customer_phone || "").replace(/\D/g, ""));
      if (c) setCustId(c.id);
      setNgayLayGia(o.sale_date); setTuVanId(o.seller_id || ""); setTuVanName(o.seller_name || "");
      setNguonDon(o.customer_source || "Khách vãng lai"); setGhiChu1(o.note || "");
      setDiemBan(o.location_code); setBatteryOption(o.battery_option || "");
      setPicked({ frame_number: sk0, vehicle_id: o.vehicle_id, location_code: unit?.location_code || o.location_code, status: "DA_BAN" });
      setGiaGoc(gia || null); setBangGia(o.price_snapshot); setPromoChon(ids);
      setBangGiaKey(JSON.stringify([[...ids].sort(), gia, o.sale_date, o.battery_option || ""]));
      setCoc(Number(o.paid_amount) || 0);
      setItemsGoc(its || []); setDTongGoc({ type: o.discount_type || "amount", value: o.discount_value || 0 });
      setExtra(o.extra || {});
      setHd({ tinh_tp: o.extra?.hd_tinh_tp || "", phuong_xa: o.extra?.hd_phuong_xa || "", dia_chi: o.extra?.hd_dia_chi || "" });
      notify(`Đang sửa đơn ${o.code}.`);
    })();
  }, [params, custs, vehicles, loading]);

  // ===== DIEN SAN tu Tra cuu xe (?xe=) / Dat coc (?sk=&kh=) =====
  const [preDone, setPreDone] = useState(false);
  useEffect(() => {
    if (preDone || params.get("sua") || loading || custs.length === 0 || vehicles.length === 0) return;
    setPreDone(true);
    const sk = (params.get("sk") || "").trim().toUpperCase(), phone = params.get("kh"), xe = params.get("xe");
    if (!sk && !phone && !xe) return;
    (async () => {
      let coKhach = false;
      if (phone) {
        const c = custs.find((x) => (x.phone || "").replace(/\D/g, "") === String(phone).replace(/\D/g, ""));
        if (c) { pickCust(c); coKhach = true; }
      }
      if (sk) {
        const { data: u } = await supabase.from("vehicle_units").select("frame_number, vehicle_id, location_code, status").eq("frame_number", sk).maybeSingle();
        if (!u) notify(`Không tìm thấy số khung ${sk}.`, "err");
        else if (!["TON_KHO", "GIU_CHO"].includes(u.status)) notify(`Xe ${sk} đang ở trạng thái ${u.status}, không bán được.`, "err");
        else { await chonXe(u); if (coKhach) setStep(2); }
      }
      if (xe) { setCheDoTim("model"); await timXeTheoModel(xe); }
    })();
  }, [params, custs, vehicles, loading]);

  const today = iso(new Date());
  const promosHopLe = vehicleObj ? promos.filter((p) =>
    p.brand.trim().toLowerCase() === vehicleObj.brand.trim().toLowerCase() &&
    (p.vehicle_names.length === 0 || p.vehicle_names.some((n) => n.trim().toLowerCase() === vehicleObj.name.trim().toLowerCase())) &&
    ((p.battery_options || []).length === 0 || (batteryOption && p.battery_options.includes(batteryOption))) &&
    p.end_date >= today
  ) : [];
  const promosTheoLoai = { GIAM_GIA: [], QUY_DOI_TIEN_MAT: [], HO_TRO_SAU_BAN: [] };
  promosHopLe.forEach((p) => { (promosTheoLoai[p.kind] || promosTheoLoai.GIAM_GIA).push(p); });

  const tinhBangGia = async () => {
    if (!giaXe) return notify("Chưa có giá xe niêm yết.", "err");
    setBusy(true); setBangGiaLoi("");
    const { data, error } = await supabase.rpc("fn_tinh_bang_gia", { p: {
      gia_xe: Number(giaXe), promotion_ids: promoChon, so_tien_coc: Number(coc) || 0,
      ngay_lay_gia: ngayLayGia, vehicle_name: vehicleObj?.name || null, battery_option: batteryOption || null,
    } });
    setBusy(false);
    if (error) { setBangGiaLoi(errMsg(error)); setBangGia(null); return; }
    setBangGia(data); setBangGiaKey(keyHienTai);
  };

  // ===== BƯỚC 3: Thanh toán & xuất HĐ =====
  const [pays, setPays] = useState([]); // {method, amount, account_id, tra_gop_ct, note}
  const [extra, setExtra] = useState({}); // trường tùy chỉnh (Cài đặt > Trường tùy chỉnh)
  const [hd, setHd] = useState({ tinh_tp: "", phuong_xa: "", dia_chi: "" });
  const tinhList = Object.keys(diaBan);
  const phuongList = diaBan[hd.tinh_tp] || [];

  const cfields = (customFields || []).filter((c) => c.entity === "sales_order");
  const PTTT = paymentMethods.length > 0 ? paymentMethods.map((m) => m.code) : ["Tiền mặt", "Chuyển khoản", "Trả góp"];
  const quyTypeOf = (method) => paymentMethods.find((m) => m.code === method)?.quy_type;
  const companyIdCuaDon = vehicleObj ? brands.find((b) => b.name === vehicleObj.brand)?.company_id || null : null;
  const banksHopLe = companyIdCuaDon ? bankAccounts.filter((a) => a.company_id === companyIdCuaDon) : [];

  const phaiTra = bangGia?.gia_can_thanh_toan || 0;
  const tongCoc = Number(coc) || 0;
  const daTra = tongCoc + pays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const conLai = Math.max(phaiTra - daTra, 0);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  const locName = (c) => locations.find((l) => l.code === c)?.name || c || "—";
  const canNext1 = kh.customer_name && kh.customer_phone;
  const canNext2 = picked && Number(giaXe) > 0 && !bangGiaCu && bangGia;

  const canhBaoMotPTTT = () => {
    const cacDong = pays.filter((p) => Number(p.amount) > 0);
    if (cacDong.length !== 1) return true;
    const d = cacDong[0];
    return confirm(`⚠️ Đơn này chỉ chọn ĐÚNG 1 phương thức thanh toán duy nhất:\n\n${d.method}: ${Number(d.amount).toLocaleString("vi-VN")}đ\n\nNếu khách thực tế trả bằng NHIỀU phương thức khác nhau (VD: một phần tiền mặt + một phần chuyển khoản), hạch toán thu-chi vào sổ quỹ sẽ SAI theo từng tài khoản.\n\nBấm OK nếu chắc chắn khách CHỈ trả bằng đúng 1 phương thức này.\nBấm Hủy để quay lại sửa cho đúng.`);
  };

  const luu = async () => {
    if (!picked) return notify("Chưa chọn xe.", "err");
    if (!bangGia || bangGiaCu) return notify('Bảng giá chưa cập nhật — quay lại Bước 2 bấm "Làm mới Bảng giá".', "err");
    if (!diemBan) return notify("Chọn điểm bán.", "err");
    if (vehicleObj?.model_pin === "Xe đổi pin" && !batteryOption) return notify("Xe Đổi pin bắt buộc chọn Hình thức kinh doanh pin.", "err");
    const tgThieu = pays.find((p) => p.method === "Trả góp" && Number(p.amount) > 0 && !p.tra_gop_ct);
    if (tgThieu) return notify("Chọn đơn vị trả góp.", "err");
    const nhThieu = pays.find((p) => Number(p.amount) > 0 && quyTypeOf(p.method) === "Ngân hàng" && !p.account_id);
    if (nhThieu) return notify(`Chọn tài khoản Ngân hàng nhận tiền cho phương thức "${nhThieu.method}".`, "err");
    const cfThieu = cfields.find((c) => c.required && c.field_type !== "formula" && !extra[c.field_key]);
    if (cfThieu) return notify(`Nhập "${cfThieu.label}".`, "err");
    if (suaId && phaiTra < tongCoc) return notify(`Tổng đơn mới (${fmtVND(phaiTra)}) không được nhỏ hơn số đã thu (${fmtVND(tongCoc)}). Muốn giảm hãy hoàn tiền cho khách trước.`, "err");
    if (!canhBaoMotPTTT()) return;

    const frame = {
      frame_number: picked.frame_number, unit_price: Number(bangGia.gia_xe) || 0,
      discount_type: "amount", discount_value: Number(bangGia.tong_uu_dai) || 0,
      promo_amount: Number(bangGia.tong_uu_dai) || 0, invoice_total: Number(bangGia.tong_xuat_hd) || 0,
      price_snapshot: bangGia,
    };
    const tg = pays.find((p) => p.method === "Trả góp" && p.tra_gop_ct);
    const extraOut = {
      ...extra,
      hd_tinh_tp: hd.tinh_tp || "", hd_phuong_xa: hd.phuong_xa || "", hd_dia_chi: hd.dia_chi || "",
      ...(tg ? { tra_gop_cong_ty: tg.tra_gop_ct, tra_gop_so_tien: Number(tg.amount) || 0 } : {}),
    };
    const khOut = {
      customer_name: kh.customer_name, customer_phone: kh.customer_phone,
      customer_cccd: kh.customer_cccd, customer_address: kh.customer_address,
      customer_source: nguonDon, sale_date: ngayLayGia, location_code: diemBan,
      seller_id: tuVanId, seller_name: tuVanName, battery_option: batteryOption || null,
    };
    const paysOut = pays.filter((p) => Number(p.amount) > 0).map((p) => ({
      method: p.method, amount: Number(p.amount), account_id: p.account_id || null, tra_gop_ct: p.tra_gop_ct || "",
      note: p.method === "Trả góp" && p.tra_gop_ct ? `Trả góp qua ${p.tra_gop_ct}` : (p.note || ""),
    }));

    setBusy(true);
    if (suaId) {
      const { data, error } = await supabase.rpc("fn_sua_don_ban_v2", { p: {
        id: suaId, ...khOut, ly_do: lyDo,
        frames: [frame],
        items: itemsGoc.map((x) => ({ item_type: x.item_type, name: x.name, qty: x.qty, unit_price: x.unit_price,
          discount_type: x.discount_type || "amount", discount_value: x.discount_value || 0 })),
        new_payments: paysOut,
        discount_type: dTongGoc.type, discount_value: Number(dTongGoc.value) || 0,
        extra: extraOut,
      } });
      setBusy(false);
      if (error) return notify(errMsg(error), "err");
      setKetQua({ first: data?.code || suaCode, edited: true });
      notify(`Đã sửa đơn ${data?.code || suaCode}.`);
      refresh();
      return;
    }

    const { data, error } = await supabase.rpc("fn_ban_hang_v2", { p: {
      ...khOut, note: ghiChu1,
      frames: [frame],
      items: [],
      payments: paysOut,
      extra: extraOut,
    } });
    if (error) { setBusy(false); return notify(errMsg(error), "err"); }

    if (promoChon.length > 0 && data?.first) {
      const km = (bangGia.khuyen_mai || []).filter((k) => promoChon.includes(k.id));
      const { error: e2 } = await supabase.rpc("fn_gan_khuyen_mai_don_v2", { p_sale_code: data.first, p_promotions: km });
      if (e2) notify("Đã tạo đơn nhưng gắn khuyến mại lỗi: " + errMsg(e2), "err");
    }
    setBusy(false);
    setKetQua(data);
    notify(`Đã tạo đơn ${data.first}.`);
    refresh();
  };

  const lamMoi = () => {
    setKetQua(null); setStep(1);
    setCocDatTruoc(false); setBanCheo(false); setGhiChu1("");
    setCustId(""); setNewC(null); setKh({ customer_name: "", customer_phone: "", customer_cccd: "", customer_address: "" });
    setPicked(null); setBatteryOption(""); setCoc(0); setPromoChon([]); setBangGia(null); setBangGiaLoi(""); setBangGiaKey(null); setGiaGoc(null);
    setSuaId(null); setSuaCode(""); setLyDo(""); setItemsGoc([]); setDTongGoc({ type: "amount", value: 0 });
    setPays([]); setExtra({}); setHd({ tinh_tp: "", phuong_xa: "", dia_chi: "" });
    if (profile) { setTuVanId(profile.id); setTuVanName(profile.name); }
  };

  if (ketQua) {
    return (
      <div className="flex flex-col gap-4">
        <Toast toast={toast} />
        <div className="card text-center py-8">
          <div className="text-5xl mb-2">✅</div>
          <div className="font-extrabold text-xl mb-1">{ketQua.edited ? "Đã cập nhật đơn bán" : "Đã tạo đơn bán"} {ketQua.first}</div>
          <div className="flex gap-2 justify-center flex-wrap mt-4">
            <Link href={`/don-ban?q=${encodeURIComponent(ketQua.first)}`} className="btn-primary">Xem chi tiết & in phiếu</Link>
            <button className="btn-ok" onClick={lamMoi}>+ Tạo đơn khác</button>
            <Link href="/don-ban" className="btn-ghost">Về danh sách đơn</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-10">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <Link href="/ban-hang?new=1" className="btn-ghost !text-xs" title="Chọn nhiều xe trong 1 đơn, tự tách thành từng đơn theo từng xe">Tạo đơn bán buôn (nhiều xe) →</Link>
        <div className="font-extrabold text-lg mr-auto">{suaId ? `Sửa đơn bán ${suaCode}` : "Tạo đơn bán — Wizard 4 bước"}</div>
      </div>

      <div className="card !py-3">
        <div className="flex items-center gap-1 flex-wrap">
          {STEPS.map((lb, i) => (
            <div key={i} className="flex items-center gap-1">
              <button onClick={() => setStep(i + 1)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${step === i + 1 ? "bg-brand text-white" : step > i + 1 ? "bg-[#E5F6EE] text-[#0E7A4A]" : "bg-[#EEF1F4] text-[#5A6572]"}`}>
                <span>{step > i + 1 ? "✓" : i + 1}</span> {lb}
              </button>
              {i < STEPS.length - 1 && <span className="text-[#C6CDD6]">→</span>}
            </div>
          ))}
        </div>
      </div>

      {/* ===== BƯỚC 1 ===== */}
      {step === 1 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card">
            <div className="font-extrabold mb-3">Thông tin đơn hàng</div>
            <div className="flex flex-col gap-2.5">
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <input type="checkbox" className="w-4 h-4" checked={cocDatTruoc} onChange={(e) => setCocDatTruoc(e.target.checked)} />
                Đơn có cọc đặt trước (xe đang giữ chỗ)
              </label>
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <input type="checkbox" className="w-4 h-4" checked={banCheo} onChange={(e) => setBanCheo(e.target.checked)} />
                Bán chéo (cross-sell)
              </label>
              <Field label="Ngày lấy giá" hint="Chương trình khuyến mại phải còn hạn vào đúng ngày này mới áp dụng được.">
                <input type="date" className="inp" value={ngayLayGia} onChange={(e) => setNgayLayGia(e.target.value)} />
              </Field>
              <Field label="Tư vấn bán hàng">
                <select className="inp" value={tuVanId} onChange={(e) => { const s = staff.find((x) => x.id === e.target.value); setTuVanId(e.target.value); setTuVanName(s?.name || ""); }}>
                  <option value="">— Chọn nhân viên —</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
                </select>
              </Field>
              <Field label="Nguồn đơn">
                <select className="inp" value={nguonDon} onChange={(e) => setNguonDon(e.target.value)}>
                  {CUSTOMER_SOURCES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
              {!suaId && <Field label="Ghi chú"><textarea className="inp !h-20" value={ghiChu1} onChange={(e) => setGhiChu1(e.target.value)} /></Field>}
            </div>
          </div>

          <div className="card">
            <div className="font-extrabold mb-3">Khách hàng</div>
            {custId ? (
              <CustomerSearch customers={custs} value={custId} onPick={pickCust} onCreate={() => {}} />
            ) : newC ? (
              <div className="flex flex-col gap-2">
                <Field label="Họ tên *"><input className="inp" value={newC.name} onChange={(e) => setNewC((p) => ({ ...p, name: e.target.value }))} /></Field>
                <Field label="SĐT *"><input className="inp" value={newC.phone} onChange={(e) => setNewC((p) => ({ ...p, phone: e.target.value }))} /></Field>
                <Field label="Email *"><input className="inp" value={newC.email} onChange={(e) => setNewC((p) => ({ ...p, email: e.target.value }))} /></Field>
                <Field label="Giới tính *">
                  <select className="inp" value={newC.gender} onChange={(e) => setNewC((p) => ({ ...p, gender: e.target.value }))}>
                    <option value="">— Chọn —</option><option value="Nam">Nam</option><option value="Nữ">Nữ</option><option value="Khác">Khác</option>
                  </select>
                </Field>
                <Field label="Ngày sinh *"><input type="date" className="inp" value={newC.birthday} onChange={(e) => setNewC((p) => ({ ...p, birthday: e.target.value }))} /></Field>
                <Field label="Địa chỉ"><input className="inp" value={newC.address} onChange={(e) => setNewC((p) => ({ ...p, address: e.target.value }))} /></Field>
                <div className="flex gap-2">
                  <button className="btn-ghost !text-xs" onClick={() => setNewC(null)}>Hủy</button>
                  <button className="btn-ok !text-xs" onClick={luuCustMoi}>Lưu khách mới</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <CustomerSearch customers={custs} value={custId} onPick={pickCust} onCreate={() => {}} />
                <button className="btn-ghost !text-xs self-start" onClick={() => setNewC({ name: "", phone: "", address: "", email: "", gender: "", birthday: "" })}>+ Tạo khách mới</button>
              </div>
            )}
            {kh.customer_name && (
              <div className="mt-3 text-[13px] bg-[#F8FAFC] rounded-lg p-2.5">
                <b>{kh.customer_name}</b> · {kh.customer_phone}{kh.customer_address && <div className="text-[#5A6572]">{kh.customer_address}</div>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== BƯỚC 2 ===== */}
      {step === 2 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <div className="card">
              <div className="font-extrabold mb-2.5">Chọn xe</div>
              <Field label="Điểm bán (ghi nhận doanh số)" required>
                <LocSearch locations={locations.filter((l) => l.type === "Cửa hàng" || l.type === "Showroom")} value={diemBan} onChange={setDiemBan} placeholder="Chọn cửa hàng" />
              </Field>
              <div className="flex gap-1.5 mb-2.5 mt-2">
                <button type="button" className={`btn-ghost !text-xs ${cheDoTim === "sk" ? "!bg-brand !text-white" : ""}`} onClick={() => setCheDoTim("sk")}>🔢 Theo số khung</button>
                <button type="button" className={`btn-ghost !text-xs ${cheDoTim === "model" ? "!bg-brand !text-white" : ""}`} onClick={() => setCheDoTim("model")}>🚗 Theo tên xe & màu</button>
              </div>
              {cheDoTim === "sk" ? (
                <FrameSearch supabase={supabase} value={picked?.frame_number || ""} onlyStatus={["TON_KHO", "GIU_CHO"]}
                  placeholder="Tìm số khung, hoặc quét mã…" onPick={(sk, u) => { if (u) chonXe(u); }} />
              ) : (
                <div className="rounded-xl border border-[#E3E8EF] p-3">
                  <VehicleSearch vehicles={vehicles} value={modelChon} onChange={timXeTheoModel} />
                  {modelChon && (
                    <div className="mt-2.5 max-h-52 overflow-y-auto flex flex-col gap-1">
                      {xeTheoModel.length === 0 && <div className="text-xs text-[#8A93A0] py-2">Không còn xe sẵn sàng bán ở model này.</div>}
                      {xeTheoModel.map((u) => (
                        <label key={u.frame_number} className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg cursor-pointer hover:bg-[#F8FAFC] ${picked?.frame_number === u.frame_number ? "bg-[#EAF2FF]" : ""}`}>
                          <input type="radio" name="xe" checked={picked?.frame_number === u.frame_number} onChange={() => chonXe({ ...u, vehicle_id: u.vehicle_id || modelChon })} />
                          <span className="font-mono font-bold">{u.frame_number}</span>
                          <span className="text-[#8A93A0]">{locName(u.location_code)}</span>
                          {u.status === "GIU_CHO" && <Badge tone="amber">Đang giữ chỗ</Badge>}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {picked && (
                <div className="mt-3 p-3 rounded-xl bg-[#F8FAFC]">
                  <div className="font-bold">{vehicleObj ? `${vehicleObj.brand} · ${vehicleObj.name} · ${vehicleObj.color}` : picked.vehicle_id}</div>
                  <div className="font-mono text-[11px] text-[#8A93A0]">SK {picked.frame_number} · {locName(picked.location_code)}</div>
                  {coc > 0 && <div className="text-[12px] text-[#A25F00] font-bold mt-1">{suaId ? "🔒 Đã thu trước đó" : "🔒 Đã nhận cọc"} {fmtVND(coc)}</div>}
                  <Field label="Giá niêm yết">
                    <div className="inp bg-[#F3F5F8] font-bold text-[15px]">{fmtVND(giaXe)}</div>
                  </Field>
                  {giaXe === 0 && <div className="text-[11px] text-danger -mt-2 mb-2">Xe này chưa có giá niêm yết trong danh mục xe — vào Danh mục xe cập nhật trước.</div>}
                  {vehicleObj?.model_pin === "Xe đổi pin" && (
                    <Field label="Hình thức kinh doanh pin" required>
                      <select className="inp" value={batteryOption} onChange={(e) => setBatteryOption(e.target.value)}>
                        <option value="">— Chọn —</option><option value="Kèm pin">Kèm pin</option><option value="Thuê pin">Thuê pin</option>
                      </select>
                    </Field>
                  )}
                </div>
              )}
            </div>

            {picked && (
              <div className="card">
                <div className="flex items-center gap-2 mb-2">
                  <div className="font-extrabold mr-auto">🏷 Khuyến mại áp dụng</div>
                  <button className="btn-ghost !text-xs" onClick={() => setShowPromoDrawer(!showPromoDrawer)}>{showPromoDrawer ? "Thu gọn ▲" : "Chọn khuyến mại ▼"}</button>
                </div>
                {promoChon.length > 0 && !showPromoDrawer && (
                  <div className="flex flex-wrap gap-1.5">
                    {promoChon.map((id) => { const p = promos.find((x) => x.id === id); return p ? <Badge key={id} tone="purple">🏷 {p.name}</Badge> : null; })}
                  </div>
                )}
                {showPromoDrawer && (
                  <div className="flex flex-col gap-3">
                    {Object.entries(KIND_LABELS).map(([kind, label]) => (
                      promosTheoLoai[kind]?.length > 0 && (
                        <div key={kind}>
                          <div className="text-[11px] font-bold text-[#8A93A0] uppercase mb-1">{label}</div>
                          <div className="flex flex-wrap gap-1.5">
                            {promosTheoLoai[kind].map((p) => (
                              <label key={p.id} className={`text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer ${promoChon.includes(p.id) ? "bg-[#EAF2FF] border-brand text-brand font-semibold" : "border-[#E3E8EF]"}`}>
                                <input type="checkbox" className="hidden" checked={promoChon.includes(p.id)}
                                  onChange={(e) => setPromoChon((cur) => e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id))} />
                                {p.name}
                              </label>
                            ))}
                          </div>
                        </div>
                      )
                    ))}
                    {promosHopLe.length === 0 && <div className="text-xs text-[#8A93A0]">Không có chương trình nào còn hiệu lực cho xe này.</div>}
                  </div>
                )}
              </div>
            )}
          </div>

          <BangGiaPanel picked={picked} bangGiaCu={bangGiaCu} bangGiaLoi={bangGiaLoi} busy={busy} tinhBangGia={tinhBangGia} bangGia={bangGia} coc={coc} cocLabel={suaId ? "Đã thu trước đó" : "Đã đặt cọc"} />
        </div>
      )}

      {/* ===== BƯỚC 3 ===== */}
      {step === 3 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <div className="card">
              <div className="font-extrabold mb-2.5">Thanh toán</div>
              {coc > 0 && (
                <div className="flex items-center justify-between px-3 py-2 mb-2.5 rounded-lg bg-[#FDF6E3] text-[13.5px]">
                  <span className="text-[#A25F00] font-semibold">{suaId ? "🔒 Đã thu trước đó (gồm cọc & các khoản đã thu)" : "🔒 Đã nhận cọc (từ phiếu giữ xe)"}</span>
                  <b className="text-[#A25F00]">{fmtVND(coc)}</b>
                </div>
              )}
              <div className="flex flex-col gap-1.5 mb-2">
                {pays.map((p, i) => (
                  <div key={i} className="flex gap-1.5 items-center">
                    <select className="inp !py-1.5 !text-xs !w-auto" value={p.method} onChange={(e) => setPays((x) => x.map((y, j) => j === i ? { ...y, method: e.target.value } : y))}>
                      {PTTT.map((m) => <option key={m}>{m}</option>)}
                    </select>
                    <div className="flex-1"><MoneyInput className="!py-1.5 !text-xs" value={p.amount} onChange={(v) => setPays((x) => x.map((y, j) => j === i ? { ...y, amount: v } : y))} /></div>
                    <button className="text-danger font-bold px-1" onClick={() => setPays((x) => x.filter((_, j) => j !== i))}>✕</button>
                  </div>
                ))}
                {pays.map((p, i) => p.method === "Trả góp" ? (
                  <div key={"tg" + i} className="flex items-center gap-2 flex-wrap bg-[#FDF6E3] rounded-lg px-2.5 py-2 -mt-0.5">
                    <span className="text-[11px] font-bold text-[#A25F00]">Đơn vị trả góp:</span>
                    <select className="inp !w-auto !py-1 !text-xs" value={p.tra_gop_ct || ""}
                      onChange={(e) => setPays((x) => x.map((y, j) => j === i ? { ...y, tra_gop_ct: e.target.value } : y))}>
                      <option value="">— Chọn đơn vị —</option>
                      {(settings?.cong_ty_tra_gop || "Home Credit\nShinhanbank\nHD Saison\nFE Credit")
                        .split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean).map((x) => <option key={x}>{x}</option>)}
                    </select>
                  </div>
                ) : quyTypeOf(p.method) === "Ngân hàng" ? (
                  <div key={"nh" + i} className="flex items-center gap-2 flex-wrap bg-[#EAF2FF] rounded-lg px-2.5 py-2 -mt-0.5">
                    <span className="text-[11px] font-bold text-brand">Tài khoản nhận tiền:</span>
                    <select className="inp !w-auto !py-1 !text-xs" value={p.account_id || ""}
                      onChange={(e) => setPays((x) => x.map((y, j) => j === i ? { ...y, account_id: e.target.value } : y))}>
                      <option value="">— Chọn đúng tài khoản khách đã chuyển vào —</option>
                      {banksHopLe.map((a) => <option key={a.id} value={a.id}>{a.name}{a.bank_info ? ` (${a.bank_info})` : ""}</option>)}
                    </select>
                    {banksHopLe.length === 0 && <span className="text-[10.5px] text-danger">Chưa có tài khoản Ngân hàng nào cho đúng pháp nhân của hãng xe này — vào Sổ quỹ tạo trước.</span>}
                  </div>
                ) : null)}
              </div>
              <div className="flex gap-1.5 flex-wrap mb-3">
                <button className="btn-ghost !text-xs" onClick={() => setPays((p) => [...p, { method: "Tiền mặt", amount: "" }])}>⊕ Thêm phương thức</button>
                {conLai > 0 && pays.length > 0 && (
                  <button className="btn-ghost !text-xs" onClick={() => setPays((p) => p.map((x, j) => j === p.length - 1 ? { ...x, amount: (Number(x.amount) || 0) + conLai } : x))}>
                    Điền nốt {fmtVND(conLai)}
                  </button>
                )}
                {pays.length === 0 && (
                  <button className="btn-ghost !text-xs" onClick={() => setPays([{ method: "Tiền mặt", amount: Math.max(phaiTra - tongCoc, 0) }])}>
                    {tongCoc > 0 ? `Trả nốt ${fmtVND(Math.max(phaiTra - tongCoc, 0))} tiền mặt` : "Trả đủ tiền mặt"}
                  </button>
                )}
              </div>
              <div className="rounded-xl border border-[#E3E8EF] overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF] text-[13.5px]">
                  <span className="text-[#5A6572]">Khách đã trả{tongCoc > 0 ? (suaId ? ` (đã thu trước đó ${fmtVND(tongCoc)})` : ` (gồm cọc ${fmtVND(tongCoc)})`) : ""}</span><span className="font-bold text-[#0E7A4A]">{fmtVND(daTra)}</span>
                </div>
                <div className={`flex items-center justify-between px-3 py-2.5 ${conLai > 0 ? "bg-[#FFF6E5]" : "bg-[#E7F6EE]"}`}>
                  <span className="font-bold text-[13.5px]">Còn phải trả</span>
                  <span className={`text-[18px] font-extrabold ${conLai > 0 ? "text-[#A25F00]" : "text-[#0E7A4A]"}`}>{fmtVND(conLai)}</span>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="font-extrabold mb-2.5">Thông tin xuất hóa đơn</div>
              <div className="flex flex-col gap-2.5">
                <Field label="Tỉnh / Thành phố">
                  <select className="inp" value={hd.tinh_tp} onChange={(e) => setHd((p) => ({ ...p, tinh_tp: e.target.value, phuong_xa: "" }))} disabled={tinhList.length === 0}>
                    <option value="">{tinhList.length === 0 ? "— Chưa cấu hình (vào Cài đặt) —" : "— Chọn —"}</option>
                    {tinhList.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Phường / Xã">
                  <select className="inp" value={hd.phuong_xa} onChange={(e) => setHd((p) => ({ ...p, phuong_xa: e.target.value }))} disabled={!hd.tinh_tp || phuongList.length === 0}>
                    <option value="">{!hd.tinh_tp ? "— Chọn Tỉnh/TP trước —" : phuongList.length === 0 ? "— Chưa có Phường/Xã nào —" : "— Chọn —"}</option>
                    {phuongList.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Field>
                <Field label="Địa chỉ chi tiết"><input className="inp" value={hd.dia_chi} onChange={(e) => setHd((p) => ({ ...p, dia_chi: e.target.value }))} /></Field>
              </div>
            </div>

            {cfields.length > 0 && (
              <div className="card">
                <div className="font-extrabold mb-2.5">Thông tin bổ sung</div>
                <div className="flex flex-col gap-2.5">
                  {cfields.map((c) => {
                    if (c.field_type === "dropdown") return <Field key={c.id} label={c.label} required={c.required}>
                      <select className="inp" value={extra[c.field_key] || ""} onChange={(e) => setExtra((p) => ({ ...p, [c.field_key]: e.target.value }))}>
                        <option value="">— Chọn —</option>
                        {(c.options || []).map((o) => <option key={o}>{o}</option>)}
                      </select>
                    </Field>;
                    if (c.field_type === "checkbox") return <Field key={c.id} label={c.label}>
                      <label className="flex items-center gap-2 text-sm py-2">
                        <input type="checkbox" className="w-4 h-4" checked={!!extra[c.field_key]} onChange={(e) => setExtra((p) => ({ ...p, [c.field_key]: e.target.checked }))} /> Có
                      </label>
                    </Field>;
                    if (c.field_type === "number" || c.field_type === "money") return <Field key={c.id} label={c.label} required={c.required}>
                      <MoneyInput value={extra[c.field_key] || ""} onChange={(v) => setExtra((p) => ({ ...p, [c.field_key]: v }))} />
                    </Field>;
                    if (c.field_type === "formula") return null; // can gia_xe/tongXe theo kieu don cu, khong ap dung o day
                    return <Field key={c.id} label={c.label} required={c.required}>
                      <input className="inp" value={extra[c.field_key] || ""} onChange={(e) => setExtra((p) => ({ ...p, [c.field_key]: e.target.value }))} />
                    </Field>;
                  })}
                </div>
              </div>
            )}
          </div>

          <BangGiaPanel picked={picked} bangGiaCu={bangGiaCu} bangGiaLoi={bangGiaLoi} busy={busy} tinhBangGia={tinhBangGia} bangGia={bangGia} coc={coc} cocLabel={suaId ? "Đã thu trước đó" : "Đã đặt cọc"} />
        </div>
      )}

      {/* ===== BƯỚC 4: XÁC NHẬN ===== */}
      {step === 4 && (
        <div className="flex flex-col gap-4">
          {suaId && (
            <div className="card !py-3">
              <Field label="Lý do sửa đơn" hint="Ghi vào ghi chú đơn để truy vết.">
                <input className="inp" value={lyDo} onChange={(e) => setLyDo(e.target.value)} placeholder="VD: Đổi khuyến mại theo thỏa thuận mới" />
              </Field>
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card">
              <div className="font-extrabold mb-2">Khách hàng & đơn hàng</div>
              <div className="text-[13px] flex flex-col gap-1">
                <div><b>{kh.customer_name || "—"}</b> · {kh.customer_phone}</div>
                <div className="text-[#5A6572]">Tư vấn: {tuVanName || "—"} · Nguồn: {nguonDon}</div>
                <div className="text-[#5A6572]">Ngày lấy giá: {fmtDate(ngayLayGia)} {cocDatTruoc && "· Có cọc đặt trước"} {banCheo && "· Bán chéo"}</div>
                {ghiChu1 && <div className="text-[#5A6572]">Ghi chú: {ghiChu1}</div>}
              </div>
              {picked && (
                <div className="mt-3 pt-3 border-t border-dashed border-[#E3E8EF] text-[13px]">
                  <b>{vehicleObj ? `${vehicleObj.brand} ${vehicleObj.name} ${vehicleObj.color}` : picked.vehicle_id}</b>
                  <div className="font-mono text-[11px] text-[#8A93A0]">SK {picked.frame_number} · {locName(diemBan)}</div>
                  {batteryOption && <div className="text-[#5A6572]">Pin: {batteryOption}</div>}
                </div>
              )}
              <div className="mt-3 pt-3 border-t border-dashed border-[#E3E8EF] text-[13px]">
                {pays.filter((p) => Number(p.amount) > 0).map((p, i) => (
                  <div key={i}>{p.method}: {fmtVND(p.amount)}{p.method === "Trả góp" && p.tra_gop_ct ? ` (qua ${p.tra_gop_ct})` : ""}</div>
                ))}
                {pays.filter((p) => Number(p.amount) > 0).length === 0 && <div className="text-[#8A93A0]">Chưa thêm phương thức thanh toán nào.</div>}
                {coc > 0 && <div>{suaId ? "Đã thu trước đó" : "Đã đặt cọc"}: {fmtVND(coc)}</div>}
                {(hd.dia_chi || hd.phuong_xa || hd.tinh_tp) && <div className="text-[#5A6572]">Xuất HĐ: {[hd.dia_chi, hd.phuong_xa, hd.tinh_tp].filter(Boolean).join(", ")}</div>}
              </div>
            </div>
            <div className="card">
              <div className="font-extrabold mb-2">💰 Bảng giá</div>
              {!bangGia ? <div className="text-xs text-[#8A93A0]">Chưa có Bảng giá — quay lại Bước 2 để tính.</div> : (
                <div className="rounded-xl border border-[#E3E8EF] overflow-hidden text-[13px]">
                  <div className="flex justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF]"><span className="text-[#5A6572]">Giá niêm yết</span><b>{fmtVND(bangGia.gia_xe)}</b></div>
                  <div className="flex justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF] bg-[#EAF2FF]"><span className="font-bold">Giá cần thanh toán</span><b className="text-brand">{fmtVND(bangGia.gia_can_thanh_toan)}</b></div>
                  <div className="flex justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF]"><span className="text-[#5A6572]">Tổng xuất hóa đơn</span><b>{fmtVND(bangGia.tong_xuat_hd)}</b></div>
                  <div className="flex justify-between px-3 py-2.5 bg-[#FFF6E5]"><span className="font-bold">Còn lại phải thu</span><b className="text-[18px] text-[#A25F00]">{fmtVND(conLai)}</b></div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* THANH ĐIỀU HƯỚNG */}
      <div className="fixed bottom-0 left-0 right-0 lg:left-[248px] bg-white border-t border-[#E6EAEF] px-4 py-3 flex items-center gap-2 z-30">
        <div className="text-[12px] text-[#8A93A0]">Bước {step}/4 — {STEPS[step - 1]}</div>
        <div className="ml-auto flex gap-2">
          {step > 1 && <button className="btn-ghost" onClick={() => setStep(step - 1)}>← Quay lại</button>}
          {step < 4 && (
            <button className="btn-primary" disabled={(step === 1 && !canNext1) || (step === 2 && !canNext2)}
              onClick={() => {
                if (step === 1 && !canNext1) return notify("Chọn hoặc nhập khách hàng.", "err");
                if (step === 2 && !canNext2) return notify("Chọn xe và bấm \"Làm mới Bảng giá\" trước khi tiếp tục.", "err");
                setStep(step + 1);
              }}>Tiếp theo →</button>
          )}
          {step === 4 && <button className="btn-ok" disabled={busy} onClick={luu}>{suaId ? "💾 Lưu thay đổi" : "💾 Lưu đơn"}</button>}
        </div>
      </div>
    </div>
  );
}

export default function TaoDonWizard() {
  return <Suspense fallback={<div className="card">Đang tải…</div>}><TaoDonWizardInner /></Suspense>;
}
