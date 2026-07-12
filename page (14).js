"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, LocPicker } from "@/components/ui";
import { errMsg, downloadCSV } from "@/lib/format";
import Scanner from "@/components/Scanner";

export default function KiemKe() {
  const { supabase, vehicles, locations, loading, refresh } = useCatalog();
  const { toast, notify } = useToast();
  const [method, setMethod] = useState("frame"); // frame | qty
  const [loc, setLoc] = useState("");
  const [units, setUnits] = useState([]);
  const [scan, setScan] = useState("");
  const [actual, setActual] = useState({});
  const [busy, setBusy] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const loadUnits = async () => {
    if (!loc) { setUnits([]); return; }
    const { data } = await supabase.from("vehicle_units").select("*")
      .eq("location_code", loc).in("status", ["TON_KHO", "DANG_CHUYEN"]).order("vehicle_id");
    setUnits(data || []);
  };
  useEffect(() => { setActual({}); setScan(""); loadUnits(); }, [loc]);

  if (loading) return <div className="card">Đang tải dữ liệu…</div>;
  const vName = (id) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.name} ${v.color}` : id; };

  // ===== PHUONG PHAP 1: THEO SO KHUNG =====
  const scanned = [...new Set(scan.split(/[\n,;\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))];
  const sysFrames = units.map((u) => u.frame_number.toUpperCase());
  const missing = units.filter((u) => u.status === "TON_KHO" && !scanned.includes(u.frame_number.toUpperCase()));
  const inTransit = units.filter((u) => u.status === "DANG_CHUYEN");
  const extra = scanned.filter((s) => !sysFrames.includes(s));
  const matched = scanned.filter((s) => sysFrames.includes(s)).length;

  const submitFrame = async () => {
    if (missing.length === 0 && extra.length === 0) return notify("Không có chênh lệch — tồn thực tế khớp hệ thống.");
    setBusy(true);
    let created = 0, failed = 0;
    const byVehicle = {};
    missing.forEach((u) => { (byVehicle[u.vehicle_id] = byVehicle[u.vehicle_id] || []).push(u.frame_number); });
    for (const [vid, frames] of Object.entries(byVehicle)) {
      const { error } = await supabase.rpc("fn_de_xuat_dieu_chinh", {
        p_vehicle: vid, p_loc: loc, p_remove: frames, p_add: [],
        p_reason: "Kiểm kê lệch", p_note: `Không thấy khi kiểm kê ${new Date().toLocaleDateString("vi-VN")}`,
      });
      error ? failed++ : created++;
    }
    setBusy(false);
    let msg = `Đã tạo ${created} đề xuất bớt xe thiếu${failed ? `, ${failed} lỗi` : ""}.`;
    if (extra.length) msg += ` Còn ${extra.length} số khung lạ — vào "Điều chỉnh tồn" thêm thủ công (cần chọn đúng mã xe).`;
    notify(msg, failed ? "err" : "ok");
    setScan(""); loadUnits();
  };

  // ===== PHUONG PHAP 2: THEO SO LUONG =====
  const byVid = {};
  units.forEach((u) => { (byVid[u.vehicle_id] = byVid[u.vehicle_id] || []).push(u); });
  const qtyRows = Object.entries(byVid).map(([vid, us]) => ({ vid, sys: us.length, units: us }))
    .sort((a, b) => vName(a.vid).localeCompare(vName(b.vid)));

  const exportBienBan = () => {
    const locLabel = locations.find((l) => l.code === loc)?.name || loc;
    const today = new Date().toLocaleDateString("vi-VN");
    downloadCSV(`bien_ban_kiem_ke_${loc}_${new Date().toISOString().slice(0,10)}.csv`, [
      ["BIÊN BẢN KIỂM KÊ TỒN KHO"],
      ["Kho / cửa hàng:", locLabel],
      ["Ngày kiểm kê:", today],
      [],
      ["STT","Mã xe","Tên xe","Tồn hệ thống","Tồn thực tế","Chênh lệch","Ghi chú"],
      ...qtyRows.map((r, i) => {
        const act = actual[r.vid];
        const d = act !== undefined && act !== "" ? Number(act) - r.sys : "";
        return [i + 1, r.vid, vName(r.vid), r.sys, act ?? "", d, ""];
      }),
      [],
      ["TỔNG", "", "", qtyRows.reduce((s, r) => s + r.sys, 0),
        qtyRows.reduce((s, r) => s + (Number(actual[r.vid]) || 0), 0), "", ""],
      [],
      ["Người kiểm kê (ký, họ tên):", "", "", "Quản lý cửa hàng (ký, họ tên):", "", "", ""],
    ]);
    notify("Đã xuất biên bản kiểm kê CSV — mở bằng Excel, in ra để ký.");
  };

  const submitQty = async () => {
    const diffs = qtyRows.filter((r) => actual[r.vid] !== undefined && actual[r.vid] !== "" && Number(actual[r.vid]) !== r.sys);
    if (diffs.length === 0) return notify("Không có chênh lệch — tồn thực tế khớp hệ thống.");
    setBusy(true);
    let created = 0, failed = 0;
    for (const r of diffs) {
      const act = Number(actual[r.vid]);
      let remove = [], add = [];
      if (act < r.sys) {
        // Thieu xe: tu chon xe de bot — uu tien so khung TAM, sau do xe nhap lau nhat
        const candidates = r.units.filter((u) => u.status === "TON_KHO")
          .sort((a, b) => (b.is_placeholder - a.is_placeholder) || (new Date(a.imported_at) - new Date(b.imported_at)));
        remove = candidates.slice(0, r.sys - act).map((u) => u.frame_number);
        if (remove.length < r.sys - act) { failed++; continue; } // xe dang chuyen chiem cho, khong du de bot
      } else {
        // Thua xe: sinh so khung TAM, bo sung so that sau tai Chi tiet kho
        const ts = Date.now().toString().slice(-6);
        for (let i = 1; i <= act - r.sys; i++) add.push(`SKT-KK-${loc}-${r.vid}-${ts}${i}`.toUpperCase());
      }
      const { error } = await supabase.rpc("fn_de_xuat_dieu_chinh", {
        p_vehicle: r.vid, p_loc: loc, p_remove: remove, p_add: add,
        p_reason: "Kiểm kê lệch", p_note: `Kiểm kê theo số lượng ${new Date().toLocaleDateString("vi-VN")}: hệ thống ${r.sys}, thực tế ${act}`,
      });
      error ? failed++ : created++;
    }
    setBusy(false);
    notify(`Đã tạo ${created} đề xuất điều chỉnh chờ duyệt${failed ? `, ${failed} dòng lỗi (kiểm tra xe đang điều chuyển)` : ""}. Xe thừa được gán số khung tạm SKT-KK — vào Chi tiết kho sửa thành số thật.`, failed ? "err" : "ok");
    setActual({}); loadUnits(); refresh();
  };

  return (
    <div className="card">
      <Toast toast={toast} />
      {showScanner && <Scanner onClose={() => setShowScanner(false)}
        onAdd={(list) => setScan((p) => [...new Set([...p.split(/[\n,;\s]+/).map(x=>x.trim()).filter(Boolean), ...list])].join("\n"))} />}
      <div className="font-extrabold text-base">Phiên kiểm kê tồn thực tế</div>
      <div className="flex gap-1.5 my-3">
        <button className={`btn !px-3 !py-2 !text-xs ${method === "frame" ? "bg-brand text-white" : "bg-[#EEF1F4] text-[#3B4552]"}`} onClick={() => setMethod("frame")}>Theo số khung (chính xác nhất)</button>
        <button className={`btn !px-3 !py-2 !text-xs ${method === "qty" ? "bg-brand text-white" : "bg-[#EEF1F4] text-[#3B4552]"}`} onClick={() => setMethod("qty")}>Theo số lượng (đếm nhanh)</button>
      </div>
      <div className="max-w-sm"><Field label="Kho / cửa hàng kiểm kê" required><LocPicker locations={locations} value={loc} onChange={setLoc} /></Field></div>

      {loc && method === "frame" && (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Field label={`Số khung thực tế đếm được (${scanned.length} xe)`}>
              <textarea className="inp !h-[190px] font-mono text-[13px]" value={scan} onChange={(e) => setScan(e.target.value)}
                placeholder={"Quét hoặc dán, mỗi dòng 1 số khung\nRLGB1234567890001"} />
            </Field>
            <button className="btn-primary w-full !py-3" onClick={() => setShowScanner(true)}>📷 Quét camera / chụp OCR</button>
          </div>
          <div>
            <div className="text-sm mb-2">Hệ thống ghi nhận kho này có <b>{units.length}</b> xe ({inTransit.length > 0 ? `trong đó ${inTransit.length} đang chuyển đi` : "không có xe đang chuyển"}).</div>
            <div className="flex gap-2 flex-wrap mb-3">
              <Badge tone="green">Khớp: {matched}</Badge>
              <Badge tone="red">Thiếu (sổ có, thực tế không): {missing.length}</Badge>
              <Badge tone="amber">Lạ (thực tế có, sổ không): {extra.length}</Badge>
            </div>
            {missing.length > 0 && (
              <div className="bg-[#FDE8EA] rounded-lg p-3 text-[13px] mb-2 max-h-40 overflow-y-auto">
                <b>Xe thiếu:</b>
                {missing.map((u) => <div key={u.frame_number} className="font-mono">{u.frame_number} · {vName(u.vehicle_id)}</div>)}
              </div>
            )}
            {extra.length > 0 && (
              <div className="bg-[#FDF1DF] rounded-lg p-3 text-[13px] mb-2 max-h-32 overflow-y-auto">
                <b>Số khung lạ:</b>
                {extra.map((x) => <div key={x} className="font-mono">{x}</div>)}
              </div>
            )}
            <button className="btn-primary" disabled={busy || scanned.length === 0} onClick={submitFrame}>
              {busy ? "Đang xử lý…" : "Hoàn tất kiểm kê & tạo đề xuất điều chỉnh"}
            </button>
          </div>
        </div>
      )}

      {loc && method === "qty" && (
        <>
          <p className="text-xs text-[#5A6572] mb-2">Đếm số xe thực tế từng mẫu và nhập vào cột "Thực tế". Nếu thiếu, hệ thống tự chọn xe để bớt (ưu tiên số khung tạm, rồi xe nhập lâu nhất); nếu thừa, hệ thống sinh số khung tạm SKT-KK để bổ sung số thật sau. Muốn chính xác từng chiếc, dùng phương pháp theo số khung.</p>
          <div className="overflow-x-auto"><table className="w-full border-collapse">
            <thead><tr><th className="th">Xe</th><th className="th">Tồn hệ thống</th><th className="th">Thực tế</th><th className="th">Chênh</th></tr></thead>
            <tbody>
              {qtyRows.map((r) => {
                const act = actual[r.vid];
                const d = act !== undefined && act !== "" ? Number(act) - r.sys : null;
                return (
                  <tr key={r.vid}>
                    <td className="td font-bold">{vName(r.vid)}</td>
                    <td className="td">{r.sys}</td>
                    <td className="td"><input type="number" min="0" className="inp !w-24 !py-1.5" value={act ?? ""} placeholder={String(r.sys)}
                      onChange={(e) => setActual((p) => ({ ...p, [r.vid]: e.target.value }))} /></td>
                    <td className="td">{d === null ? "—" : d === 0 ? <Badge tone="green">Khớp</Badge> : <b className={d < 0 ? "text-danger" : "text-[#0E7A4A]"}>{d > 0 ? "+" : ""}{d}</b>}</td>
                  </tr>
                );
              })}
              {qtyRows.length === 0 && <tr><td className="td" colSpan={4}>Kho này hiện không có tồn trên hệ thống.</td></tr>}
            </tbody>
          </table></div>
          <div className="flex gap-2 mt-3 flex-wrap">
            <button className="btn-primary" disabled={busy} onClick={submitQty}>{busy ? "Đang xử lý…" : "Hoàn tất kiểm kê & tạo đề xuất điều chỉnh"}</button>
            <button className="btn-ghost" onClick={exportBienBan}>🖨 Xuất biên bản kiểm kê (CSV)</button>
          </div>
        </>
      )}
    </div>
  );
}
