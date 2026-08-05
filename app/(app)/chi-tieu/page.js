"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, MoneyInput } from "@/components/ui";
import { errMsg } from "@/lib/format";

const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`; };
const emptyF = { pham_vi: "he_thong", location_code: "", khu_vuc: "", brand: "", target_revenue: "", target_units: "", note: "" };

export default function ChiTieu() {
  const { supabase, locations, brands, regions, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [thang, setThang] = useState(thisMonth());
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState(emptyF);

  const load = async () => {
    const { data } = await supabase.from("sales_targets").select("*").eq("thang", thang).order("location_code").order("khu_vuc").order("brand");
    setRows(data || []);
  };
  useEffect(() => { if (!loading) load(); }, [loading, thang]);

  if (loading || !profile) return <div className="card">Đang tải…</div>;
  if (!["ADMIN", "CEO"].includes(profile.role)) return <div className="card">Chỉ Admin/BGĐ được xem trang này.</div>;

  const luu = async () => {
    if (f.pham_vi === "cua_hang" && !f.location_code) return notify("Chọn cửa hàng.", "err");
    if (f.pham_vi === "khu_vuc" && !f.khu_vuc) return notify("Chọn khu vực.", "err");
    if (!Number(f.target_revenue) && !Number(f.target_units)) return notify("Nhập ít nhất 1 chỉ tiêu (doanh thu hoặc số xe).", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_luu_chi_tieu", { p: {
      thang,
      location_code: f.pham_vi === "cua_hang" ? f.location_code : null,
      khu_vuc: f.pham_vi === "khu_vuc" ? f.khu_vuc : null,
      brand: f.brand || null,
      target_revenue: Number(f.target_revenue) || 0, target_units: Number(f.target_units) || 0, note: f.note,
    } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã lưu chỉ tiêu.");
    setF((p) => ({ ...emptyF, pham_vi: p.pham_vi, location_code: p.location_code, khu_vuc: p.khu_vuc }));
    load();
  };

  const xoa = async (id) => {
    if (!confirm("Xóa chỉ tiêu này?")) return;
    const { error } = await supabase.rpc("fn_xoa_chi_tieu", { p_id: id });
    if (error) return notify(errMsg(error), "err");
    notify("Đã xóa."); load();
  };

  const phamViLabel = (r) => r.location_code ? (locations.find((l) => l.code === r.location_code)?.name || r.location_code)
    : r.khu_vuc ? `Khu vực ${r.khu_vuc}` : "Toàn hệ thống";

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
          <Field label="Phạm vi">
            <select className="inp" value={f.pham_vi} onChange={(e) => setF((p) => ({ ...emptyF, pham_vi: e.target.value }))}>
              <option value="he_thong">Toàn hệ thống</option>
              <option value="khu_vuc">Theo khu vực</option>
              <option value="cua_hang">Theo cửa hàng</option>
            </select>
          </Field>
          {f.pham_vi === "khu_vuc" && (
            <Field label="Khu vực" required>
              <select className="inp" value={f.khu_vuc} onChange={(e) => setF((p) => ({ ...p, khu_vuc: e.target.value }))}>
                <option value="">— Chọn khu vực —</option>
                {regions.map((r) => <option key={r}>{r}</option>)}
              </select>
            </Field>
          )}
          {f.pham_vi === "cua_hang" && (
            <Field label="Cửa hàng" required>
              <select className="inp" value={f.location_code} onChange={(e) => setF((p) => ({ ...p, location_code: e.target.value }))}>
                <option value="">— Chọn cửa hàng —</option>
                {locations.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Hãng xe (để trống = chỉ tiêu tổng, không tách hãng)">
            <select className="inp" value={f.brand} onChange={(e) => setF((p) => ({ ...p, brand: e.target.value }))}>
              <option value="">— Tổng chung, không tách hãng —</option>
              {(brands || []).map((b) => <option key={b.name}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Chỉ tiêu doanh thu"><MoneyInput value={f.target_revenue} onChange={(v) => setF((p) => ({ ...p, target_revenue: v }))} /></Field>
          <Field label="Chỉ tiêu số xe"><input type="number" className="inp" value={f.target_units} onChange={(e) => setF((p) => ({ ...p, target_units: e.target.value }))} /></Field>
          <Field label="Ghi chú"><input className="inp" value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} /></Field>
        </div>
        <p className="text-xs text-[#8A93A0] mt-2">VD: muốn đặt "Khu vực Hàm Yên tháng 8: 60 xe VinFast + 50 xe TAILG" → chọn Phạm vi "Theo khu vực" → Hàm Yên → Hãng "VinFast" → 60 xe → Lưu; rồi lặp lại chọn Hãng "TAILG" → 50 xe → Lưu (2 dòng riêng).</p>
        <button className="btn-ok mt-3" disabled={busy} onClick={luu}>{busy ? "Đang lưu…" : "Lưu chỉ tiêu"}</button>
      </div>

      <div className="card">
        <div className="font-extrabold mb-2.5">Chỉ tiêu đã đặt trong tháng này</div>
        <table className="w-full border-collapse tbl-card">
          <thead><tr><th className="th">Phạm vi</th><th className="th">Hãng xe</th><th className="th">Chỉ tiêu doanh thu</th><th className="th">Chỉ tiêu số xe</th><th className="th">Ghi chú</th><th className="th"></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="td font-semibold">{phamViLabel(r)}</td>
                <td className="td">{r.brand ? <Badge tone="blue">{r.brand}</Badge> : <span className="text-[#8A93A0] text-xs">Tổng chung</span>}</td>
                <td className="td">{r.target_revenue.toLocaleString("vi-VN")}đ</td>
                <td className="td">{r.target_units}</td>
                <td className="td text-xs text-[#8A93A0]">{r.note}</td>
                <td className="td"><button className="btn-ghost !px-2 !py-1 !text-xs !text-danger" onClick={() => xoa(r.id)}>Xóa</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td" colSpan={6}>Chưa đặt chỉ tiêu tháng này.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}