"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, Field } from "@/components/ui";
import { fmtDate, errMsg } from "@/lib/format";

export default function BaoDuong() {
  const { supabase, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(true);
  const [fSt, setFSt] = useState("");
  const [q, setQ] = useState("");

  const load = async () => {
    setBusy(true);
    const { data } = await supabase.from("maintenance_reminders").select("*").order("next_due_date");
    setRows(data || []);
    setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải…</div>;

  const today = new Date().toLocaleDateString("sv-SE");
  const kw = q.trim().toLowerCase();
  const filtered = rows.filter(r => {
    if (fSt === "due" && !(r.next_due_date <= today && r.status !== "Đã đến bảo dưỡng" && r.status !== "Bỏ qua")) return false;
    if (fSt && fSt !== "due" && r.status !== fSt) return false;
    if (!kw) return true;
    return `${r.frame_number} ${r.customer_name} ${r.customer_phone}`.toLowerCase().includes(kw);
  });

  const denHan = rows.filter(r => r.next_due_date <= today && !["Đã đến bảo dưỡng","Bỏ qua"].includes(r.status)).length;
  const daNhac = rows.filter(r => r.status === "Đã nhắc").length;

  const capNhat = async (r, status) => {
    setBusy(true);
    const nextDue = status === "Đã đến bảo dưỡng" ? new Date(Date.now() + r.interval_months * 30 * 86400000).toISOString().slice(0,10) : null;
    const { error } = await supabase.rpc("fn_cap_nhat_nhac_bao_duong", { p_id: r.id, p_status: status, p_next_due: nextDue });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã cập nhật."); load();
  };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="font-extrabold text-lg">Nhắc bảo dưỡng định kỳ</div>

      <div className="flex gap-3 flex-wrap">
        <KPI label="Đến hạn bảo dưỡng" value={denHan} tone={denHan ? "red" : "green"} />
        <KPI label="Đã nhắc khách" value={daNhac} tone="amber" />
        <KPI label="Tổng theo dõi" value={rows.length} tone="dark" />
      </div>

      <div className="card">
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <input className="inp !w-52" placeholder="Tìm số khung, tên, SĐT…" value={q} onChange={e => setQ(e.target.value)} />
          {[["","Tất cả"],["due","Đến hạn"],["Chưa nhắc","Chưa nhắc"],["Đã nhắc","Đã nhắc"],["Đã đến bảo dưỡng","Đã bảo dưỡng"],["Bỏ qua","Bỏ qua"]].map(([k,v]) => (
            <button key={k} className={`btn !px-3 !py-1.5 !text-xs ${fSt===k?"bg-brand text-white":"bg-[#EEF1F4]"}`} onClick={() => setFSt(k)}>{v}</button>
          ))}
        </div>

        {busy ? <div className="text-sm text-[#8A93A0]">Đang tải…</div> : (
          <div className="flex flex-col gap-2">
            {filtered.map(r => {
              const qh = r.next_due_date <= today && !["Đã đến bảo dưỡng","Bỏ qua"].includes(r.status);
              return (
                <div key={r.id} className={`p-3 rounded-xl border flex items-center gap-3 flex-wrap ${qh ? "border-danger bg-[#FFF6F6]" : "border-[#E3E8EF]"}`}>
                  <div className="flex-1 min-w-[180px]">
                    <div className="font-mono font-bold text-[13px]">{r.frame_number}</div>
                    <div className="text-[11px] text-[#8A93A0]">{r.customer_name} · {r.customer_phone}</div>
                  </div>
                  <div className="text-[12px]">
                    <div className="text-[#8A93A0]">Bảo dưỡng gần nhất: {r.last_service_date ? fmtDate(r.last_service_date) : "—"}</div>
                    <div className={qh ? "text-danger font-bold" : ""}>Đến hạn: {fmtDate(r.next_due_date)}</div>
                  </div>
                  <Badge tone={qh ? "red" : r.status === "Đã nhắc" ? "amber" : r.status === "Đã đến bảo dưỡng" ? "green" : "dark"}>{qh ? "Đến hạn" : r.status}</Badge>
                  <div className="flex gap-1">
                    {r.status === "Chưa nhắc" && <button className="btn-ok !px-2 !py-1 !text-xs" onClick={() => capNhat(r, "Đã nhắc")}>📞 Đã nhắc</button>}
                    <button className="btn-ok !px-2 !py-1 !text-xs" onClick={() => capNhat(r, "Đã đến bảo dưỡng")}>✓ Đã bảo dưỡng</button>
                    <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => capNhat(r, "Bỏ qua")}>Bỏ qua</button>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <div className="text-sm text-[#8A93A0] text-center py-8">Không có xe nào cần theo dõi.</div>}
          </div>
        )}
      </div>
    </div>
  );
}
