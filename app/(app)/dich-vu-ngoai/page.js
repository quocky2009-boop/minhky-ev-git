"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, Field, KPI, LocSearch, MoneyInput } from "@/components/ui";
import { fmtVND, fmtDate, fmtTime, errMsg } from "@/lib/format";

const LOAI = { DANG_KY: "Đăng ký xe", PHU_KIEN: "Phụ kiện / phụ tùng ngoài", KHAC: "Khác" };
const ST = {
  DANG_XU_LY: { label: "Đang xử lý", tone: "amber" },
  HOAN_TAT: { label: "Hoàn tất · chờ nộp", tone: "blue" },
  DA_NOP: { label: "Đã nộp về công ty", tone: "green" },
  HUY: { label: "Đã hủy", tone: "red" },
};
const NOP_ST = { CHO_XAC_NHAN: { label: "Chờ kế toán xác nhận", tone: "amber" }, DA_NHAN: { label: "Đã nhận", tone: "green" }, TU_CHOI: { label: "Từ chối", tone: "red" } };
const EMPTY = { location_code: "", sale: null, customer_name: "", customer_phone: "", bang_gia_id: "", ten: "", loai: "DANG_KY", thu: 0, chi_phi: 0, ghi_chu: "" };

export default function DichVuNgoai() {
  const { supabase, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [perms, setPerms] = useState({});
  const [tab, setTab] = useState("khoan");
  const [rows, setRows] = useState([]);
  const [bangGia, setBangGia] = useState([]);
  const [quy, setQuy] = useState([]);
  const [nops, setNops] = useState([]);
  const [bizAccs, setBizAccs] = useState([]);
  const [fSt, setFSt] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [tim, setTim] = useState({ q: "", list: null });
  const [open, setOpen] = useState(null);       // id khoan dang mo
  const [txns, setTxns] = useState([]);
  const [tf, setTf] = useState({ amount: "", account_id: "", note: "" });
  const [cf, setCf] = useState({ amount: "", account_id: "", ly_do: "", counterparty: "" });
  const [ef, setEf] = useState(null);
  const [nopQuy, setNopQuy] = useState("");
  const [denQuy, setDenQuy] = useState({});
  const [bg, setBg] = useState(null);

  const isAdm = ["CEO", "ADMIN"].includes(profile?.role);
  const can = (p) => profile?.role === "CEO" || !!perms[p];

  const load = async () => {
    if (!profile) return;
    const [{ data: r }, { data: g }, { data: qy }, { data: n }, { data: pm }, { data: ba }] = await Promise.all([
      supabase.from("v_dv_ngoai").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("dv_ngoai_bang_gia").select("*").order("name"),
      supabase.from("v_quy_so_du").select("*").eq("nhom", "DV_NGOAI").order("name"),
      supabase.from("dv_ngoai_nop").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("role_perms").select("perm,allowed").eq("role", profile.role),
      supabase.rpc("fn_tai_khoan_chon"),
    ]);
    setRows(r || []); setBangGia(g || []); setNops(n || []);
    setQuy((qy || []).filter((x) => isAdm || x.manager_id === profile.id));
    setBizAccs((ba || []).filter((a) => a.status === "Hoạt động" && a.nhom !== "DV_NGOAI"));
    const m = {}; (pm || []).forEach((x) => { m[x.perm] = x.allowed; }); setPerms(m);
  };
  useEffect(() => { if (!loading) load(); }, [loading, profile]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  if (!["CEO", "ADMIN", "MANAGER"].includes(profile.role)) return <div className="card">Bạn không có quyền xem mục này.</div>;

  const locName = (c) => locations.find((l) => l.code === c)?.name || c;
  const quyActive = quy.filter((x) => x.status === "Hoạt động");
  const quyTM = quyActive.filter((x) => x.type === "Tiền mặt");
  const quyCK = quyActive.filter((x) => x.type === "Ngân hàng");
  const dang = rows.filter((x) => x.status === "DANG_XU_LY");
  const choNop = rows.filter((x) => x.status === "HOAN_TAT" && !x.nop_id);
  const laiChoNop = choNop.reduce((a, b) => a + (b.thu - b.chi_phi), 0);
  const tonTM = quyTM.reduce((a, b) => a + Number(b.so_du || 0), 0);
  const tonCK = quyCK.reduce((a, b) => a + Number(b.so_du || 0), 0);
  const phaiChi = rows.filter((x) => ["DANG_XU_LY", "HOAN_TAT"].includes(x.status) && x.da_thu > 0).reduce((a, b) => a + Math.max(b.chi_phi - b.da_chi, 0), 0);

  const act = async (fn, args, okMsg, after) => {
    setBusy(true);
    const { data, error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { notify(errMsg(error), "err"); return null; }
    if (okMsg) notify(okMsg);
    await load();
    if (after) after(data);
    return data ?? true;
  };

  const timDon = async () => {
    const k = tim.q.trim();
    if (k.length < 3) return notify("Nhập ít nhất 3 ký tự mã đơn hoặc số khung.", "err");
    const { data } = await supabase.from("sales_orders").select("code,customer_name,customer_phone,frame_number,sale_date,location_code,status")
      .or(`code.ilike.%${k}%,frame_number.ilike.%${k}%`).neq("status", "Đã hủy").order("id", { ascending: false }).limit(6);
    setTim((p) => ({ ...p, list: data || [] }));
  };
  const chonDon = (o) => { setF((p) => ({ ...p, sale: o, location_code: p.location_code || o.location_code })); setTim({ q: "", list: null }); };
  const chonBangGia = (id) => {
    const g = bangGia.find((x) => String(x.id) === String(id));
    setF((p) => g ? { ...p, bang_gia_id: g.id, ten: g.name, loai: g.loai, thu: g.thu_mac_dinh, chi_phi: g.chi_mac_dinh } : { ...p, bang_gia_id: "" });
  };
  const moForm = () => {
    setF({ ...EMPTY, location_code: quyActive[0]?.location_code || "" });
    setTim({ q: "", list: null }); setShow(true);
  };
  const tao = async () => {
    if (!f.location_code) return notify("Chọn điểm.", "err");
    if (!f.ten.trim()) return notify("Nhập tên dịch vụ / hạng mục.", "err");
    if (!f.sale && !f.customer_name.trim()) return notify("Chọn đơn/xe hoặc nhập tên khách.", "err");
    const ok = await act("fn_dvn_tao", { p: {
      location_code: f.location_code, sale_code: f.sale?.code || "", customer_name: f.customer_name, customer_phone: f.customer_phone,
      bang_gia_id: f.bang_gia_id || "", ten: f.ten, loai: f.loai, thu: f.thu || 0, chi_phi: f.chi_phi || 0, ghi_chu: f.ghi_chu } }, "Đã tạo khoản dịch vụ ngoài.");
    if (ok) setShow(false);
  };

  const moKhoan = async (x) => {
    if (open === x.id) { setOpen(null); return; }
    setOpen(x.id); setEf(null);
    const goiY = quyActive.find((a) => a.type === "Tiền mặt" && a.location_code === x.location_code) || quyActive[0];
    setTf({ amount: Math.max(x.thu - x.da_thu, 0) || "", account_id: goiY?.id || "", note: "" });
    setCf({ amount: Math.max(x.chi_phi - x.da_chi, 0) || "", account_id: goiY?.id || "", ly_do: "", counterparty: "" });
    const { data } = await supabase.from("cash_txns").select("*").eq("ref_doc", x.code).order("id");
    setTxns(data || []);
  };
  const reloadTx = async (x) => { const { data } = await supabase.from("cash_txns").select("*").eq("ref_doc", x.code).order("id"); setTxns(data || []); };

  const filtered = rows.filter((x) => {
    if (fSt && x.status !== fSt) return false;
    if (!q.trim()) return true;
    return `${x.code} ${x.customer_name} ${x.customer_phone} ${x.frame_number} ${x.ten} ${x.sale_code || ""}`.toLowerCase().includes(q.trim().toLowerCase());
  });

  // ===== Nộp về công ty =====
  const choNopCuaToi = choNop.filter((x) => isAdm || x.manager_id === profile.id);
  const tienNop = choNopCuaToi.reduce((a, b) => a + (b.thu - b.chi_phi), 0);
  const deNghiNop = async () => {
    if (!nopQuy) return notify("Chọn quỹ dịch vụ ngoài sẽ nộp tiền từ đó.", "err");
    if (!confirm(`Đề nghị nộp ${fmtVND(tienNop)} (${choNopCuaToi.length} khoản đã hoàn tất) về công ty? Kế toán sẽ xác nhận khi nhận tiền.`)) return;
    await act("fn_dvn_de_nghi_nop", { p: { tu_quy_id: Number(nopQuy) } }, "Đã gửi đề nghị nộp — chờ kế toán xác nhận.");
  };
  const xacNhanNop = async (n, chap) => {
    let ly = "";
    if (!chap) { ly = prompt("Lý do từ chối:") || ""; if (!ly.trim()) return; }
    else if (!denQuy[n.id]) return notify("Chọn quỹ/tài khoản của công ty nhận tiền.", "err");
    await act("fn_dvn_xac_nhan_nop", { p: { id: n.id, chap_nhan: chap, den_quy_id: chap ? Number(denQuy[n.id]) : null, ly_do: ly } }, chap ? "Đã xác nhận nhận tiền nộp." : "Đã từ chối đề nghị nộp.");
  };

  const luuBangGia = async () => {
    if (!bg.name.trim()) return notify("Nhập tên dịch vụ.", "err");
    const ok = await act("fn_dvn_bang_gia_luu", { p: { ...bg, thu_mac_dinh: bg.thu_mac_dinh || 0, chi_mac_dinh: bg.chi_mac_dinh || 0 } }, "Đã lưu bảng giá chuẩn.");
    if (ok) setBg(null);
  };

  const tabBtn = (k, label) => (
    <button key={k} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${tab === k ? "bg-brand text-white" : "bg-[#EEF1F4] text-[#5A6572]"}`} onClick={() => setTab(k)}>{label}</button>
  );

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Dịch vụ đăng ký & phụ kiện ngoài</div>
        <div className="flex gap-1.5 flex-wrap">
          {tabBtn("khoan", `Khoản dịch vụ (${rows.length})`)}
          {tabBtn("nop", `Nộp về công ty${nops.filter((n) => n.status === "CHO_XAC_NHAN").length ? ` (${nops.filter((n) => n.status === "CHO_XAC_NHAN").length} chờ)` : ""}`)}
          {tabBtn("gia", "Bảng giá chuẩn")}
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <KPI label="Đang xử lý" value={dang.length} tone={dang.length ? "amber" : "dark"} />
        <KPI label="Lãi chờ nộp công ty" value={fmtVND(laiChoNop)} sub={`${choNop.length} khoản hoàn tất`} tone="blue" />
        <KPI label="Thu hộ chưa chi trả" value={fmtVND(phaiChi)} tone="purple" />
        <KPI label="Tồn quỹ tiền mặt (ngoài)" value={fmtVND(tonTM)} tone="green" />
        <KPI label="Số dư tài khoản CK (ngoài)" value={fmtVND(tonCK)} tone="green" />
      </div>
      {quyActive.length === 0 && (
        <div className="card text-sm text-[#A25F00] bg-[#FFF6E5]">Chưa có quỹ dịch vụ ngoài nào{isAdm ? " — vào Cài đặt → Tài khoản nhận tiền & Quỹ tiền mặt → Thêm tài khoản → chọn nhóm \"Quỹ dịch vụ ngoài\", gán cửa hàng trưởng và điểm." : " do bạn quản lý — nhờ kế toán/Ban giám đốc tạo trong Cài đặt."}</div>
      )}

      {tab === "khoan" && (
        <>
          <div className="flex gap-2 flex-wrap items-center">
            <select className="inp !w-auto" value={fSt} onChange={(e) => setFSt(e.target.value)}>
              <option value="">Trạng thái: tất cả</option>
              {Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <input className="inp !w-64" placeholder="Tìm mã, khách, SĐT, số khung, dịch vụ…" value={q} onChange={(e) => setQ(e.target.value)} />
            {can("dvn_ghi") && <button className="btn-primary !text-sm ml-auto" onClick={() => (show ? setShow(false) : moForm())}>{show ? "Đóng" : "+ Tạo khoản dịch vụ"}</button>}
          </div>

          {show && (
            <div className="card !p-4 border-2 border-brand">
              <div className="font-extrabold mb-3">Khoản dịch vụ ngoài mới</div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Điểm" required><LocSearch locations={locations} value={f.location_code} onChange={(v) => setF((p) => ({ ...p, location_code: v }))} placeholder="Chọn điểm…" /></Field>
                <div>
                  <Field label="Gắn với xe / đơn bán (mã đơn hoặc số khung)">
                    {f.sale ? (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-[#E7F6EE] text-[13px]">
                        <span className="mr-auto"><b>{f.sale.code}</b> · {f.sale.customer_name} · {f.sale.customer_phone}<br /><span className="font-mono text-[11px]">SK {f.sale.frame_number}</span></span>
                        <button className="btn-ghost !text-xs" onClick={() => setF((p) => ({ ...p, sale: null }))}>✕ Bỏ</button>
                      </div>
                    ) : (
                      <div className="flex gap-1.5">
                        <input className="inp" placeholder="VD: BH-2610-1234 hoặc số khung" value={tim.q} onChange={(e) => setTim((p) => ({ ...p, q: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && timDon()} />
                        <button className="btn-ghost !text-xs" onClick={timDon}>Tìm</button>
                      </div>
                    )}
                  </Field>
                  {!f.sale && tim.list && (
                    <div className="mt-1 flex flex-col gap-1">
                      {tim.list.map((o) => (
                        <button key={o.code} className="text-left text-[12px] p-1.5 rounded-lg border border-[#E3E8EF] hover:bg-[#F8FAFC]" onClick={() => chonDon(o)}>
                          <b>{o.code}</b> · {o.customer_name} · {o.customer_phone} · <span className="font-mono">{o.frame_number}</span>
                        </button>
                      ))}
                      {tim.list.length === 0 && <span className="text-[12px] text-[#8A93A0]">Không tìm thấy — có thể nhập khách lẻ bên dưới.</span>}
                    </div>
                  )}
                </div>
                {!f.sale && (
                  <>
                    <Field label="Tên khách (nếu không gắn xe)"><input className="inp" value={f.customer_name} onChange={(e) => setF((p) => ({ ...p, customer_name: e.target.value }))} /></Field>
                    <Field label="SĐT khách"><input className="inp" value={f.customer_phone} onChange={(e) => setF((p) => ({ ...p, customer_phone: e.target.value }))} /></Field>
                  </>
                )}
                <Field label="Chọn từ bảng giá chuẩn">
                  <select className="inp" value={f.bang_gia_id || ""} onChange={(e) => chonBangGia(e.target.value)}>
                    <option value="">— Tự nhập —</option>
                    {bangGia.filter((g) => g.status === "Hoạt động").map((g) => <option key={g.id} value={g.id}>{g.name} (thu {fmtVND(g.thu_mac_dinh)} · chi {fmtVND(g.chi_mac_dinh)})</option>)}
                  </select>
                </Field>
                <Field label="Tên dịch vụ / hạng mục" required><input className="inp" value={f.ten} onChange={(e) => setF((p) => ({ ...p, ten: e.target.value }))} /></Field>
                <Field label="Loại">
                  <select className="inp" value={f.loai} onChange={(e) => setF((p) => ({ ...p, loai: e.target.value }))}>
                    {Object.entries(LOAI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Khách thanh toán (đ)"><MoneyInput value={f.thu} onChange={(v) => setF((p) => ({ ...p, thu: v || 0 }))} /></Field>
                <Field label="Chi phí phải trả ngoài — thuế, lệ phí, nhà cung cấp (đ)"><MoneyInput value={f.chi_phi} onChange={(v) => setF((p) => ({ ...p, chi_phi: v || 0 }))} /></Field>
                <div className="md:col-span-2"><Field label="Ghi chú"><input className="inp" value={f.ghi_chu} onChange={(e) => setF((p) => ({ ...p, ghi_chu: e.target.value }))} /></Field></div>
              </div>
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                <div className="text-[13px] rounded-lg bg-[#EAF2FF] px-3 py-1.5">Lãi của cửa hàng: <b className="text-brand">{fmtVND((f.thu || 0) - (f.chi_phi || 0))}</b></div>
                <button className="btn-ok ml-auto" disabled={busy} onClick={tao}>{busy ? "Đang lưu…" : "Tạo khoản"}</button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {filtered.map((x) => {
              const st = ST[x.status] || { label: x.status, tone: "dark" };
              const dong = ["DA_NOP", "HUY"].includes(x.status);
              return (
                <div key={x.id} className="card !p-0 overflow-hidden">
                  <button className="w-full text-left p-3 flex items-center gap-2 flex-wrap hover:bg-[#F8FAFC]" onClick={() => moKhoan(x)}>
                    <div className="mr-auto min-w-0">
                      <div className="font-semibold text-sm">{x.code} · {x.ten} <span className="text-[11px] text-[#8A93A0]">· {LOAI[x.loai] || x.loai}</span></div>
                      <div className="text-[11px] text-[#8A93A0] truncate">{x.customer_name || "Khách lẻ"} {x.customer_phone ? "· " + x.customer_phone : ""}{x.frame_number ? " · SK " + x.frame_number : ""}{x.sale_code ? " · " + x.sale_code : ""} · {locName(x.location_code)} · {fmtDate(x.created_at)}</div>
                    </div>
                    <div className="text-[12px] text-right">
                      <div>Thu <b>{fmtVND(x.da_thu)}</b> / {fmtVND(x.thu)}</div>
                      <div>Chi <b>{fmtVND(x.da_chi)}</b> / {fmtVND(x.chi_phi)} · Lãi <b className="text-[#0E7A4A]">{fmtVND(x.thu - x.chi_phi)}</b></div>
                    </div>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </button>

                  {open === x.id && (
                    <div className="border-t border-[#E3E8EF] p-3 flex flex-col gap-3 bg-[#FBFCFE]">
                      <div>
                        <div className="text-xs font-bold text-[#5A6572] mb-1">Phiếu thu / chi của khoản này ({txns.length})</div>
                        {txns.length === 0 ? <div className="text-[12px] text-[#8A93A0]">Chưa có phiếu thu/chi.</div> : txns.map((t) => (
                          <div key={t.id} className="flex items-center gap-2 text-[12.5px] py-1 border-b border-dashed border-[#E3E8EF]">
                            <span className="font-mono">{t.code}</span>
                            <span className="mr-auto text-[#5A6572] truncate">{t.direction === "Thu" ? "Thu" : "Chi"} · {t.description} · {quy.find((a) => a.id === t.account_id)?.name || ""} · {fmtTime(t.created_at)}</span>
                            <b className={t.direction === "Thu" ? "text-[#0E7A4A]" : "text-danger"}>{t.direction === "Thu" ? "+" : "−"}{fmtVND(t.amount)}</b>
                          </div>
                        ))}
                      </div>

                      {!dong && can("dvn_ghi") && (
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="p-2.5 rounded-xl border border-[#BBE3CC] bg-[#F4FBF7]">
                            <div className="text-xs font-bold text-[#0E7A4A] mb-1.5">💵 Thu tiền của khách</div>
                            <div className="flex gap-1.5 flex-wrap items-end">
                              <div className="!w-36"><MoneyInput className="!py-1.5 !text-xs" value={tf.amount} onChange={(v) => setTf((p) => ({ ...p, amount: v }))} /></div>
                              <select className="inp !w-auto !py-1.5 !text-xs" value={tf.account_id} onChange={(e) => setTf((p) => ({ ...p, account_id: e.target.value }))}>
                                <option value="">— Vào quỹ —</option>
                                {quyActive.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                              </select>
                              <button className="btn-ok !text-xs" disabled={busy} onClick={async () => {
                                if (!tf.account_id) return notify("Chọn quỹ nhận tiền.", "err");
                                await act("fn_dvn_thu", { p: { id: x.id, amount: Number(tf.amount) || 0, account_id: Number(tf.account_id), note: tf.note } }, "Đã ghi thu.", () => reloadTx(x));
                              }}>Ghi thu</button>
                            </div>
                          </div>
                          <div className="p-2.5 rounded-xl border border-[#F3D9A6] bg-[#FFFAF0]">
                            <div className="text-xs font-bold text-[#A25F00] mb-1.5">💸 Chi phí đã trả ngoài (lệ phí, nhà cung cấp…)</div>
                            <div className="flex gap-1.5 flex-wrap items-end">
                              <div className="!w-36"><MoneyInput className="!py-1.5 !text-xs" value={cf.amount} onChange={(v) => setCf((p) => ({ ...p, amount: v }))} /></div>
                              <select className="inp !w-auto !py-1.5 !text-xs" value={cf.account_id} onChange={(e) => setCf((p) => ({ ...p, account_id: e.target.value }))}>
                                <option value="">— Chi từ quỹ —</option>
                                {quyActive.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                              </select>
                              <input className="inp !py-1.5 !text-xs flex-1 min-w-[160px]" placeholder="Lý do chi (bắt buộc)" value={cf.ly_do} onChange={(e) => setCf((p) => ({ ...p, ly_do: e.target.value }))} />
                              <button className="btn-primary !text-xs" disabled={busy} onClick={async () => {
                                if (!cf.account_id) return notify("Chọn quỹ chi tiền.", "err");
                                await act("fn_dvn_chi", { p: { id: x.id, amount: Number(cf.amount) || 0, account_id: Number(cf.account_id), ly_do: cf.ly_do, counterparty: cf.counterparty } }, "Đã ghi chi.", () => { setCf((p) => ({ ...p, ly_do: "" })); reloadTx(x); });
                              }}>Ghi chi</button>
                            </div>
                          </div>
                        </div>
                      )}

                      {!dong && can("dvn_ghi") && (
                        ef && ef.id === x.id ? (
                          <div className="flex gap-2 flex-wrap items-end p-2.5 rounded-xl border border-[#E3E8EF]">
                            <Field label="Tên dịch vụ"><input className="inp !py-1.5" value={ef.ten} onChange={(e) => setEf((p) => ({ ...p, ten: e.target.value }))} /></Field>
                            <Field label="Khách thanh toán"><div className="!w-36"><MoneyInput className="!py-1.5" value={ef.thu} onChange={(v) => setEf((p) => ({ ...p, thu: v || 0 }))} /></div></Field>
                            <Field label="Chi phí phải trả"><div className="!w-36"><MoneyInput className="!py-1.5" value={ef.chi_phi} onChange={(v) => setEf((p) => ({ ...p, chi_phi: v || 0 }))} /></div></Field>
                            <Field label="Ghi chú"><input className="inp !py-1.5" value={ef.ghi_chu} onChange={(e) => setEf((p) => ({ ...p, ghi_chu: e.target.value }))} /></Field>
                            <button className="btn-ok !text-xs" disabled={busy} onClick={async () => { const ok = await act("fn_dvn_sua", { p: { id: x.id, ten: ef.ten, thu: ef.thu, chi_phi: ef.chi_phi, ghi_chu: ef.ghi_chu } }, "Đã cập nhật khoản."); if (ok) setEf(null); }}>Lưu</button>
                            <button className="btn-ghost !text-xs" onClick={() => setEf(null)}>Hủy</button>
                          </div>
                        ) : (
                          <div className="flex gap-2 flex-wrap">
                            <button className="btn-ghost !text-xs" onClick={() => setEf({ id: x.id, ten: x.ten, thu: x.thu, chi_phi: x.chi_phi, ghi_chu: x.ghi_chu })}>✎ Sửa số tiền / thông tin</button>
                            {x.status === "DANG_XU_LY" && (
                              <button className="btn-ok !text-xs" disabled={busy} onClick={() => confirm("Hoàn tất khoản này? (cần đã thu đủ) — khoản hoàn tất sẽ được gom vào lãi chờ nộp công ty.") && act("fn_dvn_hoan_tat", { p_id: x.id }, "Đã hoàn tất — tính vào lãi chờ nộp.")}>✅ Hoàn tất</button>
                            )}
                            <button className="btn-ghost !text-xs !text-danger" disabled={busy} onClick={() => { const ly = prompt("Lý do hủy khoản (chỉ hủy được khi chưa có phiếu thu/chi):"); if (ly) act("fn_dvn_huy", { p_id: x.id, p_ly_do: ly }, "Đã hủy khoản."); }}>Hủy khoản</button>
                          </div>
                        )
                      )}
                      {x.ghi_chu && <div className="text-[12px] text-[#5A6572]">Ghi chú: {x.ghi_chu}</div>}
                    </div>
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && <div className="card text-sm text-[#8A93A0]">Chưa có khoản nào.</div>}
          </div>
        </>
      )}

      {tab === "nop" && (
        <>
          <div className="card">
            <div className="font-extrabold mb-1">Nộp lãi về công ty (cuối tháng)</div>
            <p className="text-[12px] text-[#5A6572] mb-3">Số nộp = tổng (khách thanh toán − chi phí phải trả) của các khoản đã <b>hoàn tất</b> và chưa nộp. Kế toán xác nhận khi nhận tiền; hệ thống tự lập phiếu chi ở quỹ dịch vụ ngoài và phiếu thu ở quỹ công ty.</p>
            <div className="flex gap-2 flex-wrap items-end">
              <div className="text-[13px] rounded-lg bg-[#EAF2FF] px-3 py-2">Có thể nộp: <b className="text-brand">{fmtVND(tienNop)}</b> · {choNopCuaToi.length} khoản</div>
              <select className="inp !w-auto" value={nopQuy} onChange={(e) => setNopQuy(e.target.value)}>
                <option value="">— Nộp từ quỹ —</option>
                {quyActive.map((a) => <option key={a.id} value={a.id}>{a.name} ({fmtVND(a.so_du)})</option>)}
              </select>
              {can("dvn_ghi") && <button className="btn-primary !text-sm" disabled={busy || tienNop <= 0} onClick={deNghiNop}>Đề nghị nộp</button>}
            </div>
          </div>
          <div className="card">
            <div className="font-extrabold mb-2">Đề nghị nộp ({nops.length})</div>
            <div className="flex flex-col gap-2">
              {nops.map((n) => {
                const st = NOP_ST[n.status] || { label: n.status, tone: "dark" };
                return (
                  <div key={n.id} className="p-2.5 rounded-xl border border-[#E3E8EF] flex items-center gap-2 flex-wrap text-[13px]">
                    <b>{n.code}</b>
                    <span className="mr-auto text-[#5A6572]">{locName(n.location_code)} · {n.so_khoan} khoản · {n.created_by_name} · {fmtDate(n.created_at)}{n.status === "DA_NHAN" ? ` · KT ${n.confirmed_by_name}` : ""}{n.ly_do_tu_choi ? ` · Từ chối: ${n.ly_do_tu_choi}` : ""}</span>
                    <b>{fmtVND(n.so_tien)}</b>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {n.status === "CHO_XAC_NHAN" && can("dvn_xac_nhan_nop") && (
                      <div className="flex gap-1.5 items-center flex-wrap w-full md:w-auto">
                        <select className="inp !w-auto !py-1 !text-xs" value={denQuy[n.id] || ""} onChange={(e) => setDenQuy((p) => ({ ...p, [n.id]: e.target.value }))}>
                          <option value="">— Công ty nhận vào —</option>
                          {bizAccs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                        <button className="btn-ok !px-2 !py-1 !text-xs" disabled={busy} onClick={() => xacNhanNop(n, true)}>✓ Đã nhận</button>
                        <button className="btn-ghost !px-2 !py-1 !text-xs !text-danger" disabled={busy} onClick={() => xacNhanNop(n, false)}>✗ Từ chối</button>
                      </div>
                    )}
                  </div>
                );
              })}
              {nops.length === 0 && <div className="text-sm text-[#8A93A0]">Chưa có đề nghị nộp nào.</div>}
            </div>
          </div>
        </>
      )}

      {tab === "gia" && (
        <div className="card">
          <div className="flex items-center mb-2">
            <div className="font-extrabold mr-auto">Bảng giá chuẩn dịch vụ ngoài ({bangGia.length})</div>
            {isAdm && <button className="btn-primary !py-1.5 !text-xs" onClick={() => setBg({ id: null, name: "", loai: "DANG_KY", thu_mac_dinh: 0, chi_mac_dinh: 0, status: "Hoạt động" })}>+ Thêm dịch vụ</button>}
          </div>
          <p className="text-[12px] text-[#5A6572] mb-3">Cửa hàng trưởng chọn dịch vụ ở đây khi tạo khoản, giá tự điền và vẫn sửa được cho từng khách. Chỉ Ban giám đốc/kế toán sửa bảng giá chuẩn.</p>
          {bg && (
            <div className="bg-[#F8FAFC] rounded-xl p-3 mb-3 grid gap-x-3 md:grid-cols-4 sm:grid-cols-2">
              <Field label="Tên dịch vụ" required><input className="inp" value={bg.name} onChange={(e) => setBg((p) => ({ ...p, name: e.target.value }))} /></Field>
              <Field label="Loại"><select className="inp" value={bg.loai} onChange={(e) => setBg((p) => ({ ...p, loai: e.target.value }))}>{Object.entries(LOAI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Khách thanh toán (đ)"><MoneyInput value={bg.thu_mac_dinh} onChange={(v) => setBg((p) => ({ ...p, thu_mac_dinh: v || 0 }))} /></Field>
              <Field label="Chi phí phải trả (đ)"><MoneyInput value={bg.chi_mac_dinh} onChange={(v) => setBg((p) => ({ ...p, chi_mac_dinh: v || 0 }))} /></Field>
              <div className="flex gap-2 md:col-span-4"><button className="btn-ok !text-xs" disabled={busy} onClick={luuBangGia}>Lưu</button><button className="btn-ghost !text-xs" onClick={() => setBg(null)}>Hủy</button></div>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            {bangGia.map((g) => (
              <div key={g.id} className={`flex items-center gap-2 p-2 rounded-lg border text-[13px] flex-wrap ${g.status === "Hoạt động" ? "border-[#E3E8EF]" : "border-[#EEE] bg-[#FAFAFA] opacity-70"}`}>
                <b className="mr-auto">{g.name} <span className="text-[11px] text-[#8A93A0] font-normal">· {LOAI[g.loai] || g.loai}</span></b>
                <span>Thu {fmtVND(g.thu_mac_dinh)}</span><span>Chi {fmtVND(g.chi_mac_dinh)}</span>
                <b className="text-[#0E7A4A]">Lãi {fmtVND(g.thu_mac_dinh - g.chi_mac_dinh)}</b>
                {g.status !== "Hoạt động" && <Badge tone="dark">Đã ẩn</Badge>}
                {isAdm && <>
                  <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => setBg({ ...g })}>✎ Sửa</button>
                  <button className="btn-ghost !px-2 !py-1 !text-xs" disabled={busy} onClick={() => act("fn_dvn_bang_gia_luu", { p: { ...g, status: g.status === "Hoạt động" ? "Đã ẩn" : "Hoạt động" } }, g.status === "Hoạt động" ? "Đã ẩn dịch vụ." : "Đã hiện lại.")}>{g.status === "Hoạt động" ? "Ẩn" : "Hiện"}</button>
                </>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
