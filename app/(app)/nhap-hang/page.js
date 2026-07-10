"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Toast, VehicleSearch, LocPicker } from "@/components/ui";
import { fmtTime, errMsg } from "@/lib/format";
import Scanner from "@/components/Scanner";

export default function NhapHang() {
  const { supabase, vehicles, locations, loading, refresh, settings } = useCatalog();
  const { toast, notify } = useToast();
  const [txns, setTxns] = useState([]);
  const empty = { vehicle_id: "", loc: "", frames: "", supplier: "", doc: "", note: "" };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const load = async () => {
    const { data } = await supabase.from("inventory_txns").select("*").eq("txn_type", "Nhập hàng").order("created_at", { ascending: false }).limit(50);
    setTxns(data || []);
  };
  useEffect(() => { load(); }, []);

  const frameList = f.frames.split(/[\n,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  const dup = frameList.filter((x, i) => frameList.indexOf(x) !== i);

  const submit = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_nhap_hang", { p_vehicle: f.vehicle_id, p_loc: f.loc, p_frames: frameList, p_supplier: f.supplier, p_doc: f.doc, p_note: f.note });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã nhập ${frameList.length} xe (phiếu ${data}). Tồn đã cộng tự động.`);
    setF(empty); refresh(); load();
  };

  if (loading) return <div className="card">Đang tải dữ liệu…</div>;
  const locName = (c) => locations.find((l) => l.code === c)?.name || c || "—";

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      {showScanner && <Scanner onClose={() => setShowScanner(false)}
        onAdd={(list) => set("frames", [...new Set([...f.frames.split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean), ...list])].join("\n"))} />}
      <div className="card">
        <div className="font-extrabold text-base">Phiếu nhập hàng — theo số khung</div>
        <p className="text-xs text-[#5A6572] mb-4">Mỗi xe 1 số khung, mỗi dòng 1 số. Có thể copy nguyên cột số khung từ file Excel của hãng rồi dán vào — số lượng tự đếm.</p>
        <div className="grid gap-x-4 md:grid-cols-2">
          <div>
            <Field label="Xe (gõ để tìm trong danh mục)" required><VehicleSearch vehicles={vehicles} value={f.vehicle_id} onChange={(v) => set("vehicle_id", v)} /></Field>
            <Field label="Kho / cửa hàng nhập" required><LocPicker locations={locations} value={f.loc} onChange={(v) => set("loc", v)} /></Field>
            <Field label="Nhà cung cấp" hint='Thêm/bớt nhà cung cấp trong menu Cài đặt.'>
              <select className="inp" value={f.supplier} onChange={(e) => set("supplier", e.target.value)}>
                <option value="">— Chọn nhà cung cấp —</option>
                {(settings.suppliers || "VinFast\nTAILG").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean).map((x) => <option key={x}>{x}</option>)}
              </select>
            </Field>
            <Field label="Số phiếu nhập"><input className="inp" value={f.doc} onChange={(e) => set("doc", e.target.value)} placeholder="Để trống sẽ tự sinh mã" /></Field>
            <Field label="Ghi chú"><input className="inp" value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
          </div>
          <div>
            <Field label={`Danh sách số khung — đã nhận diện ${frameList.length} xe`} required
              hint={dup.length ? `⚠ Có số khung lặp: ${[...new Set(dup)].join(", ")}` : "Mỗi dòng 1 số khung (hoặc cách nhau bằng dấu phẩy)."}>
              <textarea className="inp !h-[180px] font-mono text-[13px]" value={f.frames} onChange={(e) => set("frames", e.target.value)}
                placeholder={"RLGB1234567890001\nRLGB1234567890002\nRLGB1234567890003"} />
            </Field>
            <button className="btn-primary w-full !py-3" onClick={() => setShowScanner(true)}>📷 Quét camera / chụp OCR</button>
          </div>
        </div>
        <button className="btn-ok" disabled={busy || frameList.length === 0 || dup.length > 0} onClick={submit}>
          {busy ? "Đang lưu…" : `Lưu phiếu & cộng ${frameList.length} xe vào tồn`}
        </button>
      </div>
      <div className="card">
        <div className="font-extrabold mb-2.5">Lịch sử nhập gần đây</div>
        <div className="overflow-x-auto"><table className="w-full border-collapse">
          <thead><tr><th className="th">Thời gian</th><th className="th">Phiếu</th><th className="th">Xe</th><th className="th">Kho nhập</th><th className="th">SL</th><th className="th">Tồn sau</th><th className="th">Người nhập</th></tr></thead>
          <tbody>{txns.map((t) => {
            const v = vehicles.find((x) => x.id === t.vehicle_id);
            return <tr key={t.id}>
              <td className="td">{fmtTime(t.created_at)}</td><td className="td font-bold">{t.doc_code}</td>
              <td className="td">{v ? `${v.name} ${v.color}` : t.vehicle_id}</td>
              <td className="td">{locName(t.to_location)}</td>
              <td className="td font-bold text-[#0E7A4A]">+{t.qty}</td>
              <td className="td">{t.stock_after}</td><td className="td">{t.created_by_name}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </div>
    </div>
  );
}
