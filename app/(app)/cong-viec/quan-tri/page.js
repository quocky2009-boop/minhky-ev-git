"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, Field, LocSearch } from "@/components/ui";
import { errMsg } from "@/lib/format";
import { PRIORITY } from "@/lib/task";

const RULES = {
  daily: "Hằng ngày", weekday_set: "Các thứ trong tuần", weekly: "Hằng tuần",
  monthly: "Ngày cố định hằng tháng", month_end: "Ngày cuối tháng",
};
const DOW = [["2", "T2"], ["3", "T3"], ["4", "T4"], ["5", "T5"], ["6", "T6"], ["7", "T7"], ["1", "CN"]];
const emptyTpl = { id: null, name: "", description: "", completion_criteria: "", category_id: "", default_priority: "Bình thường", default_duration_hours: 24, requires_review: true, require_image: false, require_text_result: false, require_link: false, minimum_image_count: 0 };
const emptySeries = { id: null, title: "", description: "", rule_type: "daily", weekdays: [], day_of_month: 1, due_time: "17:00", assignee_id: "", reviewer_id: "", location_code: "", priority: "Bình thường", category_id: "", template_id: "" };

export default function QuanTriTask() {
  const { supabase, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [tab, setTab] = useState("mau");
  const [tpls, setTpls] = useState([]);
  const [series, setSeries] = useState([]);
  const [cats, setCats] = useState([]);
  const [staff, setStaff] = useState([]);
  const [tf, setTf] = useState(emptyTpl);
  const [items, setItems] = useState([]);
  const [sf, setSf] = useState(emptySeries);
  const [showT, setShowT] = useState(false);
  const [showS, setShowS] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outbox, setOutbox] = useState([]);

  const load = async () => {
    const [{ data: t }, { data: s }, { data: c }, { data: st }, { data: ob }] = await Promise.all([
      supabase.from("task_templates").select("*").order("name"),
      supabase.from("task_recurrence_series").select("*").order("title"),
      supabase.from("task_categories").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("profiles").select("id,name,role,region").eq("status", "Hoạt động").order("name"),
      supabase.from("task_outbox").select("status,error_message,created_at").order("id", { ascending: false }).limit(50),
    ]);
    setTpls(t || []); setSeries(s || []); setCats(c || []); setStaff(st || []); setOutbox(ob || []);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  if (!["CEO", "MANAGER", "ADMIN"].includes(profile.role)) return <div className="card">Bạn không có quyền vào trang này.</div>;

  const openTpl = async (t) => {
    setTf(t ? { ...t } : emptyTpl);
    if (t) {
      const { data } = await supabase.from("task_template_items").select("*").eq("template_id", t.id).order("sort_order");
      setItems((data || []).map((i) => ({ title: i.title, is_required: i.is_required })));
    } else setItems([]);
    setShowT(true);
  };

  const luuTpl = async () => {
    if (!tf.name.trim()) return notify("Nhập tên mẫu.", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_task_luu_mau", { p: { ...tf, category_id: tf.category_id || null, items: items.filter((x) => x.title.trim()).map((x, i) => ({ ...x, sort_order: i })) } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã lưu mẫu."); setShowT(false); load();
  };

  const luuSeries = async () => {
    if (!sf.title.trim() || !sf.assignee_id) return notify("Nhập tên việc và chọn người thực hiện.", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_task_luu_lich_lap", { p: {
      ...sf, category_id: sf.category_id || null, template_id: sf.template_id || null,
      reviewer_id: sf.reviewer_id || null, location_code: sf.location_code || null,
      day_of_month: sf.rule_type === "monthly" ? sf.day_of_month : null,
      weekdays: ["weekly", "weekday_set"].includes(sf.rule_type) ? sf.weekdays : [],
    } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã lưu lịch lặp."); setShowS(false); setSf(emptySeries); load();
  };

  const chayNgay = async () => {
    const { data, error } = await supabase.rpc("fn_task_sinh_ky", { p_date: null });
    if (error) return notify(errMsg(error), "err");
    notify(data > 0 ? `Đã sinh ${data} việc cho hôm nay.` : "Hôm nay không có lịch nào đến hạn (hoặc đã sinh rồi).");
  };

  const testDiscord = async () => {
    const { data, error } = await supabase.rpc("fn_task_test_webhook");
    if (error) return notify(errMsg(error), "err");
    notify(data || "Đã gửi.", String(data).includes("THÀNH CÔNG") ? "ok" : "err");
  };

  const dayOutbox = async () => {
    const { data, error } = await supabase.rpc("fn_task_day_outbox", { p_limit: 20 });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã đẩy ${data} tin nhắn.`); load();
  };

  const obLoi = outbox.filter((o) => o.status === "failed").length;
  const obCho = outbox.filter((o) => o.status === "pending").length;

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Mẫu & Lặp lại</div>
        <Link href="/cong-viec/doi-nhom" className="btn-ghost !text-xs">← Việc đội nhóm</Link>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {[["mau", `Mẫu công việc (${tpls.length})`], ["lap", `Việc lặp lại (${series.length})`], ["discord", "Discord"]].map(([k, v]) => (
          <button key={k} className={`btn !px-3 !py-2 !text-xs ${tab === k ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => setTab(k)}>{v}</button>
        ))}
      </div>

      {tab === "mau" && (
        <>
          <div className="card">
            <div className="flex items-center gap-2 mb-2">
              <div className="font-extrabold mr-auto">Mẫu công việc</div>
              <button className="btn-primary !text-xs" onClick={() => openTpl(null)}>+ Mẫu mới</button>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {tpls.map((t) => (
                <button key={t.id} className="p-2.5 rounded-xl border border-[#E3E8EF] text-left hover:bg-[#F8FAFC]" onClick={() => openTpl(t)}>
                  <div className="font-semibold text-[13.5px]">{t.name}</div>
                  <div className="text-[11px] text-[#8A93A0]">{t.code} · {t.default_priority} · {t.default_duration_hours}h
                    {t.require_image && " · cần ảnh"}{t.require_link && " · cần link"}</div>
                  {!t.is_active && <Badge tone="dark">Ngừng dùng</Badge>}
                </button>
              ))}
            </div>
          </div>

          {showT && (
            <div className="card border-2 border-brand">
              <div className="font-extrabold mb-3">{tf.id ? "Sửa mẫu" : "Mẫu mới"}</div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2"><Field label="Tên mẫu" required><input className="inp" value={tf.name} onChange={(e) => setTf((p) => ({ ...p, name: e.target.value }))} /></Field></div>
                <div className="md:col-span-2"><Field label="Nội dung chuẩn"><textarea className="inp !h-16" value={tf.description || ""} onChange={(e) => setTf((p) => ({ ...p, description: e.target.value }))} /></Field></div>
                <Field label="Nhóm"><select className="inp" value={tf.category_id || ""} onChange={(e) => setTf((p) => ({ ...p, category_id: e.target.value }))}><option value="">— Chọn —</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
                <Field label="Mức độ mặc định"><select className="inp" value={tf.default_priority} onChange={(e) => setTf((p) => ({ ...p, default_priority: e.target.value }))}>{Object.keys(PRIORITY).map((k) => <option key={k}>{k}</option>)}</select></Field>
                <Field label="Thời lượng mặc định (giờ)"><input type="number" className="inp" value={tf.default_duration_hours} onChange={(e) => setTf((p) => ({ ...p, default_duration_hours: +e.target.value || 24 }))} /></Field>
                <div className="flex items-end gap-3 flex-wrap text-[13px]">
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={tf.require_image} onChange={(e) => setTf((p) => ({ ...p, require_image: e.target.checked }))} /> cần ảnh</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={tf.require_link} onChange={(e) => setTf((p) => ({ ...p, require_link: e.target.checked }))} /> cần link</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={tf.require_text_result} onChange={(e) => setTf((p) => ({ ...p, require_text_result: e.target.checked }))} /> cần ghi chú</label>
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="text-xs font-bold text-[#5A6572] mr-auto">Checklist chuẩn ({items.length})</div>
                  <button className="btn-ghost !text-xs" onClick={() => setItems((p) => [...p, { title: "", is_required: false }])}>+ Bước</button>
                </div>
                {items.map((x, i) => (
                  <div key={i} className="flex gap-1.5 items-center mb-1">
                    <input className="inp !py-1.5 !text-[13px]" value={x.title} onChange={(e) => setItems((p) => p.map((y, j) => j === i ? { ...y, title: e.target.value } : y))} />
                    <label className="flex items-center gap-1 text-[11px] whitespace-nowrap"><input type="checkbox" checked={x.is_required} onChange={(e) => setItems((p) => p.map((y, j) => j === i ? { ...y, is_required: e.target.checked } : y))} /> bắt buộc</label>
                    <button className="text-danger font-bold px-1" onClick={() => setItems((p) => p.filter((_, j) => j !== i))}>✕</button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-3"><button className="btn-ok" disabled={busy} onClick={luuTpl}>Lưu mẫu</button><button className="btn-ghost" onClick={() => setShowT(false)}>Đóng</button></div>
            </div>
          )}
        </>
      )}

      {tab === "lap" && (
        <>
          <div className="card">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <div className="font-extrabold mr-auto">Việc lặp lại</div>
              <button className="btn-ghost !text-xs" onClick={chayNgay}>▶ Sinh việc hôm nay</button>
              <button className="btn-primary !text-xs" onClick={() => { setSf(emptySeries); setShowS(true); }}>+ Lịch mới</button>
            </div>
            <div className="flex flex-col gap-2">
              {series.map((s) => (
                <button key={s.id} className="p-2.5 rounded-xl border border-[#E3E8EF] text-left hover:bg-[#F8FAFC]" onClick={() => { setSf({ ...s, weekdays: s.weekdays || [] }); setShowS(true); }}>
                  <div className="flex items-center gap-2">
                    <div className="mr-auto">
                      <div className="font-semibold text-[13.5px]">{s.title}</div>
                      <div className="text-[11px] text-[#8A93A0]">
                        {RULES[s.rule_type]}
                        {["weekly", "weekday_set"].includes(s.rule_type) && ` (${(s.weekdays || []).map((d) => DOW.find((x) => x[0] == d)?.[1]).join(", ")})`}
                        {s.rule_type === "monthly" && ` (ngày ${s.day_of_month})`}
                        {" · "}hạn {String(s.due_time).slice(0, 5)} · {staff.find((x) => x.id === s.assignee_id)?.name || "?"}
                        {s.last_run_date && ` · sinh gần nhất ${s.last_run_date}`}
                      </div>
                    </div>
                    <Badge tone={s.is_active ? "green" : "dark"}>{s.is_active ? "Đang chạy" : "Tạm dừng"}</Badge>
                  </div>
                </button>
              ))}
              {series.length === 0 && <div className="text-sm text-[#8A93A0]">Chưa có lịch lặp nào.</div>}
            </div>
            <p className="text-[11px] text-[#8A93A0] mt-2">Hệ thống tự sinh việc lúc 6h sáng mỗi ngày. Mỗi kỳ là một việc riêng, có hạn và lịch sử riêng.</p>
          </div>

          {showS && (
            <div className="card border-2 border-brand">
              <div className="font-extrabold mb-3">{sf.id ? "Sửa lịch lặp" : "Lịch lặp mới"}</div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2"><Field label="Tên công việc" required><input className="inp" value={sf.title} onChange={(e) => setSf((p) => ({ ...p, title: e.target.value }))} /></Field></div>
                <div className="md:col-span-2"><Field label="Mô tả"><textarea className="inp !h-16" value={sf.description || ""} onChange={(e) => setSf((p) => ({ ...p, description: e.target.value }))} /></Field></div>
                <Field label="Chu kỳ"><select className="inp" value={sf.rule_type} onChange={(e) => setSf((p) => ({ ...p, rule_type: e.target.value }))}>{Object.entries(RULES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Giờ hết hạn trong ngày"><input type="time" className="inp" value={String(sf.due_time).slice(0, 5)} onChange={(e) => setSf((p) => ({ ...p, due_time: e.target.value }))} /></Field>
                {["weekly", "weekday_set"].includes(sf.rule_type) && (
                  <div className="md:col-span-2"><Field label="Chọn thứ">
                    <div className="flex gap-1.5 flex-wrap">
                      {DOW.map(([v, l]) => (
                        <button key={v} className={`!px-3 !py-1.5 !text-xs rounded-lg border ${(sf.weekdays || []).includes(+v) ? "bg-brand text-white border-brand" : "bg-white border-[#D5DBE3]"}`}
                          onClick={() => setSf((p) => ({ ...p, weekdays: (p.weekdays || []).includes(+v) ? p.weekdays.filter((x) => x !== +v) : [...(p.weekdays || []), +v] }))}>{l}</button>
                      ))}
                    </div>
                  </Field></div>
                )}
                {sf.rule_type === "monthly" && (
                  <Field label="Ngày trong tháng"><input type="number" min="1" max="31" className="inp" value={sf.day_of_month} onChange={(e) => setSf((p) => ({ ...p, day_of_month: +e.target.value || 1 }))} /></Field>
                )}
                <Field label="Người thực hiện" required>
                  <select className="inp" value={sf.assignee_id} onChange={(e) => setSf((p) => ({ ...p, assignee_id: e.target.value }))}>
                    <option value="">— Chọn —</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
                  </select>
                </Field>
                <Field label="Điểm"><LocSearch locations={locations} value={sf.location_code || ""} onChange={(v) => setSf((p) => ({ ...p, location_code: v }))} placeholder="Không bắt buộc" /></Field>
                <Field label="Mức độ"><select className="inp" value={sf.priority} onChange={(e) => setSf((p) => ({ ...p, priority: e.target.value }))}>{Object.keys(PRIORITY).map((k) => <option key={k}>{k}</option>)}</select></Field>
                <Field label="Dùng mẫu"><select className="inp" value={sf.template_id || ""} onChange={(e) => setSf((p) => ({ ...p, template_id: e.target.value }))}><option value="">— Không —</option>{tpls.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
                {sf.id && (
                  <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="w-4 h-4" checked={sf.is_active} onChange={(e) => setSf((p) => ({ ...p, is_active: e.target.checked }))} /> Đang chạy</label>
                )}
              </div>
              <div className="flex gap-2 mt-3"><button className="btn-ok" disabled={busy} onClick={luuSeries}>Lưu lịch</button><button className="btn-ghost" onClick={() => setShowS(false)}>Đóng</button></div>
            </div>
          )}
        </>
      )}

      {tab === "discord" && (
        <div className="card">
          <div className="font-extrabold mb-2">Thông báo Discord</div>
          <div className="flex gap-3 flex-wrap mb-3">
            <div className="p-2.5 rounded-xl bg-[#F8FAFC] flex-1 min-w-[120px]"><div className="text-[11px] text-[#8A93A0]">Chờ gửi</div><div className="text-xl font-bold">{obCho}</div></div>
            <div className="p-2.5 rounded-xl bg-[#F8FAFC] flex-1 min-w-[120px]"><div className="text-[11px] text-[#8A93A0]">Gửi lỗi</div><div className={`text-xl font-bold ${obLoi ? "text-danger" : ""}`}>{obLoi}</div></div>
            <div className="p-2.5 rounded-xl bg-[#F8FAFC] flex-1 min-w-[120px]"><div className="text-[11px] text-[#8A93A0]">Đã gửi (50 gần nhất)</div><div className="text-xl font-bold text-[#0E7A4A]">{outbox.filter((o) => o.status === "sent").length}</div></div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {["ADMIN", "CEO"].includes(profile.role) && <button className="btn-primary !text-xs" onClick={testDiscord}>🔔 Thử gửi tin test</button>}
            <button className="btn-ghost !text-xs" onClick={dayOutbox}>📤 Đẩy hàng đợi ngay</button>
          </div>
          {obLoi > 0 && (
            <div className="mt-3 text-[12px]">
              <b className="text-danger">Lỗi gần nhất:</b> {outbox.find((o) => o.status === "failed")?.error_message}
            </div>
          )}
          <p className="text-[11px] text-[#8A93A0] mt-3">Webhook cấu hình bằng SQL trong bảng app_settings (key <code>discord_webhook_task</code>). Hệ thống tự đẩy hàng đợi mỗi phút — Discord lỗi không ảnh hưởng việc tạo/duyệt task.</p>
        </div>
      )}
    </div>
  );
}
