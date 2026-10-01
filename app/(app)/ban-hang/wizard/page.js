"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
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
const BangGiaPanel = ({ picked, bangGiaCu, bangGiaLoi, busy, tinhBangGia, bangGia, coc }) => (
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
            {Number(coc) > 0 && <div className="flex justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF]"><span className="text-[#5A6572]">Đã đặt cọc</span><span>{fmtVND(coc)}</span></div>}
            <div className="flex justify-between px-3 py-2.5 bg-[#FFF6E5]"><span className="font-bold">Còn lại phải thu</span><b className="text-[18px] text-[#A25F00]">{fmtVND(Math.max((bangGia.gia_can_thanh_toan || 0) - (Number(coc) || 0), 0))}</b></div>
          </div>
        )}
      </>
    )}
  </div>
);

export default function TaoDonWizard() {
  const { supabase, vehicles, locations, brands, profile, loading, settings } = useCatalog();
  const { toast, notify } = useToast();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

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
  const [bangGiaCu, setBangGiaCu] = useState(true); // true = vua doi lua chon, can bam Lam moi

  useEffect(() => { if (!loading) supabase.from("promotions").select("*").eq("status", "Đang áp dụng").then(({ data }) => setPromos(data || [])); }, [loading]);

  const vehicleObj = vehicles.find((v) => v.id === picked?.vehicle_id);
  const giaXe = vehicleObj?.list_price || 0;
  // Luu y: KHONG dua coc vao day — coc doi khong lam thay doi KM nao ap
  // dung hay so tien cua tung KM, chi tru vao "con lai" hien thi truc tiep
  // o client (xem BangGiaPanel) — khong can goi lai RPC/danh dau cu.
  useEffect(() => { setBangGiaCu(true); }, [promoChon, giaXe, ngayLayGia]);

  const chonXe = async (u) => {
    setPicked(u);
    setBatteryOption("");
    setPromoChon([]); setBangGia(null); setBangGiaLoi(""); setBangGiaCu(true);
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
    setBangGia(data); setBangGiaCu(false);
  };

  // ===== BƯỚC 3: Thanh toán & xuất HĐ =====
  const [hinhThucTT, setHinhThucTT] = useState("thang"); // "thang" | "gop"
  const [donViTraGop, setDonViTraGop] = useState("");
  const [soTienVay, setSoTienVay] = useState(0);
  const [hd, setHd] = useState({ phone: "", email: "", tinh_tp: "", phuong_xa: "", dia_chi: "" });

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  const locName = (c) => locations.find((l) => l.code === c)?.name || c || "—";
  const canNext1 = kh.customer_name && kh.customer_phone;
  const canNext2 = picked && Number(giaXe) > 0 && !bangGiaCu && bangGia;

  const luu = () => {
    notify("Tính năng ghi đơn thật đang chờ hoàn thiện Giai đoạn 2 (đồng bộ công nợ/báo cáo tài chính theo khuyến mại có giá trị). Hiện tại Bước 4 chỉ để xem trước Bảng giá — vào màn \"Bán hàng\" (form hiện tại) để tạo đơn thật trong lúc chờ.", "err");
  };

  return (
    <div className="flex flex-col gap-4 pb-10">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <Link href="/ban-hang" className="btn-ghost !text-xs">← Về màn Bán hàng (form cũ)</Link>
        <div className="font-extrabold text-lg mr-auto">🧪 Tạo đơn bán — Wizard 4 bước (đang hoàn thiện)</div>
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
              <Field label="Ghi chú"><textarea className="inp !h-20" value={ghiChu1} onChange={(e) => setGhiChu1(e.target.value)} /></Field>
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
                  {coc > 0 && <div className="text-[12px] text-[#A25F00] font-bold mt-1">🔒 Đã nhận cọc {fmtVND(coc)}</div>}
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

          <BangGiaPanel picked={picked} bangGiaCu={bangGiaCu} bangGiaLoi={bangGiaLoi} busy={busy} tinhBangGia={tinhBangGia} bangGia={bangGia} coc={coc} />
        </div>
      )}

      {/* ===== BƯỚC 3 ===== */}
      {step === 3 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <div className="card">
              <div className="font-extrabold mb-2.5">Hình thức thanh toán</div>
              <div className="flex gap-2 mb-3">
                <button className={`btn-ghost !text-xs ${hinhThucTT === "thang" ? "!bg-brand !text-white" : ""}`} onClick={() => setHinhThucTT("thang")}>Trả thẳng</button>
                <button className={`btn-ghost !text-xs ${hinhThucTT === "gop" ? "!bg-brand !text-white" : ""}`} onClick={() => setHinhThucTT("gop")}>Trả góp</button>
              </div>
              {hinhThucTT === "gop" && (
                <div className="flex flex-col gap-2.5 p-3 rounded-xl bg-[#FDF6E3] mb-3">
                  <Field label="Đơn vị trả góp" required>
                    <select className="inp" value={donViTraGop} onChange={(e) => setDonViTraGop(e.target.value)}>
                      <option value="">— Chọn đơn vị —</option>
                      {(settings?.cong_ty_tra_gop || "Home Credit\nShinhanbank\nHD Saison\nFE Credit").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean).map((x) => <option key={x}>{x}</option>)}
                    </select>
                  </Field>
                  <Field label="Số tiền vay"><MoneyInput value={soTienVay} onChange={setSoTienVay} /></Field>
                </div>
              )}
              <Field label="Số tiền khách đã đặt cọc"><MoneyInput value={coc} onChange={setCoc} /></Field>
            </div>

            <div className="card">
              <div className="font-extrabold mb-2.5">Thông tin xuất hóa đơn</div>
              <div className="flex flex-col gap-2.5">
                <Field label="Số điện thoại"><input className="inp" value={hd.phone} onChange={(e) => setHd((p) => ({ ...p, phone: e.target.value }))} /></Field>
                <Field label="Email"><input className="inp" value={hd.email} onChange={(e) => setHd((p) => ({ ...p, email: e.target.value }))} /></Field>
                <Field label="Tỉnh / Thành phố"><input className="inp" value={hd.tinh_tp} onChange={(e) => setHd((p) => ({ ...p, tinh_tp: e.target.value }))} /></Field>
                <Field label="Phường / Xã"><input className="inp" value={hd.phuong_xa} onChange={(e) => setHd((p) => ({ ...p, phuong_xa: e.target.value }))} /></Field>
                <Field label="Địa chỉ chi tiết"><input className="inp" value={hd.dia_chi} onChange={(e) => setHd((p) => ({ ...p, dia_chi: e.target.value }))} /></Field>
              </div>
            </div>
          </div>

          <BangGiaPanel picked={picked} bangGiaCu={bangGiaCu} bangGiaLoi={bangGiaLoi} busy={busy} tinhBangGia={tinhBangGia} bangGia={bangGia} coc={coc} />
        </div>
      )}

      {/* ===== BƯỚC 4: XÁC NHẬN ===== */}
      {step === 4 && (
        <div className="flex flex-col gap-4">
          <div className="p-3 rounded-xl bg-[#FFF8E5] text-[#A25F00] text-[13px]">
            ⏳ Giai đoạn 2 (ghi đơn thật — đồng bộ promo_amount/invoice_total vào công nợ & báo cáo) đang chờ duyệt. Nút "Lưu" bên dưới hiện chỉ để xem trước Bảng giá, <b>chưa tạo đơn bán thật</b>. Muốn tạo đơn thật ngay, dùng màn "Bán hàng" hiện tại.
          </div>
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
                <div>Thanh toán: {hinhThucTT === "gop" ? `Trả góp qua ${donViTraGop || "—"} (vay ${fmtVND(soTienVay)})` : "Trả thẳng"}</div>
                <div>Đã đặt cọc: {fmtVND(coc)}</div>
                {(hd.phone || hd.email || hd.dia_chi) && <div className="text-[#5A6572]">Xuất HĐ: {hd.phone} {hd.email} {[hd.dia_chi, hd.phuong_xa, hd.tinh_tp].filter(Boolean).join(", ")}</div>}
              </div>
            </div>
            <div className="card">
              <div className="font-extrabold mb-2">💰 Bảng giá</div>
              {!bangGia ? <div className="text-xs text-[#8A93A0]">Chưa có Bảng giá — quay lại Bước 2 để tính.</div> : (
                <div className="rounded-xl border border-[#E3E8EF] overflow-hidden text-[13px]">
                  <div className="flex justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF]"><span className="text-[#5A6572]">Giá niêm yết</span><b>{fmtVND(bangGia.gia_xe)}</b></div>
                  <div className="flex justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF] bg-[#EAF2FF]"><span className="font-bold">Giá cần thanh toán</span><b className="text-brand">{fmtVND(bangGia.gia_can_thanh_toan)}</b></div>
                  <div className="flex justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF]"><span className="text-[#5A6572]">Tổng xuất hóa đơn</span><b>{fmtVND(bangGia.tong_xuat_hd)}</b></div>
                  <div className="flex justify-between px-3 py-2.5 bg-[#FFF6E5]"><span className="font-bold">Còn lại phải thu</span><b className="text-[18px] text-[#A25F00]">{fmtVND(Math.max((bangGia.gia_can_thanh_toan || 0) - (Number(coc) || 0), 0))}</b></div>
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
          {step === 4 && <button className="btn-ok" disabled={busy} onClick={luu}>💾 Lưu đơn</button>}
        </div>
      </div>
    </div>
  );
}
