"use client";
import { useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, VehicleSearch, LocSearch } from "@/components/ui";
import { errMsg, downloadCSV } from "@/lib/format";
import Scanner from "@/components/Scanner";

export default function QuetGom() {
  const { supabase, vehicles, locations, profile, loading, refresh } = useCatalog();
  const { toast, notify } = useToast();
  const [loc, setLoc] = useState("");
  const [vid, setVid] = useState("");         // model dang quet
  const [rows, setRows] = useState([]);        // {frame, vehicle_id}
  const [manual, setManual] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [busy, setBusy] = useState(false);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  const canImport = ["CEO", "ADMIN"].includes(profile.role);
  const vName = (id) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.name} ${v.color}` : id; };
  const locLabel = locations.find((l) => l.code === loc)?.name || "";

  const addFrames = (list) => {
    if (!vid) return notify("Chọn mẫu xe đang quét trước (dãy nào quét dãy đó).", "err");
    const clean = list.map((x) => x.trim().toUpperCase()).filter(Boolean);
    setRows((prev) => {
      const have = new Set(prev.map((r) => r.frame));
      const fresh = clean.filter((f) => !have.has(f));
      const dup = clean.length - fresh.length;
      if (dup > 0) notify(`Bỏ qua ${dup} số khung quét trùng.`, "err");
      return [...prev, ...fresh.map((f) => ({ frame: f, vehicle_id: vid }))];
    });
  };

  const addManual = () => {
    addFrames(manual.split(/[\n,;\s]+/));
    setManual("");
  };

  // Nhom theo model de hien thi
  const groups = {};
  rows.forEach((r) => { (groups[r.vehicle_id] = groups[r.vehicle_id] || []).push(r.frame); });

  const exportCSV = () => {
    if (rows.length === 0) return notify("Chưa có số khung nào.", "err");
    downloadCSV(`quet_${loc || "kho"}_${new Date().toISOString().slice(0, 10)}.csv`,
      [["frame_number", "vehicle_id"], ...rows.map((r) => [r.frame, r.vehicle_id])]);
    notify(`Đã xuất ${rows.length} số khung — gửi file này qua Zalo cho Admin/BGĐ để import vào kho ${locLabel || "(nhớ ghi rõ kho nào)"}.`);
  };

  const importNow = async () => {
    if (!loc) return notify("Chọn kho trước khi nhập thẳng.", "err");
    if (rows.length === 0) return notify("Chưa có số khung nào.", "err");
    if (!confirm(`Nhập thẳng ${rows.length} xe vào ${locLabel}?`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_import_units", {
      p_loc: loc,
      p_rows: rows.map((r) => ({ frame_number: r.frame, vehicle_id: r.vehicle_id, note: "Kiểm kê đầu kỳ" })),
    });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    const sk = data?.skipped || [];
    notify(`Đã nhập ${data?.inserted || 0} xe vào ${locLabel} (phiếu ${data?.doc}).` +
      (sk.length ? ` Bỏ qua ${sk.length}: ${sk.slice(0, 3).map((x) => `${x.frame} (${x.ly_do})`).join("; ")}${sk.length > 3 ? "…" : ""}` : ""),
      sk.length ? "err" : "ok");
    if (!sk.length) setRows([]);
    else setRows((prev) => prev.filter((r) => sk.some((x) => x.frame === r.frame)));
    refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      {showScanner && <Scanner onClose={() => setShowScanner(false)} onAdd={addFrames} />}

      <div className="card">
        <div className="font-extrabold text-base">Quét gom số khung → CSV</div>
        <p className="text-xs text-[#5A6572] mb-3">Dùng cho kiểm kê / nhập tồn đầu kỳ: đứng ở dãy xe nào thì chọn đúng mẫu xe đó rồi quét liên tục; sang dãy khác đổi mẫu xe quét tiếp. Xong bấm Xuất CSV gửi Admin — trang này không tự thay đổi tồn kho.</p>
        <div className="grid gap-x-4 md:grid-cols-2">
          <Field label="Kho / cửa hàng đang kiểm" required><LocSearch locations={locations} value={loc} onChange={setLoc} /></Field>
          <Field label="Mẫu xe đang quét (dãy hiện tại)" required><VehicleSearch vehicles={vehicles} value={vid} onChange={setVid} /></Field>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-primary !py-3 flex-1 min-w-[200px]" disabled={!vid} onClick={() => setShowScanner(true)}>📷 Quét camera / chụp OCR</button>
        </div>
        <div className="flex gap-1.5 mt-2">
          <input className="inp font-mono !text-[13px]" placeholder="Hoặc gõ/dán số khung, cách nhau xuống dòng…" value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addManual()} />
          <button className="btn-ghost whitespace-nowrap" onClick={addManual}>+ Thêm</button>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 flex-wrap mb-2.5">
          <div className="font-extrabold mr-auto">Đã gom: {rows.length} xe {locLabel && `· ${locLabel}`}</div>
          <button className="btn-ok !text-xs" onClick={exportCSV}>⬇ Xuất CSV gửi Admin</button>
          {canImport && <button className="btn-primary !text-xs" disabled={busy} onClick={importNow}>{busy ? "Đang nhập…" : "⚡ Nhập thẳng vào kho (Admin/BGĐ)"}</button>}
          {rows.length > 0 && <button className="btn-danger !text-xs" onClick={() => confirm("Xóa toàn bộ danh sách đã quét?") && setRows([])}>Làm lại</button>}
        </div>
        {Object.keys(groups).length === 0 && <div className="text-sm text-[#8A93A0]">Chưa quét xe nào. Chọn mẫu xe rồi bấm nút quét.</div>}
        {Object.entries(groups).map(([id, frames]) => (
          <div key={id} className="mb-2.5">
            <div className="text-[13px] font-extrabold mb-1"><Badge tone="blue">{frames.length}</Badge> {vName(id)}</div>
            <div className="flex gap-1.5 flex-wrap">
              {frames.map((fr) => (
                <span key={fr} className="inline-flex items-center gap-1 bg-[#F3F5F8] rounded-lg px-2 py-1 font-mono text-[11.5px]">
                  {fr}<button className="text-[#C6CDD6] hover:text-danger" onClick={() => setRows((p) => p.filter((r) => r.frame !== fr))}>✕</button>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
