"use client";
import { useState } from "react";
import { errMsg } from "@/lib/format";
import KhachPick from "@/components/KhachPick";

// Tao / sua ho so xe khach hang. initial = xe dang sua (co id) hoac null (tao moi).
// Tao moi: bat buoc co khach (chon san hoac tao moi) — xe luon gan voi 1 khach.
export default function XeFormModal({ supabase, brands, vehicles, notify, initial, defaultPlate = "", defaultFrame = "", onSaved, onClose }) {
  const edit = !!initial?.id;
  const [f, setF] = useState({
    plate: initial?.plate ?? defaultPlate, frame_number: initial?.frame_number ?? defaultFrame, engine_number: initial?.engine_number || "",
    brand: initial?.brand || "", model_name: initial?.model_name || "", color: initial?.color || "", year: initial?.year || "",
    warranty_start: initial?.warranty_start || "", warranty_end: initial?.warranty_end || "", note: initial?.note || "",
  });
  const [kh, setKh] = useState(null);
  const [moi, setMoi] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const models = [...new Set((vehicles || []).filter((v) => !f.brand || v.brand === f.brand).map((v) => v.name))].sort();

  const luu = async () => {
    if (!f.plate.trim() && !f.frame_number.trim()) return notify("Nhập biển số hoặc số khung.", "err");
    if (!edit && !kh && !(moi && moi.name.trim() && moi.phone.trim())) return notify("Chọn khách hàng hoặc nhập tên + SĐT khách mới.", "err");
    setBusy(true);
    const p = { ...f, id: initial?.id || null, year: f.year || null };
    if (!edit) { if (kh) p.customer_id = kh.id; else p.customer = moi; }
    const { data, error } = await supabase.rpc("fn_xe_luu", { p });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(edit ? "Đã cập nhật hồ sơ xe." : "Đã tạo hồ sơ xe.");
    onSaved && onSaved(data);
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-start justify-center p-3 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl w-[720px] max-w-full p-4 my-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center mb-3"><div className="font-extrabold text-base">{edit ? "Sửa hồ sơ xe" : "Thêm xe / khách hàng mới"}</div>
          <button className="ml-auto text-[#8A93A0] text-lg" onClick={onClose}>✕</button></div>

        {!edit && (<div className="mb-3">
          <label className="lbl">Chủ xe (khách hàng) *</label>
          <KhachPick supabase={supabase} value={kh} onPick={setKh} moi={moi} onMoi={setMoi} />
          <div className="text-[11px] text-[#8A93A0] mt-1">Một khách có thể sở hữu nhiều xe (khác hãng, khác biển số/số khung).</div>
        </div>)}

        <div className="grid gap-2.5 sm:grid-cols-2">
          <div><label className="lbl">Biển số xe</label><input className="inp" value={f.plate} onChange={(e) => set("plate", e.target.value)} placeholder="VD: 22AA-123.45" /></div>
          <div><label className="lbl">Số khung (VIN)</label><input className="inp font-mono" value={f.frame_number} onChange={(e) => set("frame_number", e.target.value)} /></div>
          <div><label className="lbl">Hãng xe</label>
            <input className="inp" list="xe-brands" value={f.brand} onChange={(e) => set("brand", e.target.value)} placeholder="VinFast, TAILG, Yadea…" />
            <datalist id="xe-brands">{(brands || []).map((b) => <option key={b.name} value={b.name} />)}</datalist></div>
          <div><label className="lbl">Kiểu xe / Model</label>
            <input className="inp" list="xe-models" value={f.model_name} onChange={(e) => set("model_name", e.target.value)} />
            <datalist id="xe-models">{models.map((m) => <option key={m} value={m} />)}</datalist></div>
          <div><label className="lbl">Màu</label><input className="inp" value={f.color} onChange={(e) => set("color", e.target.value)} /></div>
          <div><label className="lbl">Năm sản xuất</label><input type="number" className="inp" value={f.year} onChange={(e) => set("year", e.target.value)} /></div>
          <div><label className="lbl">Số máy</label><input className="inp" value={f.engine_number} onChange={(e) => set("engine_number", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="lbl">Bảo hành từ</label><input type="date" className="inp" value={f.warranty_start || ""} onChange={(e) => set("warranty_start", e.target.value)} /></div>
            <div><label className="lbl">đến</label><input type="date" className="inp" value={f.warranty_end || ""} onChange={(e) => set("warranty_end", e.target.value)} /></div>
          </div>
          <div className="sm:col-span-2"><label className="lbl">Ghi chú</label><input className="inp" value={f.note} onChange={(e) => set("note", e.target.value)} /></div>
        </div>
        <div className="flex gap-2 mt-4"><button className="btn-ok" disabled={busy} onClick={luu}>{busy ? "Đang lưu…" : edit ? "Lưu thay đổi" : "Lưu hồ sơ xe"}</button><button className="btn-ghost" onClick={onClose}>Hủy</button></div>
      </div>
    </div>
  );
}
