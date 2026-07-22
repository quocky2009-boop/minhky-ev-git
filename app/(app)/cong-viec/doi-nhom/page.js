"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, Pager, pageSlice } from "@/components/ui";
import { errMsg, downloadCSV } from "@/lib/format";
import { TASK_STATUS, PRIORITY, hanLabel, sortTasks, fmtHan, toLocalInput } from "@/lib/task";

const KANBAN = ["not_started", "in_progress", "pending_review", "needs_revision", "completed"];

export default function VievDoiNhom() {
  const { supabase, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [rows, setRows] = useState([]);
  const [staff, setStaff] = useState([]);
  const [view, setView] = useState("list");
  const [fNv, setFNv] = useState("");
  const [fSt, setFSt] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(true);
  const [d, setD] = useState(null);
  const [cl, setCl] = useState([]);
  const [results, setResults] = useState([]);

  const load = async () => {
    setBusy(true);
    const [{ data: t }, { data: s }] = await Promise.all([
      supabase.from("v_task_list").select("*").order("due_at").limit(1000),
      supabase.from("profiles").select("id,name,role,region").eq("status", "Hoạt động").order("name"),
    ]);
    setRows(t || []); setStaff(s || []); setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  const openTask = async (t) => {
    setD(t);
    const [{ data: c }, { data: r }] = await Promise.all([
      supabase.from("task_checklist_items").select("*").eq("task_id", t.id).order("sort_order"),
      supabase.from("task_results").select("*").eq("task_id", t.id).order("version_number", { ascending: false }),
    ]);
    setCl(c || []); setResults(r || []);
  };

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  if (!["CEO", "MANAGER", "ADMIN"].includes(profile.role)) return <div className="card">Bạn không có quyền xem việc đội nhóm.</div>;

  const duyet = async (action) => {
    let note = "", han = null;
    if (action === "revise") {
      note = prompt("Nội dung cần bổ sung (bắt buộc):");
      if (note === null) return;
      if (!note.trim()) return notify("Bắt buộc ghi rõ nội dung cần bổ sung.", "err");
      const h = prompt("Hạn bổ sung mới (bỏ trống = giữ nguyên).\nĐịnh dạng: 2026-07-25 17:00");
      if (h && h.trim()) han = new Date(h.replace(" ", "T")).toISOString();
    } else {
      note = prompt("Ghi chú xác nhận (không bắt buộc):") || "";
    }
    setBusy(true);
    const { error } = await supabase.rpc("fn_task_duyet", { p_id: d.id, p_action: action, p_note: note, p_han_moi: han });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(action === "approve" ? "Đã xác nhận hoàn thành." : "Đã yêu cầu bổ sung.");
    setD(null); load();
  };

  const huy = async () => {
    const l = prompt("Lý do hủy việc (bắt buộc):");
    if (l === null) return;
    if (!l.trim()) return notify("Bắt buộc nhập lý do.", "err");
    const { error } = await supabase.rpc("fn_task_huy", { p_id: d.id, p_ly_do: l });
    if (error) return notify(errMsg(error), "err");
    notify("Đã hủy việc."); setD(null); load();
  };

  const doiHan = async () => {
    const h = prompt("Hạn mới (2026-07-25 17:00):", toLocalInput(d.due_at).replace("T", " "));
    if (!h) return;
    const r = prompt("Lý do đổi hạn:") || "";
    const { error } = await supabase.rpc("fn_task_sua", { p: { id: d.id, due_at: new Date(h.replace(" ", "T")).toISOString(), reason: r } });
    if (error) return notify(errMsg(error), "err");
    notify("Đã đổi hạn — đã ghi vết."); setD(null); load();
  };

  const kw = q.trim().toLowerCase();
  const filtered = rows.filter((t) => {
    if (fNv && t.assignee_id !== fNv) return false;
    if (fSt === "overdue") { if (!t.is_overdue) return false; }
    else if (fSt === "open") { if (["completed", "cancelled"].includes(t.status)) return false; }
    else if (fSt && t.status !== fSt) return false;
    if (!kw) return true;
    return `${t.code} ${t.title} ${t.assignee_name}`.toLowerCase().includes(kw);
  });
  const sorted = sortTasks(filtered);

  const dem = (fn) => rows.filter(fn).length;
  const choToiDuyet = rows.filter((t) => t.status === "pending_review");

  // Thống kê theo nhân viên
  const theoNv = {};
  rows.forEach((t) => {
    const k = t.assignee_id;
    theoNv[k] = theoNv[k] || { ten: t.assignee_name, tong: 0, xong: 0, qua_han: 0, dang_mo: 0 };
    if (t.status !== "cancelled") theoNv[k].tong++;
    if (t.status === "completed") theoNv[k].xong++;
    if (t.is_overdue) theoNv[k].qua_han++;
    if (!["completed", "cancelled"].includes(t.status)) theoNv[k].dang_mo++;
  });

  const exportCSV = () => {
    downloadCSV(`cong_viec_${new Date().toISOString().slice(0, 10)}.csv`,
      [["Mã", "Tên việc", "Nhóm", "Người thực hiện", "Người giao", "Mức độ", "Hạn", "Gửi lúc", "Xác nhận lúc", "Trạng thái", "Quá hạn", "Checklist", "Số lần bổ sung"],
       ...sorted.map((t) => [t.code, t.title, t.category_name || "", t.assignee_name, t.assigned_by_name || t.created_by_name,
         t.priority, fmtHan(t.due_at), t.submitted_at ? fmtHan(t.submitted_at) : "", t.completed_at ? fmtHan(t.completed_at) : "",
         TASK_STATUS[t.status]?.label || t.status, t.is_overdue ? "Có" : "Không",
         t.cl_tong ? `${t.cl_xong}/${t.cl_tong}` : "", t.revision_count])]);
    notify(`Đã xuất ${sorted.length} việc.`);
  };

  // ===== CHI TIẾT / DUYỆT =====
  if (d) {
    const st = TASK_STATUS[d.status] || { label: d.status, tone: "dark" };
    const h = hanLabel(d.due_at, d.status);
    const cur = results.find((r) => r.is_current);
    return (
      <div className="flex flex-col gap-4">
        <Toast toast={toast} />
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-ghost !text-xs" onClick={() => setD(null)}>← Danh sách</button>
          <div className="font-extrabold mr-auto">{d.code}</div>
          <Badge tone={PRIORITY[d.priority]?.tone || "dark"}>{d.priority}</Badge>
          <Badge tone={st.tone}>{st.label}</Badge>
          {h && <Badge tone={h.tone}>{h.text}</Badge>}
        </div>

        <div className="card">
          <div className="font-extrabold text-lg mb-1">{d.title}</div>
          <div className="text-[11px] text-[#8A93A0] mb-2">
            👤 {d.assignee_name} · {d.category_name || "—"} · hạn {fmtHan(d.due_at)}
            {d.submitted_at && <> · gửi {fmtHan(d.submitted_at)} {d.gui_dung_han ? <span className="text-[#0E7A4A] font-bold">đúng hạn</span> : <span className="text-danger font-bold">trễ hạn</span>}</>}
          </div>
          {d.description && <p className="text-[13.5px] whitespace-pre-wrap mb-2">{d.description}</p>}
          {d.completion_criteria && <div className="text-[13px] p-2.5 rounded-xl bg-[#F8FAFC]"><b>Tiêu chuẩn:</b> {d.completion_criteria}</div>}
          {d.revision_count > 0 && <div className="text-[12px] text-[#6D28D9] mt-1">Đã yêu cầu bổ sung {d.revision_count} lần</div>}
        </div>

        {cl.length > 0 && (
          <div className="card">
            <div className="font-extrabold mb-2">Checklist ({cl.filter((x) => x.is_completed).length}/{cl.length})</div>
            {cl.map((x) => (
              <div key={x.id} className="flex items-center gap-2 py-1 text-[13px]">
                <span>{x.is_completed ? "☑" : "☐"}</span>
                <span className={x.is_completed ? "line-through text-[#8A93A0]" : ""}>{x.title}</span>
                {x.is_required && <Badge tone="amber">bắt buộc</Badge>}
                {x.completed_by_name && <span className="text-[10.5px] text-[#8A93A0] ml-auto">{x.completed_by_name}</span>}
              </div>
            ))}
          </div>
        )}

        {cur && (
          <div className="card border-2 border-[#F0C000]">
            <div className="font-extrabold mb-2">📋 Kết quả nhân viên gửi (lần {cur.version_number})</div>
            {cur.result_text && <div className="text-[13.5px] whitespace-pre-wrap mb-2">{cur.result_text}</div>}
            {cur.result_link && <a href={cur.result_link} target="_blank" rel="noreferrer" className="btn-ghost !text-xs mb-2 inline-block">🔗 Mở link</a>}
            {(cur.files || []).length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {cur.files.map((f, i) => (f.url || "").match(/\.(jpg|jpeg|png|webp)$/i)
                  ? <a key={i} href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt="" className="w-20 h-20 object-cover rounded-lg border border-[#E3E8EF]" /></a>
                  : <a key={i} href={f.url} target="_blank" rel="noreferrer" className="btn-ghost !text-xs">📎 {f.name}</a>)}
              </div>
            )}
          </div>
        )}

        <div className="card">
          <div className="flex gap-2 flex-wrap">
            {d.status === "pending_review" && (
              <>
                <button className="btn-ok" disabled={busy} onClick={() => duyet("approve")}>✅ Xác nhận hoàn thành</button>
                <button className="btn-ghost" disabled={busy} onClick={() => duyet("revise")}>🔁 Yêu cầu bổ sung</button>
              </>
            )}
            {!["completed", "cancelled"].includes(d.status) && (
              <>
                <button className="btn-ghost !text-xs" onClick={doiHan}>📅 Đổi hạn</button>
                <button className="btn-ghost !text-xs !text-danger" onClick={huy}>Hủy việc</button>
              </>
            )}
            {d.status === "completed" && <div className="text-[13px] text-[#0E7A4A]">✅ Đã xác nhận bởi {d.completed_by_name} · {fmtHan(d.completed_at)}{d.completion_note && ` · ${d.completion_note}`}</div>}
            {d.status === "cancelled" && <div className="text-[13px] text-danger">Đã hủy: {d.cancellation_reason}</div>}
          </div>
        </div>
      </div>
    );
  }

  // ===== DANH SÁCH =====
  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Việc đội nhóm ({rows.length})</div>
        <Link href="/cong-viec/giao-viec" className="btn-primary !text-sm">+ Giao việc</Link>
        <button className="btn-ghost !text-xs" onClick={exportCSV}>⬇ CSV</button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <KPI label="Chờ tôi duyệt" value={choToiDuyet.length} tone={choToiDuyet.length ? "amber" : "green"} />
        <KPI label="Quá hạn" value={dem((t) => t.is_overdue)} tone={dem((t) => t.is_overdue) ? "red" : "green"} />
        <KPI label="Đang thực hiện" value={dem((t) => t.status === "in_progress")} tone="blue" />
        <KPI label="Cần bổ sung" value={dem((t) => t.status === "needs_revision")} tone="purple" />
        <KPI label="Hoàn thành" value={dem((t) => t.status === "completed")} tone="green" />
      </div>

      <div className="card">
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <div className="flex gap-1.5">
            {[["list", "Danh sách"], ["kanban", "Kanban"], ["nv", "Theo nhân viên"]].map(([k, v]) => (
              <button key={k} className={`btn !px-3 !py-1.5 !text-xs ${view === k ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => setView(k)}>{v}</button>
            ))}
          </div>
          <select className="inp !w-auto !py-1.5 !text-xs" value={fNv} onChange={(e) => { setFNv(e.target.value); setPage(1); }}>
            <option value="">Tất cả nhân viên</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="inp !w-auto !py-1.5 !text-xs" value={fSt} onChange={(e) => { setFSt(e.target.value); setPage(1); }}>
            <option value="">Tất cả trạng thái</option>
            <option value="open">Đang mở</option>
            <option value="overdue">Quá hạn</option>
            {Object.entries(TASK_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <input className="inp !w-44 !py-1.5 !text-xs" placeholder="Tìm mã, tên việc…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>

        {view === "list" && (
          <>
            <div className="flex flex-col gap-2">
              {pageSlice(sorted, page, 15).map((t) => {
                const st = TASK_STATUS[t.status]; const h = hanLabel(t.due_at, t.status);
                return (
                  <button key={t.id} className={`p-2.5 rounded-xl border text-left hover:bg-[#F8FAFC] ${h?.overdue ? "border-[#F5B5B5] bg-[#FFF6F6]" : t.status === "pending_review" ? "border-[#F0C000] bg-[#FFFCF0]" : "border-[#E3E8EF]"}`} onClick={() => openTask(t)}>
                    <div className="flex items-start gap-2">
                      <div className="mr-auto min-w-0">
                        <div className="font-semibold text-[14px]">{t.title}</div>
                        <div className="text-[11px] text-[#8A93A0]">{t.code} · 👤 {t.assignee_name} · hạn {fmtHan(t.due_at)}{t.cl_tong > 0 && ` · ☑ ${t.cl_xong}/${t.cl_tong}`}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge tone={st?.tone}>{st?.short}</Badge>
                        {h && <span className={`text-[10.5px] font-bold ${h.tone === "red" ? "text-danger" : h.tone === "amber" ? "text-[#A25F00]" : "text-[#8A93A0]"}`}>{h.text}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
              {sorted.length === 0 && <div className="text-sm text-[#8A93A0]">Không có việc nào khớp bộ lọc.</div>}
            </div>
            <Pager total={sorted.length} page={page} setPage={setPage} pageSize={15} setPageSize={() => {}} />
          </>
        )}

        {view === "kanban" && (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {KANBAN.map((k) => {
              const list = sorted.filter((t) => t.status === k);
              const st = TASK_STATUS[k];
              return (
                <div key={k} className="min-w-[220px] flex-1 bg-[#F8FAFC] rounded-xl p-2">
                  <div className="flex items-center gap-1.5 mb-2 px-1">
                    <Badge tone={st.tone}>{st.short}</Badge>
                    <span className="text-xs font-bold text-[#5A6572]">{list.length}</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {list.slice(0, 20).map((t) => {
                      const h = hanLabel(t.due_at, t.status);
                      return (
                        <button key={t.id} className="p-2 rounded-lg bg-white border border-[#E3E8EF] text-left hover:border-brand" onClick={() => openTask(t)}>
                          <div className="text-[12.5px] font-semibold leading-tight">{t.title}</div>
                          <div className="text-[10.5px] text-[#8A93A0] mt-0.5">{t.assignee_name}</div>
                          {h && <div className={`text-[10px] font-bold mt-0.5 ${h.tone === "red" ? "text-danger" : h.tone === "amber" ? "text-[#A25F00]" : "text-[#8A93A0]"}`}>{h.text}</div>}
                        </button>
                      );
                    })}
                    {list.length === 0 && <div className="text-[11px] text-[#8A93A0] px-1">—</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {view === "nv" && (
          <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
            <thead><tr><th className="th">Nhân viên</th><th className="th text-center">Đang mở</th><th className="th text-center">Quá hạn</th><th className="th text-center">Hoàn thành</th><th className="th">Tỷ lệ xong</th></tr></thead>
            <tbody>{Object.values(theoNv).sort((a, b) => b.qua_han - a.qua_han || b.dang_mo - a.dang_mo).map((n, i) => {
              const tl = n.tong ? Math.round(n.xong / n.tong * 100) : 0;
              return (
                <tr key={i} className={n.qua_han > 0 ? "bg-[#FFF6F6]" : "hover:bg-[#F8FAFC]"}>
                  <td data-label="Nhân viên" className="td font-semibold text-[13px]">{n.ten}</td>
                  <td data-label="Đang mở" className="td text-center">{n.dang_mo}</td>
                  <td data-label="Quá hạn" className="td text-center"><b className={n.qua_han ? "text-danger" : ""}>{n.qua_han}</b></td>
                  <td data-label="Hoàn thành" className="td text-center">{n.xong}</td>
                  <td data-label="Tỷ lệ" className="td"><Badge tone={tl >= 80 ? "green" : tl >= 50 ? "amber" : "red"}>{tl}%</Badge></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
