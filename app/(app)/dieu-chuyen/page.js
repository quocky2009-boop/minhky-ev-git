"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, VehicleSearch, LocPicker, FramePicker } from "@/components/ui";
import { fmtTime, errMsg } from "@/lib/format";

function DieuChuyenInner() {
  const params = useSearchParams();
  const { supabase, vehicles, locations, profile, loading, refresh } = useCatalog();
  const { toast, notify } = useToast();
  const [list, setList] = useState([]);
  const [units, setUnits] = useState([]);
  const [frames, setFrames] = useState([]);
  const [f, setF] = useState({ vehicle_id: params.get("xe") || "", from: "", to: "", note: "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const load = async () => {
    const { data } = await supabase.from("transfer_orders").select("*").order("requested_at", { ascending: false }).limit(100);
    setList(data || []);
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    setFrames([]);
    if (!f.vehicle_id || !f.from) { setUnits([]); return; }
    (async () => {
      const { data } = await supabase.from("vehicle_units").select("*")
        .eq("vehicle_id", f.vehicle_id).eq("location_code", f.from).eq("status", "TON_KHO").order("imported_at");
      setUnits(data || []);
    })();
  }, [f.vehicle_id, f.from]);

  const create = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_tao_dieu_chuyen", { p_vehicle: f.vehicle_id, p_from: f.from, p_to: f.to, p_frames: frames, p_note: f.note });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã tạo phiếu ${data} (${frames.length} xe). Xe được giữ chỗ, tồn chuyển khi bên nhận xác nhận.`);
    setF({ vehicle_id: "", from: "", to: "", note: "" }); setFrames([]); load(); refresh();
  };

  const confirm = async (id) => {
    const { error } = await supabase.rpc("fn_xac_nhan_dieu_chuyen", { p_id: id });
    if (error) return notify(errMsg(error), "err");
    notify("Đã xác nhận nhận xe: trừ kho đi, cộng kho đến."); refresh(); load();
  };
  const cancel = async (id) => {
    const { error } = await supabase.rpc("fn_huy_dieu_chuyen", { p_id: id });
    if (error) return notify(errMsg(error), "err");
    notify("Đã hủy phiếu. Xe trở lại trạng thái sẵn sàng tại kho đi."); refresh(); load();
  };

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  const canReceive = ["CEO", "MANAGER", "ADMIN"].includes(profile.role);
  const locName = (c) => locations.find((l) => l.code === c)?.name || c;
  const st = (s) => s === "Đã nhận" ? <Badge tone="green">Đã nhận</Badge> : s === "Đang chuyển" ? <Badge tone="blue">Đang chuyển</Badge> : <Badge tone="gray">{s}</Badge>;

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="card">
        <div className="font-extrabold text-base">Bước 1 · Tạo phiếu điều chuyển — theo số khung</div>
        <p className="text-xs text-[#5A6572] mb-4">Xe được chọn sẽ khóa ở trạng thái "Đang chuyển" (không bán được). Tồn kho chỉ đổi khi bên nhận xác nhận ở Bước 2.</p>
        <div className="grid gap-x-4 md:grid-cols-2">
          <div>
            <Field label="Xe (gõ để tìm)" required><VehicleSearch vehicles={vehicles} value={f.vehicle_id} onChange={(v) => set("vehicle_id", v)} /></Field>
            <Field label="Kho đi" required><LocPicker locations={locations} value={f.from} onChange={(v) => set("from", v)} /></Field>
            <Field label="Kho đến" required><LocPicker locations={locations} value={f.to} onChange={(v) => set("to", v)} exclude={f.from} /></Field>
            <Field label="Ghi chú"><input className="inp" value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="Lý do, người vận chuyển…" /></Field>
          </div>
          <Field label={`Chọn xe chuyển (${units.length} xe sẵn sàng tại kho đi)`} required>
            {f.vehicle_id && f.from
              ? <FramePicker units={units} selected={frames} onToggle={(fr) => setFrames((p) => p.includes(fr) ? p.filter((x) => x !== fr) : [...p, fr])} />
              : <div className="text-sm text-[#8A93A0] border border-dashed border-[#D5DBE3] rounded-xl px-3 py-4">Chọn xe và kho đi trước để hiện danh sách số khung.</div>}
          </Field>
        </div>
        <button className="btn-primary" disabled={busy || frames.length === 0 || !f.to} onClick={create}>Tạo phiếu điều chuyển ({frames.length} xe)</button>
      </div>

      <div className="card">
        <div className="font-extrabold mb-2.5">Bước 2 · Danh sách phiếu & xác nhận nhận xe</div>
        <div className="overflow-x-auto"><table className="w-full border-collapse">
          <thead><tr><th className="th">Phiếu</th><th className="th">Xe</th><th className="th">Kho đi → đến</th><th className="th">SL</th><th className="th">Người tạo</th><th className="th">Trạng thái</th><th className="th">Thao tác</th></tr></thead>
          <tbody>{list.map((tr) => {
            const v = vehicles.find((x) => x.id === tr.vehicle_id);
            return (
              <tr key={tr.id}>
                <td className="td"><b>{tr.code}</b><div className="text-[11px] text-[#8A93A0]">{fmtTime(tr.requested_at)}</div></td>
                <td className="td">{v ? `${v.name} ${v.color}` : tr.vehicle_id}<div className="text-[11px] text-[#8A93A0]">{tr.note}</div></td>
                <td className="td">{locName(tr.from_location)} <span className="text-brand font-bold">→</span> {locName(tr.to_location)}</td>
                <td className="td font-bold">{tr.quantity}</td>
                <td className="td">{tr.requested_by_name}{tr.confirmed_by_name && <div className="text-[11px] text-[#8A93A0]">Nhận: {tr.confirmed_by_name}</div>}</td>
                <td className="td">{st(tr.status)}</td>
                <td className="td">
                  {tr.status === "Đang chuyển" && canReceive && (
                    <div className="flex gap-1.5">
                      <button className="btn-ok !px-2.5 !py-1.5 !text-xs" onClick={() => confirm(tr.id)}>Xác nhận đã nhận</button>
                      <button className="btn-ghost !px-2.5 !py-1.5 !text-xs" onClick={() => cancel(tr.id)}>Hủy</button>
                    </div>
                  )}
                  {tr.status === "Đang chuyển" && !canReceive && <span className="text-xs text-[#8A93A0]">Chờ quản lý/kho xác nhận</span>}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </div>
    </div>
  );
}

export default function DieuChuyen() {
  return <Suspense fallback={<div className="card">Đang tải…</div>}><DieuChuyenInner /></Suspense>;
}
