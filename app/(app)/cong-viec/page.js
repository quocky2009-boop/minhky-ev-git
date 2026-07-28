"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, Field, Pager, pageSlice } from "@/components/ui";
import { errMsg } from "@/lib/format";
import { uploadAnhDon } from "@/lib/img";
import { TASK_STATUS, TASK_CLOSED, PRIORITY, hanLabel, sortTasks, fmtHan, toLocalInput } from "@/lib/task";
import { InfoRows, AuditLog } from "@/components/detail";

const TASK_LOG = {
  create: "Tạo việc", start: "Bắt đầu thực hiện", check: "Tích checklist", uncheck: "Bỏ tích checklist",
  submit: "Gửi kết quả", resubmit: "Gửi lại kết quả", submit_auto_complete: "Gửi & tự hoàn thành",
  approve: "Xác nhận hoàn thành", revise: "Yêu cầu bổ sung", reject: "Không đạt", cancel: "Hủy việc", update: "Cập nhật việc",
};

export default function VievCuaToi() {
  const { supabase, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(true);
  const [fSt, setFSt] = useState("");
  const [page, setPage] = useState(1);
  // chi tiet
  const [d, setD] = useState(null);
  const [cl, setCl] = useState([]);
  const [results, setResults] = useState([]);
  const [cmts, setCmts] = useState([]);
  const [logs, setLogs] = useState([]);
  const [collabs, setCollabs] = useState([]);
  // gui ket qua
  const [rf, setRf] = useState({ result_text: "", result_link: "" });
  const [files, setFiles] = useState([]);
  const [cmt, setCmt] = useState("");
  // tu tao viec
  const [showNew, setShowNew] = useState(false);
  const [nf, setNf] = useState({ title: "", description: "", priority: "Bình thường", due_at: toLocalInput(new Date(Date.now() + 86400000)) });

  const load = async () => {
    if (!profile) return;
    setBusy(true);
    const { data } = await supabase.from("v_task_list").select("*")
      .or(`assignee_id.eq.${profile.id},created_by.eq.${profile.id}`)
      .order("due_at").limit(500);
    setRows(data || []); setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading, profile]);

  const openTask = async (t) => {
    setD(t); setRf({ result_text: "", result_link: "" }); setFiles([]); setCmt("");
    const [{ data: c }, { data: r }, { data: m }, { data: co }, { data: lg }] = await Promise.all([
      supabase.from("task_checklist_items").select("*").eq("task_id", t.id).order("sort_order"),
      supabase.from("task_results").select("*").eq("task_id", t.id).order("version_number", { ascending: false }),
      supabase.from("task_comments").select("*").eq("task_id", t.id).is("deleted_at", null).order("created_at"),
      supabase.from("task_collaborators").select("*").eq("task_id", t.id),
      supabase.from("task_audit_logs").select("*").eq("task_id", t.id).order("acted_at", { ascending: false }).limit(30),
    ]);
    setCl(c || []); setResults(r || []); setCmts(m || []); setCollabs(co || []); setLogs(lg || []);
  };
  const reload = async () => {
    const { data } = await supabase.from("v_task_list").select("*").eq("id", d.id).single();
    if (data) { await openTask(data); load(); }
  };

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  const rpc = async (fn, args, ok) => {
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    if (ok) notify(ok);
    reload();
  };

  const tichCl = async (item, done) => {
    const { error } = await supabase.rpc("fn_task_tich_checklist", { p_item: item.id, p_done: done, p_note: null });
    if (error) return notify(errMsg(error), "err");
    reload();
  };

  const guiKetQua = async () => {
    setBusy(true);
    let up = [];
    try { if (files.length) { notify(`Đang tải ${files.length} tệp…`); up = await uploadAnhDon(supabase, "task/" + d.code, files.map((x) => x.file), "task-files"); } }
    catch (e) { setBusy(false); return notify("Tải tệp lỗi: " + (e.message || e), "err"); }
    const { error } = await supabase.rpc("fn_task_gui_ket_qua", { p: { task_id: d.id, ...rf, files: up.map((f, i) => ({ ...f, type: files[i]?.file?.type || "" })) } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã gửi kết quả — chờ quản lý xác nhận.");
    setRf({ result_text: "", result_link: "" }); setFiles([]); reload();
  };

  const guiBinhLuan = async () => {
    if (!cmt.trim()) return;
    const { error } = await supabase.rpc("fn_task_binh_luan", { p_id: d.id, p_content: cmt, p_files: [] });
    if (error) return notify(errMsg(error), "err");
    setCmt(""); reload();
  };

  const taoViec = async () => {
    if (!nf.title.trim()) return notify("Nhập tên công việc.", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_task_tao", { p: { ...nf, due_at: new Date(nf.due_at).toISOString(), is_personal: true } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã tạo việc ${data}.`);
    setShowNew(false); setNf({ title: "", description: "", priority: "Bình thường", due_at: toLocalInput(new Date(Date.now() + 86400000)) });
    load();
  };

  // ===== CHI TIẾT =====
  if (d) {
    const st = TASK_STATUS[d.status] || { label: d.status, tone: "dark" };
    const h = hanLabel(d.due_at, d.status);
    const laToi = d.assignee_id === profile.id;
    const clXong = cl.filter((x) => x.is_completed).length;
    const pct = cl.length ? Math.round((clXong / cl.length) * 100) : 0;
    const coTheGui = laToi && ["not_started", "in_progress", "needs_revision"].includes(d.status);

    return (
      <div className="flex flex-col gap-4">
        <Toast toast={toast} />
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-ghost !text-xs" onClick={() => { setD(null); load(); }}>← Danh sách</button>
          <div className="font-extrabold text-base mr-auto">{d.code}</div>
          <Badge tone={PRIORITY[d.priority]?.tone || "dark"}>{d.priority}</Badge>
          <Badge tone={st.tone}>{st.label}</Badge>
          {h && <Badge tone={h.tone}>{h.text}</Badge>}
        </div>

        <div className="card">
          <div className="font-extrabold text-lg mb-1">{d.title}</div>
          <div className="text-[11px] text-[#8A93A0] mb-2">
            {d.category_name || "—"} · Hạn <b>{fmtHan(d.due_at)}</b> · Giao bởi {d.assigned_by_name || d.created_by_name}
            {d.assignee_id !== profile.id && ` · Thực hiện: ${d.assignee_name}`}
          </div>
          {d.description && <p className="text-[13.5px] whitespace-pre-wrap mb-2">{d.description}</p>}
          {d.completion_criteria && (
            <div className="text-[13px] p-2.5 rounded-xl bg-[#F8FAFC] mb-2"><b>Tiêu chuẩn hoàn thành:</b> {d.completion_criteria}</div>
          )}
          {d.status === "needs_revision" && d.completion_note && (
            <div className="text-[13px] p-2.5 rounded-xl bg-[#F5F0FF] border border-[#D9C8FF]"><b>🔁 Cần bổ sung:</b> {d.completion_note}</div>
          )}
          {d.status === "completed" && (
            <div className="text-[13px] p-2.5 rounded-xl bg-[#E7F6EE]">
              <b>✅ Hoàn thành</b> — xác nhận bởi {d.completed_by_name}
              {d.gui_dung_han ? <span className="text-[#0E7A4A]"> · gửi đúng hạn</span> : <span className="text-danger"> · gửi trễ hạn</span>}
              {d.completion_note && <div>{d.completion_note}</div>}
            </div>
          )}
          {d.status === "failed" && (
            <div className="text-[13px] p-2.5 rounded-xl bg-[#FDEDED]">
              <b>❌ Không đạt</b> — đánh giá bởi {d.completed_by_name}
              {d.completion_note && <div>Lý do: {d.completion_note}</div>}
            </div>
          )}
          {collabs.length > 0 && <div className="text-[11px] text-[#8A93A0] mt-2">Phối hợp: {collabs.map((c) => c.user_name).join(", ")}</div>}
          {(d.attachments || []).length > 0 && (
            <div className="flex gap-2 flex-wrap mt-2">
              {d.attachments.map((f, i) => <a key={i} href={f.url} target="_blank" rel="noreferrer" className="btn-ghost !text-xs">📎 {f.name}</a>)}
            </div>
          )}
        </div>

        {cl.length > 0 && (
          <div className="card">
            <div className="flex items-center gap-2 mb-2">
              <div className="font-extrabold mr-auto">Checklist</div>
              <span className="text-[13px] font-bold">{clXong}/{cl.length} · {pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-[#EEF1F4] overflow-hidden mb-3">
              <div className={`h-full ${pct === 100 ? "bg-[#0E7A4A]" : "bg-[#1f6feb]"}`} style={{ width: pct + "%" }} />
            </div>
            <div className="flex flex-col gap-1">
              {cl.map((x) => (
                <label key={x.id} className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer ${x.is_completed ? "bg-[#F4FBF7] border-[#BBE3CC]" : "border-[#E3E8EF]"}`}>
                  <input type="checkbox" className="w-5 h-5 mt-0.5 shrink-0" checked={x.is_completed}
                    disabled={TASK_CLOSED.includes(d.status)}
                    onChange={(e) => tichCl(x, e.target.checked)} />
                  <span className="min-w-0">
                    <span className={`text-[13.5px] ${x.is_completed ? "line-through text-[#8A93A0]" : ""}`}>{x.title}</span>
                    {x.is_required && <Badge tone="amber">bắt buộc</Badge>}
                    {x.is_completed && <span className="block text-[10.5px] text-[#8A93A0]">{x.completed_by_name}</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {results.length > 0 && (
          <div className="card">
            <div className="font-extrabold mb-2">Kết quả đã gửi ({results.length} lần)</div>
            {results.map((r) => (
              <div key={r.id} className={`p-2.5 rounded-xl mb-1.5 ${r.is_current ? "bg-[#F8FAFC] border border-[#E3E8EF]" : "opacity-60"}`}>
                <div className="text-[11px] text-[#8A93A0]">Lần {r.version_number} · {r.submitted_by_name} · {fmtHan(r.submitted_at)}</div>
                {r.result_text && <div className="text-[13px] whitespace-pre-wrap mt-1">{r.result_text}</div>}
                {r.result_link && <a href={r.result_link} target="_blank" rel="noreferrer" className="text-[12px] text-brand break-all">{r.result_link}</a>}
                {(r.files || []).length > 0 && (
                  <div className="flex gap-1.5 flex-wrap mt-1.5">
                    {r.files.map((f, i) => (f.url || "").match(/\.(jpg|jpeg|png|webp)$/i)
                      ? <a key={i} href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt="" className="w-14 h-14 object-cover rounded-lg border border-[#E3E8EF]" /></a>
                      : <a key={i} href={f.url} target="_blank" rel="noreferrer" className="btn-ghost !text-xs">📎 {f.name}</a>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {coTheGui && (
          <div className="card border-2 border-brand">
            <div className="font-extrabold mb-2">{d.status === "needs_revision" ? "Gửi lại kết quả" : "Gửi kết quả"}</div>
            <div className="flex flex-col gap-2.5">
              {(d.require_text_result || true) && (
                <Field label={`Ghi chú kết quả${d.require_text_result ? " (bắt buộc)" : ""}`}>
                  <textarea className="inp !h-20" value={rf.result_text} onChange={(e) => setRf((p) => ({ ...p, result_text: e.target.value }))} />
                </Field>
              )}
              <Field label={`Link${d.require_link ? " (bắt buộc)" : " (nếu có)"}`}>
                <input className="inp" value={rf.result_link} onChange={(e) => setRf((p) => ({ ...p, result_link: e.target.value }))} placeholder="https://..." />
              </Field>
              <div>
                <label className="lbl">
                  Ảnh / tệp {d.require_image ? `(bắt buộc ${Math.max(d.minimum_image_count, 1)} ảnh)` : d.require_file ? "(bắt buộc)" : "(nếu có)"}
                </label>
                <div className="flex gap-2 flex-wrap items-center">
                  <label className="btn-ghost !text-xs cursor-pointer">📷 Chọn / chụp
                    <input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv" multiple className="hidden" onChange={(e) => {
                      const fs = Array.from(e.target.files || []); e.target.value = "";
                      fs.forEach((file) => { const rd = new FileReader(); rd.onload = () => setFiles((p) => [...p, { file, url: rd.result }]); rd.readAsDataURL(file); });
                    }} />
                  </label>
                  {files.map((f, i) => (
                    <span key={i} className="inline-flex items-center gap-1 bg-[#F3F5F8] rounded-lg px-1.5 py-1 text-[11px]">
                      {f.file.type.startsWith("image") ? <img src={f.url} alt="" className="w-9 h-9 object-cover rounded" /> : <span>📎 {f.file.name.slice(0, 12)}</span>}
                      <button className="text-danger font-bold" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>✕</button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-3 flex-wrap">
              {d.status === "not_started" && <button className="btn-primary" disabled={busy} onClick={() => rpc("fn_task_bat_dau", { p_id: d.id }, "Đã bắt đầu thực hiện.")}>▶ Bắt đầu</button>}
              <button className="btn-ok" disabled={busy} onClick={guiKetQua}>{busy ? "Đang gửi…" : "📤 Gửi kết quả"}</button>
              {d.is_personal && d.created_by === profile.id && (
                <button className="btn-ghost !text-danger" onClick={() => { const l = prompt("Lý do hủy việc:"); if (l) rpc("fn_task_huy", { p_id: d.id, p_ly_do: l }, "Đã hủy việc."); }}>Hủy việc</button>
              )}
            </div>
          </div>
        )}

        <AuditLog logs={logs} labels={TASK_LOG} title="Nhật ký việc" />

        <div className="card">
          <div className="font-extrabold mb-2">Trao đổi ({cmts.length})</div>
          <div className="flex flex-col gap-1.5 mb-3">
            {cmts.map((c) => (
              <div key={c.id} className={`p-2.5 rounded-xl ${c.user_id === profile.id ? "bg-[#EAF2FF] ml-6" : "bg-[#F3F5F8] mr-6"}`}>
                <div className="text-[10.5px] text-[#8A93A0]">{c.user_name} · {fmtHan(c.created_at)}</div>
                <div className="text-[13px] whitespace-pre-wrap">{c.content}</div>
              </div>
            ))}
            {cmts.length === 0 && <div className="text-sm text-[#8A93A0]">Chưa có trao đổi nào.</div>}
          </div>
          <div className="flex gap-2">
            <input className="inp" placeholder="Nhập trao đổi…" value={cmt} onChange={(e) => setCmt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && guiBinhLuan()} />
            <button className="btn-primary !px-4" onClick={guiBinhLuan}>Gửi</button>
          </div>
        </div>
      </div>
    );
  }

  // ===== DANH SÁCH =====
  const cuaToi = rows.filter((t) => t.assignee_id === profile.id);
  const dem = (fn) => cuaToi.filter(fn).length;
  const quaHan = dem((t) => t.is_overdue);
  const homNay = dem((t) => !t.is_overdue && new Date(t.due_at).toDateString() === new Date().toDateString() && !TASK_CLOSED.includes(t.status));
  const filtered = sortTasks(rows.filter((t) => {
    if (fSt === "open") return !TASK_CLOSED.includes(t.status);
    if (fSt === "overdue") return t.is_overdue;
    if (fSt === "today") return !t.is_overdue && new Date(t.due_at).toDateString() === new Date().toDateString() && !TASK_CLOSED.includes(t.status);
    if (fSt === "upcoming") return !t.is_overdue && new Date(t.due_at) > new Date() && new Date(t.due_at).toDateString() !== new Date().toDateString() && !TASK_CLOSED.includes(t.status);
    if (fSt) return t.status === fSt;
    return !TASK_CLOSED.includes(t.status);
  }));
  const soanTien = (t) => {
    const d = new Date(t.due_at);
    return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
  };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Việc của tôi</div>
        <button className="btn-primary !text-sm" onClick={() => setShowNew(!showNew)}>{showNew ? "Đóng" : "+ Tự tạo việc"}</button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <KPI label="Quá hạn" value={quaHan} tone={quaHan ? "red" : "green"} />
        <KPI label="Đến hạn hôm nay" value={homNay} tone={homNay ? "amber" : "dark"} />
        <KPI label="Đang thực hiện" value={dem((t) => t.status === "in_progress")} tone="blue" />
        <KPI label="Chờ xác nhận" value={dem((t) => t.status === "pending_review")} tone="amber" />
        <KPI label="Cần bổ sung" value={dem((t) => t.status === "needs_revision")} tone="purple" />
      </div>

      {showNew && (
        <div className="card border-2 border-brand">
          <div className="font-extrabold mb-3">Tự tạo việc cho mình</div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2"><Field label="Tên công việc" required><input className="inp" value={nf.title} onChange={(e) => setNf((p) => ({ ...p, title: e.target.value }))} /></Field></div>
            <div className="md:col-span-2"><Field label="Mô tả"><textarea className="inp !h-16" value={nf.description} onChange={(e) => setNf((p) => ({ ...p, description: e.target.value }))} /></Field></div>
            <Field label="Mức độ"><select className="inp" value={nf.priority} onChange={(e) => setNf((p) => ({ ...p, priority: e.target.value }))}>{Object.keys(PRIORITY).map((k) => <option key={k}>{k}</option>)}</select></Field>
            <Field label="Hạn hoàn thành" required><input type="datetime-local" className="inp" value={nf.due_at} onChange={(e) => setNf((p) => ({ ...p, due_at: e.target.value }))} /></Field>
          </div>
          <button className="btn-ok mt-3" disabled={busy} onClick={taoViec}>Tạo việc</button>
        </div>
      )}

      <div className="card !p-0 overflow-hidden">
        {/* TABS THEO THỜI GIAN (kiểu Timeline công việc) */}
        <div className="flex border-b border-[#EEF1F4]">
          {[["today", "Hôm nay", homNay], ["overdue", "Quá hạn", quaHan], ["upcoming", "Sắp tới", dem((t) => !t.is_overdue && new Date(t.due_at) > new Date() && new Date(t.due_at).toDateString() !== new Date().toDateString() && !TASK_CLOSED.includes(t.status))]].map(([k, v, cnt]) => (
            <button key={k} className={`flex-1 py-2.5 text-[13px] font-semibold border-b-2 transition-colors ${fSt === k ? "border-brand text-brand" : "border-transparent text-[#8A93A0] hover:text-[#5A6572]"}`} onClick={() => { setFSt(k); setPage(1); }}>
              {v} {cnt > 0 && <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${fSt === k ? "bg-brand text-white" : "bg-[#EEF1F4]"}`}>{cnt}</span>}
            </button>
          ))}
        </div>

        {/* Filter phụ theo trạng thái */}
        <div className="flex gap-1.5 flex-wrap p-3 pb-0">
          {[["", "Đang mở"], ["needs_revision", "Cần bổ sung"], ["pending_review", "Chờ duyệt"], ["completed", "Đã xong"]].map(([k, v]) => (
            <button key={k} className={`btn !px-3 !py-1.5 !text-xs ${fSt === k ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => { setFSt(k); setPage(1); }}>{v}</button>
          ))}
        </div>

        <div className="p-3">
        {busy && rows.length === 0 ? <div className="text-sm text-[#8A93A0]">Đang tải…</div> : (
          <>
            <div className="flex flex-col gap-2">
              {pageSlice(filtered, page, 15).map((t) => {
                const st = TASK_STATUS[t.status] || { label: t.status, tone: "dark" };
                const h = hanLabel(t.due_at, t.status);
                const pct = t.cl_tong > 0 ? Math.round(t.cl_xong / t.cl_tong * 100) : (t.status === "completed" ? 100 : 0);
                return (
                  <button key={t.id} className={`p-3 rounded-xl border text-left hover:bg-[#F8FAFC] transition-colors ${h?.overdue ? "border-[#F5B5B5] bg-[#FFF6F6]" : "border-[#E3E8EF] bg-white"}`} onClick={() => openTask(t)}>
                    <div className="flex items-start gap-3">
                      {/* Icon nhóm/category */}
                      <div className="w-9 h-9 rounded-lg bg-[#EEF1F4] flex items-center justify-center text-[16px] shrink-0 mt-0.5">
                        {t.priority === "Khẩn cấp" ? "🚩" : "📁"}
                      </div>
                      <div className="mr-auto min-w-0 flex-1">
                        <div className="text-[10.5px] text-[#8A93A0] mb-0.5">{t.category_name || t.code}</div>
                        <div className="font-semibold text-[14px] flex items-center gap-1.5">
                          {t.priority === "Khẩn cấp" && <span className="text-danger">🚩</span>}
                          {t.title}
                        </div>
                        <div className="text-[11px] text-[#8A93A0] mt-0.5">
                          {soanTien(t)} → {fmtHan(t.due_at)}
                          {t.assignee_id !== profile.id && ` · ${t.assignee_name}`}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <div className="h-1.5 w-28 rounded-full bg-[#EEF1F4] overflow-hidden">
                            <div className={`h-full ${pct === 100 ? "bg-[#0E7A4A]" : "bg-[#1f6feb]"}`} style={{ width: pct + "%" }} />
                          </div>
                          <span className="text-[10.5px] text-[#8A93A0]">{pct}%</span>
                          {t.cl_tong > 0 && <span className="text-[10.5px] text-[#8A93A0]">· {t.cl_xong}/{t.cl_tong} mục</span>}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <div className="w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center text-[12px] font-bold">
                          {(t.assignee_name || "?").charAt(0).toUpperCase()}
                        </div>
                        <Badge tone={st.tone}>{st.short}</Badge>
                        {h && <span className={`text-[10.5px] font-bold ${h.tone === "red" ? "text-danger" : h.tone === "amber" ? "text-[#A25F00]" : "text-[#8A93A0]"}`}>{h.text}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && <div className="text-sm text-[#8A93A0] text-center py-8">Không có việc nào. 🎉</div>}
            </div>
            <Pager total={filtered.length} page={page} setPage={setPage} pageSize={15} setPageSize={() => {}} />
          </>
        )}
        </div>
      </div>
    </div>
  );
}
