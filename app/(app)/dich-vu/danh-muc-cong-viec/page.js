"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, Field, MoneyInput, Pager, pageSlice, MultiCheck } from "@/components/ui";
import { fmtVND, errMsg } from "@/lib/format";
import ImportDanhMuc from "@/components/ImportDanhMuc";

const LOAI = ["Bảo dưỡng", "Sửa chữa", "Bảo hành", "Lắp đặt"];
const empty = { id: null, code: "", name: "", loai_cv: "Sửa chữa", group_name: "", price: 0, note: "", status: "Hoạt động" };

export default function DanhMucCongViec() {
  const { supabase, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [fLoai, setFLoai] = useState([]);
  const [showNgung, setShowNgung] = useState(false);
  const [page, setPage] = useState(1);
  const [f, setF] = useState(null);
  const [imp, setImp] = useState(false);
  const [perm, setPerm] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("dv_services").select("*").order("code");
    setRows(data || []);
  };
  useEffect(() => {
    if (loading || !profile) return;
    load();
    if (profile.role === "CEO") setPerm(true);
    else supabase.from("role_perms").select("allowed").eq("role", profile.role).eq("perm", "pt_danh_muc").maybeSingle().then(({ data }) => setPerm(!!data?.allowed));
  }, [loading, profile]);

  if (loading || !profile) return <div className="card">Đang tải…</div>;
  const kw = q.trim().toLowerCase();
  const list = rows.filter((r) => (showNgung || r.status === "Hoạt động") && (!fLoai.length || fLoai.includes(r.loai_cv)) && (!kw || `${r.code} ${r.name} ${r.group_name}`.toLowerCase().includes(kw)));

  const luu = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("fn_cv_luu", { p: { ...f, price: Number(f.price) || 0 } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã lưu công việc."); setF(null); load();
  };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Danh mục công việc dịch vụ ({list.length})</div>
        {perm && <button className="btn-ghost !text-xs" onClick={() => setImp(true)}>⬆ Import Excel</button>}
        {perm && <button className="btn-primary !text-xs" onClick={() => setF({ ...empty })}>+ Thêm công việc</button>}
      </div>
      {!perm && <div className="rounded-xl bg-[#FDF1DF] text-[#A25F00] text-[13px] px-3 py-2">Bạn chỉ xem được danh mục. Quyền sửa: “Sửa danh mục phụ tùng & bảng giá công”.</div>}

      {f && (
        <div className="card">
          <div className="font-extrabold mb-2">{f.id ? "Sửa công việc" : "Thêm công việc"}</div>
          <div className="grid gap-3 md:grid-cols-3 sm:grid-cols-2">
            <Field label="Mã công việc" required><input className="inp" value={f.code} disabled={!!f.id} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
            <Field label="Tên công việc" required><input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Loại CV"><select className="inp" value={f.loai_cv} onChange={(e) => setF({ ...f, loai_cv: e.target.value })}>{LOAI.map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Nhóm"><input className="inp" value={f.group_name} onChange={(e) => setF({ ...f, group_name: e.target.value })} placeholder="VD: Phanh, Pin & Điện…" /></Field>
            <Field label="Giá (đ, cố định)"><MoneyInput className="inp" value={f.price} onChange={(v) => setF({ ...f, price: v })} /></Field>
            <Field label="Trạng thái"><select className="inp" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option>Hoạt động</option><option>Ngừng</option></select></Field>
            <div className="md:col-span-3 sm:col-span-2"><Field label="Ghi chú"><input className="inp" value={f.note || ""} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field></div>
          </div>
          <div className="flex gap-2 mt-3"><button className="btn-ok" disabled={busy} onClick={luu}>{busy ? "Đang lưu…" : "Lưu"}</button><button className="btn-ghost" onClick={() => setF(null)}>Hủy</button></div>
        </div>)}

      <div className="card">
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <input className="inp !w-64" placeholder="Tìm mã, tên, nhóm…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <MultiCheck label="Loại CV: tất cả" value={fLoai} onChange={(v) => { setFLoai(v); setPage(1); }} options={LOAI.map((x) => ({ key: x, label: x }))} />
          <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer"><input type="checkbox" className="w-4 h-4" checked={showNgung} onChange={(e) => setShowNgung(e.target.checked)} />Hiện cả công việc ngừng</label>
        </div>
        <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
          <thead><tr><th className="th">Mã</th><th className="th">Công việc</th><th className="th">Loại CV</th><th className="th">Nhóm</th><th className="th text-right">Giá</th><th className="th">Trạng thái</th>{perm && <th className="th"></th>}</tr></thead>
          <tbody>{pageSlice(list, page, 30).map((r) => (
            <tr key={r.id} className={r.status !== "Hoạt động" ? "text-[#8A93A0]" : "hover:bg-[#F8FAFC]"}>
              <td data-label="Mã" className="td font-bold font-mono text-[12px]">{r.code}</td><td data-label="Công việc" className="td">{r.name}</td>
              <td data-label="Loại CV" className="td text-[13px]">{r.loai_cv}</td><td data-label="Nhóm" className="td text-[13px]">{r.group_name}</td>
              <td data-label="Giá" className="td text-right font-bold">{fmtVND(r.price)}</td>
              <td data-label="Trạng thái" className="td"><Badge tone={r.status === "Hoạt động" ? "green" : "gray"}>{r.status}</Badge></td>
              {perm && <td className="td"><button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => setF({ ...r })}>Sửa</button></td>}
            </tr>))}
            {list.length === 0 && <tr><td className="td" colSpan={7}>Chưa có công việc nào khớp.</td></tr>}
          </tbody>
        </table></div>
        <Pager total={list.length} page={page} setPage={setPage} pageSize={30} setPageSize={() => {}} />
      </div>
      {imp && <ImportDanhMuc mode="cv" supabase={supabase} locations={locations} notify={notify} onDone={load} onClose={() => setImp(false)} />}
    </div>
  );
}
