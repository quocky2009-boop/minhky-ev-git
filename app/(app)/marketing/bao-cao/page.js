"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, Field, Pager, pageSlice } from "@/components/ui";
import { errMsg } from "@/lib/format";
import { uploadAnhDon } from "@/lib/img";
import { normalizeMarketingUrl, KPI_TYPE_LABEL, SUB_STATUS } from "@/lib/marketing";

const iso = (d) => d.toLocaleDateString("sv-SE");
const empty = { id: null, source_type: "kpi", kpi_template_id: "", campaign_id: "", campaign_requirement_id: "",
  platform: "Facebook cá nhân", content_type: "social_post", content_url: "", published_at: iso(new Date()), note: "" };

export default function BaoCaoCuaToi() {
  const { supabase, profile, settings, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [rows, setRows] = useState([]);
  const [kpis, setKpis] = useState([]);
  const [camps, setCamps] = useState([]);
  const [reqs, setReqs] = useState([]);
  const [f, setF] = useState(empty);
  const [show, setShow] = useState(false);
  const [fotos, setFotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);

  const platforms = (settings?.mkt_platforms || "Facebook cá nhân\nZalo cá nhân\nTikTok\nKhác").split(/\n+/).map((x) => x.trim()).filter(Boolean);

  const load = async () => {
    if (!profile) return;
    const [{ data: r }, { data: k }, { data: c }] = await Promise.all([
      supabase.from("mkt_submissions").select("*").eq("user_id", profile.id).order("created_at", { ascending: false }).limit(500),
      supabase.from("mkt_kpi_templates").select("*").eq("status", "Hoạt động"),
      supabase.from("mkt_campaigns").select("*").eq("status", "active").order("end_at"),
    ]);
    setRows(r || []); setKpis(k || []); setCamps(c || []);
  };
  useEffect(() => { if (!loading) load(); }, [loading, profile]);

  useEffect(() => {
    if (f.source_type === "campaign" && f.campaign_id) {
      supabase.from("mkt_campaign_requirements").select("*").eq("campaign_id", f.campaign_id).order("sort_order")
        .then(({ data }) => setReqs(data || []));
    } else setReqs([]);
  }, [f.source_type, f.campaign_id]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  const openNew = () => { setF(empty); setFotos([]); setShow(true); };
  const openEdit = (o) => {
    setF({ id: o.id, source_type: o.source_type, kpi_template_id: o.kpi_template_id || "", campaign_id: o.campaign_id || "",
      campaign_requirement_id: o.campaign_requirement_id || "", platform: o.platform, content_type: o.content_type,
      content_url: o.content_url || "", published_at: o.published_at || iso(new Date()), note: o.note || "" });
    setFotos([]); setShow(true);
  };

  const save = async (gui) => {
    if (f.source_type === "kpi" && !f.kpi_template_id) return notify("Chọn KPI định kỳ.", "err");
    if (f.source_type === "campaign" && !f.campaign_requirement_id) return notify("Chọn chiến dịch và đầu mục.", "err");
    setBusy(true);
    let photos = [];
    try {
      if (fotos.length > 0) { notify(`Đang tải ${fotos.length} ảnh…`); photos = await uploadAnhDon(supabase, "mkt/" + profile.id + "/" + Date.now(), fotos); }
    } catch (e) { setBusy(false); return notify("Tải ảnh lỗi: " + (e.message || e), "err"); }
    const ct = f.source_type === "campaign" ? (reqs.find((r) => r.id == f.campaign_requirement_id)?.content_type || f.content_type) : f.content_type;
    const { data, error } = await supabase.rpc("fn_mkt_luu_bao_cao", { p: {
      id: f.id, gui, source_type: f.source_type,
      kpi_template_id: f.source_type === "kpi" ? f.kpi_template_id : null,
      campaign_id: f.source_type === "campaign" ? f.campaign_id : null,
      campaign_requirement_id: f.source_type === "campaign" ? f.campaign_requirement_id : null,
      platform: f.platform, content_type: ct, content_url: f.content_url,
      published_at: f.published_at, note: f.note,
      photos: photos.length ? photos : (f.id ? undefined : []),
    } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(gui ? `Đã gửi báo cáo ${data} — chờ duyệt.` : `Đã lưu nháp ${data}.`);
    setShow(false); setFotos([]); load();
  };

  const kpiName = (id) => kpis.find((k) => k.id == id)?.name || "KPI";
  const campName = (id) => camps.find((c) => c.id == id)?.name || "Chiến dịch";
  const norm = f.content_url ? normalizeMarketingUrl(f.content_url) : "";
  const curReq = reqs.find((r) => r.id == f.campaign_requirement_id);

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2">
        <div className="font-extrabold text-lg mr-auto">Báo cáo của tôi ({rows.length})</div>
        <Link href="/marketing" className="btn-ghost !text-xs">← Tổng quan</Link>
        <button className="btn-primary !text-sm" onClick={openNew}>+ Báo cáo mới</button>
      </div>

      {show && (
        <div className="card !p-4 border-2 border-brand">
          <div className="font-extrabold mb-3">{f.id ? "Sửa báo cáo" : "Báo cáo mới"}</div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Nguồn" required>
              <div className="flex gap-1.5">
                {["kpi", "campaign"].map((t) => (
                  <button key={t} className={`btn !px-3 !py-2 !text-xs ${f.source_type === t ? "bg-brand text-white" : "bg-[#EEF1F4]"}`}
                    onClick={() => setF((p) => ({ ...p, source_type: t, kpi_template_id: "", campaign_id: "", campaign_requirement_id: "" }))}>
                    {t === "kpi" ? "KPI định kỳ" : "Chiến dịch"}
                  </button>
                ))}
              </div>
            </Field>
            {f.source_type === "kpi" ? (
              <Field label="Chọn KPI" required>
                <select className="inp" value={f.kpi_template_id} onChange={(e) => setF((p) => ({ ...p, kpi_template_id: e.target.value }))}>
                  <option value="">— Chọn —</option>
                  {kpis.map((k) => <option key={k.id} value={k.id}>{k.name} ({KPI_TYPE_LABEL[k.kpi_type]})</option>)}
                </select>
              </Field>
            ) : (
              <>
                <Field label="Chọn chiến dịch" required>
                  <select className="inp" value={f.campaign_id} onChange={(e) => setF((p) => ({ ...p, campaign_id: e.target.value, campaign_requirement_id: "" }))}>
                    <option value="">— Chọn —</option>
                    {camps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
                {f.campaign_id && (
                  <Field label="Đầu mục" required>
                    <select className="inp" value={f.campaign_requirement_id} onChange={(e) => setF((p) => ({ ...p, campaign_requirement_id: e.target.value }))}>
                      <option value="">— Chọn —</option>
                      {reqs.map((r) => <option key={r.id} value={r.id}>{r.title} ({KPI_TYPE_LABEL[r.content_type]} ×{r.target_quantity})</option>)}
                    </select>
                  </Field>
                )}
              </>
            )}
            <Field label="Nền tảng">
              <select className="inp" value={f.platform} onChange={(e) => setF((p) => ({ ...p, platform: e.target.value }))}>
                {platforms.map((pl) => <option key={pl}>{pl}</option>)}
              </select>
            </Field>
            <Field label="Ngày đăng thực tế">
              <input type="date" className="inp" value={f.published_at} onChange={(e) => setF((p) => ({ ...p, published_at: e.target.value }))} />
            </Field>
            <Field label={`Link bài viết / video${curReq && !curReq.link_required ? " (không bắt buộc)" : ""}`}>
              <input className="inp" value={f.content_url} onChange={(e) => setF((p) => ({ ...p, content_url: e.target.value }))} placeholder="https://facebook.com/..." />
              {norm && norm !== f.content_url && <div className="text-[10.5px] text-[#8A93A0] mt-1">Chuẩn hóa: {norm}</div>}
            </Field>
            <Field label="Ghi chú">
              <input className="inp" value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} />
            </Field>
            <div className="md:col-span-2">
              <label className="lbl">Ảnh chứng minh {curReq?.evidence_required ? "(bắt buộc)" : "(nếu không có link)"}</label>
              <div className="flex gap-2 flex-wrap items-center">
                <label className="btn-ghost !text-xs cursor-pointer">+ Chọn / chụp ảnh
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { setFotos((p) => [...p, ...Array.from(e.target.files || [])]); e.target.value = ""; }} />
                </label>
                {fotos.map((fl, i) => (
                  <span key={i} className="inline-flex items-center gap-1 bg-[#F3F5F8] rounded-lg px-2 py-1 text-[11px]">
                    <img src={URL.createObjectURL(fl)} alt="" className="w-8 h-8 object-cover rounded" />
                    <button className="text-danger font-bold" onClick={() => setFotos((p) => p.filter((_, j) => j !== i))}>✕</button>
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button className="btn-ok" disabled={busy} onClick={() => save(true)}>{busy ? "Đang lưu…" : "Gửi duyệt"}</button>
            <button className="btn-ghost" disabled={busy} onClick={() => save(false)}>Lưu nháp</button>
            <button className="btn-ghost" onClick={() => { setShow(false); setFotos([]); }}>Hủy</button>
          </div>
        </div>
      )}

      <div className="card">
        {rows.length === 0 ? <div className="text-sm text-[#8A93A0]">Chưa có báo cáo nào. Bấm "+ Báo cáo mới" để bắt đầu.</div> : (
          <>
            <div className="flex flex-col gap-2">
              {pageSlice(rows, page, 10).map((o) => {
                const st = SUB_STATUS[o.status] || { label: o.status, tone: "dark" };
                const canEdit = ["draft", "needs_revision"].includes(o.status);
                return (
                  <div key={o.id} className="flex items-center gap-2 p-2.5 rounded-xl border border-[#E3E8EF]">
                    <div className="mr-auto min-w-0">
                      <div className="font-semibold text-sm truncate">{o.source_type === "kpi" ? kpiName(o.kpi_template_id) : campName(o.campaign_id)}</div>
                      <div className="text-[11px] text-[#8A93A0] truncate">{o.code} · {o.platform} · {o.published_at || "—"}{o.content_url ? " · có link" : ""}{(o.photos || []).length ? ` · ${o.photos.length} ảnh` : ""}</div>
                      {o.status === "needs_revision" && o.review_note && <div className="text-[11px] text-[#6D28D9]">Cần bổ sung: {o.review_note}</div>}
                      {o.status === "rejected" && o.review_note && <div className="text-[11px] text-danger">Từ chối: {o.review_note}</div>}
                    </div>
                    {o.content_url && <a href={o.content_url} target="_blank" rel="noreferrer" className="btn-ghost !px-2 !py-1 !text-xs">Mở</a>}
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {canEdit && <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => openEdit(o)}>Sửa</button>}
                  </div>
                );
              })}
            </div>
            <Pager total={rows.length} page={page} setPage={setPage} pageSize={10} setPageSize={() => {}} />
          </>
        )}
      </div>
    </div>
  );
}
