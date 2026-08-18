"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, KPI, Pager, pageSlice, useSortable, Th, LocSearch, MoneyInput } from "@/components/ui";
import { InfoRows, MoneyRows } from "@/components/detail";
import { fmtVND, fmtDate, fmtTime, errMsg, downloadCSV } from "@/lib/format";
import { CUSTOMER_TYPES, CUSTOMER_SOURCES } from "@/lib/const";

const iso = (d) => d.toLocaleDateString("sv-SE");
const CHANNELS = ["Gọi điện", "Zalo", "Facebook", "Nhắn tin", "Gặp trực tiếp", "Email", "Khác"];
const TIMELINES = ["Trong tuần này", "Trong tháng này", "1-3 tháng tới", "Trên 3 tháng", "Chưa rõ"];
const POTENTIALS = ["Cao", "Trung bình", "Thấp"];
const STATUSES = ["Lead mới", "Đang tư vấn", "Hẹn xem xe", "Đã mua", "Không mua", "Chăm sóc lại"];
const PIPELINE_STAGES = ["Mới tiếp nhận","Đã liên hệ","Có nhu cầu","Hẹn tới cửa hàng","Đã lái thử","Đang báo giá","Đã cọc","Đã bán","Mất khách"];
const STAGE_TONE = { "Mới tiếp nhận":"dark","Đã liên hệ":"blue","Có nhu cầu":"blue","Hẹn tới cửa hàng":"amber","Đã lái thử":"amber","Đang báo giá":"amber","Đã cọc":"green","Đã bán":"green","Mất khách":"red" };
const HEAT_TONE = { "Nóng":"red","Trung bình":"amber","Lạnh":"dark" };
const LOST_REASONS = ["Giá cao","Chưa đủ tiền","Chưa được gia đình đồng ý","Chọn thương hiệu khác","Không có màu","Không có xe sẵn","Không vay được trả góp","Không liên lạc được","Chưa có nhu cầu ngay","Khác"];
const emptyForm = {
  id: null, name: "", phone: "", phone2: "", email: "", cccd: "", birthday: "", gender: "",
  address: "", customer_type: "Khách lẻ", note: "",
  source: "", assigned_to: "", assigned_name: "", location_code: "",
  interested_products: "", budget: "", buy_timeline: "", potential: "", status: "Lead mới",
};

