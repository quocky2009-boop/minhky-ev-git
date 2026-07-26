"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast } from "@/components/ui";
import { fmtVND, fmtDate, fmtTime, errMsg } from "@/lib/format";

export default function DieuChuyenChiTiet() {
  const { id } = useParams();
  const router = useRouter();
  const { supabase, vehicles, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [t, setT] = useState(null);
  const [units, setUnits] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data: tr } = await supabase.from("transfer_orders").select("*").eq("id", id).single();
    if (!tr) return;
    setT(tr);
    if (tr.frames && tr.frames.length) {
      const { data: u } = await supabase.from("vehicle_units").select("frame_number,status,location_code,cost_price,vehicle_id")
        .in("frame_number", tr.frames);
      setUnits(u || []);
    }
  };
  useEffect(() => { if (!loading) load(); }, [loading, id]);

  if (loading || !t) return <div className="card">Đang tải phiếu điều chuyển…</div>;

  const vName = (id) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.brand} ${v.name} ${v.color}` : id; };
  const locName = (c) => locations.find((l) => l.code === c)?.name || c || "—";

  const statusTone = t.status === "Đã nhận" ? "green" : t.status === "Đang chuyển" ? "amber" : t.status === "Đã hủy" ? "red" : "dark";
  const canNhan = t.status === "Đang chuyển" && ["CEO", "MANAGER", "ADMIN"].includes(profile?.role);

  const nhanXe = async () => {
    if (!confirm(`Xác nhận đã nhận đủ ${t.quantity} xe tại ${locName(t.to_location)}?`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("fn_xac_nhan_dieu_chuyen", { p_id: t.id });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã xác nhận nhận xe — tồn kho đã cập nhật.");
    load();
  };

  // Group xe theo vehicle_id (1 phiếu có thể có nhiều mã xe)
  const byVehicle = {};
  (t.frames || []).forEach((f) => {
    const u = units.find((x) => x.frame_number === f);
    const vid = u?.vehicle_id || t.vehicle_id;
    if (!byVehicle[vid]) byVehicle[vid] = [];
    byVehicle[vid].push({ frame: f, unit: u });
  });

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Toast toast={toast} />

      {/* HEADER */}
      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-ghost !text-xs" onClick={() => router.back()}>← Quay lại danh sách điều chuyển</button>
        <div className="ml-auto flex gap-2">
          {canNhan && (
            <button className="btn-ok" disabled={busy} onClick={nhanXe}>✓ Xác nhận nhận xe</button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xl font-extrabold">{t.code}</span>
        <Badge tone={statusTone}>{t.status}</Badge>
      </div>

      {/* TIMELINE */}
      <div className="card !py-4 overflow-hidden">
        <div className="relative flex items-start justify-between">
          <div className="absolute top-3 left-0 right-0 h-0.5 bg-[#E3E8EF]" />
          <div className="absolute top-3 left-0 h-0.5 bg-brand"
            style={{ width: t.status === "Đã nhận" ? "100%" : t.status === "Đang chuyển" ? "50%" : "0%" }} />
          {[
            { label: "Lập phiếu", done: true, at: t.requested_at, by: t.requested_by_name },
            { label: "Đang chuyển", done: t.status !== "Nháp", at: t.requested_at, by: "" },
            { label: "Đã nhận xe", done: t.status === "Đã nhận", at: t.confirmed_at, by: t.confirmed_by_name },
          ].map((s, i) => (
            <div key={i} className="flex flex-col items-center relative" style={{ zIndex: 1, flex: 1 }}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[11px] font-bold border-2 ${s.done ? "bg-brand border-brand" : "bg-white border-[#D5DBE3]"}`}>
                {s.done ? "✓" : ""}
              </div>
              <div className="text-[10.5px] font-semibold text-center mt-1">{s.label}</div>
              {s.at && <div className="text-[9.5px] text-[#8A93A0] text-center">{fmtTime(s.at)}</div>}
              {s.by && <div className="text-[9.5px] text-[#8A93A0] text-center">{s.by}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* HÀNG HÓA */}
          <div className="card">
            <div className="font-extrabold mb-3">Xe điều chuyển ({t.quantity} chiếc)</div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead><tr className="text-[11.5px] text-[#8A93A0] uppercase border-b border-[#E3E8EF]">
                  <th className="text-left py-2 pl-2">Xe</th>
                  <th className="text-left py-2">Số khung</th>
                  <th className="text-left py-2">Trạng thái xe</th>
                  <th className="text-left py-2">Kho hiện tại</th>
                </tr></thead>
                <tbody>
                  {Object.entries(byVehicle).map(([vid, items]) => (
                    items.map(({ frame, unit }, i) => (
                      <tr key={frame} className="border-b border-dashed border-[#F0F2F5]">
                        {i === 0 && <td rowSpan={items.length} className="py-2.5 pl-2 align-top">
                          <div className="font-semibold">{vName(vid)}</div>
                          <div className="text-[10.5px] text-[#8A93A0]">{items.length} xe</div>
                        </td>}
                        <td className="py-2 font-mono text-[12px]">{frame}</td>
                        <td className="py-2">
                          {unit ? (
                            <Badge tone={unit.status === "TON_KHO" ? "green" : unit.status === "DANG_CHUYEN" ? "amber" : "dark"}>
                              {unit.status === "TON_KHO" ? "Tồn kho" : unit.status === "DANG_CHUYEN" ? "Đang chuyển" : unit.status}
                            </Badge>
                          ) : <span className="text-[#8A93A0]">—</span>}
                        </td>
                        <td className="py-2 text-xs">{unit ? locName(unit.location_code) : "—"}</td>
                      </tr>
                    ))
                  ))}
                  {(t.frames || []).length === 0 && (
                    <tr><td colSpan={4} className="py-3 text-[#8A93A0] pl-2">Phiếu cũ không lưu danh sách số khung.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {t.note && (
            <div className="card">
              <div className="font-extrabold mb-1">Ghi chú</div>
              <div className="text-[13px]">{t.note}</div>
            </div>
          )}
        </div>

        {/* CỘT PHẢI */}
        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="font-extrabold mb-3">Thông tin phiếu</div>
            <div className="flex flex-col gap-1.5 text-[13px]">
              {[
                ["Mã phiếu", t.code],
                ["Trạng thái", t.status],
                ["Kho xuất", locName(t.from_location)],
                ["Kho nhận", locName(t.to_location)],
                ["Số lượng", `${t.quantity} xe`],
                ["Người lập", t.requested_by_name],
                ["Ngày lập", fmtTime(t.requested_at)],
                t.confirmed_by_name && ["Người xác nhận", t.confirmed_by_name],
                t.confirmed_at && ["Ngày xác nhận", fmtTime(t.confirmed_at)],
              ].filter(Boolean).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-[#8A93A0] w-28 shrink-0">{k}</span>
                  <span className="font-semibold">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Hướng điều chuyển */}
          <div className="card text-center">
            <div className="text-[12px] text-[#8A93A0] mb-1">Hướng điều chuyển</div>
            <div className="font-bold text-[13px]">{locName(t.from_location)}</div>
            <div className="text-2xl my-1">→</div>
            <div className="font-bold text-[13px] text-brand">{locName(t.to_location)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
