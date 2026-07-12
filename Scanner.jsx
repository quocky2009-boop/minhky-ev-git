"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, VehicleSearch, LocSearch, FramePicker } from "@/components/ui";
import { fmtTime, errMsg } from "@/lib/format";
import { ADJUST_REASONS } from "@/lib/const";

export default function DieuChinh() {
  const { supabase, vehicles, locations, profile, loading, refresh } = useCatalog();
  const { toast, notify } = useToast();
  const [list, setList] = useState([]);
  const [units, setUnits] = useState([]);
  const [removeFrames, setRemoveFrames] = useState([]);
  const [f, setF] = useState({ vehicle_id: "", loc: "", add: "", reason: ADJUST_REASONS[0], note: "" });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const load = async () => {
    const { data } = await supabase.from("stock_adjustments").select("*").order("created_at", { ascending: false }).limit(100);
    setList(data || []);
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    setRemoveFrames([]);
    if (!f.vehicle_id || !f.loc) { setUnits([]); return; }
    (async () => {
      const { data } = await supabase.from("vehicle_units").select("*")
        .eq("vehicle_id", f.vehicle_id).eq("location_code", f.loc).eq("status", "TON_KHO").order("imported_at");
      setUnits(data || []);
    })();
  }, [f.vehicle_id, f.loc]);

  const addFrames = f.add.split(/[\n,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);

  const create = async () => {
    const { data, error } = await supabase.rpc("fn_de_xuat_dieu_chinh", {
      p_vehicle: f.vehicle_id, p_loc: f.loc, p_remove: removeFrames, p_add: addFrames, p_reason: f.reason, p_note: f.note,
    });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã gửi đề xuất ${data}. Tồn CHƯA thay đổi — chờ BGĐ/Admin duyệt.`);
    setF({ vehicle_id: "", loc: "", add: "", reason: ADJUST_REASONS[0], note: "" }); setRemoveFrames([]); load();
  };
  const decide = async (id, ok) => {
    const { error } = await supabase.rpc("fn_duyet_dieu_chinh", { p_id: id, p_approve: ok });
    if (error) return notify(errMsg(error), "err");
    notify(ok ? "Đã duyệt — tồn kho đã cập nhật theo số khung." : "Đã từ chối — tồn kho không thay đổi.");
    refresh(); load();
  };

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  const canApprove = ["CEO", "ADMIN"].includes(profile.role);
  const canRequest = ["CEO", "MANAGER", "ADMIN"].includes(profile.role);
  const locName = (c) => locations.find((l) => l.code === c)?.name || c;
  const fr = (j) => { try { return (j || []).join(", "); } catch { return ""; } };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      {canRequest && (
        <div className="card">
          <div className="font-extrabold text-base">Đề xuất điều chỉnh tồn — theo số khung</div>
          <p className="text-xs text-[#5A6572] mb-4">Chọn đích danh xe cần BỚT (mất, hỏng, sai sổ) và/hoặc nhập số khung xe cần THÊM (có thực tế nhưng thiếu trên sổ). Bắt buộc có lý do; tồn chỉ đổi sau khi BGĐ/Admin duyệt.</p>
          <div className="grid gap-x-4 md:grid-cols-2">
            <div>
              <Field label="Xe (gõ để tìm)" required><VehicleSearch vehicles={vehicles} value={f.vehicle_id} onChange={(v) => set("vehicle_id", v)} /></Field>
              <Field label="Kho / cửa hàng" required><LocSearch locations={locations} value={f.loc} onChange={(v) => set("loc", v)} /></Field>
              <Field label="Lý do điều chỉnh" required><select className="inp" value={f.reason} onChange={(e) => set("reason", e.target.value)}>{ADJUST_REASONS.map((r) => <option key={r}>{r}</option>)}</select></Field>
              <Field label="Ghi chú / biên bản"><input className="inp" value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
            </div>
            <div>
              <Field label={`BỚT xe khỏi sổ — chọn từ ${units.length} xe đang tồn`}>
                {f.vehicle_id && f.loc
                  ? <FramePicker units={units} selected={removeFrames} onToggle={(x) => setRemoveFrames((p) => p.includes(x) ? p.filter((y) => y !== x) : [...p, x])} />
                  : <div className="text-sm text-[#8A93A0] border border-dashed border-[#D5DBE3] rounded-xl px-3 py-4">Chọn xe và kho trước.</div>}
              </Field>
              <Field label={`THÊM xe vào sổ — mỗi dòng 1 số khung (${addFrames.length} xe)`}>
                <textarea className="inp !h-[90px] font-mono text-[13px]" value={f.add} onChange={(e) => set("add", e.target.value)} placeholder="RLGB1234567890099" />
              </Field>
            </div>
          </div>
          <button className="btn-primary" disabled={removeFrames.length === 0 && addFrames.length === 0} onClick={create}>
            Gửi đề xuất (bớt {removeFrames.length} / thêm {addFrames.length}) chờ duyệt
          </button>
        </div>
      )}

      <div className="card">
        <div className="font-extrabold mb-2.5">Danh sách đề xuất điều chỉnh</div>
        <div className="overflow-x-auto"><table className="w-full border-collapse">
          <thead><tr><th className="th">Phiếu</th><th className="th">Xe · Kho</th><th className="th">Số khung bớt / thêm</th><th className="th">Chênh</th><th className="th">Lý do</th><th className="th">Đề xuất</th><th className="th">Trạng thái</th><th className="th">Duyệt</th></tr></thead>
          <tbody>{list.map((ad) => {
            const v = vehicles.find((x) => x.id === ad.vehicle_id);
            return (
              <tr key={ad.id}>
                <td className="td"><b>{ad.code}</b><div className="text-[11px] text-[#8A93A0]">{fmtTime(ad.created_at)}</div></td>
                <td className="td">{v ? `${v.name} ${v.color}` : ad.vehicle_id}<div className="text-[11px] text-[#8A93A0]">{locName(ad.location_code)}</div></td>
                <td className="td text-[11px] font-mono">{fr(ad.frames_remove) && <div className="text-danger">− {fr(ad.frames_remove)}</div>}{fr(ad.frames_add) && <div className="text-[#0E7A4A]">+ {fr(ad.frames_add)}</div>}</td>
                <td className="td"><b className={ad.diff_qty < 0 ? "text-danger" : "text-[#0E7A4A]"}>{ad.diff_qty > 0 ? "+" : ""}{ad.diff_qty}</b></td>
                <td className="td">{ad.reason}{ad.note && <div className="text-[11px] text-[#8A93A0]">{ad.note}</div>}</td>
                <td className="td">{ad.requested_by_name}{ad.approved_by_name && <div className="text-[11px] text-[#8A93A0]">Duyệt: {ad.approved_by_name}</div>}</td>
                <td className="td">{ad.status === "Đã duyệt" ? <Badge tone="green">Đã duyệt</Badge> : ad.status === "Chờ duyệt" ? <Badge tone="amber">Chờ duyệt</Badge> : <Badge tone="gray">{ad.status}</Badge>}</td>
                <td className="td">
                  {ad.status === "Chờ duyệt" && canApprove && (
                    <div className="flex gap-1.5">
                      <button className="btn-ok !px-2.5 !py-1.5 !text-xs" onClick={() => decide(ad.id, true)}>Duyệt</button>
                      <button className="btn-danger !px-2.5 !py-1.5 !text-xs" onClick={() => decide(ad.id, false)}>Từ chối</button>
                    </div>
                  )}
                  {ad.status === "Chờ duyệt" && !canApprove && <span className="text-xs text-[#8A93A0]">Chờ BGĐ/Admin</span>}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </div>
    </div>
  );
}
