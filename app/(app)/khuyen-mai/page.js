"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, Pager, pageSlice, useSortable, Th } from "@/components/ui";
import { fmtDate, errMsg } from "@/lib/format";

const iso = (d) => d.toLocaleDateString("sv-SE");
const empty = { brand: "VinFast", name: "", vehicle_names: [], start_date: iso(new Date()), end_date: iso(new Date()), note: "", status: "Đang áp dụng", battery_options: [] };
const BATTERY_OPTIONS = ["Kèm pin", "Thuê pin"];

export default function KhuyenMai() {
  const { supabase, vehicles, brands, profile, loading, refresh } = useCatalog();
  const { toast, notify } = useToast();
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState(null);
  const [f, setF] = useState(empty);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const sort = useSortable();

  const load = async () => {
    const { data } = await supabase.from("promotions").select("*").order("created_at", { ascending: false });
    setRows(data || []);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải…</div>;
  const canQuan = ["ADMIN", "CEO"].includes(profile.role);

  const today = iso(new Date());
  const trangThaiThuc = (r) => {
    if (r.status === "Tạm dừng") return "Tạm dừng";
    if (r.end_date < today) return "Hết hạn";
    return "Đang áp dụng";
  };
  const TONE = { "Đang áp dụng": "green", "Tạm dừng": "amber", "Hết hạn": "dark" };

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const openNew = () => { setEditId(null); setF(empty); setShow(true); };
  const openEdit = (r) => { setEditId(r.id); setF({ brand: r.brand, name: r.name, vehicle_names: r.vehicle_names || [],
    start_date: r.start_date, end_date: r.end_date, note: r.note || "", status: r.status, battery_options: r.battery_options || [] }); setShow(true); };

  const luu = async () => {
    if (!f.name.trim()) return notify("Nhập tên chương trình.", "err");
    if (!f.brand) return notify("Chọn hãng áp dụng.", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_luu_khuyen_mai", { p: { id: editId, ...f } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(editId ? "Đã cập nhật chương trình." : "Đã tạo chương trình khuyến mại.");
    setShow(false); setF(empty); setEditId(null); load(); refresh();
  };

  const modelsOfBrand = [...new Set(vehicles.filter((v) => v.brand === f.brand).map((v) => v.name))].sort();

  const filtered = rows.filter((r) => {
    if (!q) return true;
    const kw = q.toLowerCase();
    return `${r.code} ${r.name} ${r.brand}`.toLowerCase().includes(kw);
  });
  const sorted = sort.sortFn(filtered, { code: (r) => r.code, name: (r) => r.name, brand: (r) => r.brand,
    tu: (r) => r.start_date, den: (r) => r.end_date, tt: trangThaiThuc });

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Chương trình khuyến mại</div>
        {canQuan && <button className="btn-primary !text-xs" onClick={openNew}>+ Tạo chương trình</button>}
      </div>

      {show && (
        <div className="card">
          <div className="font-extrabold mb-3">{editId ? "Sửa chương trình khuyến mại" : "Tạo chương trình khuyến mại mới"}</div>
          <div className="grid gap-3 md:grid-cols-3 sm:grid-cols-2">
            <Field label="Tên chương trình" required><input className="inp" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="Hãng áp dụng" required>
              <select className="inp" value={f.brand} onChange={(e) => set("brand", e.target.value)}>
                {(brands || []).map((b) => <option key={b.name}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Trạng thái">
              <select className="inp" value={f.status} onChange={(e) => set("status", e.target.value)}>
                <option>Đang áp dụng</option><option>Tạm dừng</option><option>Hết hạn</option>
              </select>
            </Field>
            <Field label="Từ ngày" required><input type="date" className="inp" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} /></Field>
            <Field label="Đến ngày" required><input type="date" className="inp" value={f.end_date} onChange={(e) => set("end_date", e.target.value)} /></Field>
            <div className="md:col-span-3 sm:col-span-2">
              <label className="lbl">Tên xe (Model) áp dụng — bỏ trống = áp dụng mọi model của hãng</label>
              <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border border-[#E3E8EF]">
                {modelsOfBrand.length === 0 && <span className="text-xs text-[#8A93A0]">Chưa có model nào của hãng này trong danh mục xe.</span>}
                {modelsOfBrand.map((m) => (
                  <label key={m} className={`text-xs px-2 py-1 rounded-md border cursor-pointer ${f.vehicle_names.includes(m) ? "bg-[#EAF2FF] border-brand text-brand font-semibold" : "border-[#E3E8EF]"}`}>
                    <input type="checkbox" className="hidden" checked={f.vehicle_names.includes(m)}
                      onChange={(e) => set("vehicle_names", e.target.checked ? [...f.vehicle_names, m] : f.vehicle_names.filter((x) => x !== m))} />
                    {m}
                  </label>
                ))}
              </div>
            </div>
            <div className="md:col-span-3 sm:col-span-2">
              <label className="lbl">Hình thức kinh doanh pin áp dụng — bỏ trống = áp dụng mọi hình thức (kể cả xe không phải Đổi pin)</label>
              <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border border-[#E3E8EF]">
                {BATTERY_OPTIONS.map((b) => (
                  <label key={b} className={`text-xs px-2 py-1 rounded-md border cursor-pointer ${f.battery_options.includes(b) ? "bg-[#EAF2FF] border-brand text-brand font-semibold" : "border-[#E3E8EF]"}`}>
                    <input type="checkbox" className="hidden" checked={f.battery_options.includes(b)}
                      onChange={(e) => set("battery_options", e.target.checked ? [...f.battery_options, b] : f.battery_options.filter((x) => x !== b))} />
                    {b}
                  </label>
                ))}
              </div>
            </div>
            <div className="md:col-span-3 sm:col-span-2">
              <Field label="Ghi chú / điều kiện chương trình"><textarea className="inp" rows={8} value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button className="btn-ghost" onClick={() => { setShow(false); setF(empty); setEditId(null); }}>Hủy</button>
            <button className="btn-ok" disabled={busy} onClick={luu}>{busy ? "Đang lưu…" : editId ? "Cập nhật" : "Tạo chương trình"}</button>
          </div>
        </div>
      )}

      <div className="card">
        <input className="inp !w-64 mb-3" placeholder="Tìm mã, tên, hãng…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
          <thead><tr>
            <Th label="Mã CT" k="code" sort={sort} />
            <Th label="Tên chương trình" k="name" sort={sort} />
            <Th label="Hãng" k="brand" sort={sort} />
            <th className="th">Model áp dụng</th>
            <th className="th">Pin áp dụng</th>
            <Th label="Từ ngày" k="tu" sort={sort} />
            <Th label="Đến ngày" k="den" sort={sort} />
            <Th label="Trạng thái" k="tt" sort={sort} />
            {canQuan && <th className="th"></th>}
          </tr></thead>
          <tbody>{pageSlice(sorted, page, 20).map((r) => (
            <tr key={r.id} className="hover:bg-[#F8FAFC]">
              <td className="td font-bold text-brand">{r.code}</td>
              <td className="td">{r.name}</td>
              <td className="td text-[13px]">{r.brand}</td>
              <td className="td text-[12px]">{(r.vehicle_names || []).length === 0 ? <span className="text-[#8A93A0]">Mọi model</span> : r.vehicle_names.join(", ")}</td>
              <td className="td text-[12px]">{(r.battery_options || []).length === 0 ? <span className="text-[#8A93A0]">Mọi hình thức</span> : r.battery_options.join(", ")}</td>
              <td className="td text-xs">{fmtDate(r.start_date)}</td>
              <td className="td text-xs">{fmtDate(r.end_date)}</td>
              <td className="td"><Badge tone={TONE[trangThaiThuc(r)]}>{trangThaiThuc(r)}</Badge></td>
              {canQuan && <td className="td"><button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => openEdit(r)}>Sửa</button></td>}
            </tr>
          ))}
          {sorted.length === 0 && <tr><td className="td" colSpan={9}>Chưa có chương trình khuyến mại nào.</td></tr>}
          </tbody>
        </table></div>
        <Pager total={sorted.length} page={page} setPage={setPage} pageSize={20} setPageSize={() => {}} />
      </div>
    </div>
  );
}