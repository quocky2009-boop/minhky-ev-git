"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
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

  const openNew = () => { setF(emptyForm); setTab("chung"); setDonHang([]); setPhieuDV([]); setCareLogs([]); setShow(true); };

  const openEdit = async (c) => {
    setF({
      id: c.id, name: c.name || "", phone: c.phone || "", phone2: c.phone2 || "", email: c.email || "",
      cccd: c.cccd || "", birthday: c.birthday || "", gender: c.gender || "", address: c.address || "",
      customer_type: c.customer_type || "Khách lẻ", note: c.note || "", source: c.source || "",
      assigned_to: c.assigned_to || "", assigned_name: c.assigned_name || "", location_code: c.location_code || "",
      interested_products: c.interested_products || "", budget: c.budget || "",
      buy_timeline: c.buy_timeline || "", potential: c.potential || "", status: c.status || "Lead mới",
    });
    setTab("chung"); setShow(true); setCareF(null);
    const [{ data: o }, { data: dv }, { data: care }] = await Promise.all([
      supabase.from("sales_orders").select("*").eq("customer_id", c.id).order("sale_date", { ascending: false }),
      supabase.from("dv_tickets").select("*").eq("customer_id", c.id).order("created_at", { ascending: false }).limit(50),
      supabase.from("customer_care_logs").select("*").eq("customer_id", c.id).order("care_date", { ascending: false }).limit(100),
    ]);
    setDonHang(o || []); setPhieuDV(dv || []); setCareLogs(care || []);
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
    const TABS = [
      ["chung", "Thông tin chung"],
      ["phanloai", "Phân loại & nhu cầu"],
      ["muahang", `Lịch sử mua hàng${t.so_don ? ` (${t.so_don})` : ""}`],
      ["chamsoc", `Lịch sử chăm sóc${careLogs.length ? ` (${careLogs.length})` : ""}`],
    ];
    return (
      <div className="flex flex-col gap-4 pb-24">
        <Toast toast={toast} />
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-ghost !text-xs" onClick={() => { setShow(false); load(); }}>← Danh sách</button>
          <div className="font-extrabold text-lg mr-auto">{f.id ? f.name : "Khách hàng mới"}</div>
          {f.id && <Badge tone={f.status === "Đã mua" ? "green" : f.status === "Không mua" ? "red" : "amber"}>{f.status}</Badge>}
          {f.potential && <Badge tone={f.potential === "Cao" ? "red" : f.potential === "Trung bình" ? "amber" : "dark"}>Tiềm năng {f.potential}</Badge>}
        </div>

        {f.id && (
          <div className="flex gap-3 flex-wrap">
            <KPI label="Số đơn đã mua" value={t.so_don || 0} tone="dark" />
            <KPI label="Tổng giá trị" value={fmtVND(t.tong_mua || 0)} tone="blue" />
            <KPI label="Còn nợ" value={fmtVND(t.con_no || 0)} tone={Number(t.con_no) > 0 ? "red" : "green"} />
            <KPI label="Lần chăm sóc" value={t.so_lan_cham_soc || 0} tone="purple" />
            {t.hen_ke_tiep && <KPI label="Hẹn kế tiếp" value={fmtDate(t.hen_ke_tiep)} tone="amber" />}
          </div>
        )}

        <div className="flex gap-1.5 flex-wrap">
          {TABS.map(([k, v]) => (
            <button key={k} disabled={!f.id && (k === "muahang" || k === "chamsoc")}
              className={`btn !px-3 !py-2 !text-xs ${tab === k ? "bg-brand text-white" : "bg-[#EEF1F4]"} ${!f.id && (k === "muahang" || k === "chamsoc") ? "opacity-40" : ""}`}
              onClick={() => setTab(k)}>{v}</button>
          ))}
        </div>

        {/* TAB 1: THÔNG TIN CHUNG */}
        {tab === "chung" && (
          <div className="card">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Họ tên" required><input className="inp" value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} /></Field>
              <Field label="Số điện thoại" required><input className="inp" value={f.phone} onChange={(e) => setF((p) => ({ ...p, phone: e.target.value }))} /></Field>
              <Field label="Số điện thoại phụ"><input className="inp" value={f.phone2} onChange={(e) => setF((p) => ({ ...p, phone2: e.target.value }))} /></Field>
              <Field label="Email" required><input className="inp" value={f.email} onChange={(e) => setF((p) => ({ ...p, email: e.target.value }))} placeholder="ten@email.com" /></Field>
              <Field label="Số CCCD"><input className="inp" value={f.cccd} onChange={(e) => setF((p) => ({ ...p, cccd: e.target.value }))} /></Field>
              <Field label="Ngày sinh"><input type="date" className="inp" value={f.birthday} onChange={(e) => setF((p) => ({ ...p, birthday: e.target.value }))} /></Field>
              <Field label="Giới tính" required>
                <div className="flex gap-1.5">
                  {["Nam", "Nữ", "Khác"].map((g) => (
                    <button key={g} className={`btn !px-4 !py-2 !text-xs ${f.gender === g ? "bg-brand text-white" : "bg-[#EEF1F4]"}`}
                      onClick={() => setF((p) => ({ ...p, gender: g }))}>{g}</button>
                  ))}
                </div>
              </Field>
              <Field label="Loại khách" required>
                <select className="inp" value={f.customer_type} onChange={(e) => setF((p) => ({ ...p, customer_type: e.target.value }))}>
                  {[...CUSTOMER_TYPES, "Khách lẻ của Đại lý"].map((x) => <option key={x}>{x}</option>)}
                </select>
              </Field>
              <div className="md:col-span-2"><Field label="Địa chỉ VNeID"><input className="inp" value={f.address} onChange={(e) => setF((p) => ({ ...p, address: e.target.value }))} /></Field></div>
              <div className="md:col-span-2"><Field label="Ghi chú"><textarea className="inp !h-16" value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} /></Field></div>
            </div>
          </div>
        )}

        {/* TAB 2: PHÂN LOẠI & NHU CẦU */}
        {tab === "phanloai" && (
          <div className="card">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Nguồn khách">
                <select className="inp" value={f.source} onChange={(e) => setF((p) => ({ ...p, source: e.target.value }))}>
                  <option value="">— Chọn —</option>
                  {CUSTOMER_SOURCES.map((x) => <option key={x}>{x}</option>)}
                </select>
              </Field>
              <Field label="Nhân viên phụ trách">
                <select className="inp" value={f.assigned_to} onChange={(e) => setF((p) => ({ ...p, assigned_to: e.target.value }))}>
                  <option value="">— Chưa giao —</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
                </select>
              </Field>
              <Field label="Cửa hàng phụ trách">
                <LocSearch locations={locations.filter((l) => l.type === "Cửa hàng")} value={f.location_code}
                  onChange={(v) => setF((p) => ({ ...p, location_code: v }))} placeholder="Chọn cửa hàng" />
              </Field>
              <Field label="Trạng thái">
                <select className="inp" value={f.status} onChange={(e) => setF((p) => ({ ...p, status: e.target.value }))}>
                  {STATUSES.map((x) => <option key={x}>{x}</option>)}
                </select>
              </Field>
              <div className="md:col-span-2">
                <Field label="Sản phẩm quan tâm">
                  <input className="inp" list="dm-xe" value={f.interested_products}
                    onChange={(e) => setF((p) => ({ ...p, interested_products: e.target.value }))}
                    placeholder="Gõ tên xe hoặc mô tả nhu cầu" />
                  <datalist id="dm-xe">{vehicles.map((v) => <option key={v.id} value={`${v.brand} ${v.name} ${v.color}`} />)}</datalist>
                </Field>
              </div>
              <Field label="Ngân sách dự kiến"><MoneyInput value={f.budget} onChange={(v) => setF((p) => ({ ...p, budget: v }))} placeholder="VD: 20.000.000" /></Field>
              <Field label="Thời gian dự kiến mua">
                <select className="inp" value={f.buy_timeline} onChange={(e) => setF((p) => ({ ...p, buy_timeline: e.target.value }))}>
                  <option value="">— Chọn —</option>
                  {TIMELINES.map((x) => <option key={x}>{x}</option>)}
                </select>
              </Field>
              <Field label="Mức độ tiềm năng">
                <div className="flex gap-1.5">
                  {POTENTIALS.map((x) => (
                    <button key={x} className={`btn !px-3 !py-2 !text-xs ${f.potential === x ? (x === "Cao" ? "bg-danger text-white" : x === "Trung bình" ? "bg-[#A25F00] text-white" : "bg-brand text-white") : "bg-[#EEF1F4]"}`}
                      onClick={() => setF((p) => ({ ...p, potential: x }))}>{x}</button>
                  ))}
                </div>
              </Field>
            </div>
          </div>
        )}

        {/* TAB 3: LỊCH SỬ MUA HÀNG */}
        {tab === "muahang" && (
          <div className="flex flex-col gap-4">
            <div className="card">
              <div className="font-extrabold mb-2.5">Xe đã mua ({donHang.length})</div>
              {donHang.length === 0 ? <div className="text-sm text-[#8A93A0]">Khách chưa mua xe nào.</div> : (
                <div className="flex flex-col gap-2">
                  {donHang.map((o) => {
                    const conNo = Math.max(0, o.sale_price * o.quantity - (o.paid_amount || 0));
                    return (
                      <div key={o.id} className={`p-2.5 rounded-xl border ${conNo > 0 ? "border-[#F5B5B5] bg-[#FFF6F6]" : "border-[#E3E8EF]"}`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="mr-auto min-w-0">
                            <div className="font-semibold text-[13.5px]">{vName(o.vehicle_id)}</div>
                            <div className="text-[11px] text-[#8A93A0]">{o.code} · {fmtDate(o.sale_date)} · SK {o.frame_number} · {locName(o.location_code)}</div>
                          </div>
                          <Badge tone={o.invoice_status === "Đã xuất HĐ" ? "green" : "amber"}>
                            {o.invoice_status === "Đã xuất HĐ" ? `HĐ ${o.invoice_no}` : "Chưa xuất HĐ"}
                          </Badge>
                          <b className="whitespace-nowrap">{fmtVND(o.sale_price * o.quantity)}</b>
                        </div>
                        {conNo > 0 && <div className="text-[12px] text-danger font-semibold mt-1">Còn nợ {fmtVND(conNo)}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="card">
              <div className="font-extrabold mb-2.5">Phiếu dịch vụ ({phieuDV.length})</div>
              {phieuDV.length === 0 ? <div className="text-sm text-[#8A93A0]">Chưa có phiếu dịch vụ nào.</div> : (
                <div className="flex flex-col gap-1.5">
                  {phieuDV.map((d) => (
                    <div key={d.id} className="flex items-center gap-2 p-2.5 rounded-xl border border-[#E3E8EF] text-[13px]">
                      <div className="mr-auto min-w-0">
                        <div className="font-semibold">{d.code}</div>
                        <div className="text-[11px] text-[#8A93A0]">{fmtDate(d.created_at)} · {d.vehicle_desc || d.frame_number}</div>
                      </div>
                      <Badge tone={d.status === "DA_GIAO" ? "green" : "amber"}>{d.status === "DA_GIAO" ? "Đã giao" : "Đang xử lý"}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: LỊCH SỬ CHĂM SÓC */}
        {tab === "chamsoc" && (
          <div className="flex flex-col gap-4">
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
                        <textarea className="inp !h-20" value={careF.content} onChange={(e) => setCareF((p) => ({ ...p, content: e.target.value }))}
                          placeholder="VD: tư vấn Amio S, khách hỏi trả góp" />
                      </Field>
                    </div>
                    <div className="md:col-span-2">
                      <Field label="Kết quả">
                        <input className="inp" value={careF.result} onChange={(e) => setCareF((p) => ({ ...p, result: e.target.value }))}
                          placeholder="VD: khách hẹn tuần sau qua xem xe" />
                      </Field>
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
                <div className="flex flex-col gap-2">
                  {careLogs.map((k) => {
                    const quaHan = k.next_care_date && new Date(k.next_care_date) <= new Date();
                    return (
                      <div key={k.id} className="p-2.5 rounded-xl border border-[#E3E8EF]">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <Badge tone="blue">{k.channel || "Liên hệ"}</Badge>
                          <span className="text-[11px] text-[#8A93A0] mr-auto">
                            {k.contact_at ? fmtTime(k.contact_at) : fmtDate(k.care_date)} · {k.created_by_name || k.by_name || "—"}
                          </span>
                          {k.next_care_date && (
                            <Badge tone={quaHan ? "red" : "amber"}>Hẹn {fmtDate(k.next_care_date)}{quaHan ? " · quá hạn" : ""}</Badge>
                          )}
                        </div>
                        <div className="text-[13px] whitespace-pre-wrap">{k.content}</div>
                        {k.result && <div className="text-[12px] text-[#0E7A4A] mt-1">→ {k.result}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* THANH DÍNH ĐÁY */}
        {(tab === "chung" || tab === "phanloai") && (
          <div className="fixed bottom-0 left-0 right-0 lg:left-[248px] bg-white border-t border-[#E6EAEF] px-4 py-3 flex items-center gap-3 z-30">
            <div className="text-[13px] hidden sm:block">
              <span className="text-[#8A93A0]">Khách:</span> <b>{f.name || "—"}</b>
              {f.phone && <span className="text-[#5A6572] ml-2">· {f.phone}</span>}
            </div>
            <div className="ml-auto flex gap-2">
              <button className="btn-ghost" onClick={() => { setShow(false); load(); }}>Thoát</button>
              <button className="btn-ok !px-6" disabled={busy} onClick={luu}>{busy ? "Đang lưu…" : f.id ? "Lưu thay đổi" : "Thêm khách hàng"}</button>
            </div>
          </div>
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
    </div>
  );
}

export default function KhachHang() {
  return <Suspense fallback={<div className="card">Đang tải…</div>}><KhachHangInner /></Suspense>;
}
