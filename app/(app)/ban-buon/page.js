"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, Field, MoneyInput, VehicleSearch, LocSearch, SearchPicker, MultiCheck, Pager, pageSlice, pageClamp, useSortable, Th, LocGon } from "@/components/ui";
import { QuickDates, AmountFilter, SavedFilters, TongLoc, trongKhoang } from "@/components/FinFilters";
import BankOptions from "@/components/BankOptions";
import { usePerms } from "@/lib/usePerms";
import { fmtVND, fmtDate, fmtTime, errMsg, downloadXLSX } from "@/lib/format";

const TT_TONE = { "Chờ giao": "amber", "Đang giao": "blue", "Đã giao đủ": "green", "Đã hủy": "dark" };
const homNay = () => new Date().toLocaleDateString("sv-SE");
const coGiaFix = (l) => l.gia_ban !== "" && l.gia_ban !== null && l.gia_ban !== undefined;
const donGia = (l) => (coGiaFix(l) ? Number(l.gia_ban) || 0 : (Number(l.gia_niem_yet) || 0) - Math.round((Number(l.gia_niem_yet) || 0) * (Number(l.ck_pct) || 0) / 100));
const tienDong = (l) => (Number(l.qty) || 0) * donGia(l);
// tong tien 1 don xe (giong _tong_don tren server, khong tinh hang kem)
const tongDonXe = (o) => { const g = (Number(o.sale_price) || 0) * (Number(o.quantity) || 1); const ck = o.vehicle_discount_type === "percent" ? Math.round(g * (Number(o.vehicle_discount_value) || 0) / 100) : Number(o.vehicle_discount_value) || 0; return Math.max(g - ck - (Number(o.discount_amount) || 0) - (Number(o.kb_dieu_chinh) || 0), 0); };