function KhachHangInner() {
  const params = useSearchParams();
  const { supabase, locations, vehicles, profile, loading } = useCatalog();
  const { toast, notify } = useToast();

  const [rows, setRows] = useState([]);
  const [tq, setTq] = useState({});          // tổng quan theo khách
  const [staff, setStaff] = useState([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [fType, setFType] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fStage, setFStage] = useState("");
  const [viewMode, setViewMode] = useState("list"); // list | kanban
  const [stageEdit, setStageEdit] = useState(null); // {id, pipeline_stage, heat, next_call_date, lost_reason, note}
  const [fPotential, setFPotential] = useState("");
  const [page, setPage] = useState(1);
  const sort = useSortable();

  // Form + chi tiết
  const [show, setShow] = useState(false);
  const [tab, setTab] = useState("chung");
  const [f, setF] = useState(emptyForm);
  const [donHang, setDonHang] = useState([]);
  const [phieuDV, setPhieuDV] = useState([]);
  const [careLogs, setCareLogs] = useState([]);
  const [careF, setCareF] = useState(null);
  const [dupWarn, setDupWarn] = useState([]); // KH trùng SĐT khi tạo mới

  const load = async () => {
    setBusy(true);
    const [{ data: c }, { data: t }, { data: s }] = await Promise.all([
      supabase.from("customers").select("*").order("created_at", { ascending: false }).limit(3000),
      supabase.from("v_khach_tong_quan").select("*"),
      supabase.from("profiles").select("id,name,role").eq("status", "Hoạt động").order("name"),
    ]);
    setRows(c || []); setStaff(s || []);
    const m = {}; (t || []).forEach((x) => { m[x.customer_id] = x; }); setTq(m);
    setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);
  useEffect(() => { const v = params.get("q"); if (v) setQ(v); }, [params]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  const locName = (c) => locations.find((l) => l.code === c)?.name || c;
  const vName = (id) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.name} ${v.color}` : id; };

  const openNew = () => { setF({ ...emptyForm, location_code: profile.store_code || "" }); setTab("chung"); setDonHang([]); setPhieuDV([]); setCareLogs([]); setDupWarn([]); setShow(true); };

  const luuStage = async () => {
    if (!stageEdit.pipeline_stage) return notify("Chọn giai đoạn.", "err");
    if (stageEdit.pipeline_stage === "Mất khách" && !stageEdit.lost_reason) return notify("Bắt buộc chọn lý do mất khách.", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_doi_pipeline_khach", { p: {
      id: stageEdit.id, pipeline_stage: stageEdit.pipeline_stage, heat: stageEdit.heat,
      next_call_date: stageEdit.next_call_date || null, lost_reason: stageEdit.lost_reason || "",
      note: stageEdit.note || "",
    }});
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã cập nhật giai đoạn."); setStageEdit(null); load();
  };

  const openEdit = async (c) => {
    setF({
      id: c.id, name: c.name || "", phone: c.phone || "", phone2: c.phone2 || "", email: c.email || "",
      cccd: c.cccd || "", birthday: c.birthday || "", gender: c.gender || "", address: c.address || "",
      customer_type: c.customer_type || "Khách lẻ", note: c.note || "", source: c.source || "",
      assigned_to: c.assigned_to || "", assigned_name: c.assigned_name || "", location_code: c.location_code || "",
      interested_products: c.interested_products || "", budget: c.budget || "",
      buy_timeline: c.buy_timeline || "", potential: c.potential || "", status: c.status || "Lead mới",
    });
    setTab("muahang"); setShow(true); setCareF(null);
    const [{ data: o1 }, { data: o2 }, { data: dv }, { data: care }] = await Promise.all([
      supabase.from("sales_orders").select("*").eq("customer_id", c.id).order("sale_date", { ascending: false }),
      supabase.from("sales_orders").select("*").eq("end_customer_id", c.id).order("sale_date", { ascending: false }),
      supabase.from("dv_tickets").select("*").eq("customer_id", c.id).order("created_at", { ascending: false }).limit(50),
      supabase.from("customer_care_logs").select("*").eq("customer_id", c.id).order("care_date", { ascending: false }).limit(100),
    ]);
    // Gop 2 nguon (mua truc tiep + duoc dung ten khach le cuoi cua don ban buon), loai trung neu co,
    // danh dau ro vai tro (o1 = nguoi mua chinh, o2 = khach le dung ten HD trong don ban buon)
    const map = new Map();
    (o1 || []).forEach((x) => map.set(x.id, { ...x, _vai_tro: "Người mua" }));
    (o2 || []).forEach((x) => { if (!map.has(x.id)) map.set(x.id, { ...x, _vai_tro: "Khách lẻ đứng tên HĐ" }); });
    const merged = [...map.values()].sort((a, b) => new Date(b.sale_date) - new Date(a.sale_date));
    setDonHang(merged); setPhieuDV(dv || []); setCareLogs(care || []);
  };

  const luu = async () => {
    if (!f.name.trim() || !f.phone.trim()) return notify("Nhập họ tên và số điện thoại.", "err");
    if (!f.email.trim()) return notify("Nhập email.", "err");
    if (!f.gender) return notify("Chọn giới tính.", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_luu_khach_hang_v2", { p: {
      ...f, budget: f.budget || null, birthday: f.birthday || null,
      assigned_name: staff.find((s) => s.id === f.assigned_to)?.name || "",
    } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(f.id ? "Đã cập nhật khách hàng." : "Đã thêm khách hàng mới.");
    if (!f.id) setF((p) => ({ ...p, id: data }));
    load();
  };

  const checkDup = (phone) => {
    const p = (phone || "").replace(/\s/g, "");
    if (!p || p.length < 8 || f.id) { setDupWarn([]); return; }
    const hits = rows.filter((c) => (c.phone === p || c.phone2 === p) && c.id !== f.id);
    setDupWarn(hits);
  };

  const luuCare = async () => {
    if (!careF.content?.trim()) return notify("Nhập nội dung trao đổi.", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_luu_cham_soc", { p: {
      customer_id: f.id, care_date: careF.care_date, contact_at: careF.contact_at,
      channel: careF.channel, content: careF.content, result: careF.result,
      next_care_date: careF.next_care_date || null, next_contact_at: careF.next_care_date || null,
    } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã ghi nhận chăm sóc.");
    setCareF(null);
    const { data } = await supabase.from("customer_care_logs").select("*").eq("customer_id", f.id).order("care_date", { ascending: false }).limit(100);
    setCareLogs(data || []); load();
  };

  const kw = q.trim().toLowerCase();
  const filtered = rows.filter((c) => {
    if (fType && c.customer_type !== fType) return false;
    if (fStatus && c.status !== fStatus) return false;
    if (fStage && c.pipeline_stage !== fStage) return false;
    if (fPotential && c.potential !== fPotential) return false;
    if (!kw) return true;
    return `${c.code} ${c.name} ${c.phone} ${c.phone2} ${c.email} ${c.address}`.toLowerCase().includes(kw);
  });
  const sorted = sort.sortFn(filtered, {
    ten: (c) => c.name, sdt: (c) => c.phone, loai: (c) => c.customer_type,
    tt: (c) => c.status, mua: (c) => tq[c.id]?.tong_mua || 0, no: (c) => tq[c.id]?.con_no || 0,
    cs: (c) => tq[c.id]?.cham_soc_gan_nhat || "",
  });

  const canHomNay = rows.filter((c) => {
    const h = tq[c.id]?.hen_ke_tiep;
    return h && new Date(h) <= new Date();
  });
  const tongNo = Object.values(tq).reduce((a, b) => a + Number(b.con_no || 0), 0);

  const exportCSV = () => {
    downloadCSV(`khach_hang_${iso(new Date())}.csv`,
      [["Mã", "Họ tên", "SĐT", "SĐT phụ", "Email", "CCCD", "Ngày sinh", "Giới tính", "Địa chỉ", "Loại khách",
        "Nguồn", "NV phụ trách", "Cửa hàng", "Quan tâm", "Ngân sách", "Dự kiến mua", "Tiềm năng", "Trạng thái",
        "Số đơn", "Tổng mua", "Còn nợ", "Lần CS gần nhất"],
       ...sorted.map((c) => [c.code, c.name, c.phone, c.phone2 || "", c.email || "", c.cccd || "",
         c.birthday || "", c.gender || "", c.address || "", c.customer_type, c.source || "",
         c.assigned_name || "", locName(c.location_code) || "", c.interested_products || "",
         c.budget || "", c.buy_timeline || "", c.potential || "", c.status,
         tq[c.id]?.so_don || 0, tq[c.id]?.tong_mua || 0, tq[c.id]?.con_no || 0,
         tq[c.id]?.cham_soc_gan_nhat ? fmtDate(tq[c.id].cham_soc_gan_nhat) : ""])]);
    notify(`Đã xuất ${sorted.length} khách hàng.`);
  };

  // ===== FORM / CHI TIẾT =====
  if (show) {
    const t = tq[f.id] || {};
    const DTABS = [
      ["muahang", `Lịch sử mua hàng${t.so_don ? ` (${t.so_don})` : ""}`],
      ["cong_no", "Công nợ"],
      ["chamsoc", `Lịch sử chăm sóc${careLogs.length ? ` (${careLogs.length})` : ""}`],
    ];
    return (
      <div className="flex flex-col gap-4 pb-8">
        <Toast toast={toast} />
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-ghost !text-xs" onClick={() => { setShow(false); load(); }}>← Quay lại danh sách khách hàng</button>
          <div className="ml-auto flex gap-2">
            <button className="btn-primary !text-xs" disabled={busy} onClick={luu}>{busy ? "Đang lưu…" : f.id ? "Cập nhật" : "Thêm khách hàng"}</button>
          </div>
        </div>
        <div className="font-extrabold text-xl">{f.name || "Khách hàng mới"}</div>

        {f.id && (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card lg:col-span-2">
              <div className="flex items-center gap-2 mb-3">
                <div className="font-extrabold mr-auto">Thông tin cá nhân</div>
                <Badge tone={f.status === "Đã mua" ? "green" : f.status === "Không mua" ? "red" : "amber"}>{f.status}</Badge>
                <button className="btn-ghost !text-xs" onClick={() => setTab("chung")}>Cập nhật</button>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px]">
                {[["Ngày sinh", f.birthday ? fmtDate(f.birthday) : "—"], ["Nhóm khách hàng", f.customer_type || "—"],
                  ["Giới tính", f.gender || "—"], ["Mã khách hàng", f.code || "—"],
                  ["Số điện thoại", f.phone], ["Email", f.email || "—"],
                  ["Nhân viên phụ trách", f.assigned_name || "—"], ["Mô tả", f.note || "—"],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <span className="text-[#8A93A0] w-36 shrink-0">{k}</span>
                    <span className={v === "—" ? "text-[#8A93A0]" : "font-medium"}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <div className="font-extrabold mr-auto">Thông tin mua hàng</div>
                <button className="btn-ghost !text-xs" onClick={() => setTab("muahang")}>Chi tiết</button>
              </div>
              <div className="flex flex-col gap-1.5 text-[13px]">
                {[["Tổng chi tiêu", fmtVND(t.tong_mua || 0)],
                  ["Tổng SL đơn hàng", `${t.so_don || 0}`],
                  ["Ngày cuối cùng mua hàng", t.ngay_mua_cuoi ? fmtDate(t.ngay_mua_cuoi) : "—"],
                  ["Tổng SL sản phẩm đã mua", `${t.so_xe || 0}`],
                  ["Tổng SL sản phẩm hoàn trả", "0"],
                  ["Công nợ hiện tại", fmtVND(t.con_no || 0)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <span className="text-[#8A93A0] shrink-0">{k}</span>
                    <span className={k === "Công nợ hiện tại" && Number(t.con_no) > 0 ? "font-bold text-danger" : "font-medium text-right"}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="card">
          <div className="flex gap-1.5 mb-3">
            {[["chung", "Thông tin chung"], ["phanloai", "Phân loại & nhu cầu"]].map(([k, v]) => (
              <button key={k} className={`btn !px-3 !py-2 !text-xs ${tab === k ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => setTab(k)}>{v}</button>
            ))}
          </div>
          {tab === "chung" && (
            <>
            {dupWarn.length > 0 && (
              <div className="mb-3 p-3 rounded-xl bg-[#FDEDED] border border-danger">
                <div className="font-bold text-danger text-[13px] mb-1.5">⚠ Điện thoại đã tồn tại — vui lòng kiểm tra lại</div>
                <div className="text-[12px] text-[#5A6572] mb-2">Trùng thông tin với {dupWarn.length} khách hàng sau:</div>
                <div className="flex flex-col gap-1">
                  {dupWarn.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 p-1.5 rounded-lg bg-white text-[12px]">
                      <div className="flex-1"><b className="text-brand">{c.code}</b> · {c.name} · {c.phone}</div>
                      <span className="text-[#8A93A0]">{c.assigned_name || "—"}</span>
                      <button className="btn-ghost !px-2 !py-0.5 !text-xs" onClick={() => { setDupWarn([]); openEdit(c); }}>Mở KH này</button>
                    </div>
                  ))}
                </div>
                <button className="text-[11px] text-[#8A93A0] hover:underline mt-2" onClick={() => setDupWarn([])}>Bỏ qua, vẫn tạo mới</button>
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Họ tên" required><input className="inp" value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} /></Field>
              <Field label="Số điện thoại" required><input className="inp" value={f.phone} onChange={(e) => setF((p) => ({ ...p, phone: e.target.value }))} onBlur={(e) => checkDup(e.target.value)} /></Field>
              <Field label="Số điện thoại phụ"><input className="inp" value={f.phone2} onChange={(e) => setF((p) => ({ ...p, phone2: e.target.value }))} /></Field>
              <Field label="Email" required><input className="inp" value={f.email} onChange={(e) => setF((p) => ({ ...p, email: e.target.value }))} placeholder="ten@email.com" /></Field>
              <Field label="Số CCCD"><input className="inp" value={f.cccd} onChange={(e) => setF((p) => ({ ...p, cccd: e.target.value }))} /></Field>
              <Field label="Ngày sinh"><input type="date" className="inp" value={f.birthday} onChange={(e) => setF((p) => ({ ...p, birthday: e.target.value }))} /></Field>
              <Field label="Giới tính" required>
                <div className="flex gap-1.5">{["Nam", "Nữ", "Khác"].map((g) => (
                  <button key={g} className={`btn !px-4 !py-2 !text-xs ${f.gender === g ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => setF((p) => ({ ...p, gender: g }))}>{g}</button>
                ))}</div>
              </Field>
              <Field label="Loại khách" required>
                <select className="inp" value={f.customer_type} onChange={(e) => setF((p) => ({ ...p, customer_type: e.target.value }))}>
                  {[...CUSTOMER_TYPES, "Khách lẻ của Đại lý"].map((x) => <option key={x}>{x}</option>)}
                </select>
              </Field>
              <div className="md:col-span-2"><Field label="Địa chỉ VNeID"><input className="inp" value={f.address} onChange={(e) => setF((p) => ({ ...p, address: e.target.value }))} /></Field></div>
              <div className="md:col-span-2"><Field label="Ghi chú"><textarea className="inp !h-16" value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} /></Field></div>
            </div>
            </>
          )}
          {tab === "phanloai" && (
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Nguồn khách">
                <select className="inp" value={f.source} onChange={(e) => setF((p) => ({ ...p, source: e.target.value }))}>
                  <option value="">— Chọn —</option>
                  {CUSTOMER_SOURCES.map((x) => <option key={x}>{x}</option>)}
                </select>
              </Field>
              <Field label="Nhân viên phụ trách">
                {profile.role === "CEO" ? (
                  <select className="inp" value={f.assigned_to} onChange={(e) => setF((p) => ({ ...p, assigned_to: e.target.value }))}>
                    <option value="">— Chưa giao —</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
                  </select>
                ) : (
                  <input className="inp bg-[#F8FAFC]" value={f.assigned_name || "— Chưa giao —"} disabled />
                )}
              </Field>
              <Field label="Tiềm năng">
                <div className="flex gap-1.5">{["Cao", "Trung bình", "Thấp"].map((g) => (
                  <button key={g} className={`btn !px-3 !py-2 !text-xs ${f.potential === g ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => setF((p) => ({ ...p, potential: g }))}>{g}</button>
                ))}</div>
              </Field>
              <Field label="Trạng thái">
                <select className="inp" value={f.status} onChange={(e) => setF((p) => ({ ...p, status: e.target.value }))}>
                  {STATUSES.map((x) => <option key={x}>{x}</option>)}
                </select>
              </Field>
              <Field label="Xe quan tâm">
                <select className="inp" value={f.interested_vehicle_id || ""} onChange={(e) => setF((p) => ({ ...p, interested_vehicle_id: e.target.value }))}>
                  <option value="">— Chưa xác định —</option>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.brand} {v.name} {v.color}</option>)}
                </select>
              </Field>
              <Field label="Sản phẩm quan tâm">
                <input className="inp" value={f.interested_products} onChange={(e) => setF((p) => ({ ...p, interested_products: e.target.value }))} />
              </Field>
              <Field label="Ngân sách"><input type="number" className="inp" value={f.budget} onChange={(e) => setF((p) => ({ ...p, budget: e.target.value }))} /></Field>
              <Field label="Dự kiến mua"><input className="inp" value={f.buy_timeline} onChange={(e) => setF((p) => ({ ...p, buy_timeline: e.target.value }))} /></Field>
              <Field label="Cửa hàng phụ trách">
                <LocSearch locations={locations} value={f.location_code} onChange={(v) => setF((p) => ({ ...p, location_code: v }))} placeholder="Chọn cửa hàng" />
              </Field>
            </div>
          )}
        </div>

        {f.id && (
          <>
            <div className="flex gap-1.5 flex-wrap">
              {DTABS.map(([k, v]) => (
                <button key={k} className={`btn !px-3 !py-2 !text-xs ${tab === k ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => setTab(k)}>{v}</button>
              ))}
            </div>

            {tab === "muahang" && (
              <div className="flex flex-col gap-4">
                <div className="card">
                  <div className="font-extrabold mb-2">Xe đã mua ({donHang.length})</div>
                  {donHang.length === 0 ? <div className="text-sm text-[#8A93A0]">Khách chưa mua xe nào.</div> : (
                    <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
                      <thead><tr>
                        <th className="th">Mã đơn hàng</th><th className="th">Trạng thái</th>
                        <th className="th">Vai trò</th>
                        <th className="th">Xe</th><th className="th">Số khung</th>
                        <th className="th text-right">Giá trị</th><th className="th">Chi nhánh</th>
                        <th className="th">Nhân viên xử lý</th><th className="th">Ngày ghi nhận</th>
                      </tr></thead>
                      <tbody>{donHang.map((o) => {
                        const conNo = Math.max(0, o.sale_price * o.quantity - (o.paid_amount || 0));
                        return (
                          <tr key={o.id} className={conNo > 0 ? "bg-[#FFF6F6] hover:bg-[#FDEDED]" : "hover:bg-[#F8FAFC]"}>
                            <td className="td font-bold"><Link href={`/don-ban/${o.id}`} className="text-brand hover:underline">{o.code}</Link></td>
                            <td className="td"><Badge tone={o.invoice_status === "Đã xuất HĐ" ? "green" : "amber"}>{o.invoice_status === "Đã xuất HĐ" ? "Hoàn thành" : "Chờ xuất HĐ"}</Badge></td>
                            <td className="td"><Badge tone={o._vai_tro === "Người mua" ? "blue" : "purple"}>{o._vai_tro}</Badge></td>
                            <td className="td text-[13px]">{vName(o.vehicle_id)}</td>
                            <td className="td font-mono text-xs">{o.frame_number}</td>
                            <td className="td text-right font-bold">{fmtVND(o.sale_price * o.quantity)}</td>
                            <td className="td text-xs">{locName(o.location_code)}</td>
                            <td className="td text-xs">{o.seller_name || "—"}</td>
                            <td className="td text-xs whitespace-nowrap">{fmtDate(o.sale_date)}</td>
                          </tr>
                        );
                      })}</tbody>
                    </table></div>
                  )}
                </div>
                <div className="card">
                  <div className="font-extrabold mb-2">Phiếu dịch vụ ({phieuDV.length})</div>
                  {phieuDV.length === 0 ? <div className="text-sm text-[#8A93A0]">Chưa có phiếu dịch vụ nào.</div> : (
                    <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
                      <thead><tr>
                        <th className="th">Mã phiếu</th><th className="th">Ngày tạo</th>
                        <th className="th">Xe / SK</th><th className="th">Trạng thái</th>
                        <th className="th text-right">Tổng tiền</th>
                      </tr></thead>
                      <tbody>{phieuDV.map((d) => (
                        <tr key={d.id} className="hover:bg-[#F8FAFC]">
                          <td className="td font-bold text-brand">{d.code}</td>
                          <td className="td text-xs whitespace-nowrap">{fmtDate(d.created_at)}</td>
                          <td className="td text-xs">{d.vehicle_desc || d.frame_number || "—"}</td>
                          <td className="td"><Badge tone={d.status === "DA_GIAO" ? "green" : "amber"}>{d.status === "DA_GIAO" ? "Đã giao" : "Đang xử lý"}</Badge></td>
                          <td className="td text-right font-bold">{d.total_amount ? fmtVND(d.total_amount) : "—"}</td>
                        </tr>
                      ))}</tbody>
                    </table></div>
                  )}
                </div>
              </div>
            )}

            {tab === "cong_no" && (
              <div className="card">
                <div className="font-extrabold mb-2">Công nợ</div>
                {donHang.filter((o) => Math.max(0, o.sale_price * o.quantity - (o.paid_amount || 0)) > 0).length === 0
                  ? <div className="text-sm text-[#0E7A4A]">✓ Khách không có công nợ.</div>
                  : (
                    <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
                      <thead><tr>
                        <th className="th">Mã đơn</th><th className="th">Ngày bán</th><th className="th">Xe</th>
                        <th className="th text-right">Tổng đơn</th><th className="th text-right">Đã trả</th><th className="th text-right">Còn nợ</th>
                      </tr></thead>
                      <tbody>{donHang.filter((o) => Math.max(0, o.sale_price * o.quantity - (o.paid_amount || 0)) > 0).map((o) => (
                        <tr key={o.id} className="bg-[#FFF6F6]">
                          <td className="td font-bold"><Link href={`/don-ban/${o.id}`} className="text-brand hover:underline">{o.code}</Link></td>
                          <td className="td text-xs">{fmtDate(o.sale_date)}</td>
                          <td className="td text-[13px]">{vName(o.vehicle_id)}</td>
                          <td className="td text-right">{fmtVND(o.sale_price * o.quantity)}</td>
                          <td className="td text-right text-[#0E7A4A]">{fmtVND(o.paid_amount || 0)}</td>
                          <td className="td text-right font-bold text-danger">{fmtVND(Math.max(0, o.sale_price * o.quantity - (o.paid_amount || 0)))}</td>
                        </tr>
                      ))}</tbody>
                    </table></div>
                  )
                }
              </div>
            )}

            {tab === "chamsoc" && (
              <div className="card">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="font-extrabold mr-auto">Lịch sử chăm sóc ({careLogs.length})</div>
                  <button className="btn-primary !text-xs" onClick={() => setCareF({
                    care_date: iso(new Date()),
                    contact_at: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
                    channel: "Gọi điện", content: "", result: "", next_care_date: "",
                  })}>+ Ghi nhận chăm sóc</button>
                </div>
                {careF && (
                  <div className="p-3 rounded-xl border-2 border-brand mb-3 flex flex-col gap-2.5">
                    <div className="grid gap-2.5 md:grid-cols-2">
                      <Field label="Thời gian liên hệ">
                        <input type="datetime-local" className="inp" value={careF.contact_at}
                          onChange={(e) => setCareF((p) => ({ ...p, contact_at: e.target.value, care_date: e.target.value.slice(0, 10) }))} />
                      </Field>
                      <Field label="Hình thức liên hệ">
                        <select className="inp" value={careF.channel} onChange={(e) => setCareF((p) => ({ ...p, channel: e.target.value }))}>
                          {CHANNELS.map((x) => <option key={x}>{x}</option>)}
                        </select>
                      </Field>
                      <div className="md:col-span-2">
                        <Field label="Nội dung trao đổi" required>
                          <textarea className="inp !h-20" value={careF.content} onChange={(e) => setCareF((p) => ({ ...p, content: e.target.value }))} placeholder="VD: tư vấn Amio S, khách hỏi trả góp" />
                        </Field>
                      </div>
                      <div className="md:col-span-2">
                        <Field label="Kết quả"><input className="inp" value={careF.result} onChange={(e) => setCareF((p) => ({ ...p, result: e.target.value }))} /></Field>
                      </div>
                      <Field label="Ngày hẹn liên hệ tiếp">
                        <input type="date" className="inp" value={careF.next_care_date} onChange={(e) => setCareF((p) => ({ ...p, next_care_date: e.target.value }))} />
                      </Field>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn-ok !text-xs" disabled={busy} onClick={luuCare}>{busy ? "Đang lưu…" : "Lưu"}</button>
                      <button className="btn-ghost !text-xs" onClick={() => setCareF(null)}>Hủy</button>
                    </div>
                  </div>
                )}
                {careLogs.length === 0 ? <div className="text-sm text-[#8A93A0]">Chưa có lần chăm sóc nào.</div> : (
                  <div className="flex flex-col">
                    {careLogs.map((k, idx) => {
                      const quaHan = k.next_care_date && new Date(k.next_care_date) <= new Date();
                      const nguoi = k.created_by_name || k.by_name || "—";
                      const chuCai = nguoi.charAt(0).toUpperCase();
                      const isPipeline = k.channel === "Cập nhật pipeline";
                      return (
                        <div key={k.id} className="flex gap-3 relative">
                          {/* Đường timeline dọc */}
                          <div className="flex flex-col items-center">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[13px] font-bold shrink-0 ${isPipeline ? "bg-purple-500" : "bg-brand"}`}>{chuCai}</div>
                            {idx < careLogs.length - 1 && <div className="w-0.5 flex-1 bg-[#E3E8EF] my-1" />}
                          </div>
                          {/* Nội dung */}
                          <div className="flex-1 pb-4">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="font-bold text-[13px] text-[#1E2B3C]">{nguoi}</span>
                              <span className="text-[11px] text-[#8A93A0]">{k.contact_at ? fmtTime(k.contact_at) : fmtDate(k.care_date)}</span>
                              <Badge tone={isPipeline ? "dark" : "blue"}>{k.channel || "Liên hệ"}</Badge>
                              {k.next_care_date && (
                                <Badge tone={quaHan ? "red" : "amber"}>📅 Hẹn {fmtDate(k.next_care_date)}{quaHan ? " · quá hạn" : ""}</Badge>
                              )}
                            </div>
                            <div className={`p-2.5 rounded-xl text-[13px] whitespace-pre-wrap ${isPipeline ? "bg-[#F5F0FF]" : "bg-[#F8FAFC]"}`}>
                              {k.content}
                              {k.result && <div className="text-[12px] text-[#0E7A4A] mt-1.5 pt-1.5 border-t border-[#E3E8EF]">→ {k.result}</div>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ===== DANH SÁCH =====
  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Khách hàng ({sorted.length})</div>
        <button className="btn-ghost !text-xs" onClick={exportCSV}>⬇ CSV</button>
        <button className="btn-primary !text-sm" onClick={openNew}>+ Thêm khách hàng</button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <KPI label="Tổng khách" value={rows.length} tone="dark" />
        <KPI label="Đã mua xe" value={rows.filter((c) => c.status === "Đã mua").length} tone="green" />
        <KPI label="Tiềm năng cao" value={rows.filter((c) => c.potential === "Cao").length} tone="red" />
        <KPI label="Cần chăm sóc hôm nay" value={canHomNay.length} tone={canHomNay.length ? "amber" : "green"} />
        <KPI label="Tổng công nợ" value={fmtVND(tongNo)} tone={tongNo > 0 ? "red" : "green"} />
      </div>

      {canHomNay.length > 0 && (
        <div className="card !py-2.5 bg-[#FFF6E5] border border-[#F0C000]">
          <div className="text-[13px] mb-1.5"><b>⏰ {canHomNay.length} khách đến hẹn chăm sóc</b></div>
          <div className="flex gap-1.5 flex-wrap">
            {canHomNay.slice(0, 10).map((c) => (
              <button key={c.id} className="btn-ghost !px-2.5 !py-1 !text-xs bg-white" onClick={() => openEdit(c)}>
                {c.name} · {c.phone}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        {/* PIPELINE FILTER TABS như Getfly */}
        <div className="flex gap-1.5 flex-wrap mb-3 pb-3 border-b border-[#EEF1F4]">
          <button onClick={() => { setFStage(""); setPage(1); }}
            className={`btn !px-3 !py-1.5 !text-xs ${fStage === "" ? "bg-brand text-white" : "bg-[#EEF1F4]"}`}>
            Tất cả <span className="font-bold ml-1">{rows.length}</span>
          </button>
          {PIPELINE_STAGES.map((s) => {
            const cnt = rows.filter((c) => c.pipeline_stage === s).length;
            if (cnt === 0 && fStage !== s) return null;
            return (
              <button key={s} onClick={() => { setFStage(s); setPage(1); }}
                className={`btn !px-3 !py-1.5 !text-xs ${fStage === s ? "bg-brand text-white" : "bg-[#EEF1F4]"}`}>
                {s} <span className="font-bold ml-1">{cnt}</span>
              </button>
            );
          })}
        </div>

        <div className="flex gap-2 flex-wrap items-center mb-3">
          <input className="inp !w-64" placeholder="Tìm tên, SĐT, email, mã KH…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <select className="inp !w-auto" value={fType} onChange={(e) => { setFType(e.target.value); setPage(1); }}>
            <option value="">Loại: tất cả</option>
            {[...CUSTOMER_TYPES, "Khách lẻ của Đại lý"].map((x) => <option key={x}>{x}</option>)}
          </select>
          <select className="inp !w-auto" value={fStatus} onChange={(e) => { setFStatus(e.target.value); setPage(1); }}>
            <option value="">Trạng thái: tất cả</option>
            {STATUSES.map((x) => <option key={x}>{x}</option>)}
          </select>
          <select className="inp !w-auto" value={fPotential} onChange={(e) => { setFPotential(e.target.value); setPage(1); }}>
            <option value="">Tiềm năng: tất cả</option>
            {POTENTIALS.map((x) => <option key={x}>{x}</option>)}
          </select>
        </div>

        <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
          <thead><tr>
            <th className="th w-8">#</th>
            <Th label="Khách hàng" k="ten" sort={sort} /><Th label="Liên hệ" k="sdt" sort={sort} />
            <Th label="Loại" k="loai" sort={sort} /><Th label="Trạng thái" k="tt" sort={sort} />
            <Th label="Giai đoạn" k="stage" sort={sort} />
            <Th label="Đã mua" k="mua" sort={sort} /><Th label="Còn nợ" k="no" sort={sort} />
            <Th label="Chăm sóc" k="cs" sort={sort} /><th className="th"></th>
          </tr></thead>
          <tbody>{pageSlice(sorted, page, 20).map((c, i) => {
            const t = tq[c.id] || {};
            const quaHan = t.hen_ke_tiep && new Date(t.hen_ke_tiep) <= new Date();
            return (
              <tr key={c.id} className={quaHan ? "bg-[#FFFCF0]" : "hover:bg-[#F8FAFC]"}>
                <td data-label="#" className="td text-center text-xs text-[#8A93A0]">{i + 1}</td>
                <td data-label="Khách hàng" className="td">
                  <div className="font-semibold text-[13px]">{c.name}</div>
                  <div className="text-[10.5px] text-[#8A93A0]">{c.code}{c.assigned_name ? ` · ${c.assigned_name}` : ""}</div>
                </td>
                <td data-label="Liên hệ" className="td text-[12.5px]">
                  {c.phone}
                  {c.email && <div className="text-[10.5px] text-[#8A93A0]">{c.email}</div>}
                </td>
                <td data-label="Loại" className="td text-xs">{c.customer_type}
                  {c.potential && <div><Badge tone={c.potential === "Cao" ? "red" : c.potential === "Trung bình" ? "amber" : "dark"}>{c.potential}</Badge></div>}
                </td>
                <td data-label="Trạng thái" className="td"><Badge tone={c.status === "Đã mua" ? "green" : c.status === "Không mua" ? "red" : "amber"}>{c.status}</Badge></td>
                <td data-label="Giai đoạn" className="td">
                  {c.pipeline_stage ? (
                    <div className="flex flex-col gap-0.5 items-start">
                      <Badge tone={STAGE_TONE[c.pipeline_stage] || "dark"}>{c.pipeline_stage}</Badge>
                      {c.heat && <span className="text-[9.5px]">{c.heat === "Nóng" ? "🔥 Nóng" : c.heat === "Lạnh" ? "❄ Lạnh" : "~ TB"}</span>}
                    </div>
                  ) : <span className="text-[#C6CDD6] text-xs">—</span>}
                  <button className="text-brand text-[10px] hover:underline mt-0.5" onClick={() => setStageEdit({ id: c.id, pipeline_stage: c.pipeline_stage || "Mới tiếp nhận", heat: c.heat || "Trung bình", next_call_date: c.next_call_date || "", lost_reason: "", note: "" })}>→ đổi</button>
                </td>
                <td data-label="Đã mua" className="td">{t.so_don ? <><b>{fmtVND(t.tong_mua)}</b><div className="text-[10.5px] text-[#8A93A0]">{t.so_don} đơn</div></> : <span className="text-[#C6CDD6]">—</span>}</td>
                <td data-label="Còn nợ" className="td">{Number(t.con_no) > 0 ? <b className="text-danger">{fmtVND(t.con_no)}</b> : <span className="text-[#C6CDD6]">—</span>}</td>
                <td data-label="Chăm sóc" className="td text-[11px]">
                  {t.cham_soc_gan_nhat ? fmtDate(t.cham_soc_gan_nhat) : <span className="text-[#C6CDD6]">chưa</span>}
                  {t.hen_ke_tiep && <div className={quaHan ? "text-danger font-bold" : "text-[#A25F00]"}>Hẹn {fmtDate(t.hen_ke_tiep)}</div>}
                </td>
                <td className="td"><button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => openEdit(c)}>Mở</button></td>
              </tr>
            );
          })}
          {sorted.length === 0 && <tr><td className="td" colSpan={9}>Không có khách hàng nào khớp bộ lọc.</td></tr>}
          </tbody>
        </table></div>
        <Pager total={sorted.length} page={page} setPage={setPage} pageSize={20} setPageSize={() => {}} />
      </div>

      {/* MODAL ĐỔI PIPELINE STAGE */}
      {stageEdit && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3" onClick={() => setStageEdit(null)}>
          <div className="bg-white rounded-2xl w-[460px] max-w-full p-4" onClick={(e) => e.stopPropagation()}>
            <div className="font-extrabold text-base mb-3">Chuyển giai đoạn khách hàng</div>
            <div className="flex flex-col gap-3">
              <Field label="Giai đoạn *">
                <select className="inp" value={stageEdit.pipeline_stage} onChange={(e) => setStageEdit((p) => ({ ...p, pipeline_stage: e.target.value }))}>
                  {PIPELINE_STAGES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Mức độ quan tâm">
                <div className="flex gap-1.5">{["Nóng", "Trung bình", "Lạnh"].map((h) => (
                  <button key={h} className={`btn !px-3 !py-2 !text-xs ${stageEdit.heat === h ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => setStageEdit((p) => ({ ...p, heat: h }))}>{h}</button>
                ))}</div>
              </Field>
              <Field label="Ngày gọi lại"><input type="date" className="inp" value={stageEdit.next_call_date} onChange={(e) => setStageEdit((p) => ({ ...p, next_call_date: e.target.value }))} /></Field>
              {stageEdit.pipeline_stage === "Mất khách" && (
                <Field label="Lý do mất khách *">
                  <select className="inp" value={stageEdit.lost_reason} onChange={(e) => setStageEdit((p) => ({ ...p, lost_reason: e.target.value }))}>
                    <option value="">— Bắt buộc chọn —</option>
                    {LOST_REASONS.map((l) => <option key={l}>{l}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Ghi chú"><input className="inp" value={stageEdit.note} onChange={(e) => setStageEdit((p) => ({ ...p, note: e.target.value }))} /></Field>
            </div>
            <div className="flex gap-2 mt-4">
              <button className="btn-ok flex-1" disabled={busy} onClick={luuStage}>{busy ? "Đang lưu…" : "Cập nhật"}</button>
              <button className="btn-ghost" onClick={() => setStageEdit(null)}>Hủy</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function KhachHang() {
  return <Suspense fallback={<div className="card">Đang tải…</div>}><KhachHangInner /></Suspense>;
}