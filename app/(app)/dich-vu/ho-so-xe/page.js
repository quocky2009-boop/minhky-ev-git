"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast } from "@/components/ui";
import { fmtDate, fmtTime, errMsg } from "@/lib/format";
import XeFormModal from "@/components/XeFormModal";
import KhachPick from "@/components/KhachPick";

// Ho so xe khach hang: moi xe gan voi 1 chu hien tai (co lich su chu). Mot khach co the co nhieu xe.
export default function HoSoXe() {
  const { supabase, brands, vehicles, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null); // {initial?}
  const [sel, setSel] = useState(null);
  const [hist, setHist] = useState([]);
  const [chu, setChu] = useState({ open: false, kh: null, ly_do: "" });

  const load = async (kw = q) => {
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_xe_tim", { p_q: kw, p_limit: 60 });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    setRows(data || []);
  };
  useEffect(() => { if (loading) return; const t = setTimeout(() => load(q), 250); return () => clearTimeout(t); }, [loading, q]);

  const mo = async (x) => {
    setSel(x); setChu({ open: false, kh: null, ly_do: "" }); setHist([]);
    const { data } = await supabase.rpc("fn_xe_lich_su_chu", { p_id: x.id });
    setHist(data || []);
  };
  const doiChu = async () => {
    if (!chu.kh) return notify("Chọn chủ xe mới.", "err");
    const { error } = await supabase.rpc("fn_xe_doi_chu", { p_id: sel.id, p_customer_id: chu.kh.id, p_reason: chu.ly_do });
    if (error) return notify(errMsg(error), "err");
    notify("Đã đổi chủ xe.");
    await load();
    const { data } = await supabase.rpc("fn_xe_tim", { p_q: sel.plate || sel.frame_number, p_limit: 5 });
    const nx = (data || []).find((r) => r.id === sel.id);
    if (nx) await mo(nx); else setSel(null);
  };

  if (loading || !profile) return <div className="card">Đang tải…</div>;
  const canDoiChu = ["CEO", "ADMIN", "MANAGER"].includes(profile.role);
  const nhomKhach = {};
  rows.forEach((r) => { nhomKhach[r.customer_id] = (nhomKhach[r.customer_id] || 0) + 1; });

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Hồ sơ xe khách hàng ({rows.length})</div>
        <input className="inp !w-72" placeholder="Biển số / số khung / tên khách / SĐT…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary !text-xs" onClick={() => setForm({ initial: null })}>+ Thêm xe / khách mới</button>
      </div>

      <div className="card">
        <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
          <thead><tr><th className="th">Biển số</th><th className="th">Số khung</th><th className="th">Kiểu xe</th><th className="th">Chủ xe</th><th className="th">Nguồn</th><th className="th">Bảo hành đến</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="hover:bg-[#F8FAFC] cursor-pointer" onClick={() => mo(r)}>
              <td data-label="Biển số" className="td font-bold">{r.plate || <span className="text-[#C6CDD6]">Chưa có</span>}</td>
              <td data-label="Số khung" className="td font-mono text-[11.5px]">{r.frame_number || "—"}</td>
              <td data-label="Kiểu xe" className="td text-[13px]">{[r.brand, r.model_name, r.color].filter(Boolean).join(" · ") || "—"}</td>
              <td data-label="Chủ xe" className="td text-[13px]"><b>{r.customer_name}</b><div className="text-[11px] text-[#8A93A0]">{r.customer_phone}{nhomKhach[r.customer_id] > 1 ? ` · ${nhomKhach[r.customer_id]} xe` : ""}</div></td>
              <td data-label="Nguồn" className="td"><Badge tone={r.source === "MINH_KY" ? "blue" : "amber"}>{r.source === "MINH_KY" ? "Minh Kỳ bán" : "Xe ngoài"}</Badge></td>
              <td data-label="Bảo hành đến" className="td text-xs">{r.warranty_end ? fmtDate(r.warranty_end) : "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="td" colSpan={6}>{busy ? "Đang tìm…" : "Không tìm thấy xe. Bấm “+ Thêm xe / khách mới” để tạo hồ sơ."}</td></tr>}
          </tbody>
        </table></div>
      </div>

      {sel && (
        <div className="fixed inset-0 z-[80] bg-black/50 flex items-start justify-center p-3 overflow-y-auto" onClick={() => setSel(null)}>
          <div className="bg-white rounded-2xl w-[640px] max-w-full p-4 my-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center mb-2"><div className="font-extrabold text-base">{sel.plate || sel.frame_number}</div>
              <Badge tone={sel.source === "MINH_KY" ? "blue" : "amber"}>{sel.source === "MINH_KY" ? "Minh Kỳ bán" : "Xe ngoài"}</Badge>
              <button className="ml-auto text-[#8A93A0] text-lg" onClick={() => setSel(null)}>✕</button></div>
            <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 text-[13px] mb-3">
              {[["Biển số", sel.plate], ["Số khung", sel.frame_number], ["Số máy", sel.engine_number], ["Hãng / Kiểu xe", [sel.brand, sel.model_name].filter(Boolean).join(" · ")], ["Màu", sel.color], ["Năm SX", sel.year],
                ["Bảo hành", sel.warranty_start || sel.warranty_end ? `${sel.warranty_start ? fmtDate(sel.warranty_start) : "?"} → ${sel.warranty_end ? fmtDate(sel.warranty_end) : "?"}` : ""], ["Đơn bán", sel.sale_code]].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-dashed border-[#E3E8EF] py-1"><span className="text-[#5A6572]">{k}</span><b>{v || "—"}</b></div>))}
            </div>
            <div className="rounded-xl bg-[#F0F6FF] p-2.5 mb-3 text-[13px]"><span className="text-[#5A6572]">Chủ xe hiện tại: </span><b>{sel.customer_name}</b> · {sel.customer_phone} · <span className="text-[#8A93A0]">{sel.customer_code}</span></div>
            <div className="font-bold text-[13px] mb-1">Lịch sử chủ xe</div>
            <div className="flex flex-col gap-1 mb-3">{hist.map((h, i) => (
              <div key={i} className="text-[12.5px] border border-[#E3E8EF] rounded-lg px-2.5 py-1.5"><b>{h.customer_name}</b> · {h.customer_phone}
                <div className="text-[11px] text-[#8A93A0]">{fmtTime(h.from_at)} → {h.to_at ? fmtTime(h.to_at) : "hiện tại"} · {h.reason} · {h.by_name}</div></div>))}
              {hist.length === 0 && <div className="text-xs text-[#8A93A0]">Chưa có lịch sử.</div>}</div>
            {chu.open && (
              <div className="rounded-xl border border-brand p-2.5 mb-3 flex flex-col gap-2">
                <div className="font-bold text-[13px] text-brand">Đổi chủ xe</div>
                <KhachPick supabase={supabase} value={chu.kh} onPick={(c) => setChu((p) => ({ ...p, kh: c }))} allowNew={false} />
                <input className="inp" placeholder="Lý do đổi chủ * (VD: mua lại xe cũ)" value={chu.ly_do} onChange={(e) => setChu((p) => ({ ...p, ly_do: e.target.value }))} />
                <div className="flex gap-2"><button className="btn-ok !text-xs" onClick={doiChu}>Xác nhận đổi chủ</button><button className="btn-ghost !text-xs" onClick={() => setChu({ open: false, kh: null, ly_do: "" })}>Hủy</button></div>
              </div>)}
            <div className="flex gap-2 flex-wrap">
              <button className="btn-ghost !text-xs" onClick={() => { setForm({ initial: sel }); }}>✎ Sửa thông tin xe</button>
              {canDoiChu && !chu.open && <button className="btn-ghost !text-xs" onClick={() => setChu({ open: true, kh: null, ly_do: "" })}>🔁 Đổi chủ xe</button>}
            </div>
          </div>
        </div>
      )}

      {form && <XeFormModal supabase={supabase} brands={brands} vehicles={vehicles} notify={notify} initial={form.initial}
        onClose={() => setForm(null)} onSaved={async () => { setForm(null); setSel(null); await load(); }} />}
    </div>
  );
}
