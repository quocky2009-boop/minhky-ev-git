"use client";
import { useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast } from "@/components/ui";
import { errMsg } from "@/lib/format";

export default function NhaCungCap() {
  const { supabase, profile, loading, settings, refresh } = useCatalog();
  const { toast, notify } = useToast();
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  const canEdit = ["CEO", "ADMIN"].includes(profile.role);
  const list = (settings.suppliers || "VinFast\nTAILG").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

  const saveList = async (arr) => {
    setBusy(true);
    const { error } = await supabase.rpc("fn_set_setting", { p_key: "suppliers", p_value: arr.join("\n") });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    refresh();
  };
  const add = async () => {
    const v = newName.trim();
    if (!v) return;
    if (list.some((x) => x.toLowerCase() === v.toLowerCase())) return notify("Nhà cung cấp này đã có trong danh sách.", "err");
    await saveList([...list, v]);
    notify(`Đã thêm nhà cung cấp "${v}".`); setNewName("");
  };
  const remove = async (name) => {
    if (!confirm(`Bỏ nhà cung cấp "${name}" khỏi danh sách?\nCác phiếu nhập cũ đã ghi tên này vẫn giữ nguyên.`)) return;
    await saveList(list.filter((x) => x !== name));
    notify(`Đã bỏ "${name}" khỏi danh sách.`);
  };

  return (
    <div className="card">
      <Toast toast={toast} />
      <div className="font-extrabold text-base mb-1">Nhà cung cấp ({list.length})</div>
      <p className="text-xs text-[#5A6572] mb-4">Danh sách này là dropdown chọn nhà cung cấp ở màn Nhập hàng. Xóa khỏi danh sách không ảnh hưởng các phiếu nhập đã ghi.</p>
      {canEdit && (
        <div className="flex gap-2 items-center mb-4 max-w-md">
          <input className="inp" placeholder="Tên nhà cung cấp mới…" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button className="btn-primary !py-2.5 whitespace-nowrap" disabled={busy} onClick={add}>+ Thêm</button>
        </div>
      )}
      <div className="flex flex-col gap-1.5 max-w-md">
        {list.map((x) => (
          <div key={x} className="flex items-center gap-2 border border-[#E6EAEF] rounded-xl px-3.5 py-2.5">
            <Badge tone="blue">NCC</Badge><span className="font-bold flex-1">{x}</span>
            {canEdit && <button className="text-[#C6CDD6] hover:text-danger" title="Bỏ khỏi danh sách" onClick={() => remove(x)}>✕</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
