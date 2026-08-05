"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Toast, MoneyInput } from "@/components/ui";
import { errMsg } from "@/lib/format";

const iso = (d) => d.toLocaleDateString("sv-SE");
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`; };

export default function ChiTieu() {
  const { supabase, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [thang, setThang] = useState(thisMonth());
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ location_code: "", target_revenue: "", target_units: "", note: "" });

  const load = async () => {
    const { data } = await supabase.from("sales_targets").select("*").eq("thang", thang);
    setRows(data || []);
  };
  useEffect(() => { if (!loading) load(); }, [loading, thang]);

  if (loading || !profile) return <div className="card">Đang tải…</div>;
  if (!["ADMIN", "CEO"].includes(profile.role)) return <div className="card">Chỉ Admin/BGĐ được xem trang này.</div>;

  const luu = async () => {
    if (!Number(f.target_revenue) && !Number(f.target_units)) return notify("Nhập ít nhất 1 chỉ tiêu (doanh thu hoặc số xe).", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_luu_chi_tieu", { p: {
      thang, location_code: f.location_code || null,
      target_revenue: Number(f.target_revenue) || 0, target_units: Number(f.target_units) || 0, note: f.note,
    } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã lưu chỉ tiêu.");
    setF({ location_code: "", target_revenue: "", target_units: "", note: "" });
    load();
  };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Chỉ tiêu doanh số theo tháng</div>
        <input type="month" className="inp !w-auto" value={thang.slice(0,7)} onChange={(e) => setThang(e.target.value + "-01")} />
      </div>

      <div className="card">
        <div className="font-extrabold mb-2.5">Đặt/sửa chỉ tiêu tháng {thang.slice(5,7)}/{thang.slice(0,4)}</div>
        <div className="grid gap-3 md:grid-cols-4 sm:grid-cols-2">
          <Field label="Cửa hàng">
            <select className="inp" value={f.location_code} onChange={(e) => setF((p) => ({ ...p, location_code: e.target.value }))}>
              <option value="">— Toàn hệ thống —</option>
              {locations.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Chỉ tiêu doanh thu"><MoneyInput value={f.target_revenue} onChange={(v) => setF((p) => ({ ...p, target_revenue: v }))} /></Field>
          <Field label="Chỉ tiêu số xe"><input type="number" className="inp" value={f.target_units} onChange={(e) => setF((p) => ({ ...p, target_units: e.target.value }))} /></Field>
          <Field label="Ghi chú"><input className="inp" value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} /></Field>
        </div>
        <button className="btn-ok mt-3" disabled={busy} onClick={luu}>{busy ? "Đang lưu…" : "Lưu chỉ tiêu"}</button>
      </div>

      <div className="card">
        <div className="font-extrabold mb-2.5">Chỉ tiêu đã đặt trong tháng này</div>
        <table className="w-full border-collapse tbl-card">
          <thead><tr><th className="th">Cửa hàng</th><th className="th">Chỉ tiêu doanh thu</th><th className="th">Chỉ tiêu số xe</th><th className="th">Ghi chú</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="td font-semibold">{r.location_code ? (locations.find((l) => l.code === r.location_code)?.name || r.location_code) : "Toàn hệ thống"}</td>
                <td className="td">{r.target_revenue.toLocaleString("vi-VN")}đ</td>
                <td className="td">{r.target_units}</td>
                <td className="td text-xs text-[#8A93A0]">{r.note}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td" colSpan={4}>Chưa đặt chỉ tiêu tháng này.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
