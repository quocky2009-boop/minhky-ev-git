"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, LocSearch, CustomerSearch, MoneyInput, FrameSearch, ComboFree } from "@/components/ui";
import { printOrder as _printOrder } from "@/lib/print";
import { uploadAnhDon } from "@/lib/img";
import Link from "next/link";
import { fmtVND, errMsg } from "@/lib/format";
import { CUSTOMER_TYPES, CUSTOMER_SOURCES } from "@/lib/const";

const iso = (d) => d.toLocaleDateString("sv-SE");
const ITEM_TYPES = { PHU_KIEN: "Phụ kiện", DANG_KY: "Đăng ký xe", BAO_HIEM: "Bảo hiểm" };

// Tinh truong cong thuc (vd: gia truoc thue = gia ban / (1 + thue))
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

// Tính tiền 1 dòng sau chiết khấu
const lineTotal = (qty, price, dtype, dval) => {
  const goc = (Number(qty) || 1) * (Number(price) || 0);
  const ck = dtype === "percent"
    ? Math.round(goc * Math.min(Math.max(Number(dval) || 0, 0), 100) / 100)
    : Math.min(Math.max(Number(dval) || 0, 0), goc);
  return { goc, ck, con: Math.max(goc - ck, 0) };
};

function TaoDonInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { supabase, vehicles, locations, profile, loading, refresh, settings, customFields, taxRate, paymentMethods, brands } = useCatalog();
  const { toast, notify } = useToast();

  const [custs, setCusts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [ketQua, setKetQua] = useState(null);
  const [suaId, setSuaId] = useState(null);        // id don dang sua
  const [suaCheck, setSuaCheck] = useState(null);  // ket qua kiem tra co sua duoc khong
  const [lyDo, setLyDo] = useState("");
  const [payCu, setPayCu] = useState([]);          // cac khoan da thu (khong sua duoc)
  const [daoNguoc, setDaoNguoc] = useState(null);
  const [promos, setPromos] = useState([]);
  const [promoChon, setPromoChon] = useState([]);   // mang id khuyen mai da tick
  const [promoQ, setPromoQ] = useState("");
  const [bankAccounts, setBankAccounts] = useState([]);
  const [suaPaidAmount, setSuaPaidAmount] = useState(0); // paid_amount thuc te tren don (sau hoan tien)

  // Khách hàng
  const [custId, setCustId] = useState("");
  const [kh, setKh] = useState({ customer_name: "", customer_phone: "", customer_cccd: "", customer_address: "", customer_type: "Khách lẻ", customer_source: "Khách vãng lai", customer_email: "", customer_gender: "", customer_birthday: "" });
  const [newC, setNewC] = useState(null);

  // Thông tin bổ sung
  const [meta, setMeta] = useState({ sale_date: iso(new Date()), location_code: "", document_status: "Đang làm đăng ký", note: "", seller_id: "", seller_name: "", due_date: "" });
  const [staff, setStaff] = useState([]);
  useEffect(() => {
    if (!loading) supabase.from("profiles").select("id,name,role").eq("status", "Hoạt động").order("name").then(({ data }) => setStaff(data || []));
  }, [loading]);

  // Hàng hóa: xe + bán kèm cùng một bảng
  const [xeRows, setXeRows] = useState([]);   // {frame_number, vehicle_id, ten, unit_price, discount_type, discount_value, coc_amount}
  const [kemRows, setKemRows] = useState([]); // {item_type, name, qty, unit_price, discount_type, discount_value, product_id}
  const [productList, setProductList] = useState([]);

  // Chiết khấu tổng + thanh toán
  const [dTong, setDTong] = useState({ type: "amount", value: 0 });
  const [pays, setPays] = useState([]);       // {method, amount}
  const [fotos, setFotos] = useState([]);
  const [extra, setExtra] = useState({});

  const loadCusts = async () => {
    const [{ data: c }, { data: prods }, { data: kms }, { data: banks }] = await Promise.all([
      supabase.from("customers").select("id,code,name,phone,cccd,address,status,customer_type,source,email,gender,birthday").order("created_at", { ascending: false }).limit(2000),
      supabase.from("products").select("id,name,group_name,unit,sale_price,stock_qty").eq("status","Hoạt động").order("group_name").order("name"),
      supabase.from("promotions").select("*").eq("status","Đang áp dụng"),
      supabase.from("cash_accounts").select("id, name, company_id, bank_info").eq("status","Hoạt động").eq("type","Ngân hàng"),
    ]);
    setCusts(c || []); setProductList(prods || []); setPromos(kms || []); setBankAccounts(banks || []);
  };
  useEffect(() => {
    if (!loading) {
      loadCusts();
      // Dat mac dinh seller = nguoi dang dang nhap sau khi loading xong
      if (profile && !meta.seller_id) setMeta((p) => ({ ...p, seller_id: profile.id, seller_name: profile.name }));
    }
  }, [loading]);

  // Nạp đơn để SỬA
  const [suaDone, setSuaDone] = useState(false);
  useEffect(() => {
    const id = params.get("sua");
    if (!id || suaDone || custs.length === 0) return;
    setSuaDone(true);
    (async () => {
      const chk = await supabase.rpc("fn_don_co_sua_duoc", { p_id: Number(id) });
      if (chk.error) return notify(errMsg(chk.error), "err");
      setSuaCheck(chk.data);
      if (!chk.data.ok) { notify(chk.data.ly_do, "err"); return; }

      const [{ data: o }, { data: its }, { data: pays0 }] = await Promise.all([
        supabase.from("sales_orders").select("*").eq("id", id).single(),
        supabase.from("sale_items").select("*").eq("sale_code", (await supabase.from("sales_orders").select("code").eq("id", id).single()).data?.code || ""),
        supabase.from("sale_payments").select("*").eq("sale_code", (await supabase.from("sales_orders").select("code").eq("id", id).single()).data?.code || ""),
      ]);
      if (!o) return notify("Không tìm thấy đơn.", "err");
      setSuaId(o.id);
      setKh({ customer_name: o.customer_name, customer_phone: o.customer_phone, customer_cccd: o.customer_cccd || "",
        customer_address: o.customer_address || "", customer_type: o.customer_type, customer_source: o.customer_source });
      setMeta({ sale_date: o.sale_date, location_code: o.location_code, document_status: o.document_status, note: o.note || "", seller_id: o.seller_id || "", seller_name: o.seller_name || "" });
      setExtra(o.extra || {});
      setDTong({ type: o.discount_type || "amount", value: o.discount_value || 0 });
      setPayCu(pays0 || []);
      setSuaPaidAmount(o.paid_amount || 0);
      const { data: sop } = await supabase.from("sale_order_promotions").select("promotion_id").eq("sale_code", o.code);
      setPromoChon((sop || []).map((x) => x.promotion_id));

      // Nạp xe của đơn
      const sks = String(o.frame_number || "").split(",").map((x) => x.trim()).filter(Boolean);
      const { data: units } = await supabase.from("vehicle_units").select("*").in("frame_number", sks);
      setXeRows((units || []).map((u) => {
        const v = vehicles.find((x) => x.id === u.vehicle_id);
        return { frame_number: u.frame_number, vehicle_id: u.vehicle_id,
          ten: v ? `${v.brand} ${v.name} ${v.color}` : u.vehicle_id,
          location_code: u.location_code, giu_cho: false,
          unit_price: o.sale_price, discount_type: o.vehicle_discount_type || "amount",
          discount_value: o.vehicle_discount_value || 0 };
      }));
      setKemRows((its || []).map((x) => ({ item_type: x.item_type, name: x.name, qty: x.qty,
        unit_price: x.unit_price, discount_type: x.discount_type || "amount", discount_value: x.discount_value || 0 })));
      notify(`Đang sửa đơn ${o.code}.`);
    })();
  }, [params, custs, vehicles]);

  // Nạp từ phiếu cọc (chỉ nạp xe + khách; tiền cọc được themXe tự tra từ bảng deposits)
  const [cocDone, setCocDone] = useState(false);
  useEffect(() => {
    const sk = params.get("sk"), phone = params.get("kh");
    if (!sk || cocDone || custs.length === 0) return;
    setCocDone(true);
    (async () => {
      await themXe(sk);
      const c = custs.find((x) => (x.phone || "").replace(/\D/g, "") === String(phone || "").replace(/\D/g, ""));
      if (c) pickCust(c);
    })();
  }, [params, custs]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  const cfields = (customFields || []).filter((c) => c.entity === "sales_order");
  const PTTT = (paymentMethods.length > 0 ? paymentMethods.map((m) => m.code) : ["Tiền mặt", "Chuyển khoản", "Trả góp"]);
  const traGopPT = paymentMethods.find((m) => m.code === "Trả góp");
  const quyTypeOf = (method) => paymentMethods.find((m) => m.code === method)?.quy_type;

  // Xac dinh phap nhan (company_id) theo hang xe DAU TIEN trong don — dung de loc dung
  // danh sach tai khoan Ngan hang cho nhan vien chon (Ngan hang gan theo phap nhan, khong theo cua hang)
  const companyIdCuaDon = (() => {
    const v0 = vehicles.find((v) => v.id === xeRows[0]?.vehicle_id);
    if (!v0) return null;
    return brands.find((b) => b.name === v0.brand)?.company_id || null;
  })();
  const banksHopLe = companyIdCuaDon ? bankAccounts.filter((a) => a.company_id === companyIdCuaDon) : [];

  const vName = (id) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.name} · ${v.color}` : id; };

  // ===== KHÁCH HÀNG =====
  const pickCust = (c) => {
    if (!c) { setCustId(""); return; }
    setCustId(c.id);
    setKh((p) => ({
      ...p,
      customer_name: c.name || "",
      customer_phone: c.phone || "",
      customer_cccd: c.cccd || "",
      customer_address: c.address || "",
      customer_type: c.customer_type || p.customer_type,
      customer_source: c.source || p.customer_source,
      customer_email: c.email || "",
      customer_gender: c.gender || "",
      customer_birthday: c.birthday || "",
      customer_no: 0,
    }));
    // Load cong no
    supabase.from("v_khach_tong_quan").select("con_no").eq("customer_id", c.id).single()
      .then(({ data }) => { if (data) setKh((p) => ({ ...p, customer_no: data.con_no || 0 })); });
  };
  const createCust = async (name) => setNewC({ name: name || "", phone: "", address: "", email: "", gender: "", birthday: "" });
  const luuCustMoi = async () => {
    if (!newC.name.trim() || !newC.phone.trim()) return notify("Nhập tên và SĐT.", "err");
    if (!newC.email?.trim()) return notify("Bắt buộc nhập Email.", "err");
    if (!newC.gender) return notify("Bắt buộc chọn Giới tính.", "err");
    if (!newC.birthday) return notify("Bắt buộc nhập Ngày sinh.", "err");
    const { data, error } = await supabase.rpc("fn_luu_khach_hang_v2", { p: { name: newC.name, phone: newC.phone, address: newC.address || "", email: newC.email, gender: newC.gender, birthday: newC.birthday, source: "Bán hàng" } });
    if (error) return notify(errMsg(error), "err");
    await loadCusts();
    setCustId(data);
    setKh((p) => ({ ...p, customer_name: newC.name, customer_phone: newC.phone, customer_address: newC.address || "" }));
    setNewC(null); notify("Đã tạo khách mới.");
  };

  // ===== HÀNG HÓA =====
  const themXe = async (sk) => {
    const s = String(sk || "").trim().toUpperCase();
    if (!s) return;
    if (xeRows.some((r) => r.frame_number === s)) return notify("Xe này đã có trong đơn.", "err");
    const { data: u } = await supabase.from("vehicle_units").select("*").eq("frame_number", s).maybeSingle();
    if (!u) return notify(`Không tìm thấy số khung ${s}.`, "err");
    if (!["TON_KHO", "GIU_CHO"].includes(u.status)) return notify(`Xe ${s} đang ở trạng thái ${u.status}, không bán được.`, "err");

    const v = vehicles.find((x) => x.id === u.vehicle_id);
    // Xe dang giu cho: tra tien coc da nhan tu bang deposits de tu dong tru vao "khach phai tra"
    let coc = 0;
    if (u.status === "GIU_CHO") {
      const { data: deps } = await supabase.from("deposits").select("amount").eq("frame_number", s).eq("status", "DANG_GIU");
      coc = (deps || []).reduce((t, d) => t + (Number(d.amount) || 0), 0);
    }
    setXeRows((p) => [...p, {
      frame_number: s, vehicle_id: u.vehicle_id, ten: v ? `${v.brand} ${v.name} ${v.color}` : u.vehicle_id,
      location_code: u.location_code, giu_cho: u.status === "GIU_CHO", coc_amount: coc,
      thieu_coc: u.coc_status === "CHUA_VE" || u.coc_status === "THAT_LAC",
      unit_price: v?.list_price || 0, discount_type: "amount", discount_value: 0,
    }]);
    notify(`Đã thêm ${v ? v.name : u.vehicle_id} · ${s}` + (coc > 0 ? ` · đã nhận cọc ${fmtVND(coc)}` : ""));
    if (u.coc_status === "CHUA_VE" || u.coc_status === "THAT_LAC") {
      notify(`⚠ Xe ${s} CHƯA có giấy COC — vẫn bán được nhưng nhớ bổ sung giấy cho khách sau.`, "err");
    }
  };

  const setXe = (i, k, v) => setXeRows((p) => p.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const setKem = (i, k, v) => setKemRows((p) => p.map((x, j) => j === i ? { ...x, [k]: v } : x));

  // Phụ kiện gợi ý từ Cài đặt
  const parseDM = (raw) => (raw || "").split(/\n+/).map((x) => x.trim()).filter(Boolean)
    .map((line) => { const [ten, gia] = line.split("|").map((y) => y.trim()); return { ten, gia: Number(gia) || 0 }; });
  const DM = {
    PHU_KIEN: parseDM(settings?.phu_kien),
    BAO_HIEM: parseDM(settings?.bao_hiem),
    DANG_KY: [{ ten: "Dịch vụ đăng ký xe", gia: Number(settings?.gia_dang_ky) || 350000 }],
  };

  // ===== TÍNH TIỀN =====
  const tongXe = xeRows.reduce((s, r) => s + lineTotal(1, r.unit_price, r.discount_type, r.discount_value).con, 0);
  const tongKem = kemRows.reduce((s, r) => s + lineTotal(r.qty, r.unit_price, r.discount_type, r.discount_value).con, 0);
  const tamTinh = tongXe + tongKem;
  const ckTong = dTong.type === "percent"
    ? Math.round(tamTinh * Math.min(Math.max(Number(dTong.value) || 0, 0), 100) / 100)
    : Math.min(Math.max(Number(dTong.value) || 0, 0), tamTinh);
  const phaiTra = Math.max(tamTinh - ckTong, 0);
  // Tien coc da nhan cho cac xe GIU_CHO (backend tu cong vao paid_amount khi tao don).
  // Chi ap dung khi TAO MOI; khi sua don, coc da nam trong paid_amount cu (payCu) roi.
  const tongCoc = suaId ? 0 : xeRows.reduce((s, r) => s + (Number(r.coc_amount) || 0), 0);
  // Khi sua don: dung paid_amount thuc te tu DB (da tru hoan tien), khong cong lai tung dong sale_payments
  const daTra = suaId
    ? suaPaidAmount + pays.reduce((s, p) => s + (Number(p.amount) || 0), 0)
    : tongCoc + pays.reduce((s, p) => s + (Number(p.amount) || 0), 0) + payCu.reduce((s, p) => s + p.amount, 0);
  const conLai = Math.max(phaiTra - daTra, 0);

  // ===== LƯU ĐƠN =====
  const luuDaoNguoc = async () => {
    if (!daoNguoc.ly_do?.trim()) return notify("Nhập lý do đảo ngược.", "err");
    const cacDong = (daoNguoc.new_payments || []).filter((p) => Number(p.amount) > 0);
    if (cacDong.length === 0) return notify("Nhập ít nhất 1 phương thức thanh toán mới.", "err");
    const tgThieu = cacDong.find((p) => p.method === "Trả góp" && !p.finance_company);
    if (tgThieu) return notify("Chọn đơn vị trả góp.", "err");
    const nhThieu = cacDong.find((p) => quyTypeOf(p.method) === "Ngân hàng" && !p.account_id);
    if (nhThieu) return notify(`Chọn tài khoản Ngân hàng nhận tiền cho phương thức "${nhThieu.method}".`, "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_dao_nguoc_khoan_thu", { p_payment_id: daoNguoc.id, p_ly_do: daoNguoc.ly_do,
      p_new_payments: cacDong.map((p) => ({ method: p.method, amount: Number(p.amount), finance_company: p.finance_company || null, account_id: p.account_id || null })) });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã đảo ngược và ghi lại khoản thu mới.");
    setDaoNguoc(null);
    const { data: sc } = await supabase.from("sales_orders").select("code, paid_amount").eq("id", suaId).single();
    const { data: pays2 } = await supabase.from("sale_payments").select("*").eq("sale_code", sc?.code || "");
    setPayCu(pays2 || []);
    setSuaPaidAmount(sc?.paid_amount || 0);
  };

  const luuSua = async () => {
    if (xeRows.length === 0) return notify("Đơn phải có ít nhất 1 xe.", "err");
    if (!meta.location_code) return notify("Chọn điểm bán.", "err");
    const tgThieuSua = pays.find((p) => p.method === "Trả góp" && Number(p.amount) > 0 && !p.tra_gop_ct);
    if (tgThieuSua) return notify("Chọn đơn vị trả góp cho khoản thu thêm.", "err");
    const nhThieuSua = pays.find((p) => Number(p.amount) > 0 && quyTypeOf(p.method) === "Ngân hàng" && !p.account_id);
    if (nhThieuSua) return notify(`Chọn tài khoản Ngân hàng nhận tiền cho phương thức "${nhThieuSua.method}".`, "err");
    if (!canhBaoMotPTTT()) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_sua_don_ban", { p: {
      id: suaId, ...kh, ...meta, ly_do: lyDo,
      frames: xeRows.map((r) => ({ frame_number: r.frame_number, unit_price: Number(r.unit_price) || 0,
        discount_type: r.discount_type, discount_value: Number(r.discount_value) || 0 })),
      items: kemRows.filter((r) => r.name?.trim()).map((r) => ({ item_type: r.item_type, name: r.name,
        qty: Number(r.qty) || 1, unit_price: Number(r.unit_price) || 0,
        discount_type: r.discount_type, discount_value: Number(r.discount_value) || 0 })),
      new_payments: pays.filter((p) => Number(p.amount) > 0),
      discount_type: dTong.type, discount_value: Number(dTong.value) || 0,
      extra,
    } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    await supabase.rpc("fn_gan_khuyen_mai_don", { p_sale_code: data.code, p_promotion_ids: promoChon });
    notify(`Đã sửa đơn ${data.code}.`);
    router.push(`/don-ban?q=${encodeURIComponent(data.code)}`);
  };

  const canhBaoMotPTTT = () => {
    const cacDong = pays.filter((p) => Number(p.amount) > 0);
    if (cacDong.length !== 1) return true; // 0 dong (khong thu them) hoac >=2 dong (da tach) -> khong can canh bao
    const d = cacDong[0];
    return confirm(`⚠️ Đơn này chỉ chọn ĐÚNG 1 phương thức thanh toán duy nhất:\n\n${d.method}: ${Number(d.amount).toLocaleString("vi-VN")}đ\n\nNếu khách thực tế trả bằng NHIỀU phương thức khác nhau (VD: một phần tiền mặt + một phần chuyển khoản), hạch toán thu-chi vào sổ quỹ sẽ SAI theo từng tài khoản.\n\nBấm OK nếu chắc chắn khách CHỈ trả bằng đúng 1 phương thức này.\nBấm Hủy để quay lại sửa cho đúng.`);
  };

  const luuDon = async () => {
    if (xeRows.length === 0) return notify("Chưa chọn xe nào.", "err");
    if (!kh.customer_name || !kh.customer_phone) return notify("Chọn hoặc nhập khách hàng.", "err");
    if (!meta.location_code) return notify("Chọn điểm bán để hạch toán doanh số.", "err");
    const tgThieu = pays.find((p) => p.method === "Trả góp" && Number(p.amount) > 0 && !p.tra_gop_ct);
    if (tgThieu) return notify("Chọn đơn vị trả góp.", "err");
    const nhThieu = pays.find((p) => Number(p.amount) > 0 && quyTypeOf(p.method) === "Ngân hàng" && !p.account_id);
    if (nhThieu) return notify(`Chọn tài khoản Ngân hàng nhận tiền cho phương thức "${nhThieu.method}".`, "err");
    const v0ForBattery = vehicles.find((v) => v.id === xeRows[0]?.vehicle_id);
    if (v0ForBattery?.model_pin === "Xe đổi pin" && !meta.battery_option) {
      return notify("Xe Đổi pin bắt buộc chọn Hình thức kinh doanh pin.", "err");
    }
    const cfThieu = cfields.find((c) => c.required && c.field_type !== "formula" && !extra[c.field_key]);
    if (cfThieu) return notify(`Nhập "${cfThieu.label}".`, "err");
    if (!canhBaoMotPTTT()) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_ban_hang_v2", { p: {
      ...kh, ...meta,
      frames: xeRows.map((r) => ({ frame_number: r.frame_number, unit_price: Number(r.unit_price) || 0,
        discount_type: r.discount_type, discount_value: Number(r.discount_value) || 0 })),
      items: kemRows.filter((r) => r.name?.trim()).map((r) => ({ item_type: r.item_type, name: r.name,
        qty: Number(r.qty) || 1, unit_price: Number(r.unit_price) || 0,
        discount_type: r.discount_type, discount_value: Number(r.discount_value) || 0 })),
      payments: pays.filter((p) => Number(p.amount) > 0).map((p) => ({
        method: p.method, amount: Number(p.amount), account_id: p.account_id || null,
        note: p.method === "Trả góp" && p.tra_gop_ct ? `Trả góp qua ${p.tra_gop_ct}` : (p.note || ""),
      })),
      discount_type: dTong.type, discount_value: Number(dTong.value) || 0,
      extra: {
        ...extra,
        ...Object.fromEntries(cfields.filter((c) => c.field_type === "formula")
          .map((c) => [c.field_key, calcFormula(c.formula, tongXe, taxRate)])),
        ...(pays.find((p) => p.method === "Trả góp" && p.tra_gop_ct)
          ? { tra_gop_cong_ty: pays.find((p) => p.method === "Trả góp").tra_gop_ct,
              tra_gop_so_tien: Number(pays.find((p) => p.method === "Trả góp").amount) || 0 }
          : {}),
      },
    } });
    if (error) { setBusy(false); return notify(errMsg(error), "err"); }

    if (promoChon.length > 0 && Array.isArray(data?.codes)) {
      await Promise.all(data.codes.map((code) => supabase.rpc("fn_gan_khuyen_mai_don", { p_sale_code: code, p_promotion_ids: promoChon })));
    }

    // Ảnh đính kèm -> gắn vào đơn đầu tiên
    if (fotos.length > 0 && data?.first) {
      try {
        notify(`Đang tải ${fotos.length} ảnh…`);
        const list = await uploadAnhDon(supabase, data.first, fotos.map((x) => x.file));
        await supabase.rpc("fn_gan_anh_don", { p_code: data.first, p_photos: list });
      } catch (e) { notify("Lưu đơn OK nhưng tải ảnh lỗi: " + (e.message || e), "err"); }
    }
    setBusy(false);
    setKetQua(data);
    notify(`Đã tạo ${data.count} đơn bán.`);
    refresh();
  };

  const lamMoi = () => {
    setKetQua(null); setXeRows([]); setKemRows([]); setPays([]); setFotos([]); setPromoChon([]);
    setDTong({ type: "amount", value: 0 }); setCustId(""); setNewC(null); setExtra({});
    setKh({ customer_name: "", customer_phone: "", customer_cccd: "", customer_address: "", customer_type: "Khách lẻ", customer_source: "Khách vãng lai", customer_email: "", customer_gender: "", customer_birthday: "" });
    if (profile) setMeta((p) => ({ ...p, seller_id: profile.id, seller_name: profile.name }));
  };

  // ===== ĐÃ LƯU XONG =====
  if (ketQua) {
    return (
      <div className="flex flex-col gap-4">
        <Toast toast={toast} />
        <div className="card text-center py-8">
          <div className="text-5xl mb-2">✅</div>
          <div className="font-extrabold text-xl mb-1">Đã tạo {ketQua.count} đơn bán</div>
          <div className="text-[13px] text-[#5A6572] mb-1">{(ketQua.codes || []).join(" · ")}</div>
          {ketQua.count > 1 && <div className="text-[12px] text-[#8A93A0]">Gom nhóm theo lô <b>{ketQua.batch}</b></div>}
          <div className="flex gap-2 justify-center flex-wrap mt-4">
            <Link href={`/don-ban?q=${encodeURIComponent(ketQua.first)}`} className="btn-primary">Xem chi tiết & in phiếu</Link>
            <button className="btn-ok" onClick={lamMoi}>+ Tạo đơn khác</button>
            <Link href="/don-ban" className="btn-ghost">Về danh sách đơn</Link>
          </div>
        </div>
      </div>
    );
  }

  // Bảng dòng hàng hóa dùng chung
  const RowCK = ({ r, set, i }) => (
    <>
      <td data-label="Chiết khấu" className="td">
        <div className="flex gap-1">
          {r.discount_type === "percent" ? (
            <input type="number" className="inp !py-1 !text-xs !w-20" value={r.discount_value || ""} placeholder="0"
              onChange={(e) => set(i, "discount_value", e.target.value)} />
          ) : (
            <MoneyInput className="!py-1 !text-xs !w-28" value={r.discount_value || ""} placeholder="0"
              onChange={(v) => set(i, "discount_value", v)} />
          )}
          <select className="inp !py-1 !text-xs !w-14" value={r.discount_type} onChange={(e) => set(i, "discount_type", e.target.value)}>
            <option value="amount">đ</option><option value="percent">%</option>
          </select>
        </div>
      </td>
      <td data-label="Thành tiền" className="td text-right font-bold whitespace-nowrap">
        {fmtVND(lineTotal(r.qty || 1, r.unit_price, r.discount_type, r.discount_value).con)}
      </td>
    </>
  );

  return (
    <div className="flex flex-col gap-4 pb-24">
      <Toast toast={toast} />

      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">{suaId ? "Sửa đơn bán" : "Tạo đơn bán"}</div>
        <Link href="/don-ban" className="btn-ghost !text-xs">← Danh sách đơn</Link>
      </div>

      {suaId && suaCheck?.muc === "han_che" && (
        <div className="card !py-2.5 bg-[#FFF6E5] border border-[#F0C000]">
          <div className="text-[13px]"><b>⚠ Đơn đã thu {fmtVND(suaCheck.da_thu)}</b> — sửa được nhưng tổng đơn mới không được nhỏ hơn số đã thu. Muốn giảm thì hoàn tiền cho khách trước.</div>
        </div>
      )}
      {suaId && (suaPaidAmount > 0 || payCu.length > 0) && (
        <div className="card">
          <div className="font-extrabold mb-2">Các khoản đã thu (không sửa được)</div>
          <div className="flex flex-col gap-1.5">
            {payCu.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-[13px] p-2 rounded-lg bg-[#F8FAFC]">
                <Badge tone={p.is_reversed ? "dark" : "green"}>{p.method}</Badge>
                <span className="text-[11px] text-[#8A93A0] mr-auto">{p.created_by_name} · {new Date(p.created_at).toLocaleDateString("vi-VN")}</span>
                <b className={p.is_reversed ? "line-through text-[#8A93A0]" : ""}>{fmtVND(p.amount)}</b>
                {p.is_reversed && <span className="text-[10.5px] text-danger">(đã đảo ngược)</span>}
                {!p.is_reversed && ["ADMIN","CEO"].includes(profile.role) && (
                  <button className="btn-ghost !px-2 !py-0.5 !text-[11px]" onClick={() => setDaoNguoc({ id: p.id, method: p.method, amount: p.amount, new_payments: [{ method: p.method, amount: p.amount, finance_company: "" }], ly_do: "" })}>🔄 Đảo ngược</button>
                )}
              </div>
            ))}
            {/* Neu co hoan tien: sum(payCu) != suaPaidAmount, hien tong thuc te */}
            {payCu.reduce((s, p) => s + p.amount, 0) !== suaPaidAmount && (
              <div className="flex items-center gap-2 text-[13px] p-2 rounded-lg bg-[#FFF6E5] border border-[#F0C000]">
                <span className="text-[#A25F00] mr-auto">↩ Đã hoàn tiền — thực tế khách đã trả</span>
                <b className="text-[#A25F00]">{fmtVND(suaPaidAmount)}</b>
              </div>
            )}
          </div>
          <div className="text-[11px] text-[#8A93A0] mt-2">Thêm khoản thu mới ở khối Thanh toán bên dưới.</div>
        </div>
      )}

      {/* ===== HÀNG 1: KHÁCH HÀNG | THÔNG TIN BỔ SUNG ===== */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="font-extrabold mb-2.5">Thông tin khách hàng</div>
          {newC ? (
            <div className="grid gap-2 md:grid-cols-3 p-2.5 bg-[#F0FDF6] rounded-xl">
              <input className="inp" placeholder="Họ tên *" value={newC.name} onChange={(e) => setNewC((p) => ({ ...p, name: e.target.value }))} />
              <input className="inp" placeholder="SĐT *" value={newC.phone} onChange={(e) => setNewC((p) => ({ ...p, phone: e.target.value }))} />
              <input className="inp" placeholder="Email *" type="email" value={newC.email || ""} onChange={(e) => setNewC((p) => ({ ...p, email: e.target.value }))} />
              <select className="inp" value={newC.gender || ""} onChange={(e) => setNewC((p) => ({ ...p, gender: e.target.value }))}>
                <option value="">Giới tính * (bắt buộc)</option>
                <option>Nam</option><option>Nữ</option><option>Khác</option>
              </select>
              <div><label className="text-[11px] text-[#5A6572] font-semibold">Ngày sinh *</label>
                <input type="date" className="inp" value={newC.birthday || ""} onChange={(e) => setNewC((p) => ({ ...p, birthday: e.target.value }))} />
              </div>
              <input className="inp" placeholder="Địa chỉ" value={newC.address} onChange={(e) => setNewC((p) => ({ ...p, address: e.target.value }))} />
              <div className="md:col-span-3 flex gap-2">
                <button className="btn-ok !text-xs" onClick={luuCustMoi}>Lưu khách</button>
                <button className="btn-ghost !text-xs" onClick={() => setNewC(null)}>Hủy</button>
              </div>
            </div>
          ) : (
            <CustomerSearch customers={custs} value={custId} onPick={pickCust} onCreate={createCust} />
          )}
          {kh.customer_name && (
            <div className="grid gap-2.5 md:grid-cols-2 mt-3">
              <Field label="Họ tên"><input className="inp" value={kh.customer_name} onChange={(e) => setKh((p) => ({ ...p, customer_name: e.target.value }))} /></Field>
              <Field label="SĐT"><input className="inp" value={kh.customer_phone} onChange={(e) => setKh((p) => ({ ...p, customer_phone: e.target.value }))} /></Field>
              <Field label="Email"><input className="inp" type="email" value={kh.customer_email || ""} onChange={(e) => setKh((p) => ({ ...p, customer_email: e.target.value }))} placeholder="ten@email.com" /></Field>
              <Field label="Ngày sinh"><input type="date" className="inp" value={kh.customer_birthday || ""} onChange={(e) => setKh((p) => ({ ...p, customer_birthday: e.target.value }))} /></Field>
              <Field label="Giới tính">
                <div className="flex gap-1.5">{["Nam", "Nữ", "Khác"].map((g) => (
                  <button key={g} type="button" className={`btn !px-3 !py-2 !text-xs ${kh.customer_gender === g ? "bg-brand text-white" : "bg-[#EEF1F4]"}`}
                    onClick={() => setKh((p) => ({ ...p, customer_gender: g }))}>{g}</button>
                ))}</div>
              </Field>
              <Field label="Loại khách"><select className="inp" value={kh.customer_type} onChange={(e) => setKh((p) => ({ ...p, customer_type: e.target.value }))}>{CUSTOMER_TYPES.map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Nguồn khách"><select className="inp" value={kh.customer_source} onChange={(e) => setKh((p) => ({ ...p, customer_source: e.target.value }))}>{CUSTOMER_SOURCES.map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Địa chỉ"><input className="inp" value={kh.customer_address} onChange={(e) => setKh((p) => ({ ...p, customer_address: e.target.value }))} /></Field>
              {custId && (kh.customer_no || 0) > 0 && (
                <div className="md:col-span-2 p-2 rounded-lg bg-[#FFF6F6] border border-[#F5B5B5] text-[13px] flex justify-between">
                  <span className="text-danger font-semibold">⚠ Nợ phải thu</span>
                  <b className="text-danger">{fmtVND(kh.customer_no)}</b>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <div className="font-extrabold mb-2.5">Thông tin bổ sung</div>
          <div className="flex flex-col gap-2.5">
            <Field label="Điểm bán (ghi nhận doanh số)" required>
              <LocSearch locations={locations.filter((l) => l.type === "Cửa hàng" || l.type === "Showroom")} value={meta.location_code} onChange={(v) => setMeta((p) => ({ ...p, location_code: v }))} placeholder="Bắt buộc chọn cửa hàng" />
              <div className="text-[10.5px] text-[#8A93A0] mt-1">Dùng để hạch toán doanh số theo điểm/khu vực. Xe vẫn trừ tồn ở kho của chính nó.</div>
            </Field>
            <Field label="Bán bởi">
              <select className="inp" value={meta.seller_id || ""}
                onChange={(e) => {
                  const found = staff.find((s) => s.id === e.target.value);
                  setMeta((p) => ({ ...p, seller_id: e.target.value, seller_name: found?.name || "" }));
                }}>
                <option value="">— Chọn nhân viên —</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
              </select>
            </Field>
            <Field label="Ngày bán"><input type="date" className="inp" value={meta.sale_date} onChange={(e) => setMeta((p) => ({ ...p, sale_date: e.target.value }))} /></Field>
            <Field label="Hạn thanh toán (nếu nợ)"><input type="date" className="inp" value={meta.due_date || ""} onChange={(e) => setMeta((p) => ({ ...p, due_date: e.target.value }))} placeholder="Để trống nếu trả đủ ngay" /></Field>
            {(() => {
              const v0 = vehicles.find((v) => v.id === xeRows[0]?.vehicle_id);
              if (v0?.model_pin !== "Xe đổi pin") return null;
              return (
                <Field label="Hình thức kinh doanh pin" required>
                  <select className="inp" value={meta.battery_option || ""} onChange={(e) => setMeta((p) => ({ ...p, battery_option: e.target.value }))}>
                    <option value="">— Chọn —</option>
                    <option value="Kèm pin">Kèm pin</option>
                    <option value="Thuê pin">Thuê pin</option>
                  </select>
                </Field>
              );
            })()}

            {cfields.map((c) => {
              if (c.field_type === "formula") {
                const val = calcFormula(c.formula, tongXe, taxRate);
                return <Field key={c.id} label={`${c.label} (tự tính, thuế ${Math.round(taxRate * 100)}%)`}>
                  <input className="inp bg-[#F8FAFC]" value={val === "" ? "" : fmtVND(val)} readOnly />
                </Field>;
              }
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
              return <Field key={c.id} label={c.label} required={c.required}>
                <input className="inp" value={extra[c.field_key] || ""} onChange={(e) => setExtra((p) => ({ ...p, [c.field_key]: e.target.value }))} />
              </Field>;
            })}
          </div>
        </div>
      </div>

      {/* ===== HÀNG 2: BẢNG HÀNG HÓA ===== */}
      <div className="card">
        <div className="flex items-center gap-2 mb-2.5 flex-wrap">
          <div className="font-extrabold mr-auto">Thông tin hàng hóa</div>
          <span className="text-[11px] text-[#8A93A0]">{xeRows.length} xe · {kemRows.length} mục kèm</span>
          {new Set(xeRows.map((r) => r.location_code)).size > 1 && (
            <Badge tone="blue">Gom từ {new Set(xeRows.map((r) => r.location_code)).size} kho</Badge>
          )}
        </div>

        <div className="mb-3">
          <FrameSearch supabase={supabase} value=""
            onlyStatus={["TON_KHO", "GIU_CHO"]}
            placeholder="Tìm số khung để thêm xe, hoặc quét mã…"
            onPick={(sk, u) => { if (u) themXe(sk); }} />
        </div>

        <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
          <thead><tr>
            <th className="th w-8">STT</th><th className="th">Tên hàng / dịch vụ</th>
            <th className="th w-16 text-center">SL</th><th className="th w-32">Đơn giá</th>
            <th className="th w-28">Chiết khấu</th><th className="th w-28 text-right">Thành tiền</th><th className="th w-8"></th>
          </tr></thead>
          <tbody>
            {xeRows.map((r, i) => (
              <tr key={r.frame_number} className="hover:bg-[#F8FAFC]">
                <td data-label="STT" className="td text-center text-xs text-[#8A93A0]">{i + 1}</td>
                <td data-label="Tên hàng" className="td">
                  <div className="font-semibold text-[13px]">{r.ten}</div>
                  <div className="font-mono text-[10.5px] text-[#8A93A0]">SK {r.frame_number} · {r.location_code}
                    {r.giu_cho && <span className="ml-1 text-[#A25F00] font-bold">🔒 đang giữ cọc{r.coc_amount > 0 ? ` ${fmtVND(r.coc_amount)}` : ""}</span>}
                    {r.thieu_coc && <span className="ml-1 text-danger font-bold">⚠ chưa có giấy COC</span>}</div>
                </td>
                <td data-label="SL" className="td text-center">1</td>
                <td data-label="Đơn giá" className="td"><MoneyInput className="!py-1 !text-xs" value={r.unit_price} onChange={(v) => setXe(i, "unit_price", v)} /></td>
                <RowCK r={r} set={setXe} i={i} />
                <td className="td"><button className="text-danger font-bold px-1" onClick={() => setXeRows((p) => p.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}
            {kemRows.map((r, i) => (
              <tr key={"k" + i} className="hover:bg-[#F8FAFC] bg-[#FCFDFE]">
                <td data-label="STT" className="td text-center text-xs text-[#8A93A0]">{xeRows.length + i + 1}</td>
                <td data-label="Tên hàng" className="td">
                  <div className="flex gap-1.5">
                    <select className="inp !py-1 !text-xs !w-auto" value={r.item_type} onChange={(e) => {
                      const t = e.target.value;
                      setKem(i, "item_type", t);
                      if (t === "DANG_KY" && !r.name) {
                        setKem(i, "name", DM.DANG_KY[0].ten); setKem(i, "unit_price", DM.DANG_KY[0].gia);
                      }
                    }}>
                      {Object.entries(ITEM_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <ComboFree value={r.name} placeholder="Gõ tìm hoặc nhập tên…"
                      options={[
                        ...(DM[r.item_type] || []).map((x) => x.ten),
                        ...productList.filter(p => !r.name || p.name.toLowerCase().includes(r.name.toLowerCase())).map(p => p.name),
                      ].filter((v, i, a) => a.indexOf(v) === i)}
                      onChange={(v) => {
                        setKem(i, "name", v);
                        // Uu tien tim trong danh muc hang hoa
                        const prod = productList.find(p => p.name === v);
                        if (prod) {
                          setKemRows(rows => rows.map((x, j) => j === i ? { ...x, name: v, unit_price: prod.sale_price, product_id: prod.id } : x));
                          return;
                        }
                        // Fallback: tim trong DM settings
                        const hit = (DM[r.item_type] || []).find((x) => x.ten === v);
                        if (hit && hit.gia > 0) setKem(i, "unit_price", hit.gia);
                      }} />
                  </div>
                </td>
                <td data-label="SL" className="td"><input type="number" min="1" className="inp !py-1 !text-xs !w-14" value={r.qty} onChange={(e) => setKem(i, "qty", +e.target.value || 1)} /></td>
                <td data-label="Đơn giá" className="td"><MoneyInput className="!py-1 !text-xs" value={r.unit_price} onChange={(v) => setKem(i, "unit_price", v)} /></td>
                <RowCK r={r} set={setKem} i={i} />
                <td className="td"><button className="text-danger font-bold px-1" onClick={() => setKemRows((p) => p.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}
            {xeRows.length === 0 && kemRows.length === 0 && (
              <tr><td className="td text-center text-[#8A93A0] py-6" colSpan={7}>Chưa có hàng hóa — tìm số khung hoặc quét mã ở trên để thêm xe.</td></tr>
            )}
          </tbody>
        </table></div>
        <button className="btn-ghost !text-xs mt-2.5" onClick={() => setKemRows((p) => [...p, { item_type: "PHU_KIEN", name: "", qty: 1, unit_price: 0, discount_type: "amount", discount_value: 0 }])}>
          ⊕ Thêm phụ kiện / dịch vụ đăng ký
        </button>
      </div>

      {/* ===== HÀNG 3: GHI CHÚ + ẢNH | THANH TOÁN ===== */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="font-extrabold mb-2.5">Ghi chú & ảnh đính kèm</div>
          <Field label="Ghi chú đơn hàng">
            <textarea className="inp !h-20" value={meta.note} onChange={(e) => setMeta((p) => ({ ...p, note: e.target.value }))} placeholder="VD: khách hẹn lấy xe chiều mai" />
          </Field>
          {suaId && (
            <div className="mb-2.5">
              <label className="lbl">Lý do sửa đơn (ghi vào nhật ký)</label>
              <input className="inp" value={lyDo} onChange={(e) => setLyDo(e.target.value)} placeholder="VD: khách đổi màu xe, sales gõ nhầm giá" />
            </div>
          )}
          <div className="mt-2.5">
            <label className="lbl">📷 Ảnh xe / giấy tờ (không bắt buộc)</label>
            <div className="flex gap-2 flex-wrap items-center">
              <label className="btn-ghost !text-xs cursor-pointer">+ Chọn / chụp ảnh
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => {
                  const fs = Array.from(e.target.files || []); e.target.value = "";
                  fs.forEach((file) => { const rd = new FileReader(); rd.onload = () => setFotos((p) => [...p, { file, url: rd.result }]); rd.readAsDataURL(file); });
                }} />
              </label>
              {fotos.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 bg-[#F3F5F8] rounded-lg px-1.5 py-1 text-[11px]">
                  <img src={f.url} alt="" className="w-9 h-9 object-cover rounded" />
                  <button className="text-danger font-bold" onClick={() => setFotos((p) => p.filter((_, j) => j !== i))}>✕</button>
                </span>
              ))}
            </div>
          </div>
        </div>

        {(() => {
          const brandsXe = [...new Set(xeRows.map((r) => vehicles.find((v) => v.id === r.vehicle_id)?.brand).filter(Boolean))];
          const namesXe = [...new Set(xeRows.map((r) => vehicles.find((v) => v.id === r.vehicle_id)?.name).filter(Boolean))];
          const hopLe = promos.filter((p) =>
            brandsXe.some((b) => b.trim().toLowerCase() === p.brand.trim().toLowerCase()) &&
            (p.vehicle_names.length === 0 || p.vehicle_names.some((n) => namesXe.some((nx) => nx.trim().toLowerCase() === n.trim().toLowerCase()))) &&
            p.end_date >= iso(new Date()));
          const hopLeLoc = promoQ ? hopLe.filter((p) => `${p.code} ${p.name}`.toLowerCase().includes(promoQ.toLowerCase())) : hopLe;
          if (xeRows.length === 0) return null;
          return (
            <div className="card">
              <div className="font-extrabold mb-1">🏷 Chương trình khuyến mại áp dụng</div>
              <p className="text-[11.5px] text-[#8A93A0] mb-2">Chỉ để đánh dấu/nhận diện, không tính giảm giá. Chọn các chương trình khách hàng này tham gia.</p>
              {hopLe.length > 5 && (
                <input className="inp !w-72 mb-2" placeholder="Gõ tìm chương trình…" value={promoQ} onChange={(e) => setPromoQ(e.target.value)} />
              )}
              {hopLe.length === 0 && <div className="text-xs text-[#8A93A0]">Không có chương trình nào đang áp dụng cho (các) xe này.</div>}
              {hopLe.length > 0 && hopLeLoc.length === 0 && <div className="text-xs text-[#8A93A0]">Không có chương trình nào khớp tìm kiếm.</div>}
              <div className="flex flex-wrap gap-1.5">
                {hopLeLoc.map((p) => (
                  <label key={p.id} className={`text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer ${promoChon.includes(p.id) ? "bg-[#EAF2FF] border-brand text-brand font-semibold" : "border-[#E3E8EF]"}`}>
                    <input type="checkbox" className="hidden" checked={promoChon.includes(p.id)}
                      onChange={(e) => setPromoChon((cur) => e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id))} />
                    {p.name}
                  </label>
                ))}
              </div>
            </div>
          );
        })()}

        <div className="card">
          <div className="font-extrabold mb-2.5">{suaId ? "Thu thêm (nếu có)" : "Thanh toán"}</div>
          {pays.filter((p) => Number(p.amount) > 0).length === 1 && (
            <div className="mb-2.5 px-3 py-2 rounded-lg bg-[#FFF8E5] text-[#A25F00] text-[12.5px] flex items-center gap-1.5">
              ⚠️ Đang chọn đúng 1 phương thức duy nhất — kiểm tra kỹ nếu khách trả bằng nhiều hình thức khác nhau.
            </div>
          )}
          <div className="rounded-xl border border-[#E3E8EF] overflow-hidden mb-3">
            <div className="flex items-center justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF] text-[13.5px]">
              <span className="text-[#5A6572]">Tiền xe ({xeRows.length} xe)</span><span className="font-bold">{fmtVND(tongXe)}</span>
            </div>
            {tongKem > 0 && (
              <div className="flex items-center justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF] text-[13.5px]">
                <span className="text-[#5A6572]">Phụ kiện / dịch vụ</span><span className="font-bold">{fmtVND(tongKem)}</span>
              </div>
            )}
            <div className="flex items-center justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF] text-[13.5px]">
              <span className="text-[#5A6572]">Chiết khấu đơn hàng</span>
              <span className="flex gap-1 items-center">
                {dTong.type === "percent" ? (
                  <input type="number" className="inp !py-1 !text-xs !w-20" value={dTong.value || ""} placeholder="0"
                    onChange={(e) => setDTong((p) => ({ ...p, value: e.target.value }))} />
                ) : (
                  <MoneyInput className="!py-1 !text-xs !w-28" value={dTong.value || ""} placeholder="0"
                    onChange={(v) => setDTong((p) => ({ ...p, value: v }))} />
                )}
                <select className="inp !py-1 !text-xs !w-14" value={dTong.type} onChange={(e) => setDTong((p) => ({ ...p, type: e.target.value }))}>
                  <option value="amount">đ</option><option value="percent">%</option>
                </select>
                {ckTong > 0 && <b className="text-danger whitespace-nowrap">−{fmtVND(ckTong)}</b>}
              </span>
            </div>
            <div className="flex items-center justify-between px-3 py-2.5 bg-[#EAF2FF]">
              <span className="font-bold text-[13.5px]">Khách phải trả</span>
              <span className="text-[18px] font-extrabold text-brand">{fmtVND(phaiTra)}</span>
            </div>
            {tongCoc > 0 && (
              <div className="flex items-center justify-between px-3 py-2 bg-[#FDF6E3] border-t border-dashed border-[#E3E8EF] text-[13.5px]">
                <span className="text-[#A25F00] font-semibold">➖ Đã nhận cọc trước</span>
                <span className="font-bold text-[#A25F00]">−{fmtVND(tongCoc)}</span>
              </div>
            )}
          </div>

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
              <span className="text-[#5A6572]">Khách đã trả{tongCoc > 0 ? ` (gồm cọc ${fmtVND(tongCoc)})` : ""}</span><span className="font-bold text-[#0E7A4A]">{fmtVND(daTra)}</span>
            </div>
            <div className={`flex items-center justify-between px-3 py-2.5 ${conLai > 0 ? "bg-[#FFF6E5]" : "bg-[#E7F6EE]"}`}>
              <span className="font-bold text-[13.5px]">Còn phải trả</span>
              <span className={`text-[18px] font-extrabold ${conLai > 0 ? "text-[#A25F00]" : "text-[#0E7A4A]"}`}>{fmtVND(conLai)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ===== THANH HÀNH ĐỘNG DÍNH ĐÁY ===== */}
      <div className="fixed bottom-0 left-0 right-0 lg:left-[248px] bg-white border-t border-[#E6EAEF] px-4 py-3 flex items-center gap-3 z-30">
        <div className="text-[13px] hidden sm:block">
          <span className="text-[#8A93A0]">Khách phải trả:</span> <b className="text-brand text-[15px]">{fmtVND(phaiTra)}</b>
          {conLai > 0 && <span className="text-[#A25F00] ml-2">· còn {fmtVND(conLai)}</span>}
        </div>
        <div className="ml-auto flex gap-2">
          <Link href="/don-ban" className="btn-ghost">Thoát</Link>
          <button className="btn-ok !px-6" disabled={busy || xeRows.length === 0} onClick={suaId ? luuSua : luuDon}>
            {busy ? "Đang lưu…" : suaId ? "Lưu thay đổi" : `Tạo đơn hàng${xeRows.length > 1 ? ` (${xeRows.length} xe)` : ""}`}
          </button>
        </div>
      </div>

      {daoNguoc && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3" onClick={() => setDaoNguoc(null)}>
          <div className="bg-white rounded-2xl w-[480px] max-w-full p-4" onClick={(e) => e.stopPropagation()}>
            <div className="font-extrabold mb-1">🔄 Đảo ngược khoản thu</div>
            <div className="text-[12px] text-[#8A93A0] mb-3">
              Khoản cũ ({daoNguoc.method}, {fmtVND(daoNguoc.amount)}) sẽ được giữ nguyên để truy vết (đánh dấu đã đảo ngược),
              tự động hoàn lại đúng quỹ cũ, và tạo (các) khoản thu mới đúng bên dưới — có thể tách thành nhiều phương thức khác nhau.
            </div>
            <Field label="Lý do đảo ngược" required>
              <input className="inp" placeholder="VD: sales chọn nhầm phương thức, khách thực trả nhiều hình thức" value={daoNguoc.ly_do} onChange={(e) => setDaoNguoc((p) => ({ ...p, ly_do: e.target.value }))} />
            </Field>

            <div className="font-semibold text-[13px] mt-3 mb-1.5">Phương thức thanh toán mới (đúng thực tế)</div>
            <div className="flex flex-col gap-2">
              {daoNguoc.new_payments.map((p, i) => (
                <div key={i} className="flex gap-1.5 items-start">
                  <select className="inp !w-32" value={p.method} onChange={(e) => setDaoNguoc((cur) => ({ ...cur, new_payments: cur.new_payments.map((x, j) => j === i ? { ...x, method: e.target.value, finance_company: "" } : x) }))}>
                    {PTTT.map((m) => <option key={m}>{m}</option>)}
                  </select>
                  {p.method === "Trả góp" ? (
                    <select className="inp !flex-1" value={p.finance_company || ""} onChange={(e) => setDaoNguoc((cur) => ({ ...cur, new_payments: cur.new_payments.map((x, j) => j === i ? { ...x, finance_company: e.target.value } : x) }))}>
                      <option value="">— Chọn đơn vị trả góp —</option>
                      {(settings?.cong_ty_tra_gop || "Home Credit\nShinhanbank\nHD Saison\nFE Credit").split("\n").filter(Boolean).map((c) => <option key={c}>{c}</option>)}
                    </select>
                  ) : quyTypeOf(p.method) === "Ngân hàng" ? (
                    <select className="inp !flex-1" value={p.account_id || ""} onChange={(e) => setDaoNguoc((cur) => ({ ...cur, new_payments: cur.new_payments.map((x, j) => j === i ? { ...x, account_id: e.target.value } : x) }))}>
                      <option value="">— Chọn tài khoản —</option>
                      {banksHopLe.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  ) : <div className="flex-1" />}
                  <div className="!w-32"><MoneyInput value={p.amount} onChange={(v) => setDaoNguoc((cur) => ({ ...cur, new_payments: cur.new_payments.map((x, j) => j === i ? { ...x, amount: v } : x) }))} /></div>
                  {daoNguoc.new_payments.length > 1 && (
                    <button className="btn-ghost !px-2 !text-danger" onClick={() => setDaoNguoc((cur) => ({ ...cur, new_payments: cur.new_payments.filter((_, j) => j !== i) }))}>✕</button>
                  )}
                </div>
              ))}
            </div>
            <button className="btn-ghost !text-xs mt-2" onClick={() => setDaoNguoc((cur) => ({ ...cur, new_payments: [...cur.new_payments, { method: "Tiền mặt", amount: "", finance_company: "" }] }))}>⊕ Thêm phương thức</button>

            {(() => {
              const tongMoi = daoNguoc.new_payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
              const conThieu = daoNguoc.amount - tongMoi;
              if (conThieu <= 0) return null;
              return (
                <button className="btn-ghost !text-xs mt-1.5 ml-2" onClick={() => setDaoNguoc((cur) => ({ ...cur, new_payments: cur.new_payments.map((x, j) => j === cur.new_payments.length - 1 ? { ...x, amount: (Number(x.amount) || 0) + conThieu } : x) }))}>
                  Điền nốt {fmtVND(conThieu)} vào dòng cuối
                </button>
              );
            })()}

            {(() => {
              const tongMoi = daoNguoc.new_payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
              const lech = tongMoi - daoNguoc.amount;
              return (
                <div className={`mt-3 px-3 py-2 rounded-lg text-[12.5px] ${lech === 0 ? "bg-[#E5F6EE] text-[#0E7A4A]" : "bg-[#FFF8E5] text-[#A25F00]"}`}>
                  Tổng phương thức mới: <b>{fmtVND(tongMoi)}</b> {lech !== 0 && <>— chênh <b>{lech > 0 ? "+" : ""}{fmtVND(lech)}</b> so với khoản cũ ({fmtVND(daoNguoc.amount)})</>}
                </div>
              );
            })()}

            <div className="flex gap-2 mt-3">
              <button className="btn-ghost !text-xs flex-1" onClick={() => setDaoNguoc(null)}>Hủy</button>
              <button className="btn-ok !text-xs flex-1" disabled={busy} onClick={luuDaoNguoc}>Xác nhận đảo ngược</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TaoDon() {
  return <Suspense fallback={<div className="card">Đang tải…</div>}><TaoDonInner /></Suspense>;
}