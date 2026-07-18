"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, Field, CustomerSearch, VehicleSearch, Pager, pageSlice } from "@/components/ui";
import { errMsg } from "@/lib/format";
import { uploadAnhDon } from "@/lib/img";
import { NEED_LABEL, RESULT_LABEL, SUB_STATUS } from "@/lib/marketing";

const isoDT = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 16); };
const empty = { id: null, customer_id: "", interested_vehicle_id: "", test_drive_vehicle_id: "",
  test_drive_at: isoDT(new Date()), customer_need_level: "warm", result_status: "undecided",
  customer_feedback: "", employee_note: "", campaign_id: "" };

export default function LaiThu() {
  const { supabase, vehicles, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [custs, setCusts] = useState([]);
  const [rows, setRows] = useState([]);
  const [f, setF] = useState(empty);
  const [show, setShow] = useState(false);
  const [fotos, setFotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [newC, setNewC] = useState(null); // {name, phone, address}

  const load = async () => {
    if (!profile) return;
    const [{ data: c }, { data: r }] = await Promise.all([
      supabase.from("customers").select("id,code,name,phone,status").order("created_at", { ascending: false }).limit(2000),
      supabase.from("test_drives").select("*").eq("employee_id", profile.id).order("created_at", { ascending: false }).limit(500),
    ]);
    setCusts(c || []); setRows(r || []);
  };
  useEffect(() => { if (!loading) load(); }, [loading, profile]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  const vName = (id) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.name} ${v.color}` : id; };

  const createQuick = async () => {
    if (!newC.name.trim() || !newC.phone.trim()) return notify("Nhập tên và SĐT khách.", "err");
    const { data, error } = await supabase.rpc("fn_luu_khach_hang", { p: { name: newC.name, phone: newC.phone, address: newC.address || "", source: "Lái thử" } });
    if (error) return notify(errMsg(error), "err");
    await load();
    setF((p) => ({ ...p, customer_id: data }));
    setNewC(null);
    notify("Đã tạo khách mới.");
  };

  const save = async (gui) => {
    if (!f.customer_id) return notify("Chọn hoặc tạo khách hàng.", "err");
    if (gui && (!f.interested_vehicle_id || !f.test_drive_vehicle_id)) return notify("Chọn dòng xe quan tâm và dòng xe đã lái thử.", "err");
    setBusy(true);
    let photos = [];
    try { if (fotos.length > 0) { notify(`Đang tải ${fotos.length} ảnh…`); photos = await uploadAnhDon(supabase, "td/" + profile.id + "/" + Date.now(), fotos); } }
    catch (e) { setBusy(false); return notify("Tải ảnh lỗi: " + (e.message || e), "err"); }
    const { data, error } = await supabase.rpc("fn_mkt_luu_lai_thu", { p: {
      id: f.id, gui, customer_id: f.customer_id, interested_vehicle_id: f.interested_vehicle_id || null,
      test_drive_vehicle_id: f.test_drive_vehicle_id || null, test_drive_at: new Date(f.test_drive_at).toISOString(),
      customer_need_level: f.customer_need_level, result_status: f.result_status,
      customer_feedback: f.customer_feedback, employee_note: f.employee_note,
      campaign_id: f.campaign_id || null, photos: photos.length ? photos : (f.id ? undefined : []),
    } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(gui ? `Đã gửi lượt lái thử ${data} — chờ duyệt.` : `Đã lưu nháp ${data}.`);
    setShow(false); setF(empty); setFotos([]); load();
  };

  const openNew = () => { setF(empty); setFotos([]); setNewC(null); setShow(true); };
  const openEdit = (o) => {
    setF({ id: o.id, customer_id: o.customer_id, interested_vehicle_id: o.interested_vehicle_id || "",
      test_drive_vehicle_id: o.test_drive_vehicle_id || "", test_drive_at: isoDT(new Date(o.test_drive_at)),
      customer_need_level: o.customer_need_level, result_status: o.result_status,
      customer_feedback: o.customer_feedback || "", employee_note: o.employee_note || "", campaign_id: o.campaign_id || "" });
    setFotos([]); setNewC(null); setShow(true);
  };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2">
        <div className="font-extrabold text-lg mr-auto">Lái thử của tôi ({rows.length})</div>
        <Link href="/marketing" className="btn-ghost !text-xs">← Tổng quan</Link>
        <button className="btn-primary !text-sm" onClick={openNew}>+ Thêm khách lái thử</button>
      </div>

      {show && (
        <div className="card !p-4 border-2 border-brand">
          <div className="font-extrabold mb-3">{f.id ? "Sửa lượt lái thử" : "Khách lái thử mới"}</div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <Field label="Khách hàng (tìm theo SĐT/tên, hoặc tạo mới)" required>
                {newC ? (
                  <div className="grid gap-2 md:grid-cols-3 p-2.5 bg-[#F0FDF6] rounded-xl">
                    <input className="inp" placeholder="Họ tên *" value={newC.name} onChange={(e) => setNewC((p) => ({ ...p, name: e.target.value }))} />
                    <input className="inp" placeholder="SĐT *" value={newC.phone} onChange={(e) => setNewC((p) => ({ ...p, phone: e.target.value }))} />
                    <input className="inp" placeholder="Khu vực / địa chỉ" value={newC.address} onChange={(e) => setNewC((p) => ({ ...p, address: e.target.value }))} />
                    <div className="md:col-span-3 flex gap-2">
                      <button className="btn-ok !text-xs" onClick={createQuick}>Lưu khách</button>
                      <button className="btn-ghost !text-xs" onClick={() => setNewC(null)}>Hủy</button>
                    </div>
                  </div>
                ) : (
                  <CustomerSearch customers={custs} value={f.customer_id}
                    onPick={(c) => setF((p) => ({ ...p, customer_id: c ? c.id : "" }))}
                    onCreate={(name) => setNewC({ name: name || "", phone: "", address: "" })} />
                )}
              </Field>
            </div>
            <Field label="Dòng xe khách quan tâm" required>
              <VehicleSearch vehicles={vehicles} value={f.interested_vehicle_id} onChange={(id) => setF((p) => ({ ...p, interested_vehicle_id: id || "" }))} />
            </Field>
            <Field label="Dòng xe đã lái thử" required>
              <VehicleSearch vehicles={vehicles} value={f.test_drive_vehicle_id} onChange={(id) => setF((p) => ({ ...p, test_drive_vehicle_id: id || "" }))} />
            </Field>
            <Field label="Ngày giờ lái thử">
              <input type="datetime-local" className="inp" value={f.test_drive_at} onChange={(e) => setF((p) => ({ ...p, test_drive_at: e.target.value }))} />
            </Field>
            <Field label="Mức độ nhu cầu">
              <select className="inp" value={f.customer_need_level} onChange={(e) => setF((p) => ({ ...p, customer_need_level: e.target.value }))}>
                {Object.entries(NEED_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Kết quả sau lái thử">
              <select className="inp" value={f.result_status} onChange={(e) => setF((p) => ({ ...p, result_status: e.target.value }))}>
                {Object.entries(RESULT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Phản hồi của khách"><input className="inp" value={f.customer_feedback} onChange={(e) => setF((p) => ({ ...p, customer_feedback: e.target.value }))} /></Field>
            <Field label="Ghi chú của bạn"><input className="inp" value={f.employee_note} onChange={(e) => setF((p) => ({ ...p, employee_note: e.target.value }))} /></Field>
            <div className="md:col-span-2">
              <label className="lbl">Ảnh chứng minh (khách + xe)</label>
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
        {rows.length === 0 ? <div className="text-sm text-[#8A93A0]">Chưa có lượt lái thử nào.</div> : (
          <>
            <div className="flex flex-col gap-2">
              {pageSlice(rows, page, 10).map((o) => {
                const st = SUB_STATUS[o.status] || { label: o.status, tone: "dark" };
                const canEdit = ["draft", "needs_revision"].includes(o.status);
                return (
                  <div key={o.id} className="flex items-center gap-2 p-2.5 rounded-xl border border-[#E3E8EF]">
                    <div className="mr-auto min-w-0">
                      <div className="font-semibold text-sm truncate">{o.customer_name_snapshot} · {o.customer_phone_snapshot}</div>
                      <div className="text-[11px] text-[#8A93A0] truncate">{o.code} · lái thử {vName(o.test_drive_vehicle_id)} · {NEED_LABEL[o.customer_need_level]} · {RESULT_LABEL[o.result_status]}</div>
                      {o.is_suspicious && <div className="text-[11px] text-[#A25F00]">⚠ {o.suspicious_note}</div>}
                      {o.status === "needs_revision" && o.review_note && <div className="text-[11px] text-[#6D28D9]">Cần bổ sung: {o.review_note}</div>}
                    </div>
                    {o.excluded_from_kpi && <Badge tone="red">Loại KPI</Badge>}
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
