"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, Field, MoneyInput } from "@/components/ui";
import { fmtVND, fmtDate, errMsg } from "@/lib/format";
import { usePerms } from "@/lib/usePerms";

const LOAI = { BU_PIN: "Bù pin (thuê pin)", KHUYEN_MAI: "KM hãng", CAN_TRU: "Cấn trừ vào đơn", HOAN_CAN_TRU: "Hoàn cấn trừ", DIEU_CHINH_TAY: "Điều chỉnh tay" };
const LOAI_TONE = { BU_PIN: "amber", KHUYEN_MAI: "purple", CAN_TRU: "blue", HOAN_CAN_TRU: "dark", DIEU_CHINH_TAY: "gray" };
const homNay = () => new Date().toLocaleDateString("sv-SE");
const kyNay = () => homNay().slice(0, 7);

// tong don (giong _tong_don phia server)
const tongDon = (o, itemSum) => {
  const tienXe = (o.sale_price || 0) * (o.quantity || 1);
  const ckXe = o.vehicle_discount_type === "percent" ? Math.round(tienXe * (o.vehicle_discount_value || 0) / 100) : (o.vehicle_discount_value || 0);
  return Math.max(tienXe - ckXe + (itemSum[o.code] || 0) - (o.discount_amount || 0) - (o.kb_dieu_chinh || 0), 0);
};

