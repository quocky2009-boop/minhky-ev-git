"use client";
import { useEffect, useState } from "react";
import { errMsg } from "@/lib/format";

// Chon khach (tim qua fn_khach_tim — khong phu thuoc pham vi RLS cua khach hang) hoac nhap khach moi.
// value: { id, name, phone, code } | null ; moi: { name, phone, address } | null (dang tao khach moi)
export default function KhachPick({ supabase, value, onPick, moi, onMoi, allowNew = true }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("fn_khach_tim", { p_q: q });
      if (!error) setHits(data || []); else console.warn(errMsg(error));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (value) return (
    <div className="flex items-center gap-2 border border-[#D5DBE3] rounded-xl px-3 py-2.5 bg-[#F0FDF6]">
      <div className="flex-1 min-w-0"><b>{value.name}</b> <span className="text-xs text-[#5A6572]">· {value.code} · {value.phone}</span></div>
      <button type="button" className="text-[#8A93A0] hover:text-danger text-sm" onClick={() => { onPick(null); setQ(""); }}>Đổi khách</button>
    </div>
  );
  if (moi) return (
    <div className="border border-brand rounded-xl p-2.5 bg-[#F5F8FF]">
      <div className="flex items-center mb-1.5"><b className="text-[13px] text-brand">Khách hàng mới</b>
        <button type="button" className="ml-auto text-xs text-[#8A93A0] hover:text-danger" onClick={() => onMoi(null)}>Hủy, chọn khách có sẵn</button></div>
      <div className="grid gap-2 sm:grid-cols-3">
        <input className="inp" placeholder="Họ tên *" value={moi.name} onChange={(e) => onMoi({ ...moi, name: e.target.value })} />
        <input className="inp" placeholder="SĐT *" value={moi.phone} onChange={(e) => onMoi({ ...moi, phone: e.target.value })} />
        <input className="inp" placeholder="Địa chỉ" value={moi.address || ""} onChange={(e) => onMoi({ ...moi, address: e.target.value })} />
      </div>
    </div>
  );
  return (
    <div className="relative">
      <input className="inp" placeholder="Gõ tên / SĐT / mã khách để tìm…" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && q.trim().length >= 2 && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-[#D5DBE3] rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto">
          {hits.map((c) => (
            <button type="button" key={c.id} className="w-full flex items-center gap-2 px-3 py-2.5 text-left border-b border-[#F2F4F7] hover:bg-[#F0FDF6]"
              onClick={() => { onPick(c); setOpen(false); setQ(""); }}>
              <b className="text-[13px]">{c.name}</b><span className="text-xs text-[#5A6572]">{c.code} · {c.phone}</span>
            </button>
          ))}
          {hits.length === 0 && <div className="px-3 py-2 text-xs text-[#8A93A0]">Không tìm thấy khách phù hợp.</div>}
          {allowNew && <button type="button" className="w-full text-left px-3 py-2.5 hover:bg-[#EEF3FF] text-brand font-bold text-[13px]"
            onClick={() => { const dg = /^[0-9 .+-]+$/.test(q.trim()); onMoi({ name: dg ? "" : q.trim(), phone: dg ? q.trim() : "", address: "" }); setOpen(false); setQ(""); }}>+ Tạo khách mới{q.trim() ? ` "${q.trim()}"` : ""}</button>}
        </div>
      )}
    </div>
  );
}
