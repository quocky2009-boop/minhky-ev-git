"use client";
import { useEffect, useState, useRef } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Toast, Badge, VehicleSearch, LocPicker } from "@/components/ui";
import { fmtTime, fmtDate, errMsg, parseCSV, downloadCSV } from "@/lib/format";
import Scanner from "@/components/Scanner";

export default function NhapHang() {
  const { supabase, vehicles, locations, loading, refresh, settings } = useCatalog();
  const { toast, notify } = useToast();
  const [txns, setTxns] = useState([]);
  const empty = { vehicle_id: "", loc: "", frames: "", supplier: "", doc: "", note: "" };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [detail, setDetail] = useState(null);       // {doc, txn, units}
  const [importLoc, setImportLoc] = useState("");
  const fileRef = useRef(null);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  // Xem chi tiet phieu nhap: cac so khung thuoc phieu
  const openDetail = async (t) => {
    const { data } = await supabase.from("vehicle_units").select("*").eq("import_doc", t.doc_code).order("vehicle_id");
    setDetail({ doc: t.doc_code, txn: t, units: data || [] });
  };

  const exportDetail = () => {
    if (!detail) return;
    downloadCSV(`phieu_nhap_${detail.doc}.csv`, [
      ["PHIẾU NHẬP HÀNG:", detail.doc],
      ["Thời gian:", fmtTime(detail.txn.created_at)],
      ["Người tạo:", detail.txn.created_by_name],
      ["Ghi chú:", detail.txn.note || ""],
      [],
      ["STT", "Số khung", "Mã xe", "Tên xe", "Màu", "Số máy", "Trạng thái hiện tại", "Đang ở kho"],
      ...detail.units.map((u, i) => {
        const v = vehicles.find((x) => x.id === u.vehicle_id);
        return [i + 1, u.frame_number, u.vehicle_id, v?.name || "", v?.color || "", u.engine_number || "",
          u.status === "TON_KHO" ? "Tồn kho" : u.status === "DA_BAN" ? "Đã bán" : u.status === "DANG_CHUYEN" ? "Đang chuyển" : u.status,
          locName(u.location_code)];
      }),
    ]);
    notify(`Đã xuất chi tiết phiếu ${detail.doc}.`);
  };

  // Import CSV nhap hang loat: vehicle_id + frame_number (+ engine_number, note)
  const importCSV = async (file) => {
    if (!importLoc) return notify("Chọn kho nhập trước khi import.", "err");
    const rows = parseCSV(await file.text());
    if (rows.length < 2) return notify("File trống hoặc sai định dạng.", "err");
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (k) => header.indexOf(k);
    if (idx("vehicle_id") < 0 || idx("frame_number") < 0)
      return notify("File cần tối thiểu 2 cột: vehicle_id (mã nội bộ, xem ở Danh mục xe), frame_number. Thêm được: engine_number, note.", "err");
    const items = rows.slice(1).map((r) => ({
      vehicle_id: r[idx("vehicle_id")]?.trim(),
      frame_number: r[idx("frame_number")]?.trim(),
      engine_number: idx("engine_number") >= 0 ? r[idx("engine_number")]?.trim() : "",
      note: idx("note") >= 0 ? r[idx("note")]?.trim() : "",
    }));
    const { data, error } = await supabase.rpc("fn_import_units", { p_loc: importLoc, p_rows: items });
    if (error) return notify(errMsg(error), "err");
    const sk = data?.skipped || [];
    notify(`Đã nhập ${data?.inserted || 0} xe vào ${locName(importLoc)} (phiếu ${data?.doc}).` +
      (sk.length ? ` Bỏ qua ${sk.length} dòng: ${sk.slice(0, 3).map((x) => `${x.frame} (${x.ly_do})`).join("; ")}${sk.length > 3 ? "…" : ""}` : ""),
      sk.length ? "err" : "ok");
    refresh(); load();
  };

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
        <div className="mt-4 pt-3 border-t border-dashed border-[#E6EAEF] flex gap-2 items-center flex-wrap">
          <span className="text-xs font-bold">Nhập hàng loạt từ file:</span>
          <select className="inp !w-auto !py-1.5 !text-xs" value={importLoc} onChange={(e) => setImportLoc(e.target.value)}>
            <option value="">— Kho nhập —</option>
            {locations.filter((l) => l.status === "Hoạt động").map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
          <button className="btn-ghost !py-1.5 !text-xs" onClick={() => fileRef.current?.click()}>⬆ Import CSV</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { if (e.target.files[0]) importCSV(e.target.files[0]); e.target.value = ""; }} />
          <span className="text-[11px] text-[#8A93A0]">Cột bắt buộc: vehicle_id (mã nội bộ), frame_number. Thêm được: engine_number, note. Excel: Save As → CSV UTF-8.</span>
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-3" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl w-[620px] max-w-full max-h-[88vh] overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <div className="font-extrabold text-base mr-auto">Phiếu nhập {detail.doc}</div>
              <button className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={exportDetail}>⬇ Xuất CSV phiếu</button>
              <button className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => setDetail(null)}>✕</button>
            </div>
            <div className="text-xs text-[#5A6572] mb-3">
              {fmtTime(detail.txn.created_at)} · Người tạo: <b>{detail.txn.created_by_name}</b> · Kho: <b>{locName(detail.txn.to_location)}</b> · {detail.units.length} xe
              {detail.txn.note && <div>Ghi chú: {detail.txn.note}</div>}
            </div>
            <table className="w-full border-collapse">
              <thead><tr><th className="th">Số khung</th><th className="th">Xe</th><th className="th">Trạng thái hiện tại</th></tr></thead>
              <tbody>{detail.units.map((u) => {
                const v = vehicles.find((x) => x.id === u.vehicle_id);
                return (
                  <tr key={u.frame_number}>
                    <td className="td font-mono text-[12px] font-bold">{u.frame_number}</td>
                    <td className="td">{v ? `${v.name} ${v.color}` : u.vehicle_id}</td>
                    <td className="td">{u.status === "TON_KHO" ? <Badge tone="green">Tồn · {locName(u.location_code)}</Badge>
                      : u.status === "DA_BAN" ? <Badge tone="blue">Đã bán {u.sale_code && `· ${u.sale_code}`}</Badge>
                      : u.status === "DANG_CHUYEN" ? <Badge tone="purple">Đang chuyển</Badge>
                      : <Badge tone="gray">{u.status}</Badge>}</td>
                  </tr>
                );
              })}
              {detail.units.length === 0 && <tr><td className="td" colSpan={3}>Phiếu này không có dữ liệu số khung chi tiết (có thể là phiếu từ bản cũ).</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="card">
        <div className="font-extrabold mb-2.5">Lịch sử nhập gần đây</div>
        <div className="overflow-x-auto"><table className="w-full border-collapse">
          <thead><tr><th className="th">Thời gian</th><th className="th">Phiếu</th><th className="th">Xe</th><th className="th">Kho nhập</th><th className="th">SL</th><th className="th">Tồn sau</th><th className="th">Người nhập</th><th className="th"></th></tr></thead>
          <tbody>{txns.map((t) => {
            const v = vehicles.find((x) => x.id === t.vehicle_id);
            return <tr key={t.id}>
              <td className="td">{fmtTime(t.created_at)}</td><td className="td font-bold">{t.doc_code}</td>
              <td className="td">{v ? `${v.name} ${v.color}` : t.vehicle_id}</td>
              <td className="td">{locName(t.to_location)}</td>
              <td className="td font-bold text-[#0E7A4A]">+{t.qty}</td>
              <td className="td">{t.stock_after}</td><td className="td">{t.created_by_name}</td>
              <td className="td"><button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => openDetail(t)}>Chi tiết</button></td>
            </tr>;
          })}</tbody>
        </table></div>
      </div>
    </div>
  );
}
