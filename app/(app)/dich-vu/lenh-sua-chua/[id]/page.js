"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, Field, LocSearch } from "@/components/ui";
import { fmtDate, fmtTime, errMsg } from "@/lib/format";
import { LOAI_DV, NHOM_SC, LSC_STATUS } from "@/lib/lsc";

export default function ChiTietLSC() {
  const { id } = useParams();
  const { supabase, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [r, setR] = useState(null);
  const [f, setF] = useState(null);
  const [staff, setStaff] = useState([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("cv");

  const load = async () => {
    const { data, error } = await supabase.from("v_lenh_sua_chua").select("*").eq("id", id).maybeSingle();
    if (error) return notify(errMsg(error), "err");
    setR(data);
    if (data) setF({ location_code: data.location_code, loai_dich_vu: data.loai_dich_vu, nhom_sua_chua: data.nhom_sua_chua, uu_tien: !!data.uu_tien, ktv_id: data.ktv_id || "", yeu_cau: data.yeu_cau || "",
      nguoi_mang_xe: data.nguoi_mang_xe || "", sdt_lai_xe: data.sdt_lai_xe || "", odo_km: data.odo_km ?? "", du_kien_bat_dau: data.du_kien_bat_dau || "", du_kien_giao_xe: data.du_kien_giao_xe || "", cam_ket_hoan_thanh: data.cam_ket_hoan_thanh || "" });
  };
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
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã lưu lệnh sửa chữa."); load();
  };
  const chuyen = async (action) => {
    let ly = "";
    if (action === "huy") { ly = prompt("Lý do hủy lệnh sửa chữa:") || ""; if (!ly.trim()) return; }
    else if (!confirm("Phát hành lệnh sửa chữa này? Sau khi phát hành, lệnh chuyển sang trạng thái đang thực hiện.")) return;
    const { error } = await supabase.rpc("fn_lsc_doi_trang_thai", { p_id: r.id, p_action: action, p_ly_do: ly });
    if (error) return notify(errMsg(error), "err");
    notify(action === "huy" ? "Đã hủy lệnh." : "Đã phát hành lệnh."); load();
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
          {!khoa && <button className="btn-ghost !text-xs hover:!text-danger" onClick={() => chuyen("huy")}>Hủy lệnh</button>}
          {!khoa && <button className="btn-primary !text-xs" disabled={busy} onClick={luu}>{busy ? "Đang lưu…" : "Lưu"}</button>}
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
          {[["cv", "Công việc"], ["vt", "Vật tư / Phụ tùng"]].map(([k, v]) => <button key={k} className={`btn !px-3 !py-2 !text-xs ${tab === k ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => setTab(k)}>{v}</button>)}
        </div>
        <div className="rounded-xl border border-dashed border-[#C9D2E0] bg-[#F8FAFD] p-6 text-center text-[13px] text-[#5A6572]">
          Mục <b>{tab === "cv" ? "Công việc" : "Vật tư / Phụ tùng"}</b> (chọn từ danh mục, báo giá, trừ kho) sẽ có ở <b>Giai đoạn 3</b>.
        </div>
      </div>
    </div>
  );
}
