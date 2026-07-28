"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, Field } from "@/components/ui";
import { errMsg } from "@/lib/format";

const TYPE_TONE = { "Gọi điện":"blue","Gặp khách":"green","Lái thử":"amber","Giao xe":"purple","Nội bộ":"dark","Khác":"dark" };
const WEEKDAYS = ["CN","T2","T3","T4","T5","T6","T7"];
const emptyF = { title: "", description: "", appt_type: "Gặp khách", customer_id: "", customer_name: "", start_at: "", end_at: "", assigned_to: "", note: "" };

function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function LichHen() {
  const { supabase, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [appts, setAppts] = useState([]);
  const [staff, setStaff] = useState([]);
  const [custs, setCusts] = useState([]);
  const [busy, setBusy] = useState(true);
  const [cursor, setCursor] = useState(new Date());
  const [scopeMe, setScopeMe] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [f, setF] = useState(emptyF);
  const [dayView, setDayView] = useState(null); // ngày đang xem chi tiết (click vào 1 ô)

  const load = async () => {
    setBusy(true);
    const first = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1).toISOString();
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 2, 0).toISOString();
    const [{ data: a }, { data: s }, { data: c }] = await Promise.all([
      supabase.from("appointments").select("*").gte("start_at", first).lte("start_at", last).order("start_at"),
      supabase.from("profiles").select("id,name,role").eq("status","Hoạt động").order("name"),
      supabase.from("customers").select("id,name,phone").order("created_at",{ascending:false}).limit(500),
    ]);
    setAppts(a || []); setStaff(s || []); setCusts(c || []);
    setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading, cursor.getMonth(), cursor.getFullYear()]);

  if (loading || !profile) return <div className="card">Đang tải…</div>;

  const filteredAppts = scopeMe ? appts.filter(a => a.assigned_to === profile.id) : appts;

  // Xây lưới ngày trong tháng (bắt đầu từ Chủ nhật)
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay(); // 0=CN
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const gridStart = new Date(year, month, 1 - startOffset);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart); d.setDate(gridStart.getDate() + i);
    return d;
  });

  const isoDate = (d) => d.toLocaleDateString("sv-SE");
  const today = isoDate(new Date());
  const apptsOnDay = (d) => filteredAppts.filter(a => isoDate(new Date(a.start_at)) === isoDate(d));

  const luu = async () => {
    if (!f.title.trim()) return notify("Nhập tiêu đề.", "err");
    if (!f.start_at) return notify("Chọn thời gian.", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_luu_lich_hen", { p: {
      ...f, id: f.id || null,
      assigned_to: f.assigned_to || profile.id,
      assigned_name: staff.find(s => s.id === f.assigned_to)?.name || profile.name,
    }});
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(f.id ? "Đã cập nhật lịch hẹn." : "Đã tạo lịch hẹn mới.");
    setShowForm(false); setF(emptyF); load();
  };

  const xoa = async (id) => {
    if (!confirm("Xóa lịch hẹn này?")) return;
    const { error } = await supabase.rpc("fn_xoa_lich_hen", { p_id: id });
    if (error) return notify(errMsg(error), "err");
    notify("Đã xóa lịch hẹn."); setDayView(null); load();
  };

  const openNewAt = (d) => {
    const dt = new Date(d); dt.setHours(9, 0, 0, 0);
    setF({ ...emptyF, start_at: toLocalInput(dt) });
    setShowForm(true);
  };

  const openEdit = (a) => {
    setF({ id: a.id, title: a.title, description: a.description || "", appt_type: a.appt_type,
      customer_id: a.customer_id || "", customer_name: a.customer_name || "",
      start_at: toLocalInput(new Date(a.start_at)), end_at: a.end_at ? toLocalInput(new Date(a.end_at)) : "",
      assigned_to: a.assigned_to || "", note: a.note || "" });
    setShowForm(true);
  };

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Toast toast={toast} />

      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Lịch hẹn</div>
        <button className={`btn !px-3 !py-1.5 !text-xs ${scopeMe ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => setScopeMe(!scopeMe)}>
          {scopeMe ? "Của tôi" : "Tất cả"}
        </button>
        <button className="btn-primary !text-xs" onClick={() => openNewAt(new Date())}>+ Thêm lịch hẹn</button>
      </div>

      {/* ĐIỀU HƯỚNG THÁNG */}
      <div className="flex items-center gap-2">
        <button className="btn-ghost !px-3 !py-1.5 !text-sm" onClick={() => setCursor(new Date(year, month - 1, 1))}>‹</button>
        <div className="font-bold text-[15px] w-40 text-center">Tháng {month + 1}/{year}</div>
        <button className="btn-ghost !px-3 !py-1.5 !text-sm" onClick={() => setCursor(new Date(year, month + 1, 1))}>›</button>
        <button className="btn-ghost !text-xs" onClick={() => setCursor(new Date())}>Hôm nay</button>
      </div>

      {/* FORM TẠO/SỬA */}
      {showForm && (
        <div className="card border-l-4 border-l-brand">
          <div className="font-extrabold mb-3">{f.id ? "Sửa lịch hẹn" : "Thêm lịch hẹn mới"}</div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2"><Field label="Tiêu đề *"><input className="inp" value={f.title} onChange={e => setF(p => ({...p, title: e.target.value}))} placeholder="VD: Gặp khách tư vấn Evo Grand" /></Field></div>
            <Field label="Loại lịch hẹn">
              <select className="inp" value={f.appt_type} onChange={e => setF(p => ({...p, appt_type: e.target.value}))}>
                {["Gọi điện","Gặp khách","Lái thử","Giao xe","Nội bộ","Khác"].map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Khách hàng liên quan">
              <select className="inp" value={f.customer_id} onChange={e => {
                const c = custs.find(x => x.id === Number(e.target.value));
                setF(p => ({...p, customer_id: e.target.value, customer_name: c?.name || ""}));
              }}>
                <option value="">— Không chọn —</option>
                {custs.map(c => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
              </select>
            </Field>
            <Field label="Bắt đầu *"><input type="datetime-local" className="inp" value={f.start_at} onChange={e => setF(p => ({...p, start_at: e.target.value}))} /></Field>
            <Field label="Kết thúc"><input type="datetime-local" className="inp" value={f.end_at} onChange={e => setF(p => ({...p, end_at: e.target.value}))} /></Field>
            <Field label="Người phụ trách">
              <select className="inp" value={f.assigned_to} onChange={e => setF(p => ({...p, assigned_to: e.target.value}))}>
                <option value="">— Tôi —</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <div className="md:col-span-2"><Field label="Ghi chú"><textarea className="inp !h-16" value={f.note} onChange={e => setF(p => ({...p, note: e.target.value}))} /></Field></div>
          </div>
          <div className="flex gap-2 mt-3">
            <button className="btn-ok !text-xs" disabled={busy} onClick={luu}>{busy ? "Đang lưu…" : f.id ? "Cập nhật" : "Tạo lịch hẹn"}</button>
            <button className="btn-ghost !text-xs" onClick={() => { setShowForm(false); setF(emptyF); }}>Hủy</button>
            {f.id && <button className="btn-ghost !text-xs !text-danger ml-auto" onClick={() => xoa(f.id)}>🗑 Xóa</button>}
          </div>
        </div>
      )}

      {/* LƯỚI CALENDAR */}
      <div className="card !p-0 overflow-hidden">
        <div className="grid grid-cols-7 bg-[#1E2B3C]">
          {WEEKDAYS.map(w => <div key={w} className="text-center text-white text-[11px] font-semibold py-2">{w}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const inMonth = d.getMonth() === month;
            const isToday = isoDate(d) === today;
            const dayAppts = apptsOnDay(d);
            return (
              <div key={i}
                className={`min-h-[90px] border-b border-r border-[#EEF1F4] p-1.5 cursor-pointer hover:bg-[#F8FAFC] ${!inMonth ? "bg-[#FAFBFC]" : ""} ${isToday ? "bg-[#EAF2FF]" : ""}`}
                onClick={() => setDayView(d)}>
                <div className={`text-[11px] font-semibold mb-1 ${!inMonth ? "text-[#C6CDD6]" : isToday ? "text-brand" : "text-[#5A6572]"}`}>
                  {d.getDate()}{isToday && <span className="ml-1 text-[9px] bg-brand text-white px-1 rounded-full">nay</span>}
                </div>
                <div className="flex flex-col gap-0.5">
                  {dayAppts.slice(0, 3).map(a => (
                    <div key={a.id} className={`text-[9.5px] px-1 py-0.5 rounded truncate text-white ${a.appt_type==="Gặp khách"?"bg-green-500":a.appt_type==="Lái thử"?"bg-amber-500":a.appt_type==="Giao xe"?"bg-purple-500":a.appt_type==="Gọi điện"?"bg-blue-500":"bg-gray-400"}`}
                      title={a.title} onClick={(e) => { e.stopPropagation(); openEdit(a); }}>
                      {new Date(a.start_at).toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"})} {a.title}
                    </div>
                  ))}
                  {dayAppts.length > 3 && <div className="text-[9px] text-[#8A93A0]">+{dayAppts.length - 3} khác</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CHI TIẾT NGÀY (khi click ô) */}
      {dayView && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3" onClick={() => setDayView(null)}>
          <div className="bg-white rounded-2xl w-[420px] max-w-full max-h-[80vh] overflow-y-auto p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <div className="font-extrabold">{dayView.toLocaleDateString("vi-VN",{weekday:"long", day:"2-digit", month:"2-digit", year:"numeric"})}</div>
              <button className="btn-ghost !text-xs ml-auto" onClick={() => setDayView(null)}>✕</button>
            </div>
            <button className="btn-primary !text-xs w-full mb-3" onClick={() => { openNewAt(dayView); setDayView(null); }}>+ Thêm lịch hẹn ngày này</button>
            <div className="flex flex-col gap-2">
              {apptsOnDay(dayView).length === 0 && <div className="text-sm text-[#8A93A0] text-center py-4">Chưa có lịch hẹn nào.</div>}
              {apptsOnDay(dayView).sort((a,b) => new Date(a.start_at) - new Date(b.start_at)).map(a => (
                <div key={a.id} className="p-2.5 rounded-xl border border-[#E3E8EF] cursor-pointer hover:bg-[#F8FAFC]" onClick={() => { openEdit(a); setDayView(null); }}>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge tone={TYPE_TONE[a.appt_type]}>{a.appt_type}</Badge>
                    <span className="text-[11px] text-[#8A93A0]">{new Date(a.start_at).toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"})}{a.end_at && ` - ${new Date(a.end_at).toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"})}`}</span>
                  </div>
                  <div className="font-semibold text-[13px]">{a.title}</div>
                  {a.customer_name && <div className="text-[11px] text-brand">👤 {a.customer_name}</div>}
                  <div className="text-[10.5px] text-[#8A93A0] mt-0.5">{a.assigned_name}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
