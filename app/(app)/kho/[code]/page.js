"use client";
import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI } from "@/components/ui";
import { fmtDate, errMsg, parseCSV, downloadCSV } from "@/lib/format";

const daysIn = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));

export default function KhoChiTiet() {
  const { code } = useParams();
  const { supabase, vehicles, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [units, setUnits] = useState([]);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("days");
  const fileRef = useRef(null);

  const load = async () => {
    const { data } = await supabase.from("vehicle_units").select("*")
      .eq("location_code", decodeURIComponent(code)).in("status", ["TON_KHO", "DANG_CHUYEN", "GIU_CHO"]);
    setUnits(data || []);
  };
  useEffect(() => { load(); }, [code]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  const loc = locations.find((l) => l.code === decodeURIComponent(code));
  const canEdit = ["CEO", "MANAGER", "ADMIN"].includes(profile.role);
  const vOf = (id) => vehicles.find((x) => x.id === id);

  const exportCSV = () => {
    downloadCSV(`ton_${decodeURIComponent(code)}.csv`,
      [["frame_number","vehicle_id","ten_xe","mau","engine_number","imported_at","so_ngay_ton","trang_thai"],
       ...units.map((u) => { const v = vOf(u.vehicle_id);
         return [u.frame_number, u.vehicle_id, v?.name || "", v?.color || "", u.engine_number || "", u.imported_at?.slice(0,10), daysIn(u.imported_at), u.status]; })]);
  };

  const importCSV = async (file) => {
    const rows = parseCSV(await file.text());
    if (rows.length < 2) return notify("File trống hoặc sai định dạng.", "err");
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (k) => header.indexOf(k);
    if (idx("frame_number") < 0 || idx("vehicle_id") < 0)
      return notify("File cần tối thiểu 2 cột: frame_number, vehicle_id (thêm imported_at dạng 2026-07-01, engine_number, note nếu có). Bấm Xuất CSV để xem mẫu.", "err");
    const items = rows.slice(1).map((r) => ({
      frame_number: r[idx("frame_number")]?.trim(),
      vehicle_id: r[idx("vehicle_id")]?.trim(),
      imported_at: idx("imported_at") >= 0 ? r[idx("imported_at")]?.trim() : "",
      engine_number: idx("engine_number") >= 0 ? r[idx("engine_number")]?.trim() : "",
      note: idx("note") >= 0 ? r[idx("note")]?.trim() : "",
    }));
    const { data, error } = await supabase.rpc("fn_import_units", { p_loc: decodeURIComponent(code), p_rows: items });
    if (error) return notify(errMsg(error), "err");
    const sk = data?.skipped || [];
    notify(`Đã import ${data?.inserted || 0} xe vào kho.` + (sk.length ? ` Bỏ qua ${sk.length} dòng: ${sk.slice(0,3).map((x)=>`${x.frame} (${x.ly_do})`).join("; ")}${sk.length>3?"…":""}` : ""), sk.length ? "err" : "ok");
    load();
  };

  const editFrame = async (u) => {
    const nv = prompt(`Nhập số khung thật thay cho "${u.frame_number}":`, u.is_placeholder ? "" : u.frame_number);
    if (!nv || nv.trim() === "" || nv.trim() === u.frame_number) return;
    const { error } = await supabase.rpc("fn_sua_so_khung", { p_old: u.frame_number, p_new: nv.trim() });
    if (error) return notify(errMsg(error), "err");
    notify("Đã cập nhật số khung."); load();
  };

  let list = units.filter((u) => {
    const v = vOf(u.vehicle_id);
    const t = (u.frame_number + u.vehicle_id + (v ? v.name + v.color : "")).toLowerCase();
    return !q || t.includes(q.toLowerCase());
  });
  list.sort((a, b) => sort === "days" ? new Date(a.imported_at) - new Date(b.imported_at)
    : a.vehicle_id.localeCompare(b.vehicle_id));

  const old60 = units.filter((u) => daysIn(u.imported_at) >= 60).length;
  const placeholders = units.filter((u) => u.is_placeholder).length;

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <Link href="/kho" className="btn-ghost !px-3 !py-1.5 !text-xs">← Danh sách kho</Link>
        <div className="text-lg font-extrabold">{loc?.name || code}</div>
        <span className="text-xs text-[#8A93A0]">{loc?.address}</span>
      </div>
      <div className="flex gap-3 flex-wrap">
        <KPI label="Xe đang tồn" value={units.filter((u) => ["TON_KHO","GIU_CHO"].includes(u.status)).length} tone="dark" />
        <KPI label="Đang chuyển đi" value={units.filter((u) => u.status === "DANG_CHUYEN").length} tone="blue" />
        <KPI label="Tồn ≥ 60 ngày" value={old60} tone={old60 ? "amber" : "dark"} />
        <KPI label="Số khung tạm cần cập nhật" value={placeholders} tone={placeholders ? "red" : "dark"} />
      </div>
      <div className="card">
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <div className="font-extrabold mr-auto">Chi tiết từng xe ({list.length})</div>
          <input className="inp !w-56" placeholder="Tìm số khung, tên xe…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn-ghost !text-xs" onClick={exportCSV}>⬇ Xuất CSV</button>
          {canEdit && <button className="btn-ghost !text-xs" onClick={() => fileRef.current?.click()}>⬆ Import CSV</button>}
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { if (e.target.files[0]) importCSV(e.target.files[0]); e.target.value = ""; }} />
          <select className="inp !w-auto" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="days">Sắp xếp: tồn lâu nhất trước</option>
            <option value="model">Sắp xếp: theo mẫu xe</option>
          </select>
        </div>
        <div className="overflow-x-auto"><table className="w-full border-collapse">
          <thead><tr><th className="th">Số khung</th><th className="th">Xe</th><th className="th">Màu</th><th className="th">Ngày nhập</th><th className="th">Số ngày tồn</th><th className="th">Trạng thái</th>{canEdit && <th className="th"></th>}</tr></thead>
          <tbody>{list.map((u) => {
            const v = vOf(u.vehicle_id);
            const d = daysIn(u.imported_at);
            return (
              <tr key={u.frame_number}>
                <td className="td font-mono text-[12.5px]"><b>{u.frame_number}</b>{u.is_placeholder && <div><Badge tone="amber">SK tạm — cần số thật</Badge></div>}</td>
                <td className="td font-bold">{v?.name || u.vehicle_id}</td>
                <td className="td">{v?.color || ""}</td>
                <td className="td">{fmtDate(u.imported_at)}</td>
                <td className="td"><b className={d >= 90 ? "text-danger" : d >= 60 ? "text-[#A25F00]" : ""}>{d} ngày</b></td>
                <td className="td">{u.status === "TON_KHO" ? <Badge tone="green">Tồn kho</Badge> : u.status === "GIU_CHO" ? <Badge tone="amber">🔒 Giữ chỗ</Badge> : <Badge tone="blue">Đang chuyển</Badge>}</td>
                {canEdit && <td className="td"><button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => editFrame(u)}>Sửa SK</button></td>}
              </tr>
            );
          })}
          {list.length === 0 && <tr><td className="td" colSpan={7}>Kho này chưa có xe tồn.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
