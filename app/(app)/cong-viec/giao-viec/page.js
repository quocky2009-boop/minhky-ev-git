"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, Field, LocSearch } from "@/components/ui";
import { errMsg } from "@/lib/format";
import { PRIORITY, toLocalInput } from "@/lib/task";

const empty = {
  title: "", description: "", completion_criteria: "", category_id: "", location_code: "",
  priority: "Bình thường", due_at: toLocalInput(new Date(Date.now() + 86400000)),
  reviewer_id: "", requires_review: true,
  require_text_result: false, require_link: false, require_image: false, require_file: false,
  require_all_checklist: false, minimum_image_count: 0,
};

export default function GiaoViec() {
  const { supabase, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [staff, setStaff] = useState([]);
  const [cats, setCats] = useState([]);
  const [tpls, setTpls] = useState([]);
  const [f, setF] = useState(empty);
  const [cl, setCl] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [collabs, setCollabs] = useState([]);
  const [tplId, setTplId] = useState("");
  const [busy, setBusy] = useState(false);
  const [ketQua, setKetQua] = useState(null);

  const load = async () => {
    const [{ data: s }, { data: c }, { data: t }] = await Promise.all([
      supabase.from("profiles").select("id,name,role,region").eq("status", "Hoạt động").order("name"),
      supabase.from("task_categories").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("task_templates").select("*").eq("is_active", true).order("name"),
    ]);
    setStaff(s || []); setCats(c || []); setTpls(t || []);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  if (!["CEO", "MANAGER", "ADMIN"].includes(profile.role)) return <div className="card">Bạn không có quyền giao việc.</div>;

  // CHT chỉ giao trong khu vực mình
  const nhanVien = profile.role === "MANAGER" && profile.region
    ? staff.filter((s) => s.region === profile.region) : staff;

  const dungMau = async (id) => {
    setTplId(id);
    if (!id) { setCl([]); return; }
    const t = tpls.find((x) => String(x.id) === String(id));
    if (!t) return;
    const { data: items } = await supabase.from("task_template_items").select("*").eq("template_id", t.id).order("sort_order");
    setF((p) => ({
      ...p, title: t.name, description: t.description || "", completion_criteria: t.completion_criteria || "",
      category_id: t.category_id || "", priority: t.default_priority,
      due_at: toLocalInput(new Date(Date.now() + (t.default_duration_hours || 24) * 3600000)),
      requires_review: t.requires_review, require_text_result: t.require_text_result,
      require_link: t.require_link, require_image: t.require_image, require_file: t.require_file,
      require_all_checklist: t.require_all_checklist, minimum_image_count: t.minimum_image_count,
    }));
    setCl((items || []).map((i) => ({ title: i.title, is_required: i.is_required })));
    notify(`Đã áp dụng mẫu "${t.name}".`);
  };

  const giao = async () => {
    if (!f.title.trim()) return notify("Nhập tên công việc.", "err");
    if (assignees.length === 0) return notify("Chọn ít nhất 1 người thực hiện.", "err");
    setBusy(true);
    const payload = {
      ...f,
      category_id: f.category_id || null,
      reviewer_id: f.reviewer_id || null,
      location_code: f.location_code || null,
      due_at: new Date(f.due_at).toISOString(),
      template_id: tplId || null,
      checklist: cl.filter((x) => x.title.trim()).map((x, i) => ({ ...x, sort_order: i })),
      collaborators: collabs.map((u) => ({ user_id: u, can_check: true })),
    };
    let res, err;
    if (assignees.length === 1) {
      const r = await supabase.rpc("fn_task_tao", { p: { ...payload, assignee_id: assignees[0] } });
      res = r.data ? { count: 1, codes: [r.data] } : null; err = r.error;
    } else {
      const r = await supabase.rpc("fn_task_giao_hang_loat", { p: { ...payload, assignees, batch_title: f.title } });
      res = r.data; err = r.error;
    }
    setBusy(false);
    if (err) return notify(errMsg(err), "err");
    setKetQua(res);
    notify(`Đã giao ${res.count || 1} việc.`);
    setF(empty); setCl([]); setAssignees([]); setCollabs([]); setTplId("");
  };

  const toggle = (arr, setArr, id) => setArr(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  return (
    <div className="flex flex-col gap-4 pb-24">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Giao việc</div>
        <Link href="/cong-viec/doi-nhom" className="btn-ghost !text-xs">Việc đội nhóm →</Link>
      </div>

      {ketQua && (
        <div className="card bg-[#E7F6EE] border border-[#BBE3CC]">
          <div className="font-bold">✅ Đã giao {ketQua.count} việc</div>
          <div className="text-[12px] text-[#5A6572] mt-1">{(ketQua.codes || []).join(" · ")}</div>
          <button className="btn-ghost !text-xs mt-2" onClick={() => setKetQua(null)}>Đóng</button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
      <div className="card lg:col-span-2">
        <div className="font-extrabold mb-3">Nội dung công việc</div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2"><Field label="Tên công việc" required><input className="inp" value={f.title} onChange={(e) => setF((p) => ({ ...p, title: e.target.value }))} /></Field></div>
          <div className="md:col-span-2"><Field label="Nội dung chi tiết"><textarea className="inp !h-20" value={f.description} onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} /></Field></div>
          <div className="md:col-span-2"><Field label="Tiêu chuẩn hoàn thành"><input className="inp" value={f.completion_criteria} onChange={(e) => setF((p) => ({ ...p, completion_criteria: e.target.value }))} placeholder="Thế nào là làm xong?" /></Field></div>
          <Field label="Nhóm công việc">
            <select className="inp" value={f.category_id} onChange={(e) => setF((p) => ({ ...p, category_id: e.target.value }))}>
              <option value="">— Chọn —</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Điểm / cửa hàng"><LocSearch locations={locations} value={f.location_code} onChange={(v) => setF((p) => ({ ...p, location_code: v }))} placeholder="Không bắt buộc" /></Field>
          <Field label="Mức độ ưu tiên">
            <div className="flex gap-1.5 flex-wrap">
              {Object.keys(PRIORITY).map((k) => (
                <button key={k} className={`btn !px-2.5 !py-2 !text-xs ${f.priority === k ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => setF((p) => ({ ...p, priority: k }))}>{k}</button>
              ))}
            </div>
          </Field>
          <Field label="Hạn hoàn thành" required><input type="datetime-local" className="inp" value={f.due_at} onChange={(e) => setF((p) => ({ ...p, due_at: e.target.value }))} /></Field>
        </div>
      </div>

      <div className="card">
        <div className="font-extrabold mb-3">Thông tin bổ sung</div>
        <div className="flex flex-col gap-3">
          <Field label="Dùng mẫu có sẵn">
            <select className="inp" value={tplId} onChange={(e) => dungMau(e.target.value)}>
              <option value="">— Tạo mới từ đầu —</option>
              {tpls.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Người giao"><input className="inp bg-[#F8FAFC]" value={profile.name} disabled /></Field>
          <Field label="Người xác nhận kết quả">
            <select className="inp" value={f.reviewer_id} onChange={(e) => setF((p) => ({ ...p, reviewer_id: e.target.value }))}>
              <option value="">— Mặc định: người có quyền duyệt —</option>
              {staff.filter((s) => ["CEO", "MANAGER", "ADMIN"].includes(s.role)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>
      </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <div className="font-extrabold mr-auto">Checklist ({cl.length})</div>
          <button className="btn-ghost !text-xs" onClick={() => setCl((p) => [...p, { title: "", is_required: false }])}>+ Thêm bước</button>
        </div>
        <div className="flex flex-col gap-1.5">
          {cl.map((x, i) => (
            <div key={i} className="flex gap-1.5 items-center">
              <span className="text-xs text-[#8A93A0] w-5">{i + 1}.</span>
              <input className="inp !py-1.5 !text-[13px]" value={x.title} onChange={(e) => setCl((p) => p.map((y, j) => j === i ? { ...y, title: e.target.value } : y))} placeholder="Nội dung bước" />
              <label className="flex items-center gap-1 text-[11px] whitespace-nowrap">
                <input type="checkbox" checked={x.is_required} onChange={(e) => setCl((p) => p.map((y, j) => j === i ? { ...y, is_required: e.target.checked } : y))} /> bắt buộc
              </label>
              <button className="text-danger font-bold px-1" onClick={() => setCl((p) => p.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          {cl.length === 0 && <div className="text-[13px] text-[#8A93A0]">Chưa có bước nào — không bắt buộc.</div>}
        </div>
      </div>

      <div className="card">
        <div className="font-extrabold mb-2">Yêu cầu bằng chứng khi gửi kết quả</div>
        <div className="grid gap-2 md:grid-cols-2 text-[13px]">
          {[["require_text_result", "Bắt buộc ghi chú kết quả"], ["require_link", "Bắt buộc có link"],
            ["require_image", "Bắt buộc có ảnh"], ["require_file", "Bắt buộc đính kèm file"],
            ["require_all_checklist", "Phải tích hết checklist bắt buộc"], ["requires_review", "Cần quản lý xác nhận"]].map(([k, v]) => (
            <label key={k} className="flex items-center gap-2 p-2 rounded-lg border border-[#E3E8EF] cursor-pointer">
              <input type="checkbox" className="w-4 h-4" checked={f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.checked }))} />
              {v}
            </label>
          ))}
          {f.require_image && (
            <Field label="Số ảnh tối thiểu"><input type="number" min="1" className="inp" value={f.minimum_image_count} onChange={(e) => setF((p) => ({ ...p, minimum_image_count: +e.target.value || 1 }))} /></Field>
          )}
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <div className="font-extrabold mr-auto">Người thực hiện ({assignees.length})</div>
          {assignees.length > 1 && <Badge tone="purple">Giao hàng loạt — mỗi người 1 việc riêng</Badge>}
          <button className="btn-ghost !text-xs" onClick={() => setAssignees(nhanVien.map((s) => s.id))}>Chọn tất cả</button>
          <button className="btn-ghost !text-xs" onClick={() => setAssignees([])}>Bỏ chọn</button>
        </div>
        <div className="grid gap-1.5 md:grid-cols-2 max-h-[300px] overflow-y-auto">
          {nhanVien.map((s) => (
            <label key={s.id} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer ${assignees.includes(s.id) ? "bg-[#EAF2FF] border-brand" : "border-[#E3E8EF]"}`}>
              <input type="checkbox" className="w-4 h-4" checked={assignees.includes(s.id)} onChange={() => toggle(assignees, setAssignees, s.id)} />
              <span className="text-[13px]"><b>{s.name}</b> <span className="text-[11px] text-[#8A93A0]">· {s.role}{s.region ? " · " + s.region : ""}</span></span>
            </label>
          ))}
        </div>
        {assignees.length === 1 && (
          <div className="mt-3">
            <div className="text-xs font-semibold text-[#5A6572] mb-1.5">Người phối hợp (không bắt buộc)</div>
            <div className="flex gap-1.5 flex-wrap">
              {nhanVien.filter((s) => s.id !== assignees[0]).map((s) => (
                <button key={s.id} className={`!px-2.5 !py-1 !text-[11px] rounded-lg border ${collabs.includes(s.id) ? "bg-brand text-white border-brand" : "bg-white border-[#D5DBE3]"}`}
                  onClick={() => toggle(collabs, setCollabs, s.id)}>{s.name}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button className="btn-ok !py-3 !px-6" disabled={busy} onClick={giao}>
          {busy ? "Đang giao…" : assignees.length > 1 ? `📤 Giao ${assignees.length} việc` : "📤 Giao việc"}
        </button>
      </div>
    </div>
  );
}