function BanBuonInner() {
  const { supabase, vehicles, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const sp = useSearchParams();
  const router = useRouter();
  const [ds, setDs] = useState([]);
  const [khs, setKhs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [fTT, setFTT] = useState([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fKh, setFKh] = useState([]);
  const [fLoc, setFLoc] = useState([]);
  const [fNv, setFNv] = useState([]);
  const [fTra, setFTra] = useState("");
  const [aMin, setAMin] = useState("");
  const [aMax, setAMax] = useState("");
  const [showHuy, setShowHuy] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [xeLo, setXeLo] = useState({}); // don_buon_id -> "so khung, ma don" de tim kiem
  const sort = useSortable();
  const [form, setForm] = useState(null); // tao / sua lo
  const [lo, setLo] = useState(null);     // chi tiet lo
  const [quet, setQuet] = useState("");   // o quet/go so khung khi giao
  const [quetMsg, setQuetMsg] = useState(null);
  const [timDong, setTimDong] = useState({}); // loc so khung theo tung dong
  const [banks, setBanks] = useState([]);
  const can = usePerms(supabase, profile);
  const admin = can("bb_sua_ck"); // duoc sua % CK si tren lo

  const loadDs = async () => {
    const [{ data }, { data: os }] = await Promise.all([
      supabase.from("v_don_buon").select("*").order("ngay_chot", { ascending: false }).order("id", { ascending: false }).limit(2000),
      supabase.from("sales_orders").select("code,frame_number,don_buon_id,end_customer_name").not("don_buon_id", "is", null).limit(10000),
    ]);
    const m = {};
    (os || []).forEach((o) => { m[o.don_buon_id] = `${m[o.don_buon_id] || ""} ${o.code} ${o.frame_number || ""} ${o.end_customer_name || ""}`; });
    setDs(data || []); setXeLo(m);
  };
  useEffect(() => {
    if (loading || !profile) return;
    loadDs();
    supabase.from("customers").select("id,code,name,phone,customer_type").eq("customer_type", "Khách buôn").order("name").limit(2000).then(({ data }) => setKhs(data || []));
    supabase.rpc("fn_tai_khoan_chon").then((r) => setBanks((r.data || []).filter((a) => a.status === "Hoạt động" && a.type === "Ngân hàng")));
  }, [loading, profile]);
  useEffect(() => { const id = sp.get("id"); if (id && profile) moLo(Number(id), sp.get("thu") === "1"); }, [sp, profile]);

  const moThu = (H) => { setLo((L) => ({ ...L, pay: { method: "Chuyển khoản", account_id: "", amount: H.con_phai_tra > 0 ? H.con_phai_tra : "", note: "" } })); setTimeout(() => document.getElementById("bb-thanh-toan")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); };
  const moLo = async (id, thu = false) => {
    const [{ data: h }, { data: dg }, { data: tt }, { data: os }] = await Promise.all([
      supabase.from("v_don_buon").select("*").eq("id", id).single(),
      supabase.from("don_buon_dong").select("*").eq("don_id", id).order("id"),
      supabase.from("don_buon_thanh_toan").select("*").eq("don_id", id).order("id"),
      supabase.from("sales_orders").select("id,code,sale_date,vehicle_id,frame_number,location_code,status,paid_amount,sale_price,quantity,vehicle_discount_type,vehicle_discount_value,discount_amount,kb_dieu_chinh,don_buon_dong_id,end_customer_name").eq("don_buon_id", id).order("id"),
    ]);
    if (!h) return notify("Không tìm thấy đơn bán buôn.", "err");
    const vids = [...new Set((dg || []).map((d) => d.vehicle_id))];
    let ton = [];
    if (vids.length) { const r = await supabase.from("vehicle_units").select("frame_number,vehicle_id,location_code,imported_at").in("vehicle_id", vids).eq("status", "TON_KHO").order("imported_at").limit(2000); ton = r.data || []; }
    const { data: sd } = await supabase.rpc("fn_kb_so_du", { p_customer: h.customer_id });
    let kbDon = [];
    if ((os || []).length) { const r = await supabase.from("kb_so_cai").select("id,loai,so_tien,sale_code,note,huy").in("sale_code", os.map((o) => o.code)).eq("huy", false); kbDon = r.data || []; }
    setLo({ h, dong: dg || [], tt: tt || [], orders: os || [], ton, kb: sd || null, kbDon, chon: {}, giaoLoc: h.location_code || "", giaoNgay: homNay(), pay: thu && h.status !== "Đã hủy" ? { method: "Chuyển khoản", account_id: "", amount: h.con_phai_tra > 0 ? h.con_phai_tra : "", note: "" } : null, ct: null });
    if (thu) setTimeout(() => document.getElementById("bb-thanh-toan")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
  };

  if (loading || !profile) return <div className="card">Đang tải…</div>;
  if (!["CEO", "ADMIN", "MANAGER", "SALES"].includes(profile.role)) return <div className="card">Bạn không có quyền xem trang này.</div>;

  const vName = (id) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.brand} ${v.name} ${v.color}` : id; };
  const locName = (c) => locations.find((l) => l.code === c)?.name || c || "—";

  // ===== tao / sua lo =====
  const moTao = () => setForm({ id: null, customer_id: "", location_code: profile.store_code || "", ngay_chot: homNay(), note: "", lines: [{ vehicle_id: "", qty: 1, gia_niem_yet: 0, ck_pct: "", gia_ban: "", note: "" }] });
  const setLine = async (i, k, v) => {
    setForm((f) => ({ ...f, lines: f.lines.map((l, j) => j === i ? { ...l, [k]: v } : l) }));
    if (k === "vehicle_id" && v) {
      const xe = vehicles.find((x) => x.id === v);
      let pct = "";
      if (form.customer_id) { const { data } = await supabase.rpc("fn_ck_si_tra", { p_customer: Number(form.customer_id), p_vehicle_id: v, p_ngay: form.ngay_chot || null }); if (data !== null && data !== undefined) pct = Number(data); }
      setForm((f) => ({ ...f, lines: f.lines.map((l, j) => j === i ? { ...l, gia_niem_yet: xe?.list_price || 0, ck_pct: pct } : l) }));
    }
  };
  const apCkTatCa = async (custId, ngay) => {
    if (!custId) return;
    const lines = await Promise.all(form.lines.map(async (l) => {
      if (!l.vehicle_id) return l;
      const { data } = await supabase.rpc("fn_ck_si_tra", { p_customer: Number(custId), p_vehicle_id: l.vehicle_id, p_ngay: ngay || null });
      return { ...l, ck_pct: data !== null && data !== undefined ? Number(data) : "" };
    }));
    setForm((f) => ({ ...f, lines }));
  };
  const luuLo = async () => {
    if (!form.customer_id) return notify("Chọn khách buôn.", "err");
    const lines = form.lines.filter((l) => l.vehicle_id && Number(l.qty) > 0);
    if (!lines.length) return notify("Thêm ít nhất một dòng xe.", "err");
    const thieuCk = lines.filter((l) => (l.ck_pct === "" || l.ck_pct === null) && !coGiaFix(l));
    if (thieuCk.length && !admin) return notify(`Chưa có CK sỉ cho: ${thieuCk.map((l) => vName(l.vehicle_id)).join(", ")}. Nhờ người có quyền thêm ở Khách buôn › Bảng chiết khấu sỉ, hoặc người có quyền “Sửa % CK sỉ trên đơn bán buôn” nhập trực tiếp.`, "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_lo_luu", { p: { id: form.id, customer_id: Number(form.customer_id), location_code: form.location_code, ngay_chot: form.ngay_chot, note: form.note,
      lines: lines.map((l) => ({ id: l.id || null, vehicle_id: l.vehicle_id, qty: Number(l.qty), ck_pct: admin && l.ck_pct !== "" ? Number(l.ck_pct) : null, gia_ban: admin && coGiaFix(l) ? Number(l.gia_ban) : null, note: l.note || "" })) } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã lưu đơn bán buôn ${data.code}.`); setForm(null); loadDs(); moLo(data.id); router.replace(`/ban-buon?id=${data.id}`);
  };

  // ===== chi tiet: thu tien / can tru / giao xe =====
  const reload = () => { moLo(lo.h.id); loadDs(); };
  const thuTien = async () => {
    const p = lo.pay;
    if (!(Number(p.amount) > 0)) return notify("Nhập số tiền.", "err");
    if (p.method === "Chuyển khoản" && !p.account_id) return notify("Chọn tài khoản nhận tiền.", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_lo_thu_tien", { p: { don_id: lo.h.id, method: p.method, account_id: p.account_id || null, amount: Number(p.amount), note: p.note || "" } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã thu ${fmtVND(p.amount)} (${data.phieu_thu}).${data.phan_bo ? ` Đã phân bổ ${fmtVND(data.phan_bo)} xuống các đơn xe.` : ""}`); reload();
  };
  const canTru = async () => {
    const n = Number(lo.ct.amount) || 0;
    if (n <= 0) return notify("Nhập số tiền cấn trừ.", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_lo_can_tru", { p_id: lo.h.id, p_amount: n, p_note: lo.ct.note || "" });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã cấn trừ ${fmtVND(n)} vào đơn bán buôn.`); reload();
  };
  const daoNguoc = async (t) => {
    const ly = prompt(`Đảo ngược khoản ${t.loai === "CAN_TRU" ? "cấn trừ" : "thu"} ${fmtVND(t.amount)}? Nhập lý do:`);
    if (!ly) return;
    const { error } = await supabase.rpc("fn_lo_dao_nguoc_tt", { p_tt_id: t.id, p_ly_do: ly });
    if (error) return notify(errMsg(error), "err");
    notify("Đã đảo ngược."); reload();
  };
  const giaoXe = async () => {
    const xe = Object.entries(lo.chon).flatMap(([dongId, frames]) => frames.map((f) => ({ dong_id: Number(dongId), frame_number: f })));
    if (!xe.length) return notify("Chọn số khung cần giao.", "err");
    if (!confirm(`Giao ${xe.length} xe và tạo ${xe.length} đơn bán cho ${lo.h.customer_name}?`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_lo_giao_xe", { p: { don_id: lo.h.id, location_code: lo.giaoLoc || null, sale_date: lo.giaoNgay, xe } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã tạo ${data.so_xe} đơn bán.${data.phan_bo ? ` Phân bổ ${fmtVND(data.phan_bo)} tiền đã trả trước.` : ""}`); reload();
  };
  const huyLo = async () => {
    const ly = prompt("Hủy đơn bán buôn này? Nhập lý do:");
    if (!ly) return;
    const { error } = await supabase.rpc("fn_lo_huy", { p_id: lo.h.id, p_ly_do: ly });
    if (error) return notify(errMsg(error), "err");
    notify("Đã hủy đơn bán buôn."); reload();
  };
  // Quet / go so khung: tu gan vao dong dung model con thieu
  const quetSoKhung = (raw, daGiaoFn) => {
    const fn = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!fn) return;
    let u = lo.ton.find((x) => x.frame_number.toUpperCase() === fn);
    if (!u) { const m = lo.ton.filter((x) => x.frame_number.toUpperCase().endsWith(fn)); if (m.length === 1) u = m[0]; else if (m.length > 1) return setQuetMsg({ err: true, t: `“${fn}” khớp ${m.length} số khung — gõ thêm ký tự.` }); }
    if (!u) return setQuetMsg({ err: true, t: `Không thấy số khung “${fn}” trong kho (chưa nhập kho, đã bán hoặc đang chuyển).` });
    if (Object.values(lo.chon).some((a) => a.includes(u.frame_number))) return setQuetMsg({ err: true, t: `${u.frame_number} đã được chọn rồi.` });
    const dong = lo.dong.find((d) => d.vehicle_id === u.vehicle_id && d.qty - daGiaoFn(d.id) - (lo.chon[d.id] || []).length > 0);
    if (!dong) {
      const coModel = lo.dong.some((d) => d.vehicle_id === u.vehicle_id);
      return setQuetMsg({ err: true, t: coModel ? `${u.frame_number} (${vName(u.vehicle_id)}) — dòng xe này đã chọn đủ số lượng.` : `${u.frame_number} là ${vName(u.vehicle_id)} — không có trong đơn bán buôn này.` });
    }
    setLo((L) => ({ ...L, chon: { ...L.chon, [dong.id]: [...(L.chon[dong.id] || []), u.frame_number] } }));
    setQuetMsg({ err: false, t: `✓ ${u.frame_number} → ${vName(u.vehicle_id)} · ${locName(u.location_code)}` });
    setQuet("");
  };
  const toggleXe = (dongId, frame, max) => setLo((L) => {
    const cur = L.chon[dongId] || [];
    const next = cur.includes(frame) ? cur.filter((x) => x !== frame) : cur.length >= max ? cur : [...cur, frame];
    return { ...L, chon: { ...L.chon, [dongId]: next } };
  });

  const kw = q.trim().toLowerCase();
  const dsLoc = ds.filter((d) => {
    if (!showHuy && d.trang_thai === "Đã hủy" && !fTT.includes("Đã hủy")) return false;
    if (from && d.ngay_chot < from) return false;
    if (to && d.ngay_chot > to) return false;
    if (fTT.length && !fTT.includes(d.trang_thai)) return false;
    if (fKh.length && !fKh.includes(String(d.customer_id))) return false;
    if (fLoc.length && !fLoc.includes(d.location_code || "")) return false;
    if (fNv.length && !fNv.includes(d.created_by_name || "")) return false;
    if (fTra === "con_no" && !(d.con_phai_tra > 0)) return false;
    if (fTra === "du" && d.con_phai_tra > 0) return false;
    if (fTra === "chua_tra" && d.da_tra > 0) return false;
    if (!trongKhoang(d.con_phai_tra, aMin, aMax) && (aMin || aMax)) return false;
    if (kw && !`${d.code} ${d.customer_name} ${d.customer_code} ${d.customer_phone || ""} ${d.note || ""} ${xeLo[d.id] || ""}`.toLowerCase().includes(kw)) return false;
    return true;
  });
  const dsSort = sort.sortFn(dsLoc, { code: (d) => d.code, ngay: (d) => d.ngay_chot, kh: (d) => d.customer_name, sl: (d) => d.sl_dat, pt: (d) => Number(d.phai_tra), dt: (d) => Number(d.da_tra), con: (d) => Number(d.con_phai_tra), tt: (d) => d.trang_thai });
  const curPage = pageClamp(page, dsSort.length, pageSize);
  const nHuy = ds.filter((d) => d.trang_thai === "Đã hủy").length;
  const dsActive = dsLoc.filter((d) => d.trang_thai !== "Đã hủy");
  const resetPage = () => setPage(1);
  const xuatExcel = () => downloadXLSX(`don_ban_buon_${from || "dau"}_den_${to || "nay"}.xlsx`, [
    ["Mã đơn", "Ngày chốt", "Khách buôn", "Mã KH", "Cửa hàng", "SL đặt", "SL giao", "Phải trả", "Đã trả", "Còn phải trả", "Trạng thái", "Người tạo", "Ghi chú"],
    ...dsSort.map((d) => [d.code, d.ngay_chot, d.customer_name, d.customer_code, locName(d.location_code), d.sl_dat, d.sl_giao, Number(d.phai_tra), Number(d.da_tra), Number(d.con_phai_tra), d.trang_thai, d.created_by_name, d.note || ""]),
  ], "Don ban buon");
  const tongForm = form ? form.lines.reduce((s, l) => s + tienDong(l), 0) : 0;

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Toast toast={toast} />

      {!form && !lo && (
        <>
          <div className="flex gap-3 flex-wrap">
            <KPI label="Số đơn (theo bộ lọc)" value={dsActive.length} sub={`${dsActive.filter((d) => ["Chờ giao", "Đang giao"].includes(d.trang_thai)).length} đơn đang mở`} />
            <KPI label="Xe chờ giao" value={dsActive.reduce((s, d) => s + (d.sl_dat - d.sl_giao), 0)} tone="amber" sub={`đã giao ${dsActive.reduce((s, d) => s + d.sl_giao, 0)}/${dsActive.reduce((s, d) => s + d.sl_dat, 0)} xe`} />
            <KPI label="Doanh số bán buôn" value={fmtVND(dsActive.reduce((s, d) => s + Number(d.phai_tra), 0))} tone="blue" />
            <KPI label="Khách buôn còn phải trả" value={fmtVND(dsActive.reduce((s, d) => s + Number(d.con_phai_tra), 0))} tone="red" />
          </div>
          <div className="card">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <div className="font-extrabold mr-auto">Đơn bán buôn ({dsSort.length})</div>
              <button className="btn-ghost !text-xs" onClick={xuatExcel}>⬇ Excel</button>
              <button className="btn-primary !text-xs" onClick={moTao}>+ Tạo đơn bán buôn</button>
            </div>
            <div className="flex gap-2 flex-wrap items-center mb-2">
              <QuickDates from={from} to={to} setFrom={setFrom} setTo={setTo} onChange={resetPage} />
              <input type="date" className="inp !w-auto !py-1.5 !text-xs" value={from} onChange={(e) => { setFrom(e.target.value); resetPage(); }} />
              <input type="date" className="inp !w-auto !py-1.5 !text-xs" value={to} onChange={(e) => { setTo(e.target.value); resetPage(); }} />
              {(from || to) && <button className="btn-ghost !text-xs !py-1" onClick={() => { setFrom(""); setTo(""); resetPage(); }}>Mọi ngày</button>}
            </div>
            <div className="flex gap-2 flex-wrap items-center mb-3">
              <LocGon n={(fKh.length ? 1 : 0) + (fLoc.length ? 1 : 0) + (fTT.length ? 1 : 0) + (fTra ? 1 : 0) + (fNv.length ? 1 : 0) + (aMin || aMax ? 1 : 0) + (showHuy ? 1 : 0)}>
              <MultiCheck label="Khách buôn: tất cả" value={fKh} onChange={(v) => { setFKh(v); resetPage(); }}
                options={[...new Map(ds.map((d) => [String(d.customer_id), { key: String(d.customer_id), label: d.customer_name }])).values()].sort((a, b) => a.label.localeCompare(b.label))} />
              <MultiCheck label="Cửa hàng: tất cả" value={fLoc} onChange={(v) => { setFLoc(v); resetPage(); }}
                options={[...new Set(ds.map((d) => d.location_code || ""))].map((c) => ({ key: c, label: c ? locName(c) : "(chưa chọn)" }))} />
              <MultiCheck label="Trạng thái: tất cả" value={fTT} onChange={(v) => { setFTT(v); resetPage(); }} width="w-52"
                options={Object.keys(TT_TONE).map((k) => ({ key: k, label: k }))} />
              <select className="inp !w-auto" value={fTra} onChange={(e) => { setFTra(e.target.value); resetPage(); }}>
                <option value="">Thanh toán: tất cả</option><option value="con_no">Còn phải trả</option><option value="chua_tra">Chưa trả đồng nào</option><option value="du">Đã trả đủ</option>
              </select>
              <MultiCheck label="Người tạo: tất cả" value={fNv} onChange={(v) => { setFNv(v); resetPage(); }} width="w-52"
                options={[...new Set(ds.map((d) => d.created_by_name || ""))].filter(Boolean).sort().map((n) => ({ key: n, label: n }))} />
              <AmountFilter min={aMin} max={aMax} setMin={setAMin} setMax={setAMax} onChange={resetPage} />
              <button className={`btn-ghost !text-xs ${showHuy ? "!bg-[#FDEDED] !text-danger" : ""}`} onClick={() => { setShowHuy(!showHuy); resetPage(); }}>{showHuy ? "Đang hiện đơn hủy" : `Lô hủy${nHuy ? ` (${nHuy})` : ""}`}</button>
              </LocGon>
              <input className="inp !w-64 max-md:!w-full max-md:order-first" placeholder="Tìm mã đơn, khách, SĐT, số khung, mã đơn xe, khách lẻ cuối…" value={q} onChange={(e) => { setQ(e.target.value); resetPage(); }} />
              <SavedFilters k="ban-buon" state={{ fKh, fLoc, fTT, fTra, fNv }} apply={(x) => { setFKh(x.fKh || []); setFLoc(x.fLoc || []); setFTT(x.fTT || []); setFTra(x.fTra || ""); setFNv(x.fNv || []); }} />
            </div>
            <div className="text-[11px] text-[#8A93A0] -mt-1 mb-2">Ô số tiền lọc theo <b>Còn phải trả</b>.</div>
            <TongLoc>
              <span>{dsActive.length} đơn · {dsActive.reduce((s, d) => s + d.sl_dat, 0)} xe</span>
              <span>Phải trả: <b>{fmtVND(dsActive.reduce((s, d) => s + Number(d.phai_tra), 0))}</b></span>
              <span>Đã trả: <b className="text-[#0E7A4A]">{fmtVND(dsActive.reduce((s, d) => s + Number(d.da_tra), 0))}</b></span>
              <span>Còn: <b className="text-danger">{fmtVND(dsActive.reduce((s, d) => s + Number(d.con_phai_tra), 0))}</b></span>
            </TongLoc>
            <div className="overflow-x-auto"><table className="w-full text-[13px] tbl-card">
              <thead><tr className="text-left text-[11.5px] text-[#8A93A0] uppercase border-b border-[#E3E8EF]">
                <Th label="Mã đơn" k="code" sort={sort} /><Th label="Ngày chốt" k="ngay" sort={sort} /><Th label="Khách buôn" k="kh" sort={sort} /><th className="th">Cửa hàng</th>
                <Th label="Đặt / giao" k="sl" sort={sort} className="text-right" /><Th label="Phải trả" k="pt" sort={sort} className="text-right" /><Th label="Đã trả" k="dt" sort={sort} className="text-right" />
                <Th label="Còn" k="con" sort={sort} className="text-right" /><Th label="Trạng thái" k="tt" sort={sort} /><th className="th">Người tạo</th><th className="th"></th>
              </tr></thead>
              <tbody>{pageSlice(dsSort, curPage, pageSize).map((d) => (
                <tr key={d.id} className={`border-b border-dashed border-[#F0F2F5] cursor-pointer hover:bg-[#F8FAFC] ${d.trang_thai === "Đã hủy" ? "opacity-50" : ""}`} onClick={() => { moLo(d.id); router.replace(`/ban-buon?id=${d.id}`); }}>
                  <td data-label="Mã đơn" data-m="title" className="py-2 font-bold text-brand">{d.code}</td><td data-label="Ngày chốt" data-m="nolabel">{fmtDate(d.ngay_chot)}</td><td data-label="Khách buôn" data-m="nolabel full"><span className="max-md:font-semibold">{d.customer_name}</span><div className="text-[11px] text-[#8A93A0]">{d.customer_code}</div></td>
                  <td data-label="Cửa hàng" data-m="nolabel" className="text-[12px]">{locName(d.location_code)}</td>
                  <td data-label="Giao/đặt" className="text-right">{d.sl_giao}/{d.sl_dat}</td><td data-label="Phải trả" data-m="end" className="text-right">{fmtVND(d.phai_tra)}</td><td data-label="Đã trả" className="text-right">{fmtVND(d.da_tra)}</td>
                  <td data-label="Còn" className={`text-right font-bold ${d.con_phai_tra > 0 ? "text-danger" : ""}`}>{d.con_phai_tra > 0 ? fmtVND(d.con_phai_tra) : "—"}</td>
                  <td data-label="Trạng thái" data-m="nolabel"><Badge tone={TT_TONE[d.trang_thai]}>{d.trang_thai}</Badge></td>
                  <td data-label="Người tạo" data-m="hide" className="text-[12px] text-[#5A6572]">{d.created_by_name}</td>
                  <td data-m="actions">{d.trang_thai !== "Đã hủy" && d.con_phai_tra > 0 && <button className="btn-ok !px-2 !py-1 !text-xs whitespace-nowrap" onClick={(e) => { e.stopPropagation(); router.replace(`/ban-buon?id=${d.id}&thu=1`); }}>💵 Thu tiền</button>}</td>
                </tr>
              ))}
              {dsSort.length === 0 && <tr><td colSpan={11} className="py-3 text-[#8A93A0]">Không có đơn nào theo bộ lọc.</td></tr>}</tbody>
            </table></div>
            <Pager total={dsSort.length} page={curPage} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
          </div>
        </>
      )}

      {form && (
        <>
          <div className="flex items-center gap-2"><button className="btn-ghost !text-xs" onClick={() => setForm(null)}>← Quay lại</button><div className="font-extrabold text-lg">{form.id ? "Sửa đơn bán buôn" : "Tạo đơn bán buôn (chốt đơn, chưa có số khung)"}</div></div>
          <div className="card">
            <div className="grid gap-x-3 md:grid-cols-4 sm:grid-cols-2">
              <Field label="Khách buôn" required>
                <SearchPicker items={khs} value={form.customer_id} getKey={(c) => c.id} getLabel={(c) => `${c.name} · ${c.phone || ""} (${c.code})`} placeholder="Gõ tên khách buôn…"
                  onChange={(v) => { setForm((f) => ({ ...f, customer_id: v || "" })); apCkTatCa(v, form.ngay_chot); }} />
              </Field>
              <Field label="Cửa hàng phụ trách (quỹ tiền mặt)"><LocSearch locations={locations} value={form.location_code} onChange={(v) => setForm((f) => ({ ...f, location_code: v || "" }))} /></Field>
              <Field label="Ngày chốt"><input type="date" className="inp" value={form.ngay_chot} onChange={(e) => { setForm((f) => ({ ...f, ngay_chot: e.target.value })); apCkTatCa(form.customer_id, e.target.value); }} /></Field>
              <Field label="Ghi chú"><input className="inp" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></Field>
            </div>
            {khs.length === 0 && <div className="text-[12px] text-[#A25F00]">Chưa có khách hàng loại “Khách buôn” trong danh mục.</div>}
          </div>
          <div className="card">
            <div className="font-extrabold mb-2">Xe đặt (model + màu, chưa chọn số khung)</div>
            <div className="flex flex-col gap-2">
              {form.lines.map((l, i) => (
                <div key={i} className="grid gap-2 md:grid-cols-[2fr_70px_130px_90px_160px_140px_32px] items-end border-b border-dashed border-[#F0F2F5] pb-2">
                  <div><label className="lbl">Model + màu</label><VehicleSearch vehicles={vehicles} value={l.vehicle_id} onChange={(v) => setLine(i, "vehicle_id", v || "")} /></div>
                  <div><label className="lbl">SL</label><input type="number" min="1" className="inp" value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value)} /></div>
                  <div><label className="lbl">Giá niêm yết (kèm pin)</label><div className="inp bg-[#F8FAFC]">{fmtVND(l.gia_niem_yet)}</div></div>
                  <div><label className="lbl">CK sỉ %</label>{admin
                    ? <input type="number" step="0.1" className="inp" value={l.ck_pct} placeholder="—" onChange={(e) => setLine(i, "ck_pct", e.target.value)} />
                    : <div className={`inp ${l.ck_pct === "" && !coGiaFix(l) ? "text-danger" : "bg-[#F8FAFC]"}`}>{coGiaFix(l) ? "—" : l.ck_pct === "" ? "chưa có" : `${l.ck_pct}%`}</div>}</div>
                  <div><label className="lbl" title="Nhập giá bán buôn cố định cho mỗi xe — bỏ qua % CK sỉ">Giá bán buôn/xe (nhập tay)</label>{admin
                    ? <MoneyInput className={coGiaFix(l) ? "!border-brand" : ""} value={l.gia_ban} placeholder="theo % CK" onChange={(v) => setLine(i, "gia_ban", v === null || v === undefined ? "" : v)} />
                    : <div className="inp bg-[#F8FAFC]">{coGiaFix(l) ? fmtVND(l.gia_ban) : "theo % CK"}</div>}</div>
                  <div><label className="lbl">Thành tiền</label><div className="inp bg-[#F8FAFC] font-bold">{fmtVND(tienDong(l))}</div></div>
                  <button className="btn-ghost !px-2 !py-2 !text-xs !text-danger" onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))}>✕</button>
                </div>
              ))}
            </div>
            <button className="btn-ghost !text-xs mt-2" onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, { vehicle_id: "", qty: 1, gia_niem_yet: 0, ck_pct: "", gia_ban: "", note: "" }] }))}>⊕ Thêm dòng xe</button>
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <div className="mr-auto text-[13px]">Tổng {form.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0)} xe · <b className="text-brand text-[15px]">Khách buôn cần trả {fmtVND(tongForm)}</b></div>
              <button className="btn-primary" disabled={busy} onClick={luuLo}>{busy ? "Đang lưu…" : "Lưu đơn"}</button>
            </div>
            <div className="text-[11.5px] text-[#8A93A0] mt-1">CK sỉ tự lấy từ Bảng chiết khấu sỉ (Khách buôn › Bảng chiết khấu sỉ) theo khách, model và ngày chốt. Nhập “Giá bán buôn/xe” để bán theo giá cố định (VD xe TAILG) — khi có giá này thì không tính % CK; xóa trống để quay lại tính theo %.{admin ? " Bạn được quyền sửa % và giá trực tiếp trên đơn." : " Cần quyền “Sửa % CK sỉ trên đơn bán buôn” để sửa % / giá trực tiếp."}</div>
          </div>
        </>
      )}

      {lo && !form && (() => {
        const h = lo.h; const huy = h.status === "Đã hủy";
        const daGiao = (dongId) => lo.orders.filter((o) => o.don_buon_dong_id === dongId && !["Đã hủy", "Đã trả hàng"].includes(o.status)).length;
        const soChon = Object.values(lo.chon).reduce((s, a) => s + a.length, 0);
        return (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <button className="btn-ghost !text-xs" onClick={() => { setLo(null); router.replace("/ban-buon"); }}>← Danh sách đơn bán buôn</button>
              <span className="text-xl font-extrabold">{h.code}</span><Badge tone={TT_TONE[h.trang_thai]}>{h.trang_thai}</Badge>
              <span className="text-[13px] text-[#5A6572]">{h.customer_name} · chốt {fmtDate(h.ngay_chot)} · {h.created_by_name}</span>
              <div className="ml-auto flex gap-2">
                {!huy && h.con_phai_tra > 0 && <button className="btn-ok !text-xs" onClick={() => moThu(h)}>💵 Thu tiền ({fmtVND(h.con_phai_tra)})</button>}
                <Link className="btn-ghost !text-xs" href={`/khach-buon?kh=${h.customer_id}`}>Sổ khách buôn</Link>
                {!huy && <button className="btn-ghost !text-xs" onClick={() => setForm({ id: h.id, customer_id: h.customer_id, location_code: h.location_code || "", ngay_chot: h.ngay_chot, note: h.note, lines: lo.dong.map((d) => ({ ...d, gia_ban: d.gia_ban ?? "" })) })}>✎ Sửa đơn</button>}
                {!huy && lo.orders.length === 0 && <button className="btn-ghost !text-xs !text-danger" onClick={huyLo}>Hủy đơn</button>}
              </div>
            </div>
            {huy && <div className="rounded-lg bg-[#F3F5F8] px-3 py-2 text-[13px]">Đơn bán buôn đã hủy: {h.huy_ly_do}</div>}
            <div className="flex gap-3 flex-wrap">
              <KPI label="Khách buôn cần trả" value={fmtVND(h.phai_tra)} sub={`${h.sl_dat} xe · đã giao ${h.sl_giao}`} />
              <KPI label="Đã trả (tiền + cấn trừ)" value={fmtVND(h.da_tra)} tone="green" sub={Number(h.da_tra) > Number(h.phai_tra) ? `trả dư ${fmtVND(h.da_tra - h.phai_tra)} — xem giải thích bên dưới` : undefined} />
              <KPI label="Còn phải trả" value={fmtVND(h.con_phai_tra)} tone={h.con_phai_tra > 0 ? "red" : "green"} />
              <KPI label="Tiền chưa phân bổ cho xe" value={fmtVND(h.so_du_chua_phan_bo)} tone="blue" sub="Tự phân bổ khi giao xe" />
            </div>

            {(() => {
              const du = Number(h.da_tra) - Number(h.phai_tra);
              const chuaPb = Number(h.so_du_chua_phan_bo) || 0;
              if (du <= 0 && chuaPb <= 0) return null;
              const active = lo.orders.filter((o) => !["Đã hủy", "Đã trả hàng"].includes(o.status));
              const duDon = active.map((o) => ({ o, tong: tongDonXe(o), paid: Number(o.paid_amount) || 0 })).filter((x) => x.paid > x.tong);
              return (
                <div className="rounded-xl border border-[#F2D7A6] bg-[#FFF8EB] px-3 py-2.5 text-[13px]">
                  <div className="font-bold text-[#A25F00] mb-1">ⓘ Vì sao “Đã trả” khác “Khách buôn cần trả”?</div>
                  <ul className="list-disc ml-5 flex flex-col gap-0.5">
                    {chuaPb > 0 && <li><b>{fmtVND(chuaPb)}</b> đã thu ở đơn bán buôn nhưng <b>chưa chia xuống đơn xe</b> (xe chưa giao) — sẽ tự chia khi bấm giao xe.</li>}
                    {du > 0 && duDon.map(({ o, tong, paid }) => {
                      const ghi = (lo.kbDon || []).filter((k) => k.sale_code === o.code && k.loai === "DIEU_CHINH_TAY" && Number(k.so_tien) > 0);
                      return (<li key={o.id}>Đơn xe <Link className="text-brand underline" href={`/don-ban/${o.id}`}>{o.code}</Link> cần trả <b>{fmtVND(tong)}</b> nhưng đã nhận <b>{fmtVND(paid)}</b> → khách <b>trả dư {fmtVND(paid - tong)}</b>.{" "}
                        {ghi.length ? <span className="text-[#0E7A4A]">Khoản dư đã ghi vào <Link className="underline" href={`/khach-buon?kh=${h.customer_id}`}>Sổ khách buôn</Link> (số dư bù) để cấn trừ đơn sau{ghi[0].note ? ` — ${ghi[0].note}` : ""}.</span>
                          : <span className="text-danger">Khoản dư chưa ghi vào Sổ khách buôn — cần hoàn lại khách hoặc nhờ Ban giám đốc ghi điều chỉnh để cấn trừ đơn sau.</span>}</li>);
                    })}
                    {du > 0 && duDon.length === 0 && chuaPb <= 0 && <li>Khách đã trả nhiều hơn số cần trả <b>{fmtVND(du)}</b> (có thể do giảm giá/bù pin ghi sau khi thu tiền). Kiểm tra Sổ khách buôn hoặc hoàn lại khách.</li>}
                  </ul>
                </div>);
            })()}
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2 flex flex-col gap-4">
                <div className="card">
                  <div className="font-extrabold mb-2">Xe đặt & giao xe</div>
                  {!huy && h.sl_giao < h.sl_dat && (
                    <div className="mb-2.5 rounded-xl bg-[#EAF2FF] p-2.5">
                      <label className="lbl">Quét hoặc gõ số khung (đủ số khung, hoặc vài số cuối) rồi Enter — tự xếp vào đúng dòng xe</label>
                      <input className="inp font-mono" autoComplete="off" placeholder="VD: RPXT5LHLVTE711526 hoặc 711526" value={quet}
                        onChange={(e) => { setQuet(e.target.value); setQuetMsg(null); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); quetSoKhung(quet, daGiao); } }} />
                      {quetMsg && <div className={`text-[12px] mt-1 font-semibold ${quetMsg.err ? "text-danger" : "text-[#0E7A4A]"}`}>{quetMsg.t}</div>}
                    </div>)}
                  {(() => {
                    const rows = lo.dong.map((d) => { const gn = Number(d.gia_niem_yet) || 0; const dgx = donGia(d); return { d, gn, dgx, ckx: gn - dgx, g: daGiao(d.id) }; });
                    const T = rows.reduce((t, r) => ({ sl: t.sl + r.d.qty, giao: t.giao + r.g, ny: t.ny + r.gn * r.d.qty, ck: t.ck + r.ckx * r.d.qty, tt: t.tt + r.dgx * r.d.qty }), { sl: 0, giao: 0, ny: 0, ck: 0, tt: 0 });
                    const lech = Number(h.phai_tra) - T.tt;
                    return (
                      <div className="overflow-x-auto mb-2"><table className="w-full text-[12.5px] border-collapse tbl-card">
                        <thead><tr className="text-[11px] text-[#5A6572] uppercase bg-[#F8FAFB] border-y border-[#E3E8EF]">
                          <th className="py-2 px-1.5 text-left">#</th><th className="px-1.5 text-left">Model + màu</th><th className="px-1.5 text-right">SL</th><th className="px-1.5 text-center">Đã giao</th>
                          <th className="px-1.5 text-right">Giá niêm yết/xe</th><th className="px-1.5 text-right">CK %</th><th className="px-1.5 text-right">Tiền CK/xe</th><th className="px-1.5 text-right">Giá bán/xe</th>
                          <th className="px-1.5 text-right">Tiền niêm yết</th><th className="px-1.5 text-right">Tổng tiền CK</th><th className="px-1.5 text-right">Thành tiền</th></tr></thead>
                        <tbody>{rows.map(({ d, gn, dgx, ckx, g }, i) => (
                          <tr key={d.id} className="border-b border-dashed border-[#F0F2F5]">
                            <td className="py-2 px-1.5 text-[#8A93A0]">{i + 1}</td><td className="px-1.5 font-semibold">{vName(d.vehicle_id)}{coGiaFix(d) && <div className="text-[10.5px] font-normal text-brand">giá bán buôn cố định</div>}</td>
                            <td className="px-1.5 text-right">{d.qty}</td><td className="px-1.5 text-center"><Badge tone={g >= d.qty ? "green" : "amber"}>{g}/{d.qty}</Badge></td>
                            <td className="px-1.5 text-right">{fmtVND(gn)}</td><td className="px-1.5 text-right">{coGiaFix(d) ? (gn > 0 ? `${Math.round(ckx / gn * 1000) / 10}%` : "—") : `${Number(d.ck_pct)}%`}</td>
                            <td className="px-1.5 text-right text-[#A25F00]">{fmtVND(ckx)}</td><td className="px-1.5 text-right font-semibold">{fmtVND(dgx)}</td>
                            <td className="px-1.5 text-right">{fmtVND(gn * d.qty)}</td><td className="px-1.5 text-right text-[#A25F00]">{fmtVND(ckx * d.qty)}</td><td className="px-1.5 text-right font-bold">{fmtVND(dgx * d.qty)}</td>
                          </tr>))}</tbody>
                        <tfoot>
                          <tr className="bg-[#F8FAFB] font-bold border-t border-[#E3E8EF]"><td className="py-2 px-1.5" colSpan={2}>Tổng cộng</td><td data-label="SL" className="px-1.5 text-right">{T.sl}</td><td data-label="Đã giao" className="px-1.5 text-center">{T.giao}/{T.sl}</td><td colSpan={4}></td>
                            <td data-label="Niêm yết" className="px-1.5 text-right">{fmtVND(T.ny)}</td><td data-label="CK" className="px-1.5 text-right text-[#A25F00]">{fmtVND(T.ck)}</td><td data-label="Thành tiền" className="px-1.5 text-right">{fmtVND(T.tt)}</td></tr>
                          {lech !== 0 && <tr className="text-[12px]"><td className="py-1.5 px-1.5 text-[#5A6572]" colSpan={10}>Điều chỉnh trên đơn xe đã giao (giảm giá thêm, bù thuê pin… — xem từng đơn xe bên dưới)</td><td className={`px-1.5 text-right font-semibold ${lech < 0 ? "text-[#A25F00]" : ""}`}>{lech > 0 ? "+" : ""}{fmtVND(lech)}</td></tr>}
                          <tr className="font-extrabold text-brand"><td className="py-2 px-1.5" colSpan={10}>Khách buôn cần trả</td><td className="px-1.5 text-right text-[14px]">{fmtVND(h.phai_tra)}</td></tr>
                        </tfoot>
                      </table></div>);
                  })()}
                  {!huy && lo.dong.some((d) => d.qty - daGiao(d.id) > 0) && <div className="font-bold text-[13px] mt-3 mb-1">Chọn số khung để giao</div>}
                  {lo.dong.map((d) => {
                    const g = daGiao(d.id); const con = d.qty - g;
                    if (huy || con <= 0) return null;
                    const ton = lo.ton.filter((u) => u.vehicle_id === d.vehicle_id);
                    const chon = lo.chon[d.id] || [];
                    const tk = (timDong[d.id] || "").trim().toUpperCase();
                    const tonLoc = ton.filter((u) => !chon.includes(u.frame_number) && (!tk || u.frame_number.toUpperCase().includes(tk) || locName(u.location_code).toUpperCase().includes(tk)));
                    return (
                      <div key={d.id} className="border border-[#E3E8EF] rounded-xl p-2.5 mb-2">
                        <div className="flex items-center gap-2 flex-wrap text-[13px]"><b className="mr-auto">{vName(d.vehicle_id)}</b><Badge tone="amber">Giao {g}/{d.qty}</Badge></div>
                        {!huy && con > 0 && (
                          <div className="mt-1.5">
                            {chon.length > 0 && <div className="flex gap-1 flex-wrap mb-1.5 items-center"><span className="text-[11.5px] font-semibold text-brand">Đã chọn {chon.length}/{con}:</span>
                              {chon.map((f) => { const u = ton.find((x) => x.frame_number === f); return (
                                <span key={f} className="text-[11px] font-mono rounded px-1.5 py-0.5 bg-brand text-white">{f}{u && <span className="font-sans opacity-80"> · {locName(u.location_code)}</span>} <button className="ml-1 font-bold" onClick={() => toggleXe(d.id, f, con)}>✕</button></span>); })}</div>}
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="text-[11.5px] text-[#5A6572]">Chọn số khung trong kho (còn {con - chon.length} xe cần chọn) — {ton.length} xe tồn{tk ? `, ${tonLoc.length} khớp` : ""}:</span>
                              {ton.length > 6 && <input className="inp !py-1 !text-xs !w-56 font-mono" placeholder="Lọc số khung / tên kho…" value={timDong[d.id] || ""} onChange={(e) => setTimDong((m) => ({ ...m, [d.id]: e.target.value }))} />}
                            </div>
                            <div className="flex gap-1 flex-wrap max-h-40 overflow-y-auto">
                              {tonLoc.map((u) => (
                                <button key={u.frame_number} type="button" onClick={() => toggleXe(d.id, u.frame_number, con)}
                                  className={`text-[11px] font-mono rounded px-1.5 py-0.5 border ${chon.includes(u.frame_number) ? "bg-brand text-white border-brand" : "bg-[#F3F5F8] border-transparent"}`}>
                                  {u.frame_number} <span className="font-sans opacity-75">· {locName(u.location_code)}</span>
                                </button>
                              ))}
                              {ton.length === 0 && <span className="text-[12px] text-danger">Hết tồn model này.</span>}
                              {ton.length > 0 && tonLoc.length === 0 && tk && <span className="text-[12px] text-[#8A93A0]">Không có số khung khớp “{timDong[d.id]}”.</span>}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {!huy && h.sl_giao < h.sl_dat && (
                    <div className="flex items-end gap-2 flex-wrap mt-2">
                      <div className="w-64"><label className="lbl">Điểm bán ghi trên đơn (để trống = theo kho của xe)</label><LocSearch locations={locations} value={lo.giaoLoc} onChange={(v) => setLo((L) => ({ ...L, giaoLoc: v || "" }))} /></div>
                      <div><label className="lbl">Ngày giao</label><input type="date" className="inp" value={lo.giaoNgay} onChange={(e) => setLo((L) => ({ ...L, giaoNgay: e.target.value }))} /></div>
                      <button className="btn-primary ml-auto" disabled={busy || soChon === 0} onClick={giaoXe}>Giao {soChon} xe & tạo đơn bán</button>
                    </div>
                  )}
                </div>

                <div className="card">
                  <div className="font-extrabold mb-2">Đơn bán từng xe ({lo.orders.length})</div>
                  <div className="overflow-x-auto"><table className="w-full text-[12.5px] tbl-card">
                    <thead><tr className="text-left text-[11px] text-[#8A93A0] uppercase border-b border-[#E3E8EF]"><th className="py-2">Đơn</th><th>Ngày</th><th>Xe · số khung</th><th>Kho</th><th className="text-right">Cần trả</th><th className="text-right">Đã trả</th><th>Khách lẻ cuối</th></tr></thead>
                    <tbody>{lo.orders.map((o) => (
                      <tr key={o.id} className={`border-b border-dashed border-[#F0F2F5] ${["Đã hủy", "Đã trả hàng"].includes(o.status) ? "opacity-50" : ""}`}>
                        <td className="py-2"><Link className="text-brand underline" href={`/don-ban/${o.id}`}>{o.code}</Link></td><td>{fmtDate(o.sale_date)}</td>
                        <td>{vName(o.vehicle_id)}<div className="font-mono text-[11px]">{o.frame_number}</div></td><td>{locName(o.location_code)}</td>
                        <td className="text-right">{fmtVND(tongDonXe(o))}</td><td className={`text-right ${Number(o.paid_amount || 0) > tongDonXe(o) ? "text-[#A25F00] font-semibold" : Number(o.paid_amount || 0) < tongDonXe(o) ? "text-danger" : ""}`}>{fmtVND(o.paid_amount || 0)}{Number(o.paid_amount || 0) > tongDonXe(o) && <div className="text-[10.5px]">dư {fmtVND(Number(o.paid_amount) - tongDonXe(o))}</div>}</td><td>{o.end_customer_name || <span className="text-[#8A93A0]">chưa bán</span>}</td>
                      </tr>
                    ))}
                    {lo.orders.length === 0 && <tr><td colSpan={7} className="py-3 text-[#8A93A0]">Chưa giao xe nào.</td></tr>}</tbody>
                  </table></div>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="card scroll-mt-20" id="bb-thanh-toan">
                  <div className="flex items-center mb-2"><div className="font-extrabold mr-auto">Thanh toán của đơn bán buôn</div>
                    {!huy && <button className="btn-primary !text-xs" onClick={() => moThu(h)}>+ Thu tiền</button>}</div>
                  {lo.pay && (
                    <div className="rounded-lg border-2 border-brand p-2 mb-2 flex flex-col gap-1.5">
                      <select className="inp" value={lo.pay.method} onChange={(e) => setLo((L) => ({ ...L, pay: { ...L.pay, method: e.target.value } }))}><option>Chuyển khoản</option><option>Tiền mặt</option></select>
                      {lo.pay.method === "Chuyển khoản" && (
                        <select className="inp" value={lo.pay.account_id} onChange={(e) => setLo((L) => ({ ...L, pay: { ...L.pay, account_id: e.target.value } }))}>
                          <option value="">— Tài khoản nhận tiền —</option><BankOptions accounts={banks} companies={[]} buon giu={lo.pay.account_id} />
                        </select>
                      )}
                      <MoneyInput value={lo.pay.amount} onChange={(v) => setLo((L) => ({ ...L, pay: { ...L.pay, amount: v || 0 } }))} />
                      <input className="inp" placeholder="Ghi chú" value={lo.pay.note} onChange={(e) => setLo((L) => ({ ...L, pay: { ...L.pay, note: e.target.value } }))} />
                      <div className="flex gap-2"><button className="btn-ghost !text-xs flex-1" onClick={() => setLo((L) => ({ ...L, pay: null }))}>Hủy</button><button className="btn-ok !text-xs flex-1" disabled={busy} onClick={thuTien}>Ghi thu</button></div>
                    </div>
                  )}
                  {!huy && can("kb_can_tru") && lo.kb && lo.kb.kha_dung > 0 && (
                    <div className="rounded-lg bg-[#F8F5FF] border border-[#D9CCF5] p-2 mb-2 text-[12.5px]">
                      Số dư bù khách buôn được cấn trừ: <b className="text-[#5B3FA0]">{fmtVND(lo.kb.kha_dung)}</b>
                      {lo.ct ? (
                        <div className="flex flex-col gap-1.5 mt-1.5">
                          <MoneyInput value={lo.ct.amount} onChange={(v) => setLo((L) => ({ ...L, ct: { ...L.ct, amount: v || 0 } }))} />
                          <input className="inp" placeholder="Ghi chú, VD: chốt tháng 10" value={lo.ct.note} onChange={(e) => setLo((L) => ({ ...L, ct: { ...L.ct, note: e.target.value } }))} />
                          <div className="flex gap-2"><button className="btn-ghost !text-xs flex-1" onClick={() => setLo((L) => ({ ...L, ct: null }))}>Hủy</button><button className="btn-primary !text-xs flex-1" disabled={busy} onClick={canTru}>Cấn trừ vào đơn</button></div>
                        </div>
                      ) : <button className="btn-ghost !text-xs mt-1" onClick={() => setLo((L) => ({ ...L, ct: { amount: Math.min(L.kb.kha_dung, h.con_phai_tra), note: "" } }))}>Cấn trừ vào đơn này</button>}
                    </div>
                  )}
                  {lo.tt.length === 0 ? <div className="text-[12.5px] text-[#8A93A0]">Chưa có khoản thanh toán.</div> : lo.tt.map((t) => (
                    <div key={t.id} className={`flex items-center gap-2 text-[12.5px] py-1.5 border-b border-dashed border-[#F0F2F5] ${t.is_reversed ? "opacity-50 line-through" : ""}`}>
                      <div className="mr-auto"><b>{t.loai === "CAN_TRU" ? "Cấn trừ công nợ KB" : t.method}</b>{t.cash_txn_code && <span className="text-[#8A93A0]"> · {t.cash_txn_code}</span>}<div className="text-[11px] text-[#8A93A0]">{fmtTime(t.created_at)} · {t.created_by_name}{t.note ? ` · ${t.note}` : ""}</div></div>
                      <b>{fmtVND(t.amount)}</b>
                      {can("bb_dao_nguoc") && !t.is_reversed && <button className="btn-ghost !px-2 !py-0.5 !text-xs !text-danger" onClick={() => daoNguoc(t)}>Đảo ngược</button>}
                    </div>
                  ))}
                  <div className="text-[11px] text-[#8A93A0] mt-2">Tiền thu ở đơn bán buôn ghi vào quỹ ngay (danh mục “Thu tiền bán buôn (trả trước)”), rồi tự phân bổ xuống từng đơn xe khi giao — không cần thu lại trên đơn xe.</div>
                </div>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}

export default function BanBuon() {
  return <Suspense fallback={<div className="card">Đang tải…</div>}><BanBuonInner /></Suspense>;
}
