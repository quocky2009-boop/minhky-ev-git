"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, Field, LocSearch } from "@/components/ui";
import { fmtDate, fmtTime, fmtVND, errMsg } from "@/lib/format";
import BankOptions from "@/components/BankOptions";
import { LOAI_DV, NHOM_SC, LSC_STATUS } from "@/lib/lsc";

export default function ChiTietLSC() {
  const { id } = useParams();
  const { supabase, locations, profile, loading, paymentMethods } = useCatalog();
  const { toast, notify } = useToast();
  const [r, setR] = useState(null);
  const [f, setF] = useState(null);
  const [staff, setStaff] = useState([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("cv");
  const [lines, setLines] = useState([]);
  const [dsCv, setDsCv] = useState([]);
  const [dsPt, setDsPt] = useState([]);
  const [tonKho, setTonKho] = useState({});
  const [pays, setPays] = useState([]);
  const [pick, setPick] = useState("");
  const [pf, setPf] = useState({ method: "Tiền mặt", account_id: "", amount: "", note: "" });
  const [banks, setBanks] = useState([]);
  const [dirty, setDirty] = useState(false);

  const load = async () => {
    const { data, error } = await supabase.from("v_lsc").select("*").eq("id", id).maybeSingle();
    if (error) return notify(errMsg(error), "err");
    setR(data);
    if (data) setF({ location_code: data.location_code, loai_dich_vu: data.loai_dich_vu, nhom_sua_chua: data.nhom_sua_chua, uu_tien: !!data.uu_tien, ktv_id: data.ktv_id || "", yeu_cau: data.yeu_cau || "",
      nguoi_mang_xe: data.nguoi_mang_xe || "", sdt_lai_xe: data.sdt_lai_xe || "", odo_km: data.odo_km ?? "", du_kien_bat_dau: data.du_kien_bat_dau || "", du_kien_giao_xe: data.du_kien_giao_xe || "", cam_ket_hoan_thanh: data.cam_ket_hoan_thanh || "" });
  };
  const loadLines = async () => {
    const [{ data: ls }, { data: ps }] = await Promise.all([
      supabase.from("repair_order_lines").select("*").eq("ro_id", id).order("sort"),
      supabase.from("repair_order_payments").select("*").eq("ro_id", id).order("created_at"),
    ]);
    setLines((ls || []).map((l) => ({ ...l, key: "d" + l.id }))); setPays(ps || []); setDirty(false);
  };
  useEffect(() => {
    if (loading) return;
    loadLines();
    supabase.from("dv_services").select("id,code,name,group_name,price,loai_cv").eq("status", "Hoạt động").order("code").then(({ data }) => setDsCv(data || []));
    supabase.from("parts").select("id,code,name,unit,sell_price").eq("status", "Hoạt động").order("code").then(({ data }) => setDsPt(data || []));
    supabase.rpc("fn_tai_khoan_chon").then(({ data }) => setBanks((data || []).filter((a) => a.status === "Hoạt động" && a.type === "Ngân hàng")));
  }, [loading, id]);
  useEffect(() => {
    if (!r?.location_code) return;
    supabase.from("parts_stock").select("part_id,qty").eq("location_code", r.location_code).then(({ data }) => { const m = {}; (data || []).forEach((x) => { m[x.part_id] = x.qty; }); setTonKho(m); });
  }, [r?.location_code]);
  useEffect(() => { if (!loading) { load(); supabase.from("profiles").select("id,name,role").eq("status", "Hoạt động").in("role", ["TECHNICIAN", "MANAGER", "ADMIN", "CEO"]).order("name").then(({ data }) => setStaff(data || [])); } }, [loading, id]);

  if (loading || !profile) return <div className="card">Đang tải…</div>;
  if (!r || !f) return <div className="card">Không tìm thấy lệnh sửa chữa.</div>;
  const st = LSC_STATUS[r.status];
  const khoa = ["HUY", "HOAN_THANH_TT"].includes(r.status);
  const today = new Date().toLocaleDateString("sv-SE");
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const nhomGoiY = (loai) => ({ "Bảo dưỡng định kỳ": NHOM_SC[0], "Sửa chữa thông thường": NHOM_SC[1], "Bảo hành": NHOM_SC[2], "Lắp đặt phụ tùng / phụ kiện": NHOM_SC[3] }[loai]);

  const luu = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("fn_lsc_luu", { p: { id: r.id, ...f, odo_km: f.odo_km === "" ? null : Number(f.odo_km) } });
    if (error) { setBusy(false); return notify(errMsg(error), "err"); }
    if (r.status === "BAO_GIA" && dirty) {
      const { error: e2 } = await supabase.rpc("fn_lsc_luu_dong", { p: { id: r.id, lines: lines.map((l) => ({ line_type: l.line_type, service_id: l.service_id, part_id: l.part_id, ma: l.ma, name: l.name, loai_cv: l.loai_cv, don_vi: l.don_vi, qty: l.qty, unit_price: l.unit_price, giam_pct: l.giam_pct, giam_tien: l.giam_tien, phan_loai_tt: l.phan_loai_tt, serial: l.serial, ghi_chu: l.ghi_chu })) } });
      if (e2) { setBusy(false); return notify(errMsg(e2), "err"); }
    }
    setBusy(false);
    notify("Đã lưu lệnh sửa chữa."); await load(); await loadLines();
  };

  // ===== Cong viec / Vat tu =====
  const tinhTT = (l) => Math.max(Math.round((Number(l.qty) || 0) * (Number(l.unit_price) || 0) * (1 - (Number(l.giam_pct) || 0) / 100)) - (Number(l.giam_tien) || 0), 0);
  const upLine = (key, k, v) => { setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [k]: v } : l))); setDirty(true); };
  const xoaDong = (key) => { setLines((ls) => ls.filter((l) => l.key !== key)); setDirty(true); };
  const themCv = (c) => { setLines((ls) => [...ls, { key: "n" + Date.now() + Math.random(), line_type: "CONG", service_id: c.id, part_id: null, ma: c.code, name: c.name, loai_cv: c.loai_cv, don_vi: "", qty: 1, unit_price: c.price, giam_pct: 0, giam_tien: 0, phan_loai_tt: f.loai_dich_vu === "Bảo hành" ? "BAO_HANH" : "KHACH_HANG", serial: "", ghi_chu: "" }]); setDirty(true); setPick(""); };
  const themPt = (x) => { setLines((ls) => [...ls, { key: "n" + Date.now() + Math.random(), line_type: "PHU_TUNG", service_id: null, part_id: x.id, ma: x.code, name: x.name, loai_cv: "", don_vi: x.unit, qty: 1, unit_price: x.sell_price, giam_pct: 0, giam_tien: 0, phan_loai_tt: f.loai_dich_vu === "Bảo hành" ? "BAO_HANH" : "KHACH_HANG", serial: "", ghi_chu: "" }]); setDirty(true); setPick(""); };
  const PL = { KHACH_HANG: "Khách hàng", BAO_HANH: "Bảo hành hãng", NOI_BO: "Nội bộ" };
  const tong = (pl) => lines.filter((l) => !pl || l.phan_loai_tt === pl).reduce((a, l) => a + tinhTT(l), 0);
  const conPhaiThu = Math.max(Number(r.tong_khach_tra || 0) - Number(r.da_thu || 0), 0);
  const phayCv = lines.filter((l) => l.line_type === "CONG"); const phayPt = lines.filter((l) => l.line_type === "PHU_TUNG");

  const thuTien = async () => {
    const amount = Number(pf.amount) || conPhaiThu;
    const nh = paymentMethods.find((m) => m.code === pf.method)?.quy_type === "Ngân hàng";
    if (nh && !pf.account_id) return notify("Chọn tài khoản ngân hàng nhận tiền.", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_lsc_thu_tien", { p: { id: r.id, method: pf.method, account_id: pf.account_id || null, amount, note: pf.note } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã ghi nhận thu tiền."); setPf({ method: "Tiền mặt", account_id: "", amount: "", note: "" }); await load(); await loadLines();
  };
  const chuyen = async (action) => {
    let ly = "";
    if (action === "huy") { ly = prompt("Lý do hủy lệnh sửa chữa:") || ""; if (!ly.trim()) return; }
    else if (action === "phat_hanh") {
      if (dirty) return notify("Bấm Lưu trước khi phát hành (công việc/vật tư chưa lưu).", "err");
      if (!confirm("Phát hành lệnh sửa chữa? Phụ tùng sẽ được trừ kho ngay và không sửa được công việc/vật tư nữa.")) return;
    } else if (action === "hoan_thanh" && !confirm("Hoàn thành lệnh (không còn khoản phải thu)?")) return;
    const { error } = await supabase.rpc("fn_lsc_doi_trang_thai", { p_id: r.id, p_action: action, p_ly_do: ly });
    if (error) return notify(errMsg(error), "err");
    notify(action === "huy" ? "Đã hủy lệnh (phụ tùng đã xuất được hoàn kho)." : action === "hoan_thanh" ? "Đã hoàn thành lệnh." : "Đã phát hành lệnh — phụ tùng đã trừ kho."); load(); loadLines();
  };

  const row = (k, v) => <div className="flex justify-between gap-3 border-b border-dashed border-[#E3E8EF] py-1.5 text-[13px]"><span className="text-[#5A6572]">{k}</span><b className="text-right">{v || "—"}</b></div>;

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="text-[12px] text-[#5A6572]"><Link href="/dich-vu/lenh-sua-chua" className="text-brand hover:underline">Lệnh sửa chữa</Link> / {r.code}</div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg">{r.code}</div><Badge tone={st?.tone}>{st?.label}</Badge>{r.uu_tien && <Badge tone="red">🔥 Ưu tiên</Badge>}
        <div className="ml-auto flex gap-2 flex-wrap">
          {r.status === "BAO_GIA" && <button className="btn-ok !text-xs" onClick={() => chuyen("phat_hanh")}>Phát hành LSC</button>}
          {r.status === "PHAT_HANH" && conPhaiThu === 0 && <button className="btn-ok !text-xs" onClick={() => chuyen("hoan_thanh")}>Hoàn thành thanh toán</button>}
          {!khoa && <button className="btn-ghost !text-xs hover:!text-danger" onClick={() => chuyen("huy")}>Hủy lệnh</button>}
          {!khoa && <button className="btn-primary !text-xs" disabled={busy} onClick={luu}>{busy ? "Đang lưu…" : dirty ? "Lưu *" : "Lưu"}</button>}
        </div>
      </div>
      {r.status === "HUY" && <div className="rounded-xl bg-[#FDE8EA] text-[#B01E2C] text-[13px] px-3 py-2">Lệnh đã hủy — lý do: <b>{r.huy_ly_do}</b></div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="font-extrabold mb-2">Thông tin xe</div>
          {row("Biển số xe", r.plate)}{row("Số khung (VIN)", <span className="font-mono">{r.frame_number}</span>)}{row("Hãng · Kiểu xe · Màu", r.vehicle_desc)}
          <div className="font-extrabold mt-4 mb-2">Thông tin chủ xe</div>
          {row("Họ và tên", r.customer_name)}{row("Điện thoại", r.customer_phone)}{row("Mã khách hàng", r.customer_code)}
        </div>
        <div className="card">
          <div className="font-extrabold mb-2">Thông tin bảo hành</div>
          {row("Ngày kích hoạt bảo hành", r.warranty_start ? fmtDate(r.warranty_start) : "")}
          {row("Ngày kết thúc bảo hành", r.warranty_end ? <>{fmtDate(r.warranty_end)} {r.warranty_end < today ? <Badge tone="red">Hết hạn</Badge> : <Badge tone="green">Còn hạn</Badge>}</> : "")}
          {row("KM hiện tại", f.odo_km !== "" ? Number(f.odo_km).toLocaleString("vi-VN") : "")}
          <div className="font-extrabold mt-4 mb-2">Mốc thời gian</div>
          {row("Ngày tạo", fmtTime(r.created_at))}{row("Người tạo", r.created_by_name)}{row("Phát hành LSC", r.phat_hanh_at ? fmtTime(r.phat_hanh_at) : "")}{row("Ngày quyết toán", r.quyet_toan_at ? fmtTime(r.quyet_toan_at) : "")}
        </div>
      </div>

      <div className="card">
        <div className="font-extrabold mb-3">Thông tin lệnh sửa chữa</div>
        <fieldset disabled={khoa} className="grid gap-3 md:grid-cols-3 sm:grid-cols-2 border-0 p-0 m-0">
          <Field label="Điểm dịch vụ"><LocSearch locations={locations} value={f.location_code} onChange={(v) => set("location_code", v)} placeholder="Chọn điểm…" /></Field>
          <Field label="Loại dịch vụ"><select className="inp" value={f.loai_dich_vu} onChange={(e) => { set("loai_dich_vu", e.target.value); const g = nhomGoiY(e.target.value); if (g) set("nhom_sua_chua", g); }}>{LOAI_DV.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Nhóm sửa chữa"><select className="inp" value={f.nhom_sua_chua} onChange={(e) => set("nhom_sua_chua", e.target.value)}>{NHOM_SC.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Kỹ thuật viên (KTV)"><select className="inp" value={f.ktv_id} onChange={(e) => set("ktv_id", e.target.value)}><option value="">— Chưa phân công —</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="KM hiện tại (ODO)"><input type="number" className="inp" value={f.odo_km} onChange={(e) => set("odo_km", e.target.value)} /></Field>
          <div className="flex items-end pb-2.5"><label className="flex items-center gap-2 text-[13px] font-semibold cursor-pointer"><input type="checkbox" className="w-4 h-4" checked={f.uu_tien} onChange={(e) => set("uu_tien", e.target.checked)} />🔥 Ưu tiên tiếp nhận</label></div>
          <Field label="Người mang xe đến"><input className="inp" value={f.nguoi_mang_xe} onChange={(e) => set("nguoi_mang_xe", e.target.value)} placeholder="Nếu khác chủ xe" /></Field>
          <Field label="SĐT người lái xe"><input className="inp" value={f.sdt_lai_xe} onChange={(e) => set("sdt_lai_xe", e.target.value)} /></Field>
          <div className="hidden md:block" />
          <Field label="Dự kiến bắt đầu"><input type="date" className="inp" value={f.du_kien_bat_dau} onChange={(e) => set("du_kien_bat_dau", e.target.value)} /></Field>
          <Field label="Dự kiến giao xe"><input type="date" className="inp" value={f.du_kien_giao_xe} onChange={(e) => set("du_kien_giao_xe", e.target.value)} /></Field>
          <Field label="Cam kết hoàn thành"><input type="date" className="inp" value={f.cam_ket_hoan_thanh} onChange={(e) => set("cam_ket_hoan_thanh", e.target.value)} /></Field>
          <div className="md:col-span-3 sm:col-span-2"><Field label="Yêu cầu của khách hàng"><textarea className="inp !h-24" value={f.yeu_cau} onChange={(e) => set("yeu_cau", e.target.value)} placeholder="VD: Bảo dưỡng định kỳ 1000km, kiểm tra phanh…" /></Field></div>
        </fieldset>
      </div>

      <div className="card">
        <div className="flex gap-1.5 mb-3">
          {[["cv", `Công việc (${phayCv.length})`], ["vt", `Vật tư / Phụ tùng (${phayPt.length})`]].map(([k, v]) => <button key={k} className={`btn !px-3 !py-2 !text-xs ${tab === k ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => { setTab(k); setPick(""); }}>{v}</button>)}
        </div>
        {r.status === "BAO_GIA" && (
          <div className="relative mb-3">
            <input className="inp" placeholder={tab === "cv" ? "+ Thêm công việc: gõ mã hoặc tên công việc…" : "+ Thêm phụ tùng: gõ mã hoặc tên phụ tùng…"} value={pick} onChange={(e) => setPick(e.target.value)} />
            {pick.trim().length >= 1 && (
              <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-[#D5DBE3] rounded-xl shadow-lg max-h-64 overflow-y-auto">
                {(tab === "cv" ? dsCv.filter((c) => `${c.code} ${c.name}`.toLowerCase().includes(pick.trim().toLowerCase())).slice(0, 10).map((c) => (
                  <button key={c.id} className="w-full text-left px-3 py-2 border-b border-[#F2F4F7] hover:bg-[#F0FDF6] text-[13px]" onClick={() => themCv(c)}><b>{c.code}</b> · {c.name} <span className="text-[#8A93A0]">· {c.loai_cv} · {fmtVND(c.price)}</span></button>
                )) : dsPt.filter((c) => `${c.code} ${c.name}`.toLowerCase().includes(pick.trim().toLowerCase())).slice(0, 10).map((c) => (
                  <button key={c.id} className="w-full text-left px-3 py-2 border-b border-[#F2F4F7] hover:bg-[#F0FDF6] text-[13px]" onClick={() => themPt(c)}><b>{c.code}</b> · {c.name} <span className="text-[#8A93A0]">· {fmtVND(c.sell_price)} · tồn tại điểm này: <b className={(tonKho[c.id] || 0) > 0 ? "text-[#0E7A4A]" : "text-danger"}>{tonKho[c.id] || 0}</b></span></button>
                )))}
                {(tab === "cv" ? dsCv : dsPt).filter((c) => `${c.code} ${c.name}`.toLowerCase().includes(pick.trim().toLowerCase())).length === 0 && <div className="px-3 py-2 text-xs text-[#8A93A0]">Không có trong danh mục. {tab === "cv" ? "Thêm ở Dịch vụ → Danh mục công việc." : "Thêm ở Kho phụ tùng."}</div>}
              </div>)}
          </div>)}
        <div className="tbl-scroll"><table className="w-full border-collapse text-[12.5px]">
          <thead><tr><th className="th">Mã</th><th className="th">{tab === "cv" ? "Công việc" : "Phụ tùng"}</th>{tab === "cv" && <th className="th">Loại CV</th>}<th className="th">Phân loại TT</th><th className="th text-right">SL</th><th className="th text-right">Đơn giá</th><th className="th text-right">Giảm %</th><th className="th text-right">Giảm tiền</th><th className="th text-right">Thành tiền</th>{r.status === "BAO_GIA" && <th className="th"></th>}</tr></thead>
          <tbody>{(tab === "cv" ? phayCv : phayPt).map((l) => (
            <tr key={l.key}>
              <td className="td font-mono text-[11px]">{l.ma}</td><td className="td">{l.name}{l.line_type === "PHU_TUNG" && <div className="text-[10.5px] text-[#8A93A0]">{l.da_xuat_kho ? "✓ đã xuất kho" : `tồn tại điểm: ${tonKho[l.part_id] || 0}`}</div>}</td>
              {tab === "cv" && <td className="td text-[11.5px]">{l.loai_cv}</td>}
              <td className="td">{r.status === "BAO_GIA" ? <select className="inp !py-1 !text-xs !w-auto" value={l.phan_loai_tt} onChange={(e) => upLine(l.key, "phan_loai_tt", e.target.value)}>{Object.entries(PL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select> : <Badge tone={l.phan_loai_tt === "KHACH_HANG" ? "blue" : l.phan_loai_tt === "BAO_HANH" ? "green" : "gray"}>{PL[l.phan_loai_tt]}</Badge>}</td>
              {["qty", "unit_price", "giam_pct", "giam_tien"].map((k) => <td key={k} className="td text-right">{r.status === "BAO_GIA" ? <input type="number" min="0" className="inp !py-1 !text-xs !w-24 text-right" value={l[k]} onChange={(e) => upLine(l.key, k, e.target.value)} /> : (k === "unit_price" || k === "giam_tien" ? fmtVND(l[k]) : l[k])}</td>)}
              <td className="td text-right font-bold">{fmtVND(tinhTT(l))}</td>
              {r.status === "BAO_GIA" && <td className="td"><button className="text-danger font-bold" onClick={() => xoaDong(l.key)}>✕</button></td>}
            </tr>))}
            {(tab === "cv" ? phayCv : phayPt).length === 0 && <tr><td className="td text-[#8A93A0]" colSpan={10}>{r.status === "BAO_GIA" ? "Chưa có dòng nào — gõ vào ô phía trên để thêm từ danh mục." : "Không có dòng nào."}</td></tr>}
          </tbody>
        </table></div>
      </div>

      <div className="card">
        <div className="flex items-center gap-4 flex-wrap">
          <div><div className="text-[11px] text-[#5A6572] font-semibold uppercase">Tổng thanh toán cuối cùng (khách trả)</div><div className="text-2xl font-extrabold text-brand">{fmtVND(lines.length && dirty ? tong("KHACH_HANG") : r.tong_khach_tra)}</div></div>
          <div className="text-[12.5px] text-[#5A6572] flex gap-x-5 gap-y-1 flex-wrap">
            <span>Tổng chi phí: <b>{fmtVND(dirty ? tong() : r.tong_tien)}</b></span><span>Hãng chịu (bảo hành): <b className="text-[#0E7A4A]">{fmtVND(dirty ? tong("BAO_HANH") : r.tong_hang_tra)}</b></span>
            <span>Nội bộ: <b>{fmtVND(dirty ? tong("NOI_BO") : r.tong_noi_bo)}</b></span><span>Đã thu: <b>{fmtVND(r.da_thu)}</b></span><span>Còn phải thu: <b className={conPhaiThu > 0 ? "text-danger" : "text-[#0E7A4A]"}>{fmtVND(conPhaiThu)}</b></span>
          </div>
        </div>
        {r.status === "PHAT_HANH" && conPhaiThu > 0 && (
          <div className="mt-3 pt-3 border-t border-[#E3E8EF]">
            <div className="font-bold text-[13px] mb-2">Thu tiền khách hàng</div>
            <div className="flex gap-2 flex-wrap items-center">
              <select className="inp !w-auto" value={pf.method} onChange={(e) => setPf((p) => ({ ...p, method: e.target.value, account_id: "" }))}>
                {(paymentMethods.length ? paymentMethods.filter((m) => m.code !== "Trả góp").map((m) => m.code) : ["Tiền mặt", "Chuyển khoản"]).map((m) => <option key={m}>{m}</option>)}</select>
              {paymentMethods.find((m) => m.code === pf.method)?.quy_type === "Ngân hàng" && (
                <select className="inp !w-auto max-w-full" value={pf.account_id} onChange={(e) => setPf((p) => ({ ...p, account_id: e.target.value }))}><option value="">— Tài khoản nhận tiền —</option><BankOptions accounts={banks} companies={[]} /></select>)}
              <input type="number" className="inp !w-40" placeholder={`Số tiền (${fmtVND(conPhaiThu)})`} value={pf.amount} onChange={(e) => setPf((p) => ({ ...p, amount: e.target.value }))} />
              <input className="inp !w-48" placeholder="Ghi chú" value={pf.note} onChange={(e) => setPf((p) => ({ ...p, note: e.target.value }))} />
              <button className="btn-ok !text-xs" disabled={busy} onClick={thuTien}>Ghi nhận thu</button>
            </div>
          </div>)}
        {pays.length > 0 && (
          <div className="mt-3"><div className="font-bold text-[13px] mb-1">Phiếu thu ({pays.length})</div>
            {pays.map((x) => <div key={x.id} className="flex justify-between text-[12.5px] border-b border-dashed border-[#E3E8EF] py-1"><span><b>{x.code}</b> · {x.method} · {x.by_name} · {fmtTime(x.created_at)}</span><b>{fmtVND(x.amount)}</b></div>)}</div>)}
      </div>
    </div>
  );
}
