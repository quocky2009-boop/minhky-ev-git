"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, Field } from "@/components/ui";
import { errMsg } from "@/lib/format";
import { CAMP_STATUS, KPI_TYPE_LABEL, PART_LABEL } from "@/lib/marketing";

const iso = (d) => d.toLocaleDateString("sv-SE");
const emptyCamp = { id: null, name: "", description: "", instructions: "", sample_content_url: "", document_url: "",
  media_folder_url: "", start_at: iso(new Date()), end_at: iso(new Date(Date.now() + 6 * 86400000)), priority: "Bình thường" };
const emptyReq = { title: "", content_type: "social_post", target_quantity: 1, link_required: true, evidence_allowed: true, evidence_required: false, approval_required: true, acceptance_criteria: "" };

export default function ChienDich() {
  const { supabase, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const params = useSearchParams();
  const [camps, setCamps] = useState([]);
  const [staff, setStaff] = useState([]);
  const [detail, setDetail] = useState(null);
  const [dReqs, setDReqs] = useState([]);
  const [dProg, setDProg] = useState([]);
  const [busy, setBusy] = useState(false);
  // form
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(1);
  const [cf, setCf] = useState(emptyCamp);
  const [reqs, setReqs] = useState([{ ...emptyReq }]);
  const [targets, setTargets] = useState({}); // user_id -> participation_type

  const canManage = profile && ["CEO", "ADMIN", "MANAGER"].includes(profile.role);

  const load = async () => {
    const [{ data: c }, { data: s }] = await Promise.all([
      supabase.from("mkt_campaigns").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id,name,role,region").eq("status", "Hoạt động").order("name"),
    ]);
    setCamps(c || []); setStaff(s || []);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  const openDetail = async (c) => {
    setDetail(c);
    const [{ data: r }, { data: pg }] = await Promise.all([
      supabase.from("mkt_campaign_requirements").select("*").eq("campaign_id", c.id).order("sort_order"),
      supabase.from("v_mkt_campaign_progress").select("*").eq("campaign_id", c.id),
    ]);
    setDReqs(r || []); setDProg(pg || []);
  };
  useEffect(() => {
    const id = params.get("id");
    if (id && camps.length) { const c = camps.find((x) => String(x.id) === id); if (c) openDetail(c); }
  }, [params, camps]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  const openNew = () => { setCf(emptyCamp); setReqs([{ ...emptyReq }]); setTargets({}); setStep(1); setShow(true); };

  const saveCampaign = async (publish) => {
    if (!cf.name.trim()) return notify("Nhập tên chiến dịch.", "err");
    if (reqs.length === 0 || reqs.some((r) => !r.title.trim())) return notify("Mỗi đầu mục cần có tên.", "err");
    const tArr = Object.entries(targets).filter(([, t]) => t).map(([user_id, participation_type]) => ({ user_id, participation_type }));
    if (tArr.length === 0) return notify("Chọn ít nhất 1 nhân viên tham gia.", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_mkt_luu_chien_dich", { p: {
      ...cf, status: publish ? "active" : "draft",
      requirements: reqs.map((r, i) => ({ ...r, sort_order: i })),
      targets: tArr,
    } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(publish ? `Đã phát hành chiến dịch ${data}.` : `Đã lưu nháp ${data}.`);
    setShow(false); load();
  };

  const changeStatus = async (c, status) => {
    const label = { active: "phát hành", ended: "kết thúc", completed: "đánh dấu hoàn thành", cancelled: "hủy" }[status];
    let note = "";
    if (["cancelled"].includes(status)) { note = prompt(`Lý do ${label} chiến dịch:`) || ""; }
    else if (!confirm(`Xác nhận ${label} chiến dịch "${c.name}"?`)) return;
    const { error } = await supabase.rpc("fn_mkt_trang_thai_chien_dich", { p_id: c.id, p_status: status, p_note: note });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã ${label}.`); load(); if (detail?.id === c.id) openDetail({ ...c, status });
  };

  const confirmDone = async (campId, userId) => {
    const note = prompt("Ghi chú xác nhận hoàn thành (không bắt buộc):") || "";
    const { error } = await supabase.rpc("fn_mkt_xac_nhan_hoan_thanh", { p_campaign_id: campId, p_user_id: userId, p_note: note });
    if (error) return notify(errMsg(error), "err");
    notify("Đã xác nhận nhân viên hoàn thành."); openDetail(detail);
  };

  const exempt = async (campId, userId) => {
    const ly = prompt("Lý do miễn KPI cho nhân viên này:");
    if (ly === null) return;
    if (!ly.trim()) return notify("Bắt buộc nhập lý do.", "err");
    const { error } = await supabase.rpc("fn_mkt_mien_kpi", { p_campaign_id: campId, p_user_id: userId, p_ly_do: ly });
    if (error) return notify(errMsg(error), "err");
    notify("Đã miễn KPI."); openDetail(detail);
  };

  // ==== CHI TIET ====
  if (detail) {
    const st = CAMP_STATUS[detail.status] || { label: detail.status, tone: "dark" };
    return (
      <div className="flex flex-col gap-4">
        <Toast toast={toast} />
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-ghost !text-xs" onClick={() => { setDetail(null); setDProg([]); }}>← Danh sách</button>
          <div className="font-extrabold text-lg mr-auto">{detail.name}</div>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
        <div className="card">
          <div className="text-sm text-[#5A6572]">{detail.code} · {detail.start_at} → {detail.end_at} · Ưu tiên: {detail.priority}</div>
          {detail.description && <p className="text-sm mt-2">{detail.description}</p>}
          {detail.instructions && <p className="text-[13px] mt-1 text-[#5A6572]">Hướng dẫn: {detail.instructions}</p>}
          <div className="flex gap-2 flex-wrap mt-2">
            {detail.sample_content_url && <a href={detail.sample_content_url} target="_blank" rel="noreferrer" className="btn-ghost !text-xs">Bài mẫu</a>}
            {detail.document_url && <a href={detail.document_url} target="_blank" rel="noreferrer" className="btn-ghost !text-xs">Tài liệu</a>}
            {detail.media_folder_url && <a href={detail.media_folder_url} target="_blank" rel="noreferrer" className="btn-ghost !text-xs">Thư mục ảnh/video</a>}
          </div>
          {canManage && (
            <div className="flex gap-1.5 flex-wrap mt-3 pt-3 border-t border-[#EEF1F4]">
              {detail.status === "draft" && <button className="btn-ok !text-xs" onClick={() => changeStatus(detail, "active")}>Phát hành</button>}
              {detail.status === "active" && <button className="btn-ghost !text-xs" onClick={() => changeStatus(detail, "ended")}>Kết thúc</button>}
              {["active", "ended"].includes(detail.status) && ["ADMIN", "CEO"].includes(profile.role) && <button className="btn-ghost !text-xs" onClick={() => changeStatus(detail, "completed")}>Hoàn thành</button>}
              {!["completed", "cancelled"].includes(detail.status) && ["ADMIN", "CEO"].includes(profile.role) && <button className="btn-ghost !text-xs !text-danger" onClick={() => changeStatus(detail, "cancelled")}>Hủy</button>}
            </div>
          )}
        </div>

        <div className="card">
          <div className="font-extrabold mb-2">Đầu mục KPI ({dReqs.length})</div>
          <div className="flex flex-col gap-1.5">
            {dReqs.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-sm p-2 rounded-lg bg-[#F8FAFC]">
                <Badge tone="purple">{KPI_TYPE_LABEL[r.content_type]}</Badge>
                <span className="font-semibold">{r.title}</span>
                <span className="text-[#8A93A0]">×{r.target_quantity}</span>
                <span className="ml-auto text-[11px] text-[#8A93A0]">{r.link_required ? "cần link" : "không cần link"}{r.evidence_required ? " · cần ảnh" : ""}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="font-extrabold mb-2">Tiến độ nhân viên ({dProg.length})</div>
          {dProg.length === 0 ? <div className="text-sm text-[#8A93A0]">Chưa có nhân viên nào được giao.</div> : (
            <div className="flex flex-col gap-2">
              {dProg.map((p) => (
                <div key={p.user_id} className="flex items-center gap-2 flex-wrap p-2.5 rounded-xl border border-[#E3E8EF]">
                  <div className="mr-auto">
                    <div className="font-semibold text-sm">{p.user_name} <span className="text-[11px] text-[#8A93A0]">· {p.region || "—"}</span></div>
                    <div className="text-[11px] text-[#8A93A0]">Duyệt {p.da_duyet}/{p.tong_muc_tieu} · nộp {p.da_nop} · chờ {p.cho_duyet}</div>
                  </div>
                  <Badge tone={PART_LABEL[p.participation_type] === "Được miễn" ? "dark" : p.participation_type === "encouraged" ? "blue" : "purple"}>{PART_LABEL[p.participation_type]}</Badge>
                  {p.manager_confirmed_at ? <Badge tone="green">✓ Hoàn thành</Badge>
                    : p.du_dieu_kien ? <Badge tone="amber">Đủ điều kiện</Badge> : <Badge tone="dark">Đang làm</Badge>}
                  {canManage && p.participation_type !== "exempted" && !p.manager_confirmed_at && p.du_dieu_kien &&
                    <button className="btn-ok !px-2.5 !py-1 !text-xs" onClick={() => confirmDone(detail.id, p.user_id)}>Xác nhận HT</button>}
                  {canManage && p.participation_type !== "exempted" && !p.manager_confirmed_at &&
                    <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => exempt(detail.id, p.user_id)}>Miễn</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==== FORM TAO ====
  if (show) {
    return (
      <div className="flex flex-col gap-4">
        <Toast toast={toast} />
        <div className="flex items-center gap-2">
          <button className="btn-ghost !text-xs" onClick={() => setShow(false)}>← Hủy</button>
          <div className="font-extrabold text-lg mr-auto">Tạo chiến dịch — Bước {step}/4</div>
        </div>
        <div className="flex gap-1.5">
          {["Thông tin", "Đối tượng", "KPI", "Xem trước"].map((s, i) => (
            <button key={i} className={`btn !px-2.5 !py-1.5 !text-xs ${step === i + 1 ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => setStep(i + 1)}>{i + 1}. {s}</button>
          ))}
        </div>

        {step === 1 && (
          <div className="card grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2"><Field label="Tên chiến dịch" required><input className="inp" value={cf.name} onChange={(e) => setCf((p) => ({ ...p, name: e.target.value }))} placeholder="VD: Ra mắt Kyo, Kinet & truyền thông Amio S2" /></Field></div>
            <div className="md:col-span-2"><Field label="Mô tả"><textarea className="inp !h-16" value={cf.description} onChange={(e) => setCf((p) => ({ ...p, description: e.target.value }))} /></Field></div>
            <div className="md:col-span-2"><Field label="Hướng dẫn thực hiện"><textarea className="inp !h-16" value={cf.instructions} onChange={(e) => setCf((p) => ({ ...p, instructions: e.target.value }))} /></Field></div>
            <Field label="Link bài mẫu"><input className="inp" value={cf.sample_content_url} onChange={(e) => setCf((p) => ({ ...p, sample_content_url: e.target.value }))} /></Field>
            <Field label="Link tài liệu"><input className="inp" value={cf.document_url} onChange={(e) => setCf((p) => ({ ...p, document_url: e.target.value }))} /></Field>
            <Field label="Link thư mục ảnh/video"><input className="inp" value={cf.media_folder_url} onChange={(e) => setCf((p) => ({ ...p, media_folder_url: e.target.value }))} /></Field>
            <Field label="Mức độ ưu tiên"><select className="inp" value={cf.priority} onChange={(e) => setCf((p) => ({ ...p, priority: e.target.value }))}><option>Thấp</option><option>Bình thường</option><option>Cao</option><option>Khẩn</option></select></Field>
            <Field label="Ngày bắt đầu" required><input type="date" className="inp" value={cf.start_at} onChange={(e) => setCf((p) => ({ ...p, start_at: e.target.value }))} /></Field>
            <Field label="Hạn hoàn thành" required><input type="date" className="inp" value={cf.end_at} onChange={(e) => setCf((p) => ({ ...p, end_at: e.target.value }))} /></Field>
          </div>
        )}

        {step === 2 && (
          <div className="card">
            <div className="flex items-center gap-2 mb-2">
              <div className="font-bold mr-auto">Chọn nhân viên tham gia ({Object.values(targets).filter(Boolean).length})</div>
              <button className="btn-ghost !text-xs" onClick={() => setTargets(Object.fromEntries(staff.filter((s) => s.role === "SALES").map((s) => [s.id, "required"])))}>Chọn tất cả Sales</button>
              <button className="btn-ghost !text-xs" onClick={() => setTargets({})}>Bỏ chọn</button>
            </div>
            <div className="flex flex-col gap-1.5 max-h-[420px] overflow-y-auto">
              {staff.map((s) => (
                <div key={s.id} className="flex items-center gap-2 p-2 rounded-lg border border-[#E3E8EF]">
                  <input type="checkbox" className="w-4 h-4" checked={!!targets[s.id]} onChange={(e) => setTargets((p) => ({ ...p, [s.id]: e.target.checked ? "required" : "" }))} />
                  <div className="mr-auto text-sm"><b>{s.name}</b> <span className="text-[11px] text-[#8A93A0]">· {s.role} · {s.region || "—"}</span></div>
                  {targets[s.id] && (
                    <select className="inp !w-auto !py-1 !text-xs" value={targets[s.id]} onChange={(e) => setTargets((p) => ({ ...p, [s.id]: e.target.value }))}>
                      <option value="required">Bắt buộc</option>
                      <option value="encouraged">Khuyến khích</option>
                    </select>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="card">
            <div className="flex items-center gap-2 mb-2">
              <div className="font-bold mr-auto">Đầu mục KPI ({reqs.length})</div>
              <button className="btn-ghost !text-xs" onClick={() => setReqs((p) => [...p, { ...emptyReq }])}>+ Thêm đầu mục</button>
            </div>
            <div className="flex flex-col gap-3">
              {reqs.map((r, i) => (
                <div key={i} className="p-3 rounded-xl border border-[#E3E8EF] grid gap-2 md:grid-cols-2">
                  <Field label="Tên đầu mục"><input className="inp" value={r.title} onChange={(e) => setReqs((p) => p.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} placeholder="VD: 3 bài Facebook" /></Field>
                  <Field label="Loại"><select className="inp" value={r.content_type} onChange={(e) => setReqs((p) => p.map((x, j) => j === i ? { ...x, content_type: e.target.value } : x))}>
                    <option value="social_post">Bài viết</option><option value="short_video">Video ngắn</option><option value="share">Chia sẻ</option><option value="test_drive">Lái thử</option><option value="custom">Tùy chỉnh</option>
                  </select></Field>
                  <Field label="Số lượng"><input type="number" min="1" className="inp" value={r.target_quantity} onChange={(e) => setReqs((p) => p.map((x, j) => j === i ? { ...x, target_quantity: +e.target.value } : x))} /></Field>
                  <div className="flex items-end gap-3 flex-wrap text-xs">
                    <label className="flex items-center gap-1"><input type="checkbox" checked={r.link_required} onChange={(e) => setReqs((p) => p.map((x, j) => j === i ? { ...x, link_required: e.target.checked } : x))} /> Bắt buộc link</label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={r.evidence_required} onChange={(e) => setReqs((p) => p.map((x, j) => j === i ? { ...x, evidence_required: e.target.checked } : x))} /> Bắt buộc ảnh</label>
                    {reqs.length > 1 && <button className="text-danger font-bold ml-auto" onClick={() => setReqs((p) => p.filter((_, j) => j !== i))}>Xóa</button>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="card">
            <div className="font-bold mb-2">Xem trước</div>
            <div className="text-sm flex flex-col gap-1">
              <div><b>{cf.name}</b> · {cf.start_at} → {cf.end_at} · {cf.priority}</div>
              <div>Nhân viên: <b>{Object.values(targets).filter(Boolean).length}</b> (bắt buộc {Object.values(targets).filter((t) => t === "required").length}, khuyến khích {Object.values(targets).filter((t) => t === "encouraged").length})</div>
              <div>Đầu mục: {reqs.map((r) => `${r.title} ×${r.target_quantity}`).join(" · ")}</div>
              <div className="text-[#8A93A0]">Tổng nội dung dự kiến: {reqs.reduce((s, r) => s + r.target_quantity, 0) * Object.values(targets).filter((t) => t === "required").length} (chỉ tính nhân viên bắt buộc)</div>
            </div>
            <div className="flex gap-2 mt-4">
              <button className="btn-ok" disabled={busy} onClick={() => saveCampaign(true)}>{busy ? "Đang lưu…" : "Phát hành ngay"}</button>
              <button className="btn-ghost" disabled={busy} onClick={() => saveCampaign(false)}>Lưu nháp</button>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {step > 1 && <button className="btn-ghost" onClick={() => setStep(step - 1)}>← Trước</button>}
          {step < 4 && <button className="btn-primary ml-auto" onClick={() => setStep(step + 1)}>Tiếp →</button>}
        </div>
      </div>
    );
  }

  // ==== DANH SACH ====
  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2">
        <div className="font-extrabold text-lg mr-auto">Chiến dịch ({camps.length})</div>
        <Link href="/marketing" className="btn-ghost !text-xs">← Tổng quan</Link>
        {canManage && <button className="btn-primary !text-sm" onClick={openNew}>+ Tạo chiến dịch</button>}
      </div>
      <div className="card">
        {camps.length === 0 ? <div className="text-sm text-[#8A93A0]">Chưa có chiến dịch nào.</div> : (
          <div className="flex flex-col gap-2">
            {camps.map((c) => {
              const st = CAMP_STATUS[c.status] || { label: c.status, tone: "dark" };
              return (
                <button key={c.id} className="flex items-center gap-2 p-2.5 rounded-xl border border-[#E3E8EF] hover:bg-[#F8FAFC] text-left" onClick={() => openDetail(c)}>
                  <div className="mr-auto">
                    <div className="font-semibold text-sm">{c.name}</div>
                    <div className="text-[11px] text-[#8A93A0]">{c.code} · {c.start_at} → {c.end_at}</div>
                  </div>
                  {c.priority === "Khẩn" && <Badge tone="red">Khẩn</Badge>}
                  <Badge tone={st.tone}>{st.label}</Badge>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
