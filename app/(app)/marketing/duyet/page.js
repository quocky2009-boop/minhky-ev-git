"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI } from "@/components/ui";
import { errMsg } from "@/lib/format";
import { NEED_LABEL, RESULT_LABEL, KPI_TYPE_LABEL } from "@/lib/marketing";

export default function DuyetBaoCao() {
  const { supabase, vehicles, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [tab, setTab] = useState("bao_cao");
  const [subs, setSubs] = useState([]);
  const [tds, setTds] = useState([]);
  const [kpis, setKpis] = useState([]);
  const [camps, setCamps] = useState([]);
  const [busy, setBusy] = useState(false);

  const isBGD = ["ADMIN", "CEO"].includes(profile?.role);

  const load = async () => {
    const [{ data: s }, { data: t }, { data: k }, { data: c }] = await Promise.all([
      supabase.from("mkt_submissions").select("*").in("status", ["submitted", "needs_revision"]).order("submitted_at"),
      supabase.from("test_drives").select("*").in("status", ["submitted", "needs_revision"]).order("submitted_at"),
      supabase.from("mkt_kpi_templates").select("id,name,kpi_type"),
      supabase.from("mkt_campaigns").select("id,name"),
    ]);
    setSubs(s || []); setTds(t || []); setKpis(k || []); setCamps(c || []);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  const vName = (id) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.name} ${v.color}` : id; };
  const kpiName = (id) => kpis.find((k) => k.id == id)?.name || "KPI";
  const campName = (id) => camps.find((c) => c.id == id)?.name || "Chiến dịch";

  const act = async (fn, o, action) => {
    let note = "";
    if (["revise", "reject", "recall"].includes(action)) {
      note = prompt(action === "revise" ? "Lý do yêu cầu bổ sung:" : action === "reject" ? "Lý do từ chối:" : "Lý do thu hồi:");
      if (note === null) return;
      if (!note.trim()) return notify("Bắt buộc nhập lý do.", "err");
    }
    setBusy(true);
    const { error } = await supabase.rpc(fn, { p_id: o.id, p_action: action, p_note: note });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(action === "approve" ? "Đã duyệt." : action === "revise" ? "Đã yêu cầu bổ sung." : "Đã từ chối.");
    load();
  };

  const excludeKpi = async (o) => {
    const ly = prompt("Lý do loại lượt lái thử này khỏi KPI:");
    if (ly === null) return;
    if (!ly.trim()) return notify("Bắt buộc nhập lý do.", "err");
    const { error } = await supabase.rpc("fn_mkt_loai_khoi_kpi", { p_id: o.id, p_ly_do: ly });
    if (error) return notify(errMsg(error), "err");
    notify("Đã cập nhật trạng thái loại KPI."); load();
  };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2">
        <div className="font-extrabold text-lg mr-auto">Duyệt báo cáo marketing</div>
        <Link href="/marketing/bao-cao-cty" className="btn-ghost !text-xs">Báo cáo cửa hàng →</Link>
      </div>
      <div className="flex gap-3 flex-wrap">
        <KPI label="Báo cáo chờ duyệt" value={subs.filter((s) => s.status === "submitted").length} tone="amber" />
        <KPI label="Lái thử chờ duyệt" value={tds.filter((t) => t.status === "submitted").length} tone="blue" />
        <KPI label="Lái thử nghi trùng" value={tds.filter((t) => t.is_suspicious).length} tone={tds.some((t) => t.is_suspicious) ? "red" : "dark"} />
      </div>

      <div className="flex gap-1.5">
        <button className={`btn !px-3 !py-2 !text-xs ${tab === "bao_cao" ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => setTab("bao_cao")}>Bài viết / Video ({subs.length})</button>
        <button className={`btn !px-3 !py-2 !text-xs ${tab === "lai_thu" ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => setTab("lai_thu")}>Lái thử ({tds.length})</button>
      </div>

      {tab === "bao_cao" && (
        <div className="card">
          {subs.length === 0 ? <div className="text-sm text-[#8A93A0]">Không có báo cáo nào chờ duyệt.</div> : (
            <div className="flex flex-col gap-2">
              {subs.map((o) => (
                <div key={o.id} className="p-3 rounded-xl border border-[#E3E8EF]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="mr-auto min-w-0">
                      <div className="font-semibold text-sm">{o.user_name} · {o.region || "—"}</div>
                      <div className="text-[11px] text-[#8A93A0]">{o.code} · {o.source_type === "kpi" ? kpiName(o.kpi_template_id) : campName(o.campaign_id)} · {o.platform} · {KPI_TYPE_LABEL[o.content_type]} · đăng {o.published_at || "—"}</div>
                      {o.note && <div className="text-[11px] text-[#5A6572]">Ghi chú: {o.note}</div>}
                    </div>
                    {o.status === "needs_revision" && <Badge tone="purple">Đã trả lại</Badge>}
                  </div>
                  {(o.content_url || (o.photos || []).length > 0) && (
                    <div className="flex gap-2 flex-wrap items-center mt-2">
                      {o.content_url && <a href={o.content_url} target="_blank" rel="noreferrer" className="btn-ghost !px-2.5 !py-1 !text-xs">🔗 Mở link</a>}
                      {(o.photos || []).map((ph, i) => <a key={i} href={ph.url} target="_blank" rel="noreferrer"><img src={ph.url} alt="" className="w-14 h-14 object-cover rounded-lg border border-[#E3E8EF]" /></a>)}
                    </div>
                  )}
                  <div className="flex gap-1.5 mt-2.5">
                    <button className="btn-ok !px-3 !py-1.5 !text-xs" disabled={busy} onClick={() => act("fn_mkt_duyet_bao_cao", o, "approve")}>✓ Xác nhận</button>
                    <button className="btn-ghost !px-3 !py-1.5 !text-xs" disabled={busy} onClick={() => act("fn_mkt_duyet_bao_cao", o, "revise")}>Yêu cầu bổ sung</button>
                    <button className="btn-ghost !px-3 !py-1.5 !text-xs !text-danger" disabled={busy} onClick={() => act("fn_mkt_duyet_bao_cao", o, "reject")}>Từ chối</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "lai_thu" && (
        <div className="card">
          {tds.length === 0 ? <div className="text-sm text-[#8A93A0]">Không có lượt lái thử nào chờ duyệt.</div> : (
            <div className="flex flex-col gap-2">
              {tds.map((o) => (
                <div key={o.id} className={`p-3 rounded-xl border ${o.is_suspicious ? "border-[#F0C000] bg-[#FFFCF0]" : "border-[#E3E8EF]"}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="mr-auto min-w-0">
                      <div className="font-semibold text-sm">{o.customer_name_snapshot} · {o.customer_phone_snapshot}</div>
                      <div className="text-[11px] text-[#8A93A0]">{o.code} · {o.employee_name} · {o.region || "—"} · lái thử {vName(o.test_drive_vehicle_id)} · {NEED_LABEL[o.customer_need_level]} · {RESULT_LABEL[o.result_status]}</div>
                      {o.customer_feedback && <div className="text-[11px] text-[#5A6572]">Phản hồi: {o.customer_feedback}</div>}
                      {o.is_suspicious && <div className="text-[11px] text-[#A25F00] font-semibold">⚠ {o.suspicious_note}</div>}
                    </div>
                    {o.status === "needs_revision" && <Badge tone="purple">Đã trả lại</Badge>}
                  </div>
                  {(o.photos || []).length > 0 && (
                    <div className="flex gap-2 flex-wrap mt-2">
                      {o.photos.map((ph, i) => <a key={i} href={ph.url} target="_blank" rel="noreferrer"><img src={ph.url} alt="" className="w-14 h-14 object-cover rounded-lg border border-[#E3E8EF]" /></a>)}
                    </div>
                  )}
                  <div className="flex gap-1.5 mt-2.5 flex-wrap">
                    <button className="btn-ok !px-3 !py-1.5 !text-xs" disabled={busy} onClick={() => act("fn_mkt_duyet_lai_thu", o, "approve")}>✓ Xác nhận</button>
                    <button className="btn-ghost !px-3 !py-1.5 !text-xs" disabled={busy} onClick={() => act("fn_mkt_duyet_lai_thu", o, "revise")}>Yêu cầu bổ sung</button>
                    <button className="btn-ghost !px-3 !py-1.5 !text-xs !text-danger" disabled={busy} onClick={() => act("fn_mkt_duyet_lai_thu", o, "reject")}>Từ chối</button>
                    {isBGD && <button className="btn-ghost !px-3 !py-1.5 !text-xs" disabled={busy} onClick={() => excludeKpi(o)}>Loại khỏi KPI</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