function KhachBuonInner() {
  const { supabase, vehicles, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const sp = useSearchParams();
  const [tab, setTab] = useState("so");
  const [khs, setKhs] = useState([]);       // khach buon
  const [so, setSo] = useState([]);         // kb_so_cai (tat ca, khong huy)
  const [busy, setBusy] = useState(true);
  const [chon, setChon] = useState(null);   // customer dang xem
  const [orders, setOrders] = useState([]);
  const [itemSum, setItemSum] = useState({});
  const [dong, setDong] = useState([]);     // so cai cua khach dang xem (ca dong huy)
  const [ky, setKy] = useState("");         // loc ky YYYY-MM
  const [ctF, setCtF] = useState(null);     // can tru
  const [tayF, setTayF] = useState(null);   // ghi tay
  const [ck, setCk] = useState([]);         // bang ck si
  const [ckF, setCkF] = useState(null);
  const [ckKh, setCkKh] = useState("");
  const [q, setQ] = useState("");
  const can = usePerms(supabase, profile);
  const admin = can("kb_dieu_chinh"); // dieu chinh tay, huy dong, che do can tru
  const ckAdmin = can("bb_ck_si");

  const loadDs = async () => {
    setBusy(true);
    const [{ data: c1 }, { data: o1 }, { data: s1 }] = await Promise.all([
      supabase.from("customers").select("id,code,name,phone,customer_type,kb_can_tru_mode").eq("customer_type", "Khách buôn").limit(2000),
      supabase.from("sales_orders").select("customer_id").eq("customer_type", "Khách buôn").not("customer_id", "is", null).limit(10000),
      supabase.from("kb_so_cai").select("customer_id,so_tien,ky,huy").eq("huy", false).limit(20000),
    ]);
    const ids = new Set([...(c1 || []).map((c) => c.id), ...(o1 || []).map((o) => o.customer_id)]);
    const thieu = [...ids].filter((id) => !(c1 || []).some((c) => c.id === id));
    let c2 = [];
    if (thieu.length) { const r = await supabase.from("customers").select("id,code,name,phone,customer_type,kb_can_tru_mode").in("id", thieu); c2 = r.data || []; }
    setKhs([...(c1 || []), ...c2].sort((a, b) => a.name.localeCompare(b.name)));
    setSo(s1 || []);
    setBusy(false);
  };
  const loadCk = async () => {
    const { data } = await supabase.from("ck_si").select("*").order("tu_ngay", { ascending: false }).limit(3000);
    setCk(data || []);
  };
  useEffect(() => { if (!loading && profile) { loadDs(); loadCk(); } }, [loading, profile]);
  useEffect(() => {
    const id = sp.get("kh");
    if (id && khs.length) { const c = khs.find((x) => String(x.id) === id); if (c) moKhach(c); }
  }, [sp, khs.length]);

  const moKhach = async (c) => {
    setChon(c); setKy("");
    const [{ data: os }, { data: ds }] = await Promise.all([
      supabase.from("sales_orders").select("*").eq("customer_id", c.id).eq("customer_type", "Khách buôn").order("sale_date", { ascending: false }).limit(2000),
      supabase.from("kb_so_cai").select("*").eq("customer_id", c.id).order("ngay", { ascending: false }).order("id", { ascending: false }),
    ]);
    const codes = (os || []).map((o) => o.code);
    const m = {};
    if (codes.length) {
      const { data: its } = await supabase.from("sale_items").select("sale_code,amount").in("sale_code", codes);
      (its || []).forEach((i) => { m[i.sale_code] = (m[i.sale_code] || 0) + (i.amount || 0); });
    }
    setOrders(os || []); setItemSum(m); setDong(ds || []);
  };

  if (loading || !profile) return <div className="card">Đang tải…</div>;
  if (!["CEO", "ADMIN", "MANAGER", "SALES"].includes(profile.role)) return <div className="card">Bạn không có quyền xem trang này.</div>;

  const vOf = (id) => vehicles.find((v) => v.id === id);
  const locName = (c) => locations.find((l) => l.code === c)?.name || c || "";
  const soDu = (cid, mode) => {
    const ds = so.filter((d) => d.customer_id === cid);
    const tong = ds.reduce((s, d) => s + Number(d.so_tien), 0);
    const kd = mode === "CUOI_THANG" ? ds.filter((d) => d.so_tien < 0 || d.ky < kyNay()).reduce((s, d) => s + Number(d.so_tien), 0) : tong;
    return { tong, kd: Math.max(Math.min(kd, tong), 0) };
  };
  const dongCon = dong.filter((d) => !d.huy);
  const sdChon = chon ? (() => {
    const tong = dongCon.reduce((s, d) => s + Number(d.so_tien), 0);
    const kd = chon.kb_can_tru_mode === "CUOI_THANG" ? dongCon.filter((d) => d.so_tien < 0 || d.ky < kyNay()).reduce((s, d) => s + Number(d.so_tien), 0) : tong;
    return { tong, kd: Math.max(Math.min(kd, tong), 0) };
  })() : null;
  const conLai = (o) => tongDon(o, itemSum) - (o.paid_amount || 0);
  const donMo = orders.filter((o) => !["Đã hủy", "Đã trả hàng"].includes(o.status) && conLai(o) > 0);

  const canTru = async () => {
    const n = Number(ctF.amount) || 0;
    if (!ctF.sale_code) return notify("Chọn đơn cần cấn trừ.", "err");
    if (n <= 0) return notify("Nhập số tiền cấn trừ.", "err");
    const { error } = await supabase.rpc("fn_kb_can_tru", { p_customer: chon.id, p_sale_code: ctF.sale_code, p_amount: n, p_note: ctF.note || "" });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã cấn trừ ${fmtVND(n)} vào đơn ${ctF.sale_code}.`); setCtF(null); moKhach(chon); loadDs();
  };
  const ghiTay = async () => {
    const n = (Number(tayF.amount) || 0) * (tayF.chieu === "-" ? -1 : 1);
    const { error } = await supabase.rpc("fn_kb_ghi_tay", { p_customer: chon.id, p_so_tien: n, p_note: tayF.note || "", p_ngay: tayF.ngay || null });
    if (error) return notify(errMsg(error), "err");
    notify("Đã ghi điều chỉnh."); setTayF(null); moKhach(chon); loadDs();
  };
  const huyDong = async (d) => {
    const ly = prompt(d.loai === "CAN_TRU" ? "Đảo ngược khoản cấn trừ này (số dư sẽ được hoàn lại, đơn quay lại còn nợ). Lý do:" : "Lý do hủy dòng này:");
    if (!ly) return;
    const { error } = await supabase.rpc("fn_kb_huy", { p_id: d.id, p_ly_do: ly });
    if (error) return notify(errMsg(error), "err");
    notify("Đã cập nhật sổ."); moKhach(chon); loadDs();
  };
  const doiCheDo = async (mode) => {
    const { error } = await supabase.rpc("fn_kb_dat_che_do", { p_customer: chon.id, p_mode: mode });
    if (error) return notify(errMsg(error), "err");
    setChon((c) => ({ ...c, kb_can_tru_mode: mode })); setKhs((p) => p.map((c) => c.id === chon.id ? { ...c, kb_can_tru_mode: mode } : c));
    notify("Đã đổi chế độ cấn trừ.");
  };

  // sao ke theo bo cuc file Excel theo doi ban buon
  const ckPct = (o) => o.vehicle_discount_type === "percent" ? Number(o.vehicle_discount_value || 0) : (o.sale_price > 0 ? Math.round(Number(o.vehicle_discount_value || 0) * 10000 / (o.sale_price * (o.quantity || 1))) / 100 : 0);
  const ordKy = orders.filter((o) => !ky || (o.sale_date || "").startsWith(ky));
  const dongKy = dong.filter((d) => !ky || d.ky === ky);
  const xuatExcel = async () => {
    const XLSX = await import("xlsx");
    const head = ["STT", "Ngày giao xe", "Mã đơn", "Loại xe", "Màu xe", "Số khung", "Lấy từ kho", "Số lượng", "Giá bán lẻ niêm yết", "Chiết khấu mua sỉ (%)", "Số tiền CK cho khách buôn", "Tổng tiền khách buôn cần trả ban đầu", "Đã thanh toán", "Khách lẻ sau cùng", "Loại hình pin khách lẻ mua", "Giá niêm yết cho khách sau cùng", "KM hãng trả lại khách buôn", "Chênh lệch bù khách buôn (thuê pin)"];
    const rows = [...ordKy].reverse().filter((o) => !["Đã hủy", "Đã trả hàng"].includes(o.status)).map((o, i) => {
      const v = vOf(o.vehicle_id);
      const pct = ckPct(o);
      const tienXe = o.sale_price * (o.quantity || 1);
      const ckTien = Math.round(tienXe * pct / 100);
      const km = dongCon.filter((d) => d.sale_code === o.code && d.loai === "KHUYEN_MAI").reduce((s, d) => s + Number(d.so_tien), 0);
      const giaCuoi = o.end_customer_battery_option === "Thuê pin" && v?.list_price_thue_pin ? v.list_price_thue_pin : (o.end_customer_name ? o.sale_price : "");
      return [i + 1, o.sale_date, o.code, v ? `${v.brand} ${v.name}` : o.vehicle_id, v?.color || "", o.frame_number || "", locName(o.location_code), o.quantity || 1,
        o.sale_price, pct, ckTien, tienXe - ckTien, o.paid_amount || 0, o.end_customer_name || "", o.end_customer_battery_option || (o.end_customer_name ? "Kèm pin" : ""),
        giaCuoi, km || "", o.kb_dieu_chinh || ""];
    });
    const so2 = [["Ngày", "Kỳ", "Loại", "Đơn", "Diễn giải", "Số tiền (+ Minh Kỳ nợ khách / − đã cấn trừ)", "Trạng thái"],
      ...[...dongKy].reverse().map((d) => [d.ngay, d.ky, LOAI[d.loai] || d.loai, d.sale_code || "", d.note, Number(d.so_tien), d.huy ? `Đã hủy: ${d.huy_ly_do || ""}` : ""])];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...rows]), "Don ban buon");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...so2, [], ["Số dư hiện tại", "", "", "", "", sdChon.tong]]), "So cong no");
    XLSX.writeFile(wb, `Sao-ke-ban-buon_${chon.code}_${ky || "tat-ca"}.xlsx`);
  };

  // ===== Bang CK si =====
  const models = [...new Map(vehicles.map((v) => [`${v.brand}|${v.name}`, { brand: v.brand, name: v.name }])).values()].sort((a, b) => `${a.brand} ${a.name}`.localeCompare(`${b.brand} ${b.name}`));
  const luuCk = async () => {
    const [brand, model] = (ckF.bm || "").split("|");
    const { error } = await supabase.rpc("fn_ck_si_luu", { p: { id: ckF.id || null, customer_id: ckF.customer_id, brand, model, pct: Number(ckF.pct), tu_ngay: ckF.tu_ngay, den_ngay: ckF.den_ngay || null, note: ckF.note || "" } });
    if (error) return notify(errMsg(error), "err");
    notify("Đã lưu chiết khấu sỉ."); setCkF(null); loadCk();
  };
  const xoaCk = async (r) => {
    if (!confirm("Xóa dòng chiết khấu sỉ này? (Các đơn đã lên không bị thay đổi)")) return;
    const { error } = await supabase.rpc("fn_ck_si_xoa", { p_id: r.id });
    if (error) return notify(errMsg(error), "err");
    loadCk();
  };
  const khName = (id) => khs.find((c) => c.id === id)?.name || `#${id}`;
  const ckLoc = ck.filter((r) => !ckKh || String(r.customer_id) === ckKh);
  const conHieuLuc = (r) => r.tu_ngay <= homNay() && (!r.den_ngay || r.den_ngay >= homNay());

  const dsLoc = khs.filter((c) => !q || `${c.name} ${c.code} ${c.phone}`.toLowerCase().includes(q.toLowerCase()));
  const tongNo = khs.reduce((s, c) => s + soDu(c.id, c.kb_can_tru_mode).tong, 0);

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Toast toast={toast} />
      <div className="flex gap-1 border-b border-[#E3E8EF]">
        {[["so", "Sổ công nợ khách buôn"], ["ck", "Bảng chiết khấu sỉ"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3.5 py-2 text-[13px] font-semibold border-b-2 -mb-px ${tab === k ? "border-brand text-brand" : "border-transparent text-[#5A6572]"}`}>{l}</button>
        ))}
      </div>

      {tab === "so" && !chon && (
        <>
          <div className="flex gap-3 flex-wrap">
            <KPI label="Số khách buôn" value={khs.length} />
            <KPI label="Tổng số dư bù khách buôn" value={fmtVND(tongNo)} tone="amber" sub="KM hãng + bù pin chưa cấn trừ" />
          </div>
          <div className="card">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <div className="font-extrabold mr-auto">Khách buôn</div>
              <input className="inp !w-56" placeholder="Tìm tên, mã, SĐT…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {busy ? <div className="text-sm text-[#8A93A0]">Đang tải…</div> : (
              <div className="overflow-x-auto"><table className="w-full text-[13px]">
                <thead><tr className="text-left text-[11.5px] text-[#8A93A0] uppercase border-b border-[#E3E8EF]"><th className="py-2">Khách buôn</th><th>SĐT</th><th>Cấn trừ</th><th className="text-right">Số dư bù</th><th className="text-right">Được cấn trừ</th><th></th></tr></thead>
                <tbody>{dsLoc.map((c) => {
                  const sd = soDu(c.id, c.kb_can_tru_mode);
                  return (
                    <tr key={c.id} className="border-b border-dashed border-[#F0F2F5] cursor-pointer hover:bg-[#F8FAFC]" onClick={() => moKhach(c)}>
                      <td className="py-2"><b>{c.name}</b> <span className="text-[11px] text-[#8A93A0]">{c.code}</span>{c.customer_type !== "Khách buôn" && <span className="ml-1"><Badge tone="red">Danh mục ghi "{c.customer_type}"</Badge></span>}</td>
                      <td>{c.phone}</td>
                      <td>{c.kb_can_tru_mode === "CUOI_THANG" ? "Cuối tháng" : "Ngay đơn sau"}</td>
                      <td className="text-right font-bold">{sd.tong ? fmtVND(sd.tong) : "—"}</td>
                      <td className="text-right">{sd.kd ? fmtVND(sd.kd) : "—"}</td>
                      <td className="text-right text-brand text-xs">Xem →</td>
                    </tr>
                  );
                })}
                {dsLoc.length === 0 && <tr><td colSpan={6} className="py-3 text-[#8A93A0]">Chưa có khách buôn.</td></tr>}</tbody>
              </table></div>
            )}
          </div>
        </>
      )}

      {tab === "so" && chon && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn-ghost !text-xs" onClick={() => { setChon(null); setOrders([]); setDong([]); }}>← Danh sách khách buôn</button>
            <span className="text-xl font-extrabold">{chon.name}</span>
            <span className="text-[13px] text-[#8A93A0]">{chon.code} · {chon.phone}</span>
            <div className="ml-auto flex gap-2 flex-wrap">
              <select className="inp !w-auto !py-1.5 !text-xs" value={ky} onChange={(e) => setKy(e.target.value)}>
                <option value="">Tất cả kỳ</option>
                {[...new Set([...orders.map((o) => (o.sale_date || "").slice(0, 7)), ...dong.map((d) => d.ky)])].filter(Boolean).sort().reverse().map((k) => <option key={k} value={k}>Tháng {k.slice(5)}/{k.slice(0, 4)}</option>)}
              </select>
              <button className="btn-ghost !text-xs" onClick={xuatExcel}>⬇ Xuất sao kê Excel</button>
              {admin && <button className="btn-ghost !text-xs" onClick={() => setTayF({ chieu: "+", amount: 0, note: "", ngay: homNay() })}>± Điều chỉnh tay</button>}
              <button className="btn-primary !text-xs" disabled={!can("kb_can_tru") || !sdChon || sdChon.kd <= 0 || donMo.length === 0} onClick={() => setCtF({ sale_code: donMo[donMo.length - 1]?.code || "", amount: Math.min(sdChon.kd, conLai(donMo[donMo.length - 1] || {})), note: "" })}>Cấn trừ vào đơn</button>
            </div>
          </div>

          <div className="flex gap-3 flex-wrap">
            <KPI label="Số dư bù khách buôn" value={fmtVND(sdChon.tong)} tone="amber" sub="Minh Kỳ đang nợ khách buôn" />
            <KPI label="Được cấn trừ ngay" value={fmtVND(sdChon.kd)} tone="blue" sub={chon.kb_can_tru_mode === "CUOI_THANG" ? "Khoản phát sinh tháng này dùng từ tháng sau" : "Trừ ngay vào đơn sau"} />
            <KPI label="Khách buôn còn nợ (các đơn)" value={fmtVND(donMo.reduce((s, o) => s + conLai(o), 0))} tone="red" sub={`${donMo.length} đơn chưa trả đủ`} />
          </div>
          {admin && (
            <div className="text-[12.5px] flex items-center gap-2 flex-wrap">
              <span className="text-[#5A6572]">Chế độ cấn trừ:</span>
              {[["NGAY", "Trừ ngay vào đơn sau"], ["CUOI_THANG", "Chốt cuối tháng, trừ vào đơn tháng sau"]].map(([k, l]) => (
                <label key={k} className="inline-flex items-center gap-1 cursor-pointer"><input type="radio" checked={(chon.kb_can_tru_mode || "NGAY") === k} onChange={() => doiCheDo(k)} /> {l}</label>
              ))}
            </div>
          )}

          <div className="card">
            <div className="font-extrabold mb-2">Sổ công nợ (KM hãng, bù pin, cấn trừ){ky ? ` — tháng ${ky.slice(5)}/${ky.slice(0, 4)}` : ""}</div>
            <div className="overflow-x-auto"><table className="w-full text-[13px]">
              <thead><tr className="text-left text-[11.5px] text-[#8A93A0] uppercase border-b border-[#E3E8EF]"><th className="py-2">Ngày</th><th>Loại</th><th>Đơn</th><th>Diễn giải</th><th className="text-right">Số tiền</th><th></th></tr></thead>
              <tbody>{dongKy.map((d) => (
                <tr key={d.id} className={`border-b border-dashed border-[#F0F2F5] ${d.huy ? "opacity-50 line-through" : ""}`}>
                  <td className="py-2 whitespace-nowrap">{fmtDate(d.ngay)}</td>
                  <td><Badge tone={LOAI_TONE[d.loai]}>{LOAI[d.loai] || d.loai}</Badge></td>
                  <td>{d.sale_code ? <Link className="text-brand underline" href={`/don-ban/${orders.find((o) => o.code === d.sale_code)?.id || ""}`}>{d.sale_code}</Link> : "—"}</td>
                  <td className="text-[12px] text-[#5A6572]">{d.note}{d.huy ? ` (hủy: ${d.huy_ly_do || ""})` : ""}<div className="text-[10.5px] text-[#8A93A0]">{d.created_by_name}</div></td>
                  <td className={`text-right font-bold whitespace-nowrap ${d.so_tien > 0 ? "text-[#5B3FA0]" : "text-danger"}`}>{d.so_tien > 0 ? "+" : ""}{fmtVND(d.so_tien)}</td>
                  <td className="text-right">{admin && !d.huy && d.loai !== "HOAN_CAN_TRU" && <button className="btn-ghost !px-2 !py-0.5 !text-xs !text-danger" onClick={() => huyDong(d)}>{d.loai === "CAN_TRU" ? "Đảo ngược" : "Hủy"}</button>}</td>
                </tr>
              ))}
              {dongKy.length === 0 && <tr><td colSpan={6} className="py-3 text-[#8A93A0]">Chưa có phát sinh. KM hãng và bù pin tự ghi khi nhập Khách lẻ cuối trên đơn bán.</td></tr>}</tbody>
            </table></div>
          </div>

          <div className="card">
            <div className="font-extrabold mb-2">Đơn bán buôn{ky ? ` — tháng ${ky.slice(5)}/${ky.slice(0, 4)}` : ""} ({ordKy.length})</div>
            <div className="overflow-x-auto"><table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[11px] text-[#8A93A0] uppercase border-b border-[#E3E8EF]">
                <th className="py-2">Ngày</th><th>Đơn</th><th>Xe</th><th>Số khung · kho</th><th className="text-right">Niêm yết</th><th className="text-right">CK sỉ</th><th className="text-right">Phải trả</th><th className="text-right">Đã trả</th><th>Khách lẻ cuối</th><th className="text-right">KM / bù</th>
              </tr></thead>
              <tbody>{ordKy.map((o) => {
                const v = vOf(o.vehicle_id); const huy = ["Đã hủy", "Đã trả hàng"].includes(o.status);
                const km = dongCon.filter((d) => d.sale_code === o.code && d.loai === "KHUYEN_MAI").reduce((s, d) => s + Number(d.so_tien), 0);
                return (
                  <tr key={o.id} className={`border-b border-dashed border-[#F0F2F5] align-top ${huy ? "opacity-50" : ""}`}>
                    <td className="py-2 whitespace-nowrap">{fmtDate(o.sale_date)}</td>
                    <td><Link className="text-brand underline" href={`/don-ban/${o.id}`}>{o.code}</Link>{huy && <div><Badge tone="red">{o.status}</Badge></div>}</td>
                    <td>{v ? `${v.name} ${v.color}` : o.vehicle_id}</td>
                    <td className="font-mono text-[11px]">{o.frame_number}<div className="font-sans text-[#8A93A0]">{locName(o.location_code)}</div></td>
                    <td className="text-right">{fmtVND(o.sale_price * (o.quantity || 1))}</td>
                    <td className="text-right">{ckPct(o)}%</td>
                    <td className="text-right font-bold">{fmtVND(tongDon(o, itemSum))}</td>
                    <td className="text-right">{fmtVND(o.paid_amount || 0)}{!huy && conLai(o) > 0 && <div className="text-danger text-[11px]">còn {fmtVND(conLai(o))}</div>}</td>
                    <td>{o.end_customer_name || <span className="text-[#8A93A0]">chưa bán</span>}{o.end_customer_battery_option && <div><Badge tone="amber">{o.end_customer_battery_option}</Badge></div>}</td>
                    <td className="text-right">{km > 0 && <div className="text-[#5B3FA0]">KM {fmtVND(km)}</div>}{o.kb_dieu_chinh > 0 && <div className="text-[#B45309]">Bù {fmtVND(o.kb_dieu_chinh)}</div>}</td>
                  </tr>
                );
              })}
              {ordKy.length === 0 && <tr><td colSpan={10} className="py-3 text-[#8A93A0]">Không có đơn.</td></tr>}</tbody>
            </table></div>
          </div>
        </>
      )}

      {tab === "ck" && (
        <div className="card">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <div className="font-extrabold mr-auto">Chiết khấu sỉ theo khách buôn × model × thời kỳ</div>
            <select className="inp !w-56" value={ckKh} onChange={(e) => setCkKh(e.target.value)}>
              <option value="">Tất cả khách buôn</option>
              {khs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {ckAdmin && <button className="btn-primary !text-xs" onClick={() => setCkF({ id: null, customer_id: ckKh || "", bm: "", pct: "", tu_ngay: homNay(), den_ngay: "", note: "" })}>+ Thêm</button>}
          </div>
          <p className="text-[12px] text-[#5A6572] mb-2">Khi lên đơn cho khách buôn (trang Bán hàng), hệ thống tự điền CK sỉ đang hiệu lực theo model xe. Đổi mức CK thì thêm dòng mới với ngày bắt đầu mới — không sửa lại các đơn đã lên.{!ckAdmin && " Cần quyền “Sửa bảng chiết khấu sỉ” để thêm/sửa."}</p>
          <div className="overflow-x-auto"><table className="w-full text-[13px]">
            <thead><tr className="text-left text-[11.5px] text-[#8A93A0] uppercase border-b border-[#E3E8EF]"><th className="py-2">Khách buôn</th><th>Model</th><th className="text-right">CK sỉ</th><th>Từ ngày</th><th>Đến ngày</th><th>Ghi chú</th><th></th></tr></thead>
            <tbody>{ckLoc.map((r) => (
              <tr key={r.id} className={`border-b border-dashed border-[#F0F2F5] ${conHieuLuc(r) ? "" : "text-[#8A93A0]"}`}>
                <td className="py-2">{khName(r.customer_id)}</td>
                <td>{r.brand} {r.model}</td>
                <td className="text-right font-bold">{Number(r.pct)}%</td>
                <td>{fmtDate(r.tu_ngay)}</td>
                <td>{r.den_ngay ? fmtDate(r.den_ngay) : "—"} {conHieuLuc(r) && <Badge tone="green">Hiệu lực</Badge>}</td>
                <td className="text-[12px]">{r.note}</td>
                <td className="text-right whitespace-nowrap">{ckAdmin && <>
                  <button className="btn-ghost !px-2 !py-0.5 !text-xs" onClick={() => setCkF({ id: r.id, customer_id: r.customer_id, bm: `${r.brand}|${r.model}`, pct: r.pct, tu_ngay: r.tu_ngay, den_ngay: r.den_ngay || "", note: r.note })}>✎</button>
                  <button className="btn-ghost !px-2 !py-0.5 !text-xs !text-danger" onClick={() => xoaCk(r)}>✕</button>
                </>}</td>
              </tr>
            ))}
            {ckLoc.length === 0 && <tr><td colSpan={7} className="py-3 text-[#8A93A0]">Chưa có mức chiết khấu sỉ.</td></tr>}</tbody>
          </table></div>
        </div>
      )}

      {ckF && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3" onClick={() => setCkF(null)}>
          <div className="bg-white rounded-2xl w-[480px] max-w-full p-4" onClick={(e) => e.stopPropagation()}>
            <div className="font-extrabold mb-2">{ckF.id ? "Sửa" : "Thêm"} chiết khấu sỉ</div>
            <Field label="Khách buôn" required>
              <select className="inp" value={ckF.customer_id} onChange={(e) => setCkF((p) => ({ ...p, customer_id: e.target.value }))}>
                <option value="">— Chọn —</option>
                {khs.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
              </select>
            </Field>
            <Field label="Model" required>
              <select className="inp" value={ckF.bm} onChange={(e) => setCkF((p) => ({ ...p, bm: e.target.value }))}>
                <option value="">— Chọn model —</option>
                {models.map((m) => <option key={`${m.brand}|${m.name}`} value={`${m.brand}|${m.name}`}>{m.brand} {m.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="CK sỉ (%)" required><input type="number" step="0.1" min="0" max="100" className="inp" value={ckF.pct} onChange={(e) => setCkF((p) => ({ ...p, pct: e.target.value }))} /></Field>
              <Field label="Từ ngày" required><input type="date" className="inp" value={ckF.tu_ngay} onChange={(e) => setCkF((p) => ({ ...p, tu_ngay: e.target.value }))} /></Field>
              <Field label="Đến ngày"><input type="date" className="inp" value={ckF.den_ngay} onChange={(e) => setCkF((p) => ({ ...p, den_ngay: e.target.value }))} /></Field>
            </div>
            <Field label="Ghi chú"><input className="inp" value={ckF.note} onChange={(e) => setCkF((p) => ({ ...p, note: e.target.value }))} /></Field>
            <div className="flex gap-2 mt-2"><button className="btn-ghost !text-xs flex-1" onClick={() => setCkF(null)}>Hủy</button><button className="btn-primary !text-xs flex-1" onClick={luuCk}>Lưu</button></div>
          </div>
        </div>
      )}

      {ctF && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3" onClick={() => setCtF(null)}>
          <div className="bg-white rounded-2xl w-[480px] max-w-full p-4" onClick={(e) => e.stopPropagation()}>
            <div className="font-extrabold mb-1">Cấn trừ số dư vào đơn</div>
            <div className="text-[12px] text-[#5A6572] mb-2">Ghi như một khoản thanh toán <b>không phải tiền</b> trên đơn (không vào quỹ, không đổi giá bán xe). Được cấn trừ tối đa {fmtVND(sdChon.kd)}.</div>
            <Field label="Đơn của khách buôn còn nợ" required>
              <select className="inp" value={ctF.sale_code} onChange={(e) => { const o = donMo.find((x) => x.code === e.target.value); setCtF((p) => ({ ...p, sale_code: e.target.value, amount: o ? Math.min(sdChon.kd, conLai(o)) : p.amount })); }}>
                {donMo.map((o) => { const v = vOf(o.vehicle_id); return <option key={o.code} value={o.code}>{o.code} · {fmtDate(o.sale_date)} · {v ? `${v.name} ${v.color}` : ""} · còn {fmtVND(conLai(o))}</option>; })}
              </select>
            </Field>
            <Field label="Số tiền cấn trừ" required><MoneyInput value={ctF.amount} onChange={(v) => setCtF((p) => ({ ...p, amount: v || 0 }))} /></Field>
            <Field label="Ghi chú"><input className="inp" value={ctF.note} onChange={(e) => setCtF((p) => ({ ...p, note: e.target.value }))} placeholder="VD: chốt tháng 10 — KM hãng + bù pin" /></Field>
            <div className="flex gap-2 mt-2"><button className="btn-ghost !text-xs flex-1" onClick={() => setCtF(null)}>Hủy</button><button className="btn-primary !text-xs flex-1" onClick={canTru}>Cấn trừ</button></div>
          </div>
        </div>
      )}

      {tayF && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3" onClick={() => setTayF(null)}>
          <div className="bg-white rounded-2xl w-[440px] max-w-full p-4" onClick={(e) => e.stopPropagation()}>
            <div className="font-extrabold mb-2">Điều chỉnh tay sổ khách buôn</div>
            <div className="flex gap-3 text-[13px] mb-2">
              <label className="inline-flex items-center gap-1"><input type="radio" checked={tayF.chieu === "+"} onChange={() => setTayF((p) => ({ ...p, chieu: "+" }))} /> Minh Kỳ nợ thêm khách (+)</label>
              <label className="inline-flex items-center gap-1"><input type="radio" checked={tayF.chieu === "-"} onChange={() => setTayF((p) => ({ ...p, chieu: "-" }))} /> Khách nợ lại Minh Kỳ (−)</label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Số tiền" required><MoneyInput value={tayF.amount} onChange={(v) => setTayF((p) => ({ ...p, amount: v || 0 }))} /></Field>
              <Field label="Ngày (tính kỳ)"><input type="date" className="inp" value={tayF.ngay} onChange={(e) => setTayF((p) => ({ ...p, ngay: e.target.value }))} /></Field>
            </div>
            <Field label="Lý do" required><input className="inp" value={tayF.note} onChange={(e) => setTayF((p) => ({ ...p, note: e.target.value }))} placeholder="VD: số dư đầu kỳ chuyển từ Excel" /></Field>
            <div className="flex gap-2 mt-2"><button className="btn-ghost !text-xs flex-1" onClick={() => setTayF(null)}>Hủy</button><button className="btn-primary !text-xs flex-1" onClick={ghiTay}>Ghi sổ</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function KhachBuon() {
  return <Suspense fallback={<div className="card">Đang tải…</div>}><KhachBuonInner /></Suspense>;
}
