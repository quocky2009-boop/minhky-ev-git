"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, Field, Pager, pageSlice, useSortable, Th } from "@/components/ui";
import { fmtVND, fmtDate, errMsg } from "@/lib/format";

const STAGES = ["Mới tiếp nhận","Đã liên hệ","Có nhu cầu","Hẹn tới cửa hàng","Đã lái thử","Đang báo giá","Đã cọc","Đã bán","Mất khách"];
const STAGE_TONE = { "Mới tiếp nhận":"dark","Đã liên hệ":"blue","Có nhu cầu":"blue","Hẹn tới cửa hàng":"amber","Đã lái thử":"amber","Đang báo giá":"amber","Đã cọc":"green","Đã bán":"green","Mất khách":"red" };
const HEAT_TONE = { "Nóng":"red","Trung bình":"amber","Lạnh":"dark" };
const SOURCES = ["Facebook","TikTok","Zalo","Khách vãng lai","Giới thiệu","Sự kiện","Website","Khác"];
const LOST_REASONS = ["Giá cao","Chưa đủ tiền","Chưa được gia đình đồng ý","Chọn thương hiệu khác","Không có màu","Không có xe sẵn","Không vay được trả góp","Không liên lạc được","Chưa có nhu cầu ngay","Khác"];
const TIMELINES = ["Tuần này","Tháng này","1–3 tháng","3–6 tháng","Chưa xác định"];
const emptyF = { customer_name:"",customer_phone:"",source:"Khách vãng lai",interested_vehicle_id:"",interested_vehicle_name:"",budget:"",mua_cho:"",need_loan:false,current_vehicle:"",buy_timeline:"",competitor:"",stage:"Mới tiếp nhận",heat:"Trung bình",next_call_date:"",location_code:"",note:"",assigned_to:"",assigned_name:"" };

