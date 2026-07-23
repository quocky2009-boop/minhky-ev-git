"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, Field, KPI, CustomerSearch, LocSearch, Pager, pageSlice, MoneyInput, FrameSearch } from "@/components/ui";
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
const LOG_LABEL = {
  tiep_nhan: "Tiếp nhận xe", chan_doan: "Cập nhật chẩn đoán", bao_gia: "Lập / sửa báo giá",
  khach_duyet: "Khách duyệt báo giá", xuat_vat_tu: "Xuất vật tư", nghiem_thu: "Nghiệm thu",
  thu_tien: "Thu tiền", duyet_cong_no: "Duyệt công nợ", giao_xe: "Giao xe",
  hoan_tat: "Nghiệm thu & giao xe", huy_phieu: "Hủy phiếu",
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
  const [fSt, setFSt] = useState("");
  const [q, setQ] = useState("");
  const _params = useSearchParams();
  useEffect(() => { const v = _params.get("q"); if (v) setQ(v); }, [_params]);
  const [_autoOpened, _setAutoOpened] = useState(false);
  useEffect(() => {
    const v = _params.get("q");
    if (!v || _autoOpened || rows.length === 0) return;
    const hit = rows.filter((t) => t.code.toLowerCase() === v.toLowerCase());
    if (hit.length === 1) { _setAutoOpened(true); openDetail(hit[0]); }
  }, [_params, rows]);
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
  const [logs, setLogs] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [dType, setDType] = useState("amount");
  const [dPercent, setDPercent] = useState(0);
  const [payF, setPayF] = useState({ method: "Chuyển khoản", amount: "" });
  const [xeInfo, setXeInfo] = useState(null);
  const [nLines, setNLines] = useState([]);      // hang muc ngay khi tiep nhan
  const [nDisc, setNDisc] = useState({ type: "amount", amount: 0, percent: 0 });

  const can = (p) => profile?.role === "CEO" || !!perms[p];

  const load = async () => {
    if (!profile) return;
    const [{ data: t }, { data: pm }, { data: c }, { data: sv }] = await Promise.all([
      supabase.from("dv_tickets").select("*").order("created_at", { ascending: false }).limit(1000),
      supabase.from("role_perms").select("perm,allowed").eq("role", profile.role),
      supabase.from("customers").select("id,code,name,phone,status").order("created_at", { ascending: false }).limit(2000),
      supabase.from("dv_services").select("*").eq("status", "Hoạt động").order("group_name"),
    ]);
    setRows(t || []); setCusts(c || []); setServices(sv || []);
    const m = {}; (pm || []).forEach((x) => { m[x.perm] = x.allowed; }); setPerms(m);
  };
  useEffect(() => { if (!loading) load(); }, [loading, profile]);

  const openDetail = async (t) => {
    setDetail(t); setDiscount(t.discount || 0); setPayF({ method: "Chuyển khoản", amount: "" }); setPayFotos([]); setSerialPick({});
    const [{ data: l }, { data: p }, { data: v }, { data: lg }] = await Promise.all([
      supabase.from("dv_ticket_lines").select("*").eq("ticket_id", t.id).order("id"),
      supabase.from("dv_payments").select("*").eq("ticket_id", t.id).order("id"),
      supabase.from("v_dv_ticket_tong").select("*").eq("ticket_id", t.id).single(),
      supabase.from("dv_audit_logs").select("*").eq("entity_type", "ticket").eq("entity_id", t.code)
        .order("acted_at", { ascending: false }).limit(30),
    ]);
    setLogs(lg || []);
    setLines(l || []); setPays(p || []); setTong(v || null);
    setDiscount(t.discount || 0); setDType(t.discount_type || "amount"); setDPercent(t.discount_percent || 0);
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
    setBusy(true);
    let photos = [];
    try { if (fotos.length) { notify(`Đang tải ${fotos.length} ảnh…`); photos = await uploadAnhDon(supabase, "tn/" + Date.now(), fotos.map((x) => x.file), "dich-vu"); } }
    catch (e) { setBusy(false); return notify("Tải ảnh lỗi: " + (e.message || e), "err"); }
    const { data, error } = await supabase.rpc("fn_dv_tao_phieu", { p: { ...f, odo_km: f.odo_km || null, battery_pct: f.battery_pct || null, photos } });
    if (error) { setBusy(false); return notify(errMsg(error), "err"); }

    // Luu luon hang muc bao gia neu da nhap
    const ok = nLines.filter((l) => l.name?.trim());
    if (ok.length > 0) {
      const { data: t2 } = await supabase.from("dv_tickets").select("id").eq("code", data).single();
      if (t2) {
        const { error: e2 } = await supabase.rpc("fn_dv_luu_bao_gia", { p: {
          id: t2.id, lines: ok,
          discount_type: nDisc.type, discount: nDisc.type === "amount" ? nDisc.amount : 0,
          discount_percent: nDisc.type === "percent" ? nDisc.percent : 0,
        } });
        if (e2) notify("Đã tạo phiếu nhưng lưu báo giá lỗi: " + errMsg(e2), "err");
      }
    }
    setBusy(false);
    notify(`Đã tạo phiếu ${data}${ok.length ? ` kèm ${ok.length} hạng mục` : ""}.`);
    setShow(false); setFotos([]); setNLines([]); setNDisc({ type: "amount", amount: 0, percent: 0 }); setXeInfo(null);
    setF({ location_code: "", customer_id: "", customer_name: "", customer_phone: "", frame_number: "", vehicle_desc: "", odo_km: "", battery_pct: "", assets_note: "", request_note: "" });
    load();
  };

  // Tra xe da ban theo so khung
  const traXe = async (sk) => {
    if (!sk || sk.length < 4) { setXeInfo(null); return; }
    const { data } = await supabase.rpc("fn_tra_xe_da_ban", { p_frame: sk });
    const hit = (data || [])[0];
    if (hit) {
      setXeInfo(hit);
      setF((p) => ({ ...p, frame_number: hit.frame_number,
        vehicle_desc: p.vehicle_desc || `${hit.hang} ${hit.ten_xe} ${hit.mau}`.trim() }));
    } else setXeInfo(null);
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

  const saveBaoGia = async (dtype, dval) => {
    await rpc("fn_dv_luu_bao_gia", { p: {
      id: detail.id, lines: lines.map((l) => ({ ...l })),
      discount_type: dtype ?? detail.discount_type ?? "amount",
      discount: dtype === "percent" ? 0 : (dval ?? discount),
      discount_percent: dtype === "percent" ? (dval ?? 0) : 0,
    } }, "Đã lưu báo giá.");
  };
  const hoanTat = () => {
    if (!confirm("Xác nhận nghiệm thu và giao xe cho khách?")) return;
    rpc("fn_dv_hoan_tat", { p_id: detail.id, p_note: "" }, "Đã hoàn tất — nghiệm thu & giao xe.");
  };
  const duyetNo = () => {
    const a = prompt("Số tiền công nợ được duyệt (đ):"); if (a === null) return;
    const n = prompt("Lý do / điều kiện công nợ (bắt buộc):"); if (n === null) return;
    rpc("fn_dv_duyet_cong_no", { p_id: detail.id, p_amount: Number(a) || 0, p_note: n }, "Đã duyệt công nợ.");
  };
  const huyPhieu = () => { const n = prompt("Lý do hủy phiếu (bắt buộc):"); if (n === null) return; rpc("fn_dv_huy_phieu", { p_id: detail.id, p_ly_do: n }, "Đã hủy phiếu, vật tư đã hoàn kho."); };
  const chanDoan = () => { const n = prompt("Chẩn đoán / tình trạng xe:", detail.diagnose_note || ""); if (n === null) return; rpc("fn_dv_chan_doan", { p: { id: detail.id, diagnose_note: n } }, "Đã lưu chẩn đoán."); };

  const thuTien = async () => {
    if (!(Number(payF.amount) > 0)) return notify("Nhập số tiền.", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_dv_thu_tien", { p: { ticket_id: detail.id, method: payF.method, amount: Number(payF.amount), evidence: [] } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã lập phiếu thu ${data}.`); setPayF({ method: "Chuyển khoản", amount: "" }); reloadDetail();
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

        <div className="card !p-0 overflow-hidden">
          {[
            ["Khách hàng", <span key="k"><b>{detail.customer_name}</b> · {detail.customer_phone}</span>],
            ["Điểm dịch vụ", <b key="d">{locations.find((l) => l.code === detail.location_code)?.name || detail.location_code}</b>],
            ["Xe", <span key="x"><b>{detail.vehicle_desc || "—"}</b>{detail.frame_number ? <span className="text-[11px] text-[#8A93A0] block font-mono">SK {detail.frame_number}</span> : null}</span>],
            ...(detail.odo_km || detail.battery_pct != null
              ? [["ODO / Pin", <span key="o">{detail.odo_km ? `${detail.odo_km} km` : "—"}{detail.battery_pct != null ? ` · ${detail.battery_pct}%` : ""}</span>]] : []),
            ...(detail.request_note ? [["Yêu cầu của khách", detail.request_note]] : []),
            ...(detail.assets_note ? [["Tài sản kèm theo", detail.assets_note]] : []),
            ["Chẩn đoán", <span key="c">
              {detail.diagnose_note || <i className="text-[#8A93A0] font-normal">chưa có</i>}
              {editable && can("dv_chan_doan") && <button className="btn-ghost !px-2 !py-0.5 !text-xs ml-2" onClick={chanDoan}>✎</button>}
            </span>],
            ...(detail.ktv_name ? [["Kỹ thuật viên", detail.ktv_name]] : []),
          ].map(([k, v], i) => (
            <div key={i} className="flex items-start justify-between gap-3 px-3.5 py-2.5 border-b border-dashed border-[#E3E8EF] text-[13.5px]">
              <span className="text-[#5A6572] shrink-0">{k}</span>
              <span className="text-right font-semibold min-w-0 break-words">{v}</span>
            </div>
          ))}
          {(detail.photos || []).length > 0 && (
            <div className="flex gap-1.5 flex-wrap p-3">
              {detail.photos.map((ph, i) => <a key={i} href={ph.url} target="_blank" rel="noreferrer"><img src={ph.url} alt="" className="w-14 h-14 object-cover rounded-lg border border-[#E3E8EF]" /></a>)}
            </div>
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
                        <div className="!w-32"><MoneyInput className="!py-1.5 !text-xs" value={l.unit_price} onChange={(v) => setLines((p) => p.map((x, j) => j === i ? { ...x, unit_price: v || 0 } : x))} /></div>
                        <b className="text-[13px] w-24 text-right">{fmtVND((l.qty || 1) * (l.unit_price || 0))}</b>
                        <button className="text-danger font-bold" onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>✕</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {lines.length === 0 && <div className="text-sm text-[#8A93A0]">Chưa có hạng mục.</div>}
          </div>
          {editable && can("dv_bao_gia") && (
            <div className="flex gap-2 items-center mt-3 flex-wrap">
              <span className="text-xs text-[#5A6572]">Giảm giá cả đơn:</span>
              <select className="inp !w-auto !py-1.5 !text-xs" value={dType} onChange={(e) => setDType(e.target.value)}>
                <option value="amount">Số tiền</option><option value="percent">Phần trăm</option>
              </select>
              {dType === "amount"
                ? <div className="!w-36"><MoneyInput className="!py-1.5 !text-xs" value={discount} onChange={(v) => setDiscount(v || 0)} /></div>
                : <input type="number" className="inp !py-1.5 !text-xs !w-20" placeholder="%" value={dPercent} onChange={(e) => setDPercent(+e.target.value || 0)} />}
              <button className="btn-primary !text-xs" disabled={busy} onClick={() => saveBaoGia(dType, dType === "percent" ? dPercent : discount)}>💾 Lưu báo giá</button>
            </div>
          )}
        </div>

        <div className="card">
          <div className="font-extrabold mb-2">Thanh toán</div>
          {tong && (
            <div className="mb-3 rounded-xl border border-[#E3E8EF] overflow-hidden">
              {[
                ["Báo giá", fmtVND(tong.tong), "text-brand font-bold"],
                ["Đã thu", fmtVND(tong.da_thu), "text-[#0E7A4A] font-bold"],
                ...(tong.debt_approved > 0 ? [["Công nợ được duyệt", fmtVND(tong.debt_approved), "text-[#1D4FB8] font-bold"]] : []),
              ].map(([k, v, cls], i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF] text-[13.5px]">
                  <span className="text-[#5A6572]">{k}</span><span className={cls}>{v}</span>
                </div>
              ))}
              <div className={`flex items-center justify-between px-3 py-2.5 ${conLai > 0 ? "bg-[#FFF6E5]" : "bg-[#E7F6EE]"}`}>
                <span className="font-bold text-[13.5px]">Còn thu khi trả xe</span>
                <span className={`text-[17px] font-extrabold ${conLai > 0 ? "text-[#A25F00]" : "text-[#0E7A4A]"}`}>{fmtVND(conLai)}</span>
              </div>
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
              <div><label className="lbl">Số tiền</label><div className="!w-40"><MoneyInput className="!py-2" value={payF.amount} onChange={(v) => setPayF((p) => ({ ...p, amount: v }))} /></div></div>
              <button className="btn-ok !py-2 !text-xs" disabled={busy} onClick={thuTien}>💵 Lập phiếu thu</button>
            </div>
          )}
          <div className="flex gap-2 mt-3 flex-wrap">
            {editable && can("dv_eod") && <button className="btn-ghost !text-xs" disabled={busy} onClick={duyetNo}>Duyệt công nợ</button>}
            {editable && can("dv_giao_xe") && (
              <button className="btn-ok" disabled={busy || conLai > 0} title={conLai > 0 ? "Thu đủ hoặc duyệt công nợ trước" : ""} onClick={hoanTat}>
                ✅ Nghiệm thu & Giao xe{conLai > 0 ? ` (còn thiếu ${fmtVND(conLai)})` : ""}
              </button>
            )}
          </div>
        </div>

        <div className="card">
          <div className="font-extrabold mb-2">Nhật ký phiếu ({logs.length})</div>
          {logs.length === 0 ? <div className="text-sm text-[#8A93A0]">Chưa có thao tác nào.</div> : (
            <div className="max-h-56 overflow-y-auto pr-1">
              {logs.map((lg) => (
                <div key={lg.id} className="flex items-start gap-2 py-1.5 border-b border-dashed border-[#EEF1F4] text-[12.5px]">
                  <span className="text-[#8A93A0] whitespace-nowrap">{fmtTime(lg.acted_at)}</span>
                  <span className="text-[#8A93A0]">·</span>
                  <span className="text-[#5A6572] truncate">{lg.acted_by_name}</span>
                  <span className="ml-auto font-semibold text-right whitespace-nowrap">{LOG_LABEL[lg.action] || lg.action}</span>
                </div>
              ))}
            </div>
          )}
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
            <Field label="Số khung (xe Minh Kỳ bán — gõ tìm hoặc quét)">
              <FrameSearch supabase={supabase} value={f.frame_number}
                onPick={(sk, u) => { setF((p) => ({ ...p, frame_number: sk })); traXe(sk); }} />
              {xeInfo && (
                <div className="text-[11px] mt-1 p-2 rounded-lg bg-[#E7F6EE] text-[#0E7A4A]">
                  ✓ <b>{xeInfo.hang} {xeInfo.ten_xe} {xeInfo.mau}</b>
                  {xeInfo.sale_date && ` · Minh Kỳ bán ${new Date(xeInfo.sale_date).toLocaleDateString("vi-VN")}`}
                  {xeInfo.customer_name && ` · KH ${xeInfo.customer_name}`}
                </div>
              )}
            </Field>
            <Field label="Mô tả xe (tự điền nếu là xe Minh Kỳ bán, hoặc gõ tay)">
              <input className="inp" placeholder="VD: VinFast Evo200 đỏ" value={f.vehicle_desc} onChange={(e) => setF((p) => ({ ...p, vehicle_desc: e.target.value }))} />
            </Field>
            <Field label="ODO (km)"><input type="number" className="inp" value={f.odo_km} onChange={(e) => setF((p) => ({ ...p, odo_km: e.target.value }))} /></Field>
            <Field label="Mức pin (%)"><input type="number" className="inp" value={f.battery_pct} onChange={(e) => setF((p) => ({ ...p, battery_pct: e.target.value }))} /></Field>
            <Field label="Tài sản / phụ kiện kèm theo"><input className="inp" placeholder="VD: 2 mũ bảo hiểm, sạc" value={f.assets_note} onChange={(e) => setF((p) => ({ ...p, assets_note: e.target.value }))} /></Field>
            <Field label="Yêu cầu của khách"><input className="inp" value={f.request_note} onChange={(e) => setF((p) => ({ ...p, request_note: e.target.value }))} /></Field>
            <div className="md:col-span-2"><PhotoPick fotos={fotos} setFotos={setFotos} label={`Ảnh hiện trạng xe (không bắt buộc)${fotos.length ? ` — ${fotos.length} ảnh` : ""}`} /></div>
          </div>
          <div className="mt-4 pt-3 border-t border-[#EEF1F4]">
            <div className="flex items-center gap-2 mb-2">
              <div className="font-bold text-sm mr-auto">Báo giá / hạng mục (có thể nhập luôn)</div>
              <button className="btn-ghost !text-xs" onClick={() => setNLines((p) => [...p, { line_type: "CONG", name: "", qty: 1, unit_price: 0, discount_percent: 0 }])}>+ Thêm dòng</button>
            </div>
            <div className="flex flex-col gap-1.5">
              {nLines.map((l, i) => (
                <div key={i} className="flex gap-1.5 flex-wrap items-center p-2 rounded-lg border border-[#E3E8EF]">
                  <select className="inp !w-auto !py-1.5 !text-xs" value={l.line_type} onChange={(e) => setNLines((p) => p.map((x, j) => j === i ? { ...x, line_type: e.target.value } : x))}>
                    {Object.entries(LINE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  {l.line_type === "CONG" && (
                    <select className="inp !w-auto !py-1.5 !text-xs" value={l.service_id || ""} onChange={(e) => {
                      const sv = services.find((x) => x.id == e.target.value);
                      setNLines((p) => p.map((x, j) => j === i ? { ...x, service_id: sv?.id || null, name: sv?.name || x.name, unit_price: sv?.price ?? x.unit_price } : x));
                    }}>
                      <option value="">— Bảng giá —</option>
                      {services.map((sv) => <option key={sv.id} value={sv.id}>{sv.name}</option>)}
                    </select>
                  )}
                  <input className="inp !py-1.5 !text-xs flex-1 min-w-[130px]" placeholder="Tên hạng mục / phụ tùng" value={l.name}
                    onChange={(e) => setNLines((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                  <input type="number" className="inp !py-1.5 !text-xs !w-14" title="SL" value={l.qty}
                    onChange={(e) => setNLines((p) => p.map((x, j) => j === i ? { ...x, qty: +e.target.value || 1 } : x))} />
                  <div className="!w-32"><MoneyInput className="!py-1.5 !text-xs" value={l.unit_price}
                    onChange={(v) => setNLines((p) => p.map((x, j) => j === i ? { ...x, unit_price: v || 0 } : x))} /></div>
                  <input type="number" className="inp !py-1.5 !text-xs !w-16" title="Giảm %" placeholder="%" value={l.discount_percent || ""}
                    onChange={(e) => setNLines((p) => p.map((x, j) => j === i ? { ...x, discount_percent: +e.target.value || 0 } : x))} />
                  <b className="text-[13px] w-24 text-right">{fmtVND(Math.round((l.qty || 1) * (l.unit_price || 0) * (1 - (l.discount_percent || 0) / 100)))}</b>
                  <button className="text-danger font-bold" onClick={() => setNLines((p) => p.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
              {nLines.length === 0 && <div className="text-[13px] text-[#8A93A0]">Chưa có hạng mục — có thể thêm sau khi tạo phiếu.</div>}
            </div>
            {nLines.length > 0 && (
              <div className="flex gap-2 items-center mt-2 flex-wrap">
                <span className="text-xs text-[#5A6572]">Giảm giá cả đơn:</span>
                <select className="inp !w-auto !py-1.5 !text-xs" value={nDisc.type} onChange={(e) => setNDisc((p) => ({ ...p, type: e.target.value }))}>
                  <option value="amount">Số tiền</option><option value="percent">Phần trăm</option>
                </select>
                {nDisc.type === "amount"
                  ? <div className="!w-36"><MoneyInput className="!py-1.5 !text-xs" value={nDisc.amount} onChange={(v) => setNDisc((p) => ({ ...p, amount: v || 0 }))} /></div>
                  : <input type="number" className="inp !py-1.5 !text-xs !w-20" placeholder="%" value={nDisc.percent} onChange={(e) => setNDisc((p) => ({ ...p, percent: +e.target.value || 0 }))} />}
                <span className="text-[13px] font-bold ml-auto">
                  Tổng: {fmtVND(Math.max(0, (nDisc.type === "percent"
                    ? Math.round(nLines.reduce((a, l) => a + Math.round((l.qty || 1) * (l.unit_price || 0) * (1 - (l.discount_percent || 0) / 100)), 0) * (1 - (nDisc.percent || 0) / 100))
                    : nLines.reduce((a, l) => a + Math.round((l.qty || 1) * (l.unit_price || 0) * (1 - (l.discount_percent || 0) / 100)), 0) - (nDisc.amount || 0))))}
                </span>
              </div>
            )}
          </div>

          <div className="flex gap-2 mt-4">
            <button className="btn-ok" disabled={busy} onClick={taoPhieu}>{busy ? "Đang lưu…" : "Tạo phiếu tiếp nhận"}</button>
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
