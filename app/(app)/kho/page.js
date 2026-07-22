"use client";
import { useState } from "react";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Field, Toast, Pager, pageSlice } from "@/components/ui";
import { errMsg } from "@/lib/format";

export default function Kho() {
  const { supabase, vehicles, locations, profile, loading, getQty, refresh, regions } = useCatalog();
  const { toast, notify } = useToast();
  const [edit, setEdit] = useState(null); // location dang sua; "NEW" = them moi
  const [f, setF] = useState({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const startNew = () => { setEdit("NEW"); setF({ name: "", region: regions[0] || "Thành phố", type: "Cửa hàng", address: "", status: "Hoạt động" }); };

  const removeLoc = async (l, qty) => {
    if (qty > 0) return notify(`Kho còn ${qty} xe — điều chuyển hết xe sang kho khác trước khi xóa.`, "err");
    if (!confirm(`Xóa kho "${l.name}"?\nKho đã có lịch sử giao dịch sẽ được ẩn khỏi hệ thống (lịch sử cũ vẫn giữ nguyên). Thao tác không hoàn tác được.`)) return;
    const { data, error } = await supabase.rpc("fn_xoa_kho", { p_code: l.code });
    if (error) return notify(errMsg(error), "err");
    notify(data === "DA_XOA_HAN" ? `Đã xóa hẳn kho "${l.name}".` : `Đã xóa kho "${l.name}" (lịch sử cũ vẫn được giữ).`);
    refresh();
  };

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  const canEdit = ["CEO", "ADMIN"].includes(profile.role);

  const startEdit = (l) => { setEdit(l.code); setF({ name: l.name, region: l.region, type: l.type, address: l.address, status: l.status }); };
  const save = async () => {
    if (edit === "NEW") {
      const { data, error } = await supabase.rpc("fn_them_kho", { p: f });
      if (error) return notify(errMsg(error), "err");
      notify(`Đã thêm kho mới (mã ${data}).`);
    } else {
      const { error } = await supabase.rpc("fn_sua_kho", { p: { code: edit, ...f } });
      if (error) return notify(errMsg(error), "err");
      notify("Đã cập nhật thông tin kho.");
    }
    setEdit(null); refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      {edit && (
        <div className="card">
          <div className="font-extrabold mb-3">{edit === "NEW" ? "Thêm kho / cửa hàng mới (mã kho tự sinh)" : `Sửa kho / cửa hàng — ${edit} (mã kho giữ nguyên)`}</div>
          <div className="grid gap-x-4 md:grid-cols-3 sm:grid-cols-2">
            <Field label="Tên kho / cửa hàng" required><input className="inp" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="Khu vực" required hint="Thêm/bớt khu vực trong menu Cài đặt.">
              <select className="inp" value={f.region} onChange={(e) => set("region", e.target.value)}>
                {regions.map((r) => <option key={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Loại điểm" required>
              <select className="inp" value={f.type} onChange={(e) => set("type", e.target.value)}>
                <option>Cửa hàng</option><option>Kho</option><option>Showroom</option><option>Trạm dịch vụ</option>
              </select>
            </Field>
            <Field label="Địa chỉ"><input className="inp" value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
            <Field label="Trạng thái">
              <select className="inp" value={f.status} onChange={(e) => set("status", e.target.value)}>
                <option>Hoạt động</option><option>Chuẩn bị</option><option>Ngừng hoạt động</option>
              </select>
            </Field>
          </div>
          <div className="flex gap-2.5">
            <button className="btn-ok" onClick={save}>{edit === "NEW" ? "Thêm kho" : "Lưu thay đổi"}</button>
            <button className="btn-ghost" onClick={() => setEdit(null)}>Hủy</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex items-center mb-1">
          <div className="font-extrabold mr-auto">Danh mục kho / cửa hàng ({locations.length} điểm)</div>
          {canEdit && <button className="btn-primary !py-2 !text-xs" onClick={startNew}>+ Thêm kho / cửa hàng</button>}
        </div>
        <p className="text-xs text-[#5A6572] mb-2.5">Bấm tên kho để xem chi tiết từng chiếc xe (số khung, ngày nhập, số ngày tồn), import/export danh sách xe.</p>
        <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
          <thead><tr><th className="th">Tên</th><th className="th">Khu vực</th><th className="th">Loại điểm</th><th className="th">Địa chỉ</th><th className="th">Tổng tồn</th><th className="th">Trạng thái</th><th className="th"></th></tr></thead>
          <tbody>{pageSlice(locations, page, pageSize).map((l) => {
            const q = vehicles.reduce((s, v) => s + getQty(v.id, l.code), 0);
            return (
              <tr key={l.code} className="hover:bg-[#F8FAFC]">
                <td className="td font-bold"><Link href={`/kho/${l.code}`} className="text-brand hover:underline">{l.name}</Link><div className="text-[11px] text-[#8A93A0]">{l.code}</div></td>
                <td className="td">{l.region}</td><td className="td">{l.type}</td><td className="td">{l.address}</td>
                <td className="td font-bold">{q}</td>
                <td className="td">{l.status === "Hoạt động" ? <Badge tone="green">Hoạt động</Badge> : <Badge tone="gray">{l.status}</Badge>}</td>
                <td className="td"><div className="flex gap-1.5">
                  <Link href={`/kho/${l.code}`} className="btn-ghost !px-3 !py-1.5 !text-xs">Chi tiết →</Link>
                  {canEdit && <button className="btn-ghost !px-2.5 !py-1.5 !text-xs" onClick={() => startEdit(l)}>✎ Sửa</button>}
                  {canEdit && <button className="btn-danger !px-2.5 !py-1.5 !text-xs" disabled={q > 0} title={q > 0 ? "Kho còn xe, không xóa được" : "Xóa kho"} onClick={() => removeLoc(l, q)}>🗑</button>}
                </div></td>
              </tr>
            );
          })}</tbody>
        </table></div>
        <Pager total={locations.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
      </div>
    </div>
  );
}