export default function CoHoi() {
  const { supabase, vehicles, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [rows, setRows] = useState([]);
  const [staff, setStaff] = useState([]);
  const [busy, setBusy] = useState(true);
  const [tab, setTab] = useState("list"); // list | kanban
  const [fStage, setFStage] = useState("");
  const [fHeat, setFHeat] = useState("");
  const [fAss, setFAss] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const sort = useSortable();
  // Form tao/sua
  const [show, setShow] = useState(false);
  const [f, setF] = useState(emptyF);
  const [editId, setEditId] = useState(null);
  // Panel doi stage
  const [stageId, setStageId] = useState(null);
  const [stageF, setStageF] = useState({ stage:"",heat:"",next_call_date:"",lost_reason:"",note:"" });
  // Logs
  const [logsId, setLogsId] = useState(null);
  const [logs, setLogs] = useState([]);

  const load = async () => {
    setBusy(true);
    const [{ data: r }, { data: s }] = await Promise.all([
      supabase.from("v_co_hoi").select("*").order("updated_at", { ascending: false }).limit(2000),
      supabase.from("profiles").select("id,name,role").eq("status","Hoạt động").order("name"),
    ]);
    setRows(r || []); setStaff(s || []); setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải…</div>;

  const vName = (id) => { const v = vehicles.find(x => x.id === id); return v ? `${v.brand} ${v.name} ${v.color}` : ""; };
  const locName = (c) => locations.find(l => l.code === c)?.name || c || "—";
  const isManager = ["CEO","MANAGER","ADMIN"].includes(profile.role);

  const kw = q.trim().toLowerCase();
  const filtered = rows.filter(r => {
    if (fStage && r.stage !== fStage) return false;
    if (fHeat && r.heat !== fHeat) return false;
    if (fAss && r.assigned_to !== fAss) return false;
    if (!kw) return true;
    return `${r.customer_name} ${r.customer_phone} ${r.interested_vehicle_name||""} ${r.assigned_name}`.toLowerCase().includes(kw);
  });
  const sorted = sort.sortFn(filtered, {
    kh: r => r.customer_name, stage: r => STAGES.indexOf(r.stage),
    heat: r => r.heat, next: r => r.next_call_date||"", budget: r => r.budget,
    ass: r => r.assigned_name, upd: r => r.updated_at,
  });

  // KPI
  const active = rows.filter(r => !["Đã bán","Mất khách"].includes(r.stage));
  const nong = active.filter(r => r.heat === "Nóng").length;
  const goiHomNay = rows.filter(r => r.next_call_date === new Date().toLocaleDateString("sv-SE") && !["Đã bán","Mất khách"].includes(r.stage)).length;
  const matKhach = rows.filter(r => r.stage === "Mất khách").length;
  const daBan = rows.filter(r => r.stage === "Đã bán").length;

  const luu = async () => {
    if (!f.customer_name.trim()) return notify("Nhập tên khách.", "err");
    if (!f.customer_phone.trim()) return notify("Nhập SĐT khách.", "err");
    setBusy(true);
    let error;
    if (editId) {
      ({ error } = await supabase.rpc("fn_sua_co_hoi", { p: { ...f, id: editId } }));
    } else {
      ({ error } = await supabase.rpc("fn_tao_co_hoi", { p: { ...f, assigned_to: f.assigned_to || profile.id, assigned_name: f.assigned_name || profile.name } }));
    }
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(editId ? "Đã cập nhật cơ hội." : "Đã tạo cơ hội mới.");
    setShow(false); setEditId(null); setF(emptyF); load();
  };

  const doiStage = async () => {
    if (!stageF.stage) return notify("Chọn giai đoạn mới.", "err");
    if (stageF.stage === "Mất khách" && !stageF.lost_reason) return notify("Bắt buộc chọn lý do mất khách.", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_doi_stage_co_hoi", { p: { id: stageId, ...stageF } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã cập nhật giai đoạn."); setStageId(null); load();
  };

  const xemLogs = async (id) => {
    setLogsId(id);
    const { data } = await supabase.from("co_hoi_logs").select("*").eq("co_hoi_id", id).order("created_at", { ascending: false });
    setLogs(data || []);
  };

  const openEdit = (r) => {
    setEditId(r.id);
    setF({ customer_name: r.customer_name, customer_phone: r.customer_phone, source: r.source,
      interested_vehicle_id: r.interested_vehicle_id||"", interested_vehicle_name: r.interested_vehicle_name||"",
      budget: r.budget||"", mua_cho: r.mua_cho||"", need_loan: r.need_loan||false,
      current_vehicle: r.current_vehicle||"", buy_timeline: r.buy_timeline||"",
      competitor: r.competitor||"", stage: r.stage, heat: r.heat,
      next_call_date: r.next_call_date||"", location_code: r.location_code||"",
      note:"", assigned_to: r.assigned_to||"", assigned_name: r.assigned_name||"" });
    setShow(true);
  };

  // ===== FORM =====
  const Form = () => (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={() => { setShow(false); setEditId(null); }}>
      <div className="bg-white w-full md:max-w-2xl max-h-[90vh] overflow-y-auto rounded-t-2xl md:rounded-2xl p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <div className="font-extrabold text-lg mr-auto">{editId ? "Sửa cơ hội" : "Cơ hội bán hàng mới"}</div>
          <button className="btn-ghost !text-xs" onClick={() => { setShow(false); setEditId(null); }}>✕</button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Họ tên khách *"><input className="inp" value={f.customer_name} onChange={e => setF(p => ({...p, customer_name: e.target.value}))} /></Field>
          <Field label="SĐT *"><input className="inp" value={f.customer_phone} onChange={e => setF(p => ({...p, customer_phone: e.target.value}))} /></Field>
          <Field label="Nguồn khách">
            <select className="inp" value={f.source} onChange={e => setF(p => ({...p, source: e.target.value}))}>
              {SOURCES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Mức độ nóng">
            <div className="flex gap-1.5">{["Nóng","Trung bình","Lạnh"].map(h => (
              <button key={h} type="button" className={`btn !px-3 !py-2 !text-xs ${f.heat===h?"bg-brand text-white":"bg-[#EEF1F4]"}`} onClick={() => setF(p => ({...p, heat: h}))}>{h}</button>
            ))}</div>
          </Field>
          <Field label="Xe quan tâm">
            <select className="inp" value={f.interested_vehicle_id} onChange={e => {
              const v = vehicles.find(x => x.id === e.target.value);
              setF(p => ({...p, interested_vehicle_id: e.target.value, interested_vehicle_name: v ? `${v.brand} ${v.name} ${v.color}` : ""}));
            }}>
              <option value="">— Chọn mẫu xe —</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.brand} {v.name} {v.color}</option>)}
            </select>
          </Field>
          <Field label="Ngân sách (VND)"><input type="number" className="inp" value={f.budget} onChange={e => setF(p => ({...p, budget: e.target.value}))} placeholder="VD: 20000000" /></Field>
          <Field label="Mua cho ai"><input className="inp" value={f.mua_cho} onChange={e => setF(p => ({...p, mua_cho: e.target.value}))} placeholder="VD: bản thân, vợ, con..." /></Field>
          <Field label="Dự kiến mua">
            <select className="inp" value={f.buy_timeline} onChange={e => setF(p => ({...p, buy_timeline: e.target.value}))}>
              <option value="">— Chọn —</option>
              {TIMELINES.map(t => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Cần trả góp">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="w-4 h-4" checked={f.need_loan} onChange={e => setF(p => ({...p, need_loan: e.target.checked}))} />
              <span className="text-[13px]">Có nhu cầu trả góp</span>
            </label>
          </Field>
          <Field label="Xe đang dùng"><input className="inp" value={f.current_vehicle} onChange={e => setF(p => ({...p, current_vehicle: e.target.value}))} placeholder="VD: Honda Wave cũ" /></Field>
          <Field label="Đối thủ so sánh"><input className="inp" value={f.competitor} onChange={e => setF(p => ({...p, competitor: e.target.value}))} placeholder="VD: Yadea, Aima..." /></Field>
          <Field label="Ngày gọi lại"><input type="date" className="inp" value={f.next_call_date} onChange={e => setF(p => ({...p, next_call_date: e.target.value}))} /></Field>
          <Field label="Sales phụ trách">
            <select className="inp" value={f.assigned_to} onChange={e => {
              const s = staff.find(x => x.id === e.target.value);
              setF(p => ({...p, assigned_to: e.target.value, assigned_name: s?.name||""}));
            }}>
              <option value="">— Chọn sales —</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
            </select>
          </Field>
          <Field label="Cửa hàng">
            <select className="inp" value={f.location_code} onChange={e => setF(p => ({...p, location_code: e.target.value}))}>
              <option value="">— Chọn cửa hàng —</option>
              {locations.filter(l => l.type === "Cửa hàng" || l.type === "Showroom").map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Giai đoạn">
            <select className="inp" value={f.stage} onChange={e => setF(p => ({...p, stage: e.target.value}))}>
              {STAGES.slice(0,-1).map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <div className="md:col-span-2"><Field label="Ghi chú ban đầu"><textarea className="inp !h-16" value={f.note} onChange={e => setF(p => ({...p, note: e.target.value}))} /></Field></div>
        </div>
        <div className="flex gap-2 mt-4">
          <button className="btn-ok flex-1" disabled={busy} onClick={luu}>{busy ? "Đang lưu…" : editId ? "Cập nhật" : "Tạo cơ hội"}</button>
          <button className="btn-ghost" onClick={() => { setShow(false); setEditId(null); }}>Hủy</button>
        </div>
      </div>
    </div>
  );

  // ===== ĐỔI STAGE =====
  const StagePanel = ({ r }) => (
    <tr key={r.id+"_stage"}><td colSpan={9} className="td bg-[#EAF2FF] !p-3">
      <div className="font-semibold mb-2 text-brand">Chuyển giai đoạn — {r.customer_name}</div>
      <div className="grid gap-2 md:grid-cols-3">
        <Field label="Giai đoạn mới *">
          <select className="inp" value={stageF.stage} onChange={e => setStageF(p => ({...p, stage: e.target.value}))}>
            <option value="">— Chọn —</option>
            {STAGES.map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Mức độ nóng">
          <select className="inp" value={stageF.heat} onChange={e => setStageF(p => ({...p, heat: e.target.value}))}>
            <option value="">Giữ nguyên</option>
            {["Nóng","Trung bình","Lạnh"].map(h => <option key={h}>{h}</option>)}
          </select>
        </Field>
        <Field label="Ngày gọi lại"><input type="date" className="inp" value={stageF.next_call_date} onChange={e => setStageF(p => ({...p, next_call_date: e.target.value}))} /></Field>
        {stageF.stage === "Mất khách" && (
          <Field label="Lý do mất khách *">
            <select className="inp" value={stageF.lost_reason} onChange={e => setStageF(p => ({...p, lost_reason: e.target.value}))}>
              <option value="">— Bắt buộc chọn —</option>
              {LOST_REASONS.map(l => <option key={l}>{l}</option>)}
            </select>
          </Field>
        )}
        <div className="md:col-span-2"><Field label="Ghi chú"><input className="inp" value={stageF.note} onChange={e => setStageF(p => ({...p, note: e.target.value}))} /></Field></div>
      </div>
      <div className="flex gap-2 mt-2">
        <button className="btn-ok !text-xs" disabled={busy} onClick={doiStage}>Lưu</button>
        <button className="btn-ghost !text-xs" onClick={() => setStageId(null)}>Hủy</button>
      </div>
    </td></tr>
  );

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      {show && <Form />}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Cơ hội bán hàng ({rows.filter(r => !["Đã bán","Mất khách"].includes(r.stage)).length} đang theo)</div>
        <button className="btn-primary !text-xs" onClick={() => { setF({...emptyF, assigned_to: profile.id, assigned_name: profile.name}); setEditId(null); setShow(true); }}>+ Thêm cơ hội</button>
      </div>

      {/* KPI */}
      <div className="flex gap-3 flex-wrap">
        <KPI label="Đang theo dõi" value={active.length} tone="blue" />
        <KPI label="🔥 Khách nóng" value={nong} tone={nong > 0 ? "red" : "dark"} />
        <KPI label="📞 Gọi hôm nay" value={goiHomNay} tone={goiHomNay > 0 ? "amber" : "dark"} />
        <KPI label="✅ Đã bán" value={daBan} tone="green" />
        <KPI label="❌ Mất khách" value={matKhach} tone={matKhach > 0 ? "red" : "dark"} />
      </div>

      {/* TAB */}
      <div className="flex gap-1.5">
        {[["list","📋 Danh sách"],["kanban","🗂 Kanban"]].map(([k,v]) => (
          <button key={k} className={`btn !px-3 !py-2 !text-xs ${tab===k?"bg-brand text-white":"bg-[#EEF1F4]"}`} onClick={() => setTab(k)}>{v}</button>
        ))}
      </div>

      {/* ===== DANH SÁCH ===== */}
      {tab === "list" && (
        <div className="card">
          <div className="flex gap-2 flex-wrap items-center mb-3">
            <select className="inp !w-auto" value={fStage} onChange={e => { setFStage(e.target.value); setPage(1); }}>
              <option value="">Giai đoạn: tất cả</option>
              {STAGES.map(s => <option key={s}>{s}</option>)}
            </select>
            <select className="inp !w-auto" value={fHeat} onChange={e => { setFHeat(e.target.value); setPage(1); }}>
              <option value="">Nhiệt độ: tất cả</option>
              {["Nóng","Trung bình","Lạnh"].map(h => <option key={h}>{h}</option>)}
            </select>
            {isManager && (
              <select className="inp !w-auto" value={fAss} onChange={e => { setFAss(e.target.value); setPage(1); }}>
                <option value="">Sales: tất cả</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <input className="inp !w-52" placeholder="Tìm tên, SĐT, xe…" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} />
          </div>
          <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
            <thead><tr>
              <Th label="Khách hàng" k="kh" sort={sort} />
              <Th label="Xe quan tâm" k="xe" sort={sort} />
              <Th label="Ngân sách" k="budget" sort={sort} />
              <Th label="Nhiệt độ" k="heat" sort={sort} />
              <Th label="Giai đoạn" k="stage" sort={sort} />
              <Th label="Gọi lại" k="next" sort={sort} />
              <Th label="Sales" k="ass" sort={sort} />
              <Th label="Cập nhật" k="upd" sort={sort} />
              <th className="th"></th>
            </tr></thead>
            <tbody>{pageSlice(sorted, page, pageSize).map(r => {
              const overdueCall = r.next_call_date && r.next_call_date < new Date().toLocaleDateString("sv-SE") && !["Đã bán","Mất khách"].includes(r.stage);
              return [
                <tr key={r.id} className={`${overdueCall ? "bg-[#FFF6F6]" : "hover:bg-[#F8FAFC]"}`}>
                  <td className="td">
                    <div className="font-semibold">{r.customer_name}</div>
                    <div className="text-[10.5px] text-[#8A93A0]">{r.customer_phone}</div>
                    <div className="text-[10.5px] text-[#5A6572]">{r.source}</div>
                  </td>
                  <td className="td text-[13px]">
                    {r.interested_vehicle_name || r.vehicle_name_cat || <span className="text-[#8A93A0]">Chưa xác định</span>}
                    {r.need_loan && <div className="text-[10px] text-brand">Cần trả góp</div>}
                  </td>
                  <td className="td text-right">{r.budget > 0 ? fmtVND(r.budget) : <span className="text-[#C6CDD6]">—</span>}</td>
                  <td className="td"><Badge tone={HEAT_TONE[r.heat]}>{r.heat}</Badge></td>
                  <td className="td"><Badge tone={STAGE_TONE[r.stage]}>{r.stage}</Badge></td>
                  <td className="td text-xs">
                    {r.next_call_date
                      ? <span className={overdueCall ? "text-danger font-bold" : ""}>{fmtDate(r.next_call_date)}{overdueCall && " ⚠"}</span>
                      : <span className="text-[#C6CDD6]">—</span>}
                  </td>
                  <td className="td text-xs">{r.assigned_name}</td>
                  <td className="td text-xs text-[#8A93A0]">{fmtDate(r.updated_at)}</td>
                  <td className="td">
                    <div className="flex flex-col gap-1">
                      <button className="btn-ok !px-2 !py-1 !text-xs" onClick={() => { setStageId(r.id); setStageF({ stage:"", heat:"", next_call_date:"", lost_reason:"", note:"" }); }}>→ Stage</button>
                      <div className="flex gap-1">
                        <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => openEdit(r)}>✎</button>
                        <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => xemLogs(r.id)}>📋</button>
                      </div>
                    </div>
                  </td>
                </tr>,
                stageId === r.id && <StagePanel key={r.id+"_sp"} r={r} />,
                logsId === r.id && (
                  <tr key={r.id+"_logs"}><td colSpan={9} className="td bg-[#F8FAFC] !p-3">
                    <div className="font-semibold mb-2">Lịch sử — {r.customer_name}</div>
                    <div className="flex flex-col gap-1.5">
                      {logs.map(g => (
                        <div key={g.id} className="flex items-start gap-2 text-[12px] p-1.5 border-b border-[#F0F2F5]">
                          <span className="text-[#8A93A0] whitespace-nowrap">{fmtDate(g.created_at)}</span>
                          <span className="text-[#5A6572]">{g.created_by_name}</span>
                          {g.from_stage && <span className="text-[#8A93A0]">{g.from_stage} → <b>{g.to_stage}</b></span>}
                          {g.note && <span className="flex-1">{g.note}</span>}
                        </div>
                      ))}
                      {logs.length === 0 && <div className="text-[#8A93A0]">Chưa có lịch sử.</div>}
                    </div>
                    <button className="btn-ghost !text-xs mt-2" onClick={() => setLogsId(null)}>Đóng</button>
                  </td></tr>
                ),
              ];
            })}
            {sorted.length === 0 && <tr><td colSpan={9} className="td">Không có cơ hội nào.</td></tr>}
            </tbody>
          </table></div>
          <Pager total={sorted.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={() => {}} />
        </div>
      )}

      {/* ===== KANBAN ===== */}
      {tab === "kanban" && (
        <div className="overflow-x-auto">
          <div className="flex gap-3 min-w-max pb-4">
            {STAGES.map(stage => {
              const cards = rows.filter(r => r.stage === stage && (!fHeat || r.heat === fHeat) && (!fAss || r.assigned_to === fAss));
              const tong = cards.reduce((s, r) => s + (r.budget || 0), 0);
              return (
                <div key={stage} className="w-60 flex-shrink-0">
                  <div className={`rounded-xl p-2 mb-2 flex items-center gap-1.5 ${stage === "Mất khách" ? "bg-[#FDEDED]" : stage === "Đã bán" ? "bg-[#E5F6EE]" : "bg-[#EEF1F4]"}`}>
                    <div className="font-bold text-[12px] mr-auto">{stage}</div>
                    <Badge tone={STAGE_TONE[stage]}>{cards.length}</Badge>
                  </div>
                  {tong > 0 && <div className="text-[10.5px] text-[#8A93A0] mb-1.5 px-1">Tiềm năng: {fmtVND(tong)}</div>}
                  <div className="flex flex-col gap-2">
                    {cards.map(r => {
                      const overdueCall = r.next_call_date && r.next_call_date < new Date().toLocaleDateString("sv-SE");
                      return (
                        <div key={r.id} className={`rounded-xl border p-2.5 text-[12px] cursor-pointer hover:shadow-md transition-shadow ${overdueCall ? "border-danger bg-[#FFF6F6]" : "border-[#E3E8EF] bg-white"}`}
                          onClick={() => openEdit(r)}>
                          <div className="flex items-start gap-1.5 mb-1">
                            <div className="font-semibold flex-1">{r.customer_name}</div>
                            <Badge tone={HEAT_TONE[r.heat]}>{r.heat === "Nóng" ? "🔥" : r.heat === "Lạnh" ? "❄" : "~"}</Badge>
                          </div>
                          <div className="text-[#8A93A0]">{r.customer_phone}</div>
                          {(r.interested_vehicle_name || r.vehicle_name_cat) && <div className="text-brand text-[11px] mt-0.5">{r.interested_vehicle_name || r.vehicle_name_cat}</div>}
                          {r.budget > 0 && <div className="text-[#0E7A4A] font-semibold">{fmtVND(r.budget)}</div>}
                          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                            <span className="text-[10px] text-[#8A93A0]">{r.assigned_name}</span>
                            {r.next_call_date && <Badge tone={overdueCall ? "red" : "amber"}>{fmtDate(r.next_call_date)}</Badge>}
                          </div>
                          {r.source && <div className="text-[10px] text-[#8A93A0] mt-0.5">{r.source}</div>}
                          <button className="mt-1.5 btn-ok !px-2 !py-0.5 !text-xs w-full"
                            onClick={e => { e.stopPropagation(); setStageId(r.id); setStageF({ stage:"", heat:"", next_call_date:"", lost_reason:"", note:"" }); setTab("list"); }}>
                            → Chuyển stage
                          </button>
                        </div>
                      );
                    })}
                    {cards.length === 0 && <div className="text-[#C6CDD6] text-[11px] text-center py-4">Trống</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
