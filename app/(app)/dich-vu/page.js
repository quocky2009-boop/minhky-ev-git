"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, Field, KPI, CustomerSearch, LocSearch, Pager, pageSlice } from "@/components/ui";
import { fmtVND, fmtDate, fmtTime, errMsg } from "@/lib/format";
import { uploadAnhDon } from "@/lib/img";

const ST = {
  TIEP_NHAN: { label: "Tiếp nhận", tone: "blue" },
  CHAN_DOAN: { label: "Chẩn đoán", tone: "purple" },
  CHO_DUYET_GIA: { label: "Chờ duyệt giá", tone: "amber" },
  DANG_LAM: { label: "Đang làm", tone: "blue" },
  NGHIEM_THU: { label: "Nghiệm thu", tone: "purple" },
  CHO_THANH_TOAN: { label: "Chờ thanh toán", tone: "amber" },
  DA_GIAO: { label: "Đã giao", tone: "green" },
  HUY: { label: "Đã hủy", tone: "red" },
};
const LINE_TYPES = { CONG: "Tiền công", PHU_TUNG: "Phụ tùng", THUE_NGOAI: "Thuê ngoài", HANG_KHACH: "Hàng khách mang" };
const iso = (d) => d.toLocaleDateString("sv-SE");

function PhotoPick({ fotos, setFotos, label }) {
  return (
    <div>
      <label className="lbl">{label}</label>
      <div className="flex gap-2 flex-wrap items-center">
        <label className="btn-ghost !text-xs cursor-pointer">📷 Chọn / chụp ảnh
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => {
            const files = Array.from(e.target.files || []); e.target.value = "";
            files.forEach((file) => { const rd = new FileReader(); rd.onload = () => setFotos((p) => [...p, { file, url: rd.result }]); rd.readAsDataURL(file); });
          }} />
        </label>
        {fotos.map((fl, i) => (
          <span key={i} className="inline-flex items-center gap-1 bg-[#F3F5F8] rounded-lg px-1.5 py-1">
            <img src={fl.url} alt="" className="w-10 h-10 object-cover rounded" />
            <button className="text-danger font-bold text-xs" onClick={() => setFotos((p) => p.filter((_, j) => j !== i))}>✕</button>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function DichVu() {
  const { supabase, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [perms, setPerms] = useState({});
  const [rows, setRows] = useState([]);
  const [custs, setCusts] = useState([]);
  const [services, setServices] = useState([]);
  const [parts, setParts] = useState([]);
  const [fSt, setFSt] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  // tiep nhan
  const [show, setShow] = useState(false);
  const [f, setF] = useState({ location_code: "", customer_id: "", customer_name: "", customer_phone: "", frame_number: "", vehicle_desc: "", odo_km: "", battery_pct: "", assets_note: "", request_note: "" });
  const [fotos, setFotos] = useState([]);
  const [newC, setNewC] = useState(null);
  // chi tiet
  const [detail, setDetail] = useState(null);
  const [lines, setLines] = useState([]);
  const [pays, setPays] = useState([]);
  const [tong, setTong] = useState(null);
  const [discount, setDiscount] = useState(0);
  const [payF, setPayF] = useState({ method: "Chuyển khoản", amount: "" });
  const [payFotos, setPayFotos] = useState([]);
  const [serialPick, setSerialPick] = useState({});
  const [serialAvail, setSerialAvail] = useState({});

  const can = (p) => profile?.role === "CEO" || !!perms[p];

  const load = async () => {
    if (!profile) return;
    const [{ data: t }, { data: pm }, { data: c }, { data: sv }, { data: pt }] = await Promise.all([
      supabase.from("dv_tickets").select("*").order("created_at", { ascending: false }).limit(1000),
      supabase.from("role_perms").select("perm,allowed").eq("role", profile.role),
      supabase.from("customers").select("id,code,name,phone,status").order("created_at", { ascending: false }).limit(2000),
      supabase.from("dv_services").select("*").eq("status", "Hoạt động").order("group_name"),
      supabase.from("parts").select("*").eq("status", "Hoạt động").order("name"),
    ]);
    setRows(t || []); setCusts(c || []); setServices(sv || []); setParts(pt || []);
    const m = {}; (pm || []).forEach((x) => { m[x.perm] = x.allowed; }); setPerms(m);
  };
  useEffect(() => { if (!loading) load(); }, [loading, profile]);

  const openDetail = async (t) => {
    setDetail(t); setDiscount(t.discount || 0); setPayF({ method: "Chuyển khoản", amount: "" }); setPayFotos([]); setSerialPick({});
    const [{ data: l }, { data: p }, { data: v }] = await Promise.all([
      supabase.from("dv_ticket_lines").select("*").eq("ticket_id", t.id).order("id"),
      supabase.from("dv_payments").select("*").eq("ticket_id", t.id).order("id"),
      supabase.from("v_dv_ticket_tong").select("*").eq("ticket_id", t.id).single(),
    ]);
    setLines(l || []); setPays(p || []); setTong(v || null);
    // serial kha dung cho cac dong pin
    const serialParts = (l || []).filter((x) => x.line_type === "PHU_TUNG" && parts.find((pp) => pp.id === x.part_id)?.track_serial);
    const av = {};
    for (const x of serialParts) {
      const { data: u } = await supabase.from("part_units").select("serial").eq("part_id", x.part_id).eq("location_code", t.location_code).eq("status", "TON_KHO").limit(50);
      av[x.id] = (u || []).map((z) => z.serial);
    }
    setSerialAvail(av);
  };
  const reloadDetail = async () => { const { data: t } = await supabase.from("dv_tickets").select("*").eq("id", detail.id).single(); if (t) { await openDetail(t); load(); } };

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  // ===== TIEP NHAN =====
  const createQuick = async () => {
    if (!newC.name.trim() || !newC.phone.trim()) return notify("Nhập tên và SĐT khách.", "err");
    const { data, error } = await supabase.rpc("fn_luu_khach_hang", { p: { name: newC.name, phone: newC.phone, address: newC.address || "", source: "Dịch vụ" } });
    if (error) return notify(errMsg(error), "err");
    await load();
    const c = { id: data, name: newC.name, phone: newC.phone };
    setF((p) => ({ ...p, customer_id: data, customer_name: newC.name, customer_phone: newC.phone }));
    setNewC(null); notify("Đã tạo khách mới.");
  };

  const taoPhieu = async () => {
    if (!f.location_code) return notify("Chọn điểm dịch vụ.", "err");
    if (!f.customer_name || !f.customer_phone) return notify("Chọn hoặc tạo khách hàng.", "err");
    if (fotos.length < 4) return notify(`Bắt buộc tối thiểu 4 ảnh xe (đang có ${fotos.length}).`, "err");
    setBusy(true);
    let photos = [];
    try { notify(`Đang tải ${fotos.length} ảnh…`); photos = await uploadAnhDon(supabase, "tn/" + Date.now(), fotos.map((x) => x.file), "dich-vu"); }
    catch (e) { setBusy(false); return notify("Tải ảnh lỗi: " + (e.message || e), "err"); }
    const { data, error } = await supabase.rpc("fn_dv_tao_phieu", { p: { ...f, odo_km: f.odo_km || null, battery_pct: f.battery_pct || null, photos } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã tạo phiếu ${data}.`);
    setShow(false); setFotos([]); setF({ location_code: "", customer_id: "", customer_name: "", customer_phone: "", frame_number: "", vehicle_desc: "", odo_km: "", battery_pct: "", assets_note: "", request_note: "" });
    load();
  };

  // ===== ACTIONS =====
  const rpc = async (fn, args, okMsg) => {
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    if (okMsg) notify(okMsg);
    reloadDetail();
  };

  const saveBaoGia = async () => {
    await rpc("fn_dv_luu_bao_gia", { p: { id: detail.id, discount, lines: lines.filter((l) => !l.exported).map((l) => ({ ...l })) } }, "Đã lưu báo giá — chờ khách duyệt.");
  };
  const khachDuyet = () => rpc("fn_dv_khach_duyet", { p_id: detail.id, p_evidence: [] }, "Khách đã duyệt — chuyển sang thi công.");
  const nghiemThu = () => { const n = prompt("Ghi chú nghiệm thu (không bắt buộc):") || ""; rpc("fn_dv_nghiem_thu", { p_id: detail.id, p_note: n }, "Đã nghiệm thu — chờ thanh toán."); };
  const giaoXe = () => { if (confirm("Xác nhận giao xe cho khách?")) rpc("fn_dv_giao_xe", { p_id: detail.id }, "Đã giao xe — phiếu hoàn tất."); };
  const duyetNo = () => {
    const a = prompt("Số tiền công nợ được duyệt (đ):"); if (a === null) return;
    const n = prompt("Lý do / điều kiện công nợ (bắt buộc):"); if (n === null) return;
    rpc("fn_dv_duyet_cong_no", { p_id: detail.id, p_amount: Number(a) || 0, p_note: n }, "Đã duyệt công nợ.");
  };
  const huyPhieu = () => { const n = prompt("Lý do hủy phiếu (bắt buộc):"); if (n === null) return; rpc("fn_dv_huy_phieu", { p_id: detail.id, p_ly_do: n }, "Đã hủy phiếu, vật tư đã hoàn kho."); };
  const chanDoan = () => { const n = prompt("Chẩn đoán / tình trạng xe:", detail.diagnose_note || ""); if (n === null) return; rpc("fn_dv_chan_doan", { p: { id: detail.id, diagnose_note: n } }, "Đã lưu chẩn đoán."); };

  const xuatVatTu = async (l) => {
    const pt = parts.find((p) => p.id === l.part_id);
    let serials = [];
    if (pt?.track_serial) {
      serials = serialPick[l.id] || [];
      if (serials.length !== l.qty) return notify(`Chọn đúng ${l.qty} serial cho ${l.name}.`, "err");
    }
    rpc("fn_dv_xuat_vat_tu", { p_line_id: l.id, p_serials: serials }, `Đã xuất ${l.name} — tồn đã trừ.`);
  };

  const thuTien = async () => {
    if (!(Number(payF.amount) > 0)) return notify("Nhập số tiền.", "err");
    setBusy(true);
    let evidence = [];
    try { if (payFotos.length) evidence = await uploadAnhDon(supabase, "thu/" + detail.code, payFotos.map((x) => x.file), "dich-vu"); }
    catch (e) { setBusy(false); return notify("Tải ảnh lỗi: " + (e.message || e), "err"); }
    const { data, error } = await supabase.rpc("fn_dv_thu_tien", { p: { ticket_id: detail.id, method: payF.method, amount: Number(payF.amount), evidence } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã lập phiếu thu ${data}.`); setPayF({ method: "Chuyển khoản", amount: "" }); setPayFotos([]); reloadDetail();
  };

  // ===== CHI TIET =====
  if (detail) {
    const st = ST[detail.status] || { label: detail.status, tone: "dark" };
    const conLai = tong ? Math.max(0, tong.tong - tong.da_thu - tong.debt_approved) : null;
    const editable = !["DA_GIAO", "HUY"].includes(detail.status);
    return (
      <div className="flex flex-col gap-4">
        <Toast toast={toast} />
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-ghost !text-xs" onClick={() => { setDetail(null); load(); }}>← Danh sách</button>
          <div className="font-extrabold text-lg mr-auto">{detail.code}</div>
          <Badge tone={st.tone}>{st.label}</Badge>
          {editable && can("dv_huy_phieu") && <button className="btn-ghost !px-2.5 !py-1 !text-xs !text-danger" onClick={huyPhieu}>Hủy phiếu</button>}
        </div>

        <div className="card text-[13px] grid grid-cols-2 gap-x-4 gap-y-1.5">
          <div><span className="text-[#8A93A0]">Khách:</span> <b>{detail.customer_name}</b> · {detail.customer_phone}</div>
          <div><span className="text-[#8A93A0]">Điểm:</span> <b>{locations.find((l) => l.code === detail.location_code)?.name || detail.location_code}</b></div>
          <div className="col-span-2"><span className="text-[#8A93A0]">Xe:</span> <b>{detail.vehicle_desc || ("SK " + detail.frame_number)}</b>{detail.odo_km ? ` · ODO ${detail.odo_km}km` : ""}{detail.battery_pct != null ? ` · Pin ${detail.battery_pct}%` : ""}</div>
          {detail.request_note && <div className="col-span-2"><span className="text-[#8A93A0]">Yêu cầu:</span> {detail.request_note}</div>}
          {detail.assets_note && <div className="col-span-2"><span className="text-[#8A93A0]">Tài sản kèm:</span> {detail.assets_note}</div>}
          <div className="col-span-2"><span className="text-[#8A93A0]">Chẩn đoán:</span> {detail.diagnose_note || <i className="text-[#8A93A0]">chưa có</i>}
            {editable && can("dv_chan_doan") && <button className="btn-ghost !px-2 !py-0.5 !text-xs ml-2" onClick={chanDoan}>✎</button>}
            {detail.ktv_name && <span className="text-[11px] text-[#8A93A0]"> · KTV: {detail.ktv_name}</span>}
          </div>
          {(detail.photos || []).length > 0 && (
            <div className="col-span-2 flex gap-1.5 flex-wrap">{detail.photos.map((ph, i) => <a key={i} href={ph.url} target="_blank" rel="noreferrer"><img src={ph.url} alt="" className="w-14 h-14 object-cover rounded-lg border border-[#E3E8EF]" /></a>)}</div>
          )}
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <div className="font-extrabold mr-auto">Báo giá / hạng mục ({lines.length})</div>
            {editable && can("dv_bao_gia") && detail.status !== "CHO_THANH_TOAN" && (
              <button className="btn-ghost !text-xs" onClick={() => setLines((p) => [...p, { line_type: "CONG", name: "", qty: 1, unit_price: 0, approved: false, exported: false }])}>+ Thêm dòng</button>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {lines.map((l, i) => {
              const pt = parts.find((p) => p.id === l.part_id);
              return (
                <div key={l.id || "n" + i} className={`p-2.5 rounded-xl border ${l.exported ? "border-[#BBE3CC] bg-[#F4FBF7]" : "border-[#E3E8EF]"}`}>
                  <div className="flex gap-1.5 flex-wrap items-center">
                    {l.exported || !editable || !can("dv_bao_gia") ? (
                      <>
                        <Badge tone="dark">{LINE_TYPES[l.line_type]}</Badge>
                        <span className="font-semibold text-sm mr-auto">{l.name} ×{l.qty}</span>
                        {l.is_phat_sinh && <Badge tone="amber">Phát sinh</Badge>}
                        {l.approved ? <Badge tone="green">Khách duyệt ✓</Badge> : <Badge tone="amber">Chưa duyệt</Badge>}
                        {l.exported && <Badge tone="green">Đã xuất kho</Badge>}
                        <b>{fmtVND(l.amount)}</b>
                      </>
                    ) : (
                      <>
                        <select className="inp !w-auto !py-1.5 !text-xs" value={l.line_type} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, line_type: e.target.value, part_id: null, service_id: null } : x))}>
                          {Object.entries(LINE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        {l.line_type === "CONG" && (
                          <select className="inp !w-auto !py-1.5 !text-xs" value={l.service_id || ""} onChange={(e) => {
                            const sv = services.find((x) => x.id == e.target.value);
                            setLines((p) => p.map((x, j) => j === i ? { ...x, service_id: sv?.id || null, name: sv?.name || x.name, unit_price: sv?.price ?? x.unit_price } : x));
                          }}>
                            <option value="">— Bảng giá công —</option>
                            {services.map((sv) => <option key={sv.id} value={sv.id}>{sv.name} ({fmtVND(sv.price)})</option>)}
                          </select>
                        )}
                        {l.line_type === "PHU_TUNG" && (
                          <select className="inp !w-auto !py-1.5 !text-xs" value={l.part_id || ""} onChange={(e) => {
                            const pp = parts.find((x) => x.id == e.target.value);
                            setLines((p) => p.map((x, j) => j === i ? { ...x, part_id: pp?.id || null, name: pp?.name || x.name, unit_price: pp?.sell_price ?? x.unit_price } : x));
                          }}>
                            <option value="">— Chọn phụ tùng kho —</option>
                            {parts.map((pp) => <option key={pp.id} value={pp.id}>{pp.name}{pp.track_serial ? " (serial)" : ""}</option>)}
                          </select>
                        )}
                        <input className="inp !py-1.5 !text-xs flex-1 min-w-[120px]" placeholder="Tên hạng mục" value={l.name} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                        <input type="number" className="inp !py-1.5 !text-xs !w-16" title="SL" value={l.qty} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, qty: +e.target.value || 1 } : x))} />
                        <input type="number" className="inp !py-1.5 !text-xs !w-28" title="Đơn giá" value={l.unit_price} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, unit_price: +e.target.value || 0 } : x))} />
                        <b className="text-[13px] w-24 text-right">{fmtVND((l.qty || 1) * (l.unit_price || 0))}</b>
                        <button className="text-danger font-bold" onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>✕</button>
                      </>
                    )}
                  </div>
                  {l.exported === false && l.approved && l.line_type === "PHU_TUNG" && can("pt_xuat") && ["DANG_LAM", "NGHIEM_THU"].includes(detail.status) && (
                    <div className="mt-2 flex gap-1.5 flex-wrap items-center">
                      {pt?.track_serial && (serialAvail[l.id] || []).map((sn) => {
                        const on = (serialPick[l.id] || []).includes(sn);
                        return <button key={sn} className={`!px-2 !py-1 !text-[11px] rounded-lg border ${on ? "bg-brand text-white border-brand" : "bg-white border-[#D5DBE3]"}`}
                          onClick={() => setSerialPick((p) => ({ ...p, [l.id]: on ? (p[l.id] || []).filter((x) => x !== sn) : [...(p[l.id] || []), sn] }))}>{sn}</button>;
                      })}
                      <button className="btn-ok !px-2.5 !py-1 !text-xs" disabled={busy} onClick={() => xuatVatTu(l)}>⇧ Xuất kho{pt?.track_serial ? ` (${(serialPick[l.id] || []).length}/${l.qty} serial)` : ""}</button>
                    </div>
                  )}
                </div>
              );
            })}
            {lines.length === 0 && <div className="text-sm text-[#8A93A0]">Chưa có hạng mục.</div>}
          </div>
          {editable && can("dv_bao_gia") && (
            <div className="flex gap-2 items-center mt-3 flex-wrap">
              <span className="text-xs text-[#5A6572]">Giảm giá:</span>
              <input type="number" className="inp !py-1.5 !text-xs !w-28" value={discount} onChange={(e) => setDiscount(+e.target.value || 0)} />
              <button className="btn-primary !text-xs" disabled={busy} onClick={saveBaoGia}>💾 Lưu báo giá</button>
              {detail.status === "CHO_DUYET_GIA" && <button className="btn-ok !text-xs" disabled={busy} onClick={khachDuyet}>✓ Khách đã đồng ý báo giá</button>}
            </div>
          )}
        </div>

        <div className="card">
          <div className="font-extrabold mb-2">Thanh toán</div>
          {tong && (
            <div className="flex gap-3 flex-wrap mb-2">
              <KPI label="Tổng phiếu" value={fmtVND(tong.tong)} tone="dark" />
              <KPI label="Đã thu" value={fmtVND(tong.da_thu)} tone="green" />
              <KPI label="Công nợ duyệt" value={fmtVND(tong.debt_approved)} tone="blue" />
              <KPI label="Còn lại" value={fmtVND(conLai)} tone={conLai > 0 ? "amber" : "green"} />
            </div>
          )}
          {pays.map((p) => (
            <div key={p.id} className="flex items-center gap-2 text-sm py-1 border-b border-[#F0F2F5]">
              <span className="font-mono text-xs">{p.code}</span>
              <span className="mr-auto">{p.method} · {p.collected_by_name} · {fmtTime(p.created_at)}</span>
              {(p.evidence || []).map((ph, i) => <a key={i} href={ph.url} target="_blank" rel="noreferrer"><img src={ph.url} alt="" className="w-8 h-8 object-cover rounded" /></a>)}
              <b>{fmtVND(p.amount)}</b>
            </div>
          ))}
          {editable && can("dv_thu_tien") && (
            <div className="mt-3 flex gap-2 flex-wrap items-end">
              <div><label className="lbl">Hình thức</label>
                <select className="inp !py-2 !w-auto" value={payF.method} onChange={(e) => setPayF((p) => ({ ...p, method: e.target.value }))}>
                  <option>Chuyển khoản</option><option>Tiền mặt</option>
                </select></div>
              <div><label className="lbl">Số tiền</label><input type="number" className="inp !py-2 !w-36" value={payF.amount} onChange={(e) => setPayF((p) => ({ ...p, amount: e.target.value }))} /></div>
              <div className="min-w-[160px]"><PhotoPick fotos={payFotos} setFotos={setPayFotos} label={payF.method === "Tiền mặt" ? "Ảnh phiếu thu (bắt buộc)" : "Ảnh giao dịch"} /></div>
              <button className="btn-ok !py-2 !text-xs" disabled={busy} onClick={thuTien}>💵 Lập phiếu thu</button>
            </div>
          )}
          <div className="flex gap-2 mt-3 flex-wrap">
            {detail.status === "DANG_LAM" && can("dv_nghiem_thu") && <button className="btn-primary !text-xs" disabled={busy} onClick={nghiemThu}>✔ Nghiệm thu</button>}
            {editable && can("dv_eod") && <button className="btn-ghost !text-xs" disabled={busy} onClick={duyetNo}>Duyệt công nợ</button>}
            {detail.status === "CHO_THANH_TOAN" && can("dv_giao_xe") && (
              <button className="btn-ok !text-xs" disabled={busy || conLai > 0} title={conLai > 0 ? "Thu đủ hoặc duyệt công nợ trước" : ""} onClick={giaoXe}>
                🛵 Giao xe{conLai > 0 ? ` (còn thiếu ${fmtVND(conLai)})` : ""}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ===== DANH SACH + TIEP NHAN =====
  const filtered = rows.filter((t) => {
    if (fSt && t.status !== fSt) return false;
    if (!q) return true;
    const kw = q.toLowerCase();
    return `${t.code} ${t.customer_name} ${t.customer_phone} ${t.frame_number} ${t.vehicle_desc}`.toLowerCase().includes(kw);
  });
  const dem = (s) => rows.filter((t) => t.status === s).length;
  const dangMo = rows.filter((t) => !["DA_GIAO", "HUY"].includes(t.status)).length;

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Phiếu dịch vụ ({rows.length})</div>
        {can("dv_tiep_nhan") && <button className="btn-primary !text-sm" onClick={() => setShow(!show)}>{show ? "Đóng" : "+ Tiếp nhận xe"}</button>}
      </div>
      <div className="flex gap-3 flex-wrap">
        <KPI label="Đang mở" value={dangMo} tone={dangMo ? "amber" : "dark"} />
        <KPI label="Chờ duyệt giá" value={dem("CHO_DUYET_GIA")} tone="amber" />
        <KPI label="Đang làm" value={dem("DANG_LAM")} tone="blue" />
        <KPI label="Chờ thanh toán" value={dem("CHO_THANH_TOAN")} tone="purple" />
        <KPI label="Đã giao hôm nay" value={rows.filter((t) => t.status === "DA_GIAO" && (t.delivered_at || "").slice(0, 10) === iso(new Date())).length} tone="green" />
      </div>

      {show && (
        <div className="card !p-4 border-2 border-brand">
          <div className="font-extrabold mb-3">Tiếp nhận xe vào dịch vụ</div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Điểm dịch vụ" required><LocSearch locations={locations} value={f.location_code} onChange={(v) => setF((p) => ({ ...p, location_code: v }))} placeholder="Chọn điểm…" /></Field>
            <div>
              <Field label="Khách hàng" required>
                {newC ? (
                  <div className="grid gap-2 p-2.5 bg-[#F0FDF6] rounded-xl">
                    <input className="inp" placeholder="Họ tên *" value={newC.name} onChange={(e) => setNewC((p) => ({ ...p, name: e.target.value }))} />
                    <input className="inp" placeholder="SĐT *" value={newC.phone} onChange={(e) => setNewC((p) => ({ ...p, phone: e.target.value }))} />
                    <div className="flex gap-2"><button className="btn-ok !text-xs" onClick={createQuick}>Lưu khách</button><button className="btn-ghost !text-xs" onClick={() => setNewC(null)}>Hủy</button></div>
                  </div>
                ) : (
                  <CustomerSearch customers={custs} value={f.customer_id}
                    onPick={(c) => setF((p) => ({ ...p, customer_id: c?.id || "", customer_name: c?.name || "", customer_phone: c?.phone || "" }))}
                    onCreate={(name) => setNewC({ name: name || "", phone: "" })} />
                )}
              </Field>
            </div>
            <Field label="Số khung (xe Minh Kỳ bán, nếu có)"><input className="inp" value={f.frame_number} onChange={(e) => setF((p) => ({ ...p, frame_number: e.target.value.toUpperCase() }))} /></Field>
            <Field label="Mô tả xe (xe ngoài)"><input className="inp" placeholder="VD: VinFast Evo200 đỏ" value={f.vehicle_desc} onChange={(e) => setF((p) => ({ ...p, vehicle_desc: e.target.value }))} /></Field>
            <Field label="ODO (km)"><input type="number" className="inp" value={f.odo_km} onChange={(e) => setF((p) => ({ ...p, odo_km: e.target.value }))} /></Field>
            <Field label="Mức pin (%)"><input type="number" className="inp" value={f.battery_pct} onChange={(e) => setF((p) => ({ ...p, battery_pct: e.target.value }))} /></Field>
            <Field label="Tài sản / phụ kiện kèm theo"><input className="inp" placeholder="VD: 2 mũ bảo hiểm, sạc" value={f.assets_note} onChange={(e) => setF((p) => ({ ...p, assets_note: e.target.value }))} /></Field>
            <Field label="Yêu cầu của khách"><input className="inp" value={f.request_note} onChange={(e) => setF((p) => ({ ...p, request_note: e.target.value }))} /></Field>
            <div className="md:col-span-2"><PhotoPick fotos={fotos} setFotos={setFotos} label={`Ảnh hiện trạng xe — tối thiểu 4 ảnh trước/sau/2 bên (đang có ${fotos.length})`} /></div>
          </div>
          <div className="flex gap-2 mt-4">
            <button className="btn-ok" disabled={busy || fotos.length < 4} onClick={taoPhieu}>{busy ? "Đang lưu…" : `Tạo phiếu tiếp nhận${fotos.length < 4 ? ` (thiếu ${4 - fotos.length} ảnh)` : ""}`}</button>
            <button className="btn-ghost" onClick={() => setShow(false)}>Hủy</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <select className="inp !w-auto" value={fSt} onChange={(e) => { setFSt(e.target.value); setPage(1); }}>
            <option value="">Trạng thái: tất cả</option>
            {Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v.label} ({dem(k)})</option>)}
          </select>
          <input className="inp !w-64" placeholder="Tìm mã phiếu, khách, SĐT, số khung…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <div className="flex flex-col gap-2">
          {pageSlice(filtered, page, 15).map((t) => {
            const st = ST[t.status] || { label: t.status, tone: "dark" };
            return (
              <button key={t.id} className="flex items-center gap-2 p-2.5 rounded-xl border border-[#E3E8EF] hover:bg-[#F8FAFC] text-left" onClick={() => openDetail(t)}>
                <div className="mr-auto min-w-0">
                  <div className="font-semibold text-sm">{t.code} · {t.customer_name} <span className="text-[11px] text-[#8A93A0]">· {t.customer_phone}</span></div>
                  <div className="text-[11px] text-[#8A93A0] truncate">{t.vehicle_desc || ("SK " + t.frame_number)} · {locations.find((l) => l.code === t.location_code)?.name || t.location_code} · {fmtTime(t.created_at)}</div>
                </div>
                <Badge tone={st.tone}>{st.label}</Badge>
              </button>
            );
          })}
          {filtered.length === 0 && <div className="text-sm text-[#8A93A0]">Không có phiếu nào khớp bộ lọc.</div>}
        </div>
        <Pager total={filtered.length} page={page} setPage={setPage} pageSize={15} setPageSize={() => {}} />
      </div>
    </div>
  );
}
