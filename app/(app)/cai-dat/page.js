"use client";
import { useState, useEffect } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, MoneyInput } from "@/components/ui";
import { errMsg, fmtVND } from "@/lib/format";

const TYPE_LABELS = { text: "Chữ", number: "Số", dropdown: "Danh sách chọn", checkbox: "Tick chọn", formula: "Công thức tự tính" };

const PERM_LIST = [
  { group: "Kho & hàng hóa", items: [
    { key: "nhap_hang", label: "Nhập hàng vào kho" },
    { key: "xuat_ban", label: "Tạo đơn xuất bán" },
    { key: "dieu_chuyen", label: "Tạo phiếu điều chuyển" },
    { key: "dieu_chinh", label: "Đề xuất điều chỉnh tồn" },
    { key: "duyet_dieu_chinh", label: "Duyệt điều chỉnh tồn" },
    { key: "kiem_ke", label: "Kiểm kê" },
    { key: "nhap_tu_phieu", label: "Nhập kho từ phiếu quét gom" },
  ] },
  { group: "Đơn bán", items: [
    { key: "xac_nhan_hd", label: "Xác nhận đã xuất hóa đơn" },
    { key: "sua_thanh_toan", label: "Cập nhật số tiền đã thanh toán" },
    { key: "duyet_sua_don", label: "Duyệt điều chỉnh giá đơn" },
  ] },
  { group: "Dữ liệu", items: [
    { key: "sua_danh_muc", label: "Thêm/sửa danh mục xe, kho, NCC" },
    { key: "sua_unit", label: "Sửa thông tin xe theo số khung" },
    { key: "sua_khach", label: "Thêm/sửa khách hàng" },
  ] },
  { group: "Dịch vụ", items: [
    { key: "dv_tiep_nhan", label: "Tiếp nhận xe vào dịch vụ" },
    { key: "dv_chan_doan", label: "Chẩn đoán kỹ thuật" },
    { key: "dv_bao_gia", label: "Lập báo giá / giảm giá" },
    { key: "dv_thu_tien", label: "Thu tiền dịch vụ" },
    { key: "dv_nghiem_thu", label: "Nghiệm thu" },
    { key: "dv_giao_xe", label: "Giao xe cho khách" },
    { key: "dv_eod", label: "Duyệt công nợ & chốt ngày (EOD)" },
    { key: "dv_huy_phieu", label: "Hủy phiếu dịch vụ" },
  ] },
  { group: "Kho phụ tùng", items: [
    { key: "pt_danh_muc", label: "Sửa danh mục phụ tùng & bảng giá công" },
    { key: "pt_nhap", label: "Nhập kho phụ tùng" },
    { key: "pt_xuat", label: "Xuất vật tư theo phiếu" },
    { key: "pt_kiem_ke", label: "Kiểm kê phụ tùng" },
  ] },
  { group: "Quản trị", items: [
    { key: "xem_bao_cao", label: "Xem báo cáo" },
    { key: "cai_dat", label: "Vào trang Cài đặt" },
  ] },
];

function WebhookCard({ supabase, settings, refresh, notify, title, keyName, testRpc, desc }) {
  const [val, setVal] = useState(null);
  const cur = settings[keyName] || "";
  const save = async () => {
    const v = val.trim();
    if (v && !v.startsWith("https://discord.com/api/webhooks/") && !v.startsWith("https://discordapp.com/api/webhooks/"))
      return notify("URL không đúng dạng webhook Discord (bắt đầu bằng https://discord.com/api/webhooks/...).", "err");
    const { error } = await supabase.rpc("fn_set_setting", { p_key: keyName, p_value: v });
    if (error) return notify(errMsg(error), "err");
    notify(v ? "Đã lưu webhook. Bấm Gửi thử để kiểm tra." : "Đã tắt thông báo kênh này.");
    setVal(null); refresh();
  };
  const test = async () => {
    const { error } = await supabase.rpc(testRpc);
    if (error) return notify(errMsg(error), "err");
    notify("Đã gửi tin thử — kiểm tra channel Discord trong vài giây.");
  };
  return (
    <div className="card">
      <div className="font-extrabold mb-1">{title} {cur ? <Badge tone="green">Đang bật</Badge> : <Badge tone="gray">Chưa bật</Badge>}</div>
      <p className="text-xs text-[#5A6572] mb-3">{desc} Tạo webhook trong đúng channel: chuột phải channel → Chỉnh sửa kênh → Tích hợp → Webhook → Tạo webhook → Sao chép URL. Chưa nhập thì <b>không gửi</b>.</p>
      {val === null ? (
        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-sm font-mono text-[#5A6572]">{cur ? cur.slice(0, 45) + "…" : "Chưa cấu hình webhook."}</span>
          <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setVal(cur)}>✎ {cur ? "Sửa" : "Thêm webhook"}</button>
          {cur && <button className="btn-primary !py-1.5 !text-xs" onClick={test}>📨 Gửi thử</button>}
        </div>
      ) : (
        <div className="max-w-xl">
          <input className="inp font-mono !text-xs" placeholder="https://discord.com/api/webhooks/…" value={val} onChange={(e) => setVal(e.target.value)} />
          <div className="flex gap-2 mt-2">
            <button className="btn-ok !py-2 !text-xs" onClick={save}>Lưu</button>
            <button className="btn-ghost !py-2 !text-xs" onClick={() => setVal(null)}>Hủy</button>
            {cur && <button className="btn-danger !py-2 !text-xs" onClick={() => setVal("")}>Xóa URL (rồi bấm Lưu để tắt)</button>}
          </div>
        </div>
      )}
    </div>
  );
}

const EMPTY_ACC = { id: null, name: "", type: "Ngân hàng", location_code: "", company_id: "", bank_info: "", opening_balance: 0, status: "Hoạt động" };
function QuyTaiKhoan({ supabase, notify, locations }) {
  const [accs, setAccs] = useState([]);
  const [cos, setCos] = useState([]);
  const [f, setF] = useState(null);
  const load = async () => {
    const [{ data: a }, { data: c }] = await Promise.all([
      supabase.from("cash_accounts").select("*").order("type").order("name"),
      supabase.from("companies").select("id,name").eq("status", "Hoạt động").order("name"),
    ]);
    setAccs(a || []); setCos(c || []);
  };
  useEffect(() => { load(); }, []);
  const luu = async (acc) => {
    const a = acc || f;
    if (!a.name.trim()) return notify("Nhập tên tài khoản/quỹ.", "err");
    if (a.type === "Ngân hàng" && !a.company_id) return notify("Tài khoản ngân hàng bắt buộc chọn Pháp nhân sở hữu.", "err");
    const { error } = await supabase.rpc("fn_them_quy", { p: { ...a, company_id: a.company_id || "", location_code: a.location_code || "", opening_balance: Number(a.opening_balance) || 0 } });
    if (error) return notify(errMsg(error), "err");
    notify(acc ? (acc.status === "Hoạt động" ? "Đã mở lại tài khoản." : "Đã khóa tài khoản — không còn hiện khi chọn nơi nhận tiền.") : "Đã lưu tài khoản.");
    setF(null); load();
  };
  const bank = accs.filter((a) => a.type === "Ngân hàng");
  const coName = (id) => cos.find((c) => c.id === id)?.name || "—";
  return (
    <div className="card">
      <div className="flex items-center mb-1">
        <div className="font-extrabold mr-auto">Tài khoản nhận tiền (Ngân hàng) & Quỹ tiền mặt ({accs.length})</div>
        <button className="btn-primary !py-1.5 !text-xs" onClick={() => setF({ ...EMPTY_ACC })}>+ Thêm tài khoản</button>
      </div>
      <p className="text-xs text-[#5A6572] mb-3">Danh sách này hiện ở ô "Tài khoản nhận tiền" khi lập đơn bán (lọc theo <b>pháp nhân của hãng xe</b>). Tài khoản đã phát sinh giao dịch thì <b>không xóa được</b> — dùng "Khóa" để ẩn. Số dư và chốt quỹ xem ở mục Tài chính → Thu chi.</p>
      {f && (
        <div className="bg-[#F8FAFC] rounded-xl p-3 mb-3">
          <div className="grid gap-x-3 md:grid-cols-3 sm:grid-cols-2">
            <Field label="Tên tài khoản / quỹ" required><input className="inp" value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} placeholder="VD: TK SHB Cty Ngân Thái Sơn" /></Field>
            <Field label="Loại">
              <select className="inp" disabled={!!f.id} value={f.type} onChange={(e) => setF((p) => ({ ...p, type: e.target.value, company_id: "", location_code: "" }))}>
                <option>Ngân hàng</option><option>Tiền mặt</option>
              </select>
            </Field>
            {f.type === "Ngân hàng" ? (
              <Field label="Pháp nhân sở hữu" required>
                <select className="inp" value={f.company_id || ""} onChange={(e) => setF((p) => ({ ...p, company_id: e.target.value }))}>
                  <option value="">— Chọn pháp nhân —</option>
                  {cos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            ) : (
              <Field label="Gắn với điểm">
                <select className="inp" value={f.location_code || ""} onChange={(e) => setF((p) => ({ ...p, location_code: e.target.value }))}>
                  <option value="">— Không gắn —</option>
                  {locations.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Thông tin ngân hàng (hiện cho nhân viên chọn)"><input className="inp" value={f.bank_info || ""} onChange={(e) => setF((p) => ({ ...p, bank_info: e.target.value }))} placeholder="VD: SHB 888999 - Cty Ngân Thái Sơn" /></Field>
            {!f.id && <Field label="Số dư đầu kỳ"><MoneyInput value={f.opening_balance} onChange={(v) => setF((p) => ({ ...p, opening_balance: v || 0 }))} /></Field>}
          </div>
          <div className="flex gap-2"><button className="btn-ok !text-xs" onClick={() => luu()}>Lưu</button><button className="btn-ghost !text-xs" onClick={() => setF(null)}>Hủy</button></div>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {[...bank, ...accs.filter((a) => a.type !== "Ngân hàng")].map((a) => (
          <div key={a.id} className={`flex items-center gap-2 p-2 rounded-lg border text-[13px] flex-wrap ${a.status === "Hoạt động" ? "border-[#E3E8EF]" : "border-[#EEE] bg-[#FAFAFA] opacity-70"}`}>
            <Badge tone={a.type === "Ngân hàng" ? "blue" : "amber"}>{a.type}</Badge>
            <b className="mr-auto">{a.name}</b>
            <span className="text-xs text-[#5A6572]">{a.type === "Ngân hàng" ? `${coName(a.company_id)}${a.bank_info ? " · " + a.bank_info : ""}` : (locations.find((l) => l.code === a.location_code)?.name || "")}</span>
            {a.status !== "Hoạt động" && <Badge tone="dark">Đã khóa</Badge>}
            <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => setF({ ...a, company_id: a.company_id || "", location_code: a.location_code || "" })}>✎ Sửa</button>
            <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => luu({ ...a, company_id: a.company_id || "", status: a.status === "Hoạt động" ? "Đã khóa" : "Hoạt động" })}>{a.status === "Hoạt động" ? "Khóa" : "Mở lại"}</button>
          </div>
        ))}
        {accs.length === 0 && <div className="text-sm text-[#8A93A0]">Chưa có tài khoản nào.</div>}
      </div>
    </div>
  );
}

export default function CaiDat() {
  const { supabase, profile, loading, settings, customFields, brands, locations, refresh, taxRate, regions, diaBan } = useCatalog();
  const { toast, notify } = useToast();
  const [tax, setTax] = useState("");
  const [show, setShow] = useState(false);
  const empty = { label: "", field_type: "text", optionsText: "", op: "divide", operand: "TAX", required: false };
  const [f, setF] = useState(empty);
  const [editField, setEditField] = useState(null);
  const [newBrand, setNewBrand] = useState("");
  const [reg, setReg] = useState(null);
  const [db, setDb] = useState(null);
  const [hook, setHook] = useState(null);
  const [bk, setBk] = useState(null);
  const [pf, setPf] = useState(null); // phieu in
  const [perms, setPerms] = useState(null);
  const [collectors, setCollectors] = useState([]);
  const [staffAll, setStaffAll] = useState([]);
  const [svcs, setSvcs] = useState([]);
  const [svcF, setSvcF] = useState({ id: null, code: "", name: "", group_name: "Chung", price: 0 });
  const [colF, setColF] = useState({ user_id: "", location_code: "", is_primary: true });

  const loadDV = async () => {
    const [{ data: c }, { data: st }, { data: sv }] = await Promise.all([
      supabase.from("dv_collectors").select("*"),
      supabase.from("profiles").select("id,name,role").eq("status", "Hoạt động").order("name"),
      supabase.from("dv_services").select("*").order("group_name").order("code"),
    ]);
    setCollectors(c || []); setStaffAll(st || []); setSvcs(sv || []);
  };
  useEffect(() => { if (profile && ["CEO","ADMIN","MANAGER"].includes(profile.role)) loadDV(); }, [profile]);

  const ganNguoiThu = async (active, ovr) => {
    const u = ovr?.user_id || colF.user_id, l = ovr?.location_code || colF.location_code;
    const pri = ovr ? ovr.is_primary : colF.is_primary;
    if (!u || !l) return notify("Chọn nhân viên và điểm.", "err");
    const { error } = await supabase.rpc("fn_dv_gan_nguoi_thu", { p_user: u, p_loc: l, p_primary: pri, p_active: active });
    if (error) return notify(errMsg(error), "err");
    notify(active ? "Đã gán người thu tiền." : "Đã gỡ quyền thu tiền.");
    setColF({ user_id: "", location_code: "", is_primary: true }); loadDV();
  };

  const luuSvc = async () => {
    if (!svcF.code.trim() || !svcF.name.trim()) return notify("Nhập mã và tên dịch vụ.", "err");
    const { error } = await supabase.rpc("fn_dv_luu_service", { p: svcF });
    if (error) return notify(errMsg(error), "err");
    notify("Đã lưu bảng giá."); setSvcF({ id: null, code: "", name: "", group_name: "Chung", price: 0 }); loadDV();
  };
  const loadPerms = async () => {
    const { data } = await supabase.from("role_perms").select("*");
    const m = {};
    (data || []).forEach((r) => { m[`${r.role}|${r.perm}`] = r.allowed; });
    setPerms(m);
  };
  useEffect(() => { if (profile?.role === "CEO") loadPerms(); }, [profile]);
  const togglePerm = async (role, perm, cur) => {
    const { error } = await supabase.rpc("fn_set_quyen", { p_role: role, p_perm: perm, p_allowed: !cur });
    if (error) return notify(errMsg(error), "err");
    setPerms((p) => ({ ...p, [`${role}|${perm}`]: !cur }));
  };
  const savePf = async () => {
    for (const [key, val] of [["cty_ten", pf.ten.trim()], ["cty_diachi", pf.dc.trim()], ["cty_sdt", pf.sdt.trim()], ["phieu_footer", pf.ft.trim()]]) {
      const { error } = await supabase.rpc("fn_set_setting", { p_key: key, p_value: val });
      if (error) return notify(errMsg(error), "err");
    }
    notify("Đã lưu thông tin in phiếu xuất."); setPf(null); refresh();
  }; // {pk, bh, ftg, dk}

  const saveBk = async () => {
    const cln = (x) => x.split(/\n+/).map((y) => y.trim()).filter(Boolean).join("\n");
    for (const [key, val] of [["phu_kien", cln(bk.pk)], ["bao_hiem", cln(bk.bh)], ["gia_dang_ky", String(Number(bk.dk) || 350000)]]) {
      const { error } = await supabase.rpc("fn_set_setting", { p_key: key, p_value: val });
      if (error) return notify(errMsg(error), "err");
    }
    notify("Đã lưu danh mục bán kèm & trả góp."); setBk(null); refresh();
  };


  const saveHook = async () => {
    const v = hook.trim();
    if (v && !v.startsWith("https://discord.com/api/webhooks/") && !v.startsWith("https://discordapp.com/api/webhooks/"))
      return notify("URL không đúng dạng webhook Discord (bắt đầu bằng https://discord.com/api/webhooks/...).", "err");
    const { error } = await supabase.rpc("fn_set_setting", { p_key: "discord_webhook", p_value: v });
    if (error) return notify(errMsg(error), "err");
    notify(v ? "Đã lưu webhook. Bấm Gửi thử để kiểm tra." : "Đã tắt thông báo Discord.");
    setHook(null); refresh();
  };

  const testHook = async () => {
    const { error } = await supabase.rpc("fn_test_discord");
    if (error) return notify(errMsg(error), "err");
    notify("Đã gửi tin thử — kiểm tra channel Discord trong vài giây.");
  };

  const saveRegions = async () => {
    const clean = reg.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean).join("\n");
    if (!clean) return notify("Cần ít nhất 1 khu vực.", "err");
    const { error } = await supabase.rpc("fn_set_setting", { p_key: "regions", p_value: clean });
    if (error) return notify(errMsg(error), "err");
    notify("Đã lưu danh sách khu vực. Khu vực đang gắn với kho cũ vẫn hiển thị bình thường.");
    setReg(null); refresh();
  };

  const saveDiaBan = async () => {
    const clean = db.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const [tinh, ps] = l.split("|");
      const phuongs = (ps || "").split(/[,;]+/).map((x) => x.trim()).filter(Boolean).join(", ");
      return { tinh: (tinh || "").trim(), line: (tinh || "").trim() + (phuongs ? " | " + phuongs : "") };
    }).filter((x) => x.tinh).map((x) => x.line).join("\n");
    const { error } = await supabase.rpc("fn_set_setting", { p_key: "dia_ban", p_value: clean });
    if (error) return notify(errMsg(error), "err");
    notify("Đã lưu danh sách Tỉnh/Thành phố & Phường/Xã.");
    setDb(null); refresh();
  };

  const addBrand = async () => {
    if (!newBrand.trim()) return;
    const { error } = await supabase.rpc("fn_them_hang", { p_name: newBrand });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã thêm hãng "${newBrand.trim()}" — dùng được ngay khi thêm xe mới.`);
    setNewBrand(""); refresh();
  };
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const startEditField = (c) => {
    setEditField(c.id);
    setF({
      label: c.label, field_type: c.field_type, required: c.required,
      optionsText: (c.options || []).join("\n"),
      op: c.formula?.op || "divide",
      operand: c.formula ? (c.formula.operand === "TAX" ? "TAX" : String(c.formula.operand)) : "TAX",
    });
    setShow(true);
  };


  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  if (!["CEO", "ADMIN"].includes(profile.role)) return <div className="card">Chỉ BGĐ/Admin được vào phần cài đặt.</div>;

  const saveTax = async () => {
    const pct = parseFloat(tax);
    if (isNaN(pct) || pct < 0 || pct > 100) return notify("Nhập thuế suất dạng số phần trăm, ví dụ 8 hoặc 10.", "err");
    const { error } = await supabase.rpc("fn_set_setting", { p_key: "tax_rate", p_value: String(pct / 100) });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã đổi thuế suất thành ${pct}%. Các trường "trước thuế" sẽ tính theo mức mới.`);
    setTax(""); refresh();
  };

  const saveField = async () => {
    if (!f.label.trim()) return notify("Nhập tên trường.", "err");
    const p = { label: f.label.trim(), field_type: f.field_type, required: f.required };
    if (editField) p.id = String(editField);
    if (f.field_type === "dropdown") {
      p.options = f.optionsText.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
      if (p.options.length === 0) return notify("Nhập ít nhất 1 lựa chọn cho danh sách.", "err");
    }
    if (f.field_type === "formula") {
      p.formula = { base: "sale_price", op: f.op, operand: f.operand === "TAX" ? "TAX" : Number(f.operand) };
      if (f.operand !== "TAX" && (isNaN(Number(f.operand)) || Number(f.operand) === 0)) return notify("Toán hạng phải là số khác 0 hoặc chọn Thuế.", "err");
    }
    const { error } = await supabase.rpc("fn_save_custom_field", { p });
    if (error) return notify(errMsg(error), "err");
    notify(editField ? `Đã cập nhật trường "${f.label}".` : `Đã thêm trường "${f.label}" vào form đơn bán.`);
    setF(empty); setEditField(null); setShow(false); refresh();
  };

  const remove = async (c) => {
    if (!confirm(`Ẩn trường "${c.label}" khỏi form đơn bán? Dữ liệu cũ vẫn được giữ nguyên trong các đơn đã lưu.`)) return;
    const { error } = await supabase.rpc("fn_delete_custom_field", { p_id: c.id });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã ẩn trường "${c.label}".`); refresh();
  };

  const opText = { divide: "÷", multiply: "×", add: "+", subtract: "−" };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="card">
        <div className="font-extrabold mb-1">Thuế suất GTGT</div>
        <p className="text-xs text-[#5A6572] mb-3">Đang áp dụng: <b className="text-brand">{Math.round(taxRate * 1000) / 10}%</b>. Dùng cho các trường công thức "trước thuế" (giá trước thuế = giá bán ÷ (1 + thuế)).</p>
        <div className="flex gap-2 items-center">
          <input type="number" className="inp !w-32" placeholder="VD: 8 hoặc 10" value={tax} onChange={(e) => setTax(e.target.value)} />
          <span className="text-sm">%</span>
          <button className="btn-primary" onClick={saveTax}>Lưu thuế suất</button>
        </div>
      </div>

      <div className="card">
        <div className="font-extrabold mb-1">Danh mục hãng xe ({brands.length})</div>
        <p className="text-xs text-[#5A6572] mb-3">Hãng thêm ở đây sẽ xuất hiện trong dropdown chọn hãng khi thêm/sửa xe ở Danh mục xe.</p>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex gap-1.5 flex-wrap">{brands.map((b) => <Badge key={b.name} tone="blue">{b.name}</Badge>)}</div>
          <input className="inp !w-44 !py-1.5 !text-xs" placeholder="Tên hãng mới…" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addBrand()} />
          <button className="btn-ghost !py-1.5 !text-xs" onClick={addBrand}>+ Thêm hãng</button>
        </div>
      </div>

      <div className="card">
        <div className="font-extrabold mb-1">Thông báo Discord — Kênh Tồn kho {settings.discord_webhook ? <Badge tone="green">Đang bật</Badge> : <Badge tone="gray">Chưa bật</Badge>}</div>
        <p className="text-xs text-[#5A6572] mb-3"><b>Kênh riêng cho Xuất–Nhập–Tồn</b> (tách khỏi kênh Đơn bán bên dưới). Mọi biến động tồn kho (nhập, bán, điều chuyển, điều chỉnh, kiểm kê) sẽ gửi ngay vào channel Discord, kèm xe, kho, tồn trước → sau, người thao tác, số phiếu. Lấy URL: mở Discord → chuột phải channel → Chỉnh sửa kênh → Tích hợp (Integrations) → Webhook → Tạo webhook → Sao chép URL.</p>
        {hook === null ? (
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-sm font-mono text-[#5A6572]">{settings.discord_webhook ? settings.discord_webhook.slice(0, 45) + "…" : "Chưa cấu hình webhook."}</span>
            <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setHook(settings.discord_webhook || "")}>✎ {settings.discord_webhook ? "Sửa" : "Thêm webhook"}</button>
            {settings.discord_webhook && <button className="btn-primary !py-1.5 !text-xs" onClick={testHook}>📨 Gửi thử</button>}
          </div>
        ) : (
          <div className="max-w-xl">
            <input className="inp font-mono !text-xs" placeholder="https://discord.com/api/webhooks/…" value={hook} onChange={(e) => setHook(e.target.value)} />
            <div className="flex gap-2 mt-2">
              <button className="btn-ok !py-2 !text-xs" onClick={saveHook}>Lưu</button>
              <button className="btn-ghost !py-2 !text-xs" onClick={() => setHook(null)}>Hủy</button>
              {settings.discord_webhook && <button className="btn-danger !py-2 !text-xs" onClick={() => { setHook(""); }}>Xóa URL (rồi bấm Lưu để tắt)</button>}
            </div>
          </div>
        )}
      </div>

      <WebhookCard supabase={supabase} settings={settings} refresh={refresh} notify={notify} keyName="discord_webhook_don_ban" testRpc="fn_test_discord_don_ban"
        title="Thông báo Discord — Đơn bán"
        desc="Chi tiết (khách, xe, khuyến mại, bảng giá, thanh toán) mỗi khi tạo / sửa / hủy / hoàn trả đơn, đổi khuyến mại, bổ sung khách lẻ cuối — cho cả Wizard và Bán buôn." />
      <WebhookCard supabase={supabase} settings={settings} refresh={refresh} notify={notify} keyName="discord_webhook_thuchi" testRpc="fn_test_discord_thuchi"
        title="Thông báo Discord — Tài chính"
        desc="Báo cáo quỹ 21h hằng ngày, đảo ngược khoản thu, chốt đối soát và các biến động Tài chính." />
      <WebhookCard supabase={supabase} settings={settings} refresh={refresh} notify={notify} keyName="discord_webhook_dichvu" testRpc="fn_test_discord_dichvu"
        title="Thông báo Discord — Dịch vụ"
        desc="Module Dịch vụ: tiếp nhận xe, thu tiền, hoàn tất, giao xe, chốt công nợ cuối ngày (EOD)." />

      <QuyTaiKhoan supabase={supabase} notify={notify} locations={locations} />

      {["CEO","ADMIN","MANAGER"].includes(profile.role) && (
        <div className="card">
          <div className="font-extrabold mb-1">🔧 Dịch vụ — Người được chỉ định thu tiền</div>
          <p className="text-xs text-[#5A6572] mb-3">Chỉ những người trong danh sách này mới bấm được nút thu tiền tại điểm tương ứng (QT-DV-01 mục 7.2). <b>Kỹ thuật viên không được gán</b> — hệ thống tự chặn.</p>
          <div className="flex gap-2 flex-wrap items-end mb-3">
            <div><label className="lbl">Nhân viên</label>
              <select className="inp !w-52" value={colF.user_id} onChange={(e) => setColF((p) => ({ ...p, user_id: e.target.value }))}>
                <option value="">— Chọn —</option>
                {staffAll.filter((x) => x.role !== "TECHNICIAN").map((x) => <option key={x.id} value={x.id}>{x.name} ({x.role})</option>)}
              </select></div>
            <div><label className="lbl">Điểm</label>
              <select className="inp !w-52" value={colF.location_code} onChange={(e) => setColF((p) => ({ ...p, location_code: e.target.value }))}>
                <option value="">— Chọn —</option>
                {locations.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select></div>
            <label className="flex items-center gap-1.5 text-xs font-semibold pb-2">
              <input type="checkbox" className="w-4 h-4" checked={colF.is_primary} onChange={(e) => setColF((p) => ({ ...p, is_primary: e.target.checked }))} /> Thu chính
            </label>
            <button className="btn-ok !text-xs !py-2" onClick={() => ganNguoiThu(true)}>+ Gán</button>
          </div>
          <div className="flex flex-col gap-1.5">
            {collectors.map((c) => (
              <div key={c.id} className="flex items-center gap-2 p-2 rounded-lg border border-[#E3E8EF] text-[13px]">
                <b className="mr-auto">{staffAll.find((x) => x.id === c.user_id)?.name || c.user_id}</b>
                <span className="text-xs text-[#8A93A0]">{locations.find((l) => l.code === c.location_code)?.name || c.location_code}</span>
                <Badge tone={c.is_primary ? "green" : "blue"}>{c.is_primary ? "Thu chính" : "Dự phòng"}</Badge>
                <Badge tone={c.active ? "green" : "dark"}>{c.active ? "Đang hiệu lực" : "Đã gỡ"}</Badge>
                {c.active && <button className="btn-ghost !px-2 !py-1 !text-xs !text-danger" onClick={() => ganNguoiThu(false, { user_id: c.user_id, location_code: c.location_code, is_primary: c.is_primary })}>Gỡ</button>}
              </div>
            ))}
            {collectors.length === 0 && <div className="text-sm text-[#8A93A0]">Chưa gán ai — hiện chỉ Admin/BGĐ thu được tiền.</div>}
          </div>
        </div>
      )}

      {["CEO","ADMIN"].includes(profile.role) && (
        <div className="card">
          <div className="font-extrabold mb-1">🔧 Dịch vụ — Bảng giá tiền công ({svcs.length})</div>
          <p className="text-xs text-[#5A6572] mb-3">Danh mục này hiện trong ô chọn khi lập báo giá phiếu dịch vụ.</p>
          <div className="flex gap-2 flex-wrap items-end mb-3">
            <div><label className="lbl">Mã</label><input className="inp !w-28" value={svcF.code} onChange={(e) => setSvcF((p) => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="DVC-009" /></div>
            <div><label className="lbl">Tên dịch vụ</label><input className="inp !w-64" value={svcF.name} onChange={(e) => setSvcF((p) => ({ ...p, name: e.target.value }))} /></div>
            <div><label className="lbl">Nhóm</label><input className="inp !w-32" value={svcF.group_name} onChange={(e) => setSvcF((p) => ({ ...p, group_name: e.target.value }))} /></div>
            <div><label className="lbl">Giá công</label><div className="!w-36"><MoneyInput value={svcF.price} onChange={(v) => setSvcF((p) => ({ ...p, price: v || 0 }))} /></div></div>
            <button className="btn-ok !text-xs !py-2" onClick={luuSvc}>{svcF.id ? "Cập nhật" : "+ Thêm"}</button>
            {svcF.id && <button className="btn-ghost !text-xs !py-2" onClick={() => setSvcF({ id: null, code: "", name: "", group_name: "Chung", price: 0 })}>Hủy sửa</button>}
          </div>
          <div className="overflow-x-auto"><table className="w-full border-collapse">
            <thead><tr><th className="th">Mã</th><th className="th">Tên dịch vụ</th><th className="th">Nhóm</th><th className="th">Giá công</th><th className="th"></th></tr></thead>
            <tbody>{svcs.map((sv) => (
              <tr key={sv.id} className="hover:bg-[#F8FAFC]">
                <td className="td font-mono text-xs">{sv.code}</td>
                <td className="td text-[13px] font-semibold">{sv.name}</td>
                <td className="td text-xs">{sv.group_name}</td>
                <td className="td"><b>{fmtVND(sv.price)}</b></td>
                <td className="td"><button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => setSvcF({ id: sv.id, code: sv.code, name: sv.name, group_name: sv.group_name, price: sv.price })}>✎</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      {profile.role === "CEO" && (
        <div className="card">
          <div className="font-extrabold mb-1">Phân quyền theo vai trò</div>
          <p className="text-xs text-[#5A6572] mb-3">Tích/bỏ tích để cho phép từng vai trò làm gì. Quyền được kiểm tra ở cả giao diện lẫn database. <b>BGĐ luôn có toàn quyền</b> (không chỉnh được, tránh tự khóa mình ra ngoài).</p>
          {perms === null ? <div className="text-sm text-[#8A93A0]">Đang tải phân quyền…</div> : (
            <div className="overflow-x-auto"><table className="w-full border-collapse">
              <thead><tr><th className="th">Quyền</th><th className="th text-center">Sales</th><th className="th text-center">KTV</th><th className="th text-center">Cửa hàng trưởng</th><th className="th text-center">Admin</th><th className="th text-center">BGĐ</th></tr></thead>
              <tbody>{PERM_LIST.map((g) => [
                <tr key={g.group}><td className="td font-extrabold text-[11px] uppercase bg-[#F3F5F8]" colSpan={6}>{g.group}</td></tr>,
                ...g.items.map((it) => (
                  <tr key={it.key} className="hover:bg-[#F8FAFC]">
                    <td className="td text-[13px]">{it.label}</td>
                    {["SALES", "TECHNICIAN", "MANAGER", "ADMIN"].map((r) => (
                      <td key={r} className="td text-center">
                        <input type="checkbox" className="w-4 h-4 cursor-pointer" checked={!!perms[`${r}|${it.key}`]} onChange={() => togglePerm(r, it.key, !!perms[`${r}|${it.key}`])} />
                      </td>
                    ))}
                    <td className="td text-center"><span className="text-[#0E7A4A] font-bold">✓</span></td>
                  </tr>
                )),
              ])}</tbody>
            </table></div>
          )}
        </div>
      )}

      <div className="card">
        <div className="font-extrabold mb-1">Phiếu xuất bán (thông tin in trên phiếu)</div>
        <p className="text-xs text-[#5A6572] mb-3">Nội dung hiển thị trên phiếu xuất khi bấm 🖨 In ở trang Xuất bán: phần đầu phiếu (tên đơn vị, địa chỉ, điện thoại) và lời cảm ơn chân trang.</p>
        {pf === null ? (
          <div className="text-sm">
            <b>{settings.cty_ten || "HỆ THỐNG XE ĐIỆN MINH KỲ"}</b>
            <div className="text-xs text-[#5A6572]">{settings.cty_diachi || "(chưa có địa chỉ)"} · {settings.cty_sdt || "(chưa có SĐT)"}</div>
            <div className="text-xs text-[#8A93A0] italic mt-1">"{settings.phieu_footer || "Cảm ơn Quý khách đã tin tưởng Minh Kỳ EV. Kính chúc Quý khách thượng lộ bình an!"}"</div>
            <button className="btn-ghost !text-xs mt-2" onClick={() => setPf({ ten: settings.cty_ten || "HỆ THỐNG XE ĐIỆN MINH KỲ", dc: settings.cty_diachi || "", sdt: settings.cty_sdt || "", ft: settings.phieu_footer || "Cảm ơn Quý khách đã tin tưởng Minh Kỳ EV. Kính chúc Quý khách thượng lộ bình an!" })}>✎ Sửa</button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-w-xl">
            <div><label className="lbl">Tên đơn vị (in đậm đầu phiếu)</label><input className="inp" value={pf.ten} onChange={(e) => setPf((p) => ({ ...p, ten: e.target.value }))} /></div>
            <div><label className="lbl">Địa chỉ</label><input className="inp" value={pf.dc} onChange={(e) => setPf((p) => ({ ...p, dc: e.target.value }))} /></div>
            <div><label className="lbl">Số điện thoại</label><input className="inp" value={pf.sdt} onChange={(e) => setPf((p) => ({ ...p, sdt: e.target.value }))} /></div>
            <div><label className="lbl">Lời cảm ơn chân trang</label><input className="inp" value={pf.ft} onChange={(e) => setPf((p) => ({ ...p, ft: e.target.value }))} /></div>
            <div className="flex gap-2">
              <button className="btn-ok !text-xs" onClick={savePf}>Lưu</button>
              <button className="btn-ghost !text-xs" onClick={() => setPf(null)}>Hủy</button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="font-extrabold mb-1">Bán kèm (dùng trong đơn bán)</div>
        <p className="text-xs text-[#5A6572] mb-3">Danh mục phụ kiện và bảo hiểm theo định dạng mỗi dòng: <b>Tên|Giá</b> (VD: Mũ bảo hiểm|150000).</p>
        {bk === null ? (
          <div className="flex gap-2 items-center flex-wrap">
            <div className="text-xs"><b>Phụ kiện:</b> {(settings.phu_kien || "").split(/\n+/).filter(Boolean).length} mục · <b>Bảo hiểm:</b> {(settings.bao_hiem || "").split(/\n+/).filter(Boolean).length} mục · <b>Giá DV đăng ký:</b> {Number(settings.gia_dang_ky || 350000).toLocaleString("vi-VN")} đ</div>
            <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setBk({ pk: settings.phu_kien || "", bh: settings.bao_hiem || "", dk: settings.gia_dang_ky || "350000" })}>✎ Sửa</button>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 max-w-2xl">
            <div><label className="lbl">Phụ kiện (Tên|Giá)</label><textarea className="inp !h-32 !text-xs font-mono" value={bk.pk} onChange={(e) => setBk((p) => ({ ...p, pk: e.target.value }))} /></div>
            <div><label className="lbl">Bảo hiểm (Tên|Giá)</label><textarea className="inp !h-32 !text-xs font-mono" value={bk.bh} onChange={(e) => setBk((p) => ({ ...p, bh: e.target.value }))} /></div>
            <div><label className="lbl">Giá DV đăng ký mặc định (đ)</label><input type="number" className="inp" value={bk.dk} onChange={(e) => setBk((p) => ({ ...p, dk: e.target.value }))} /></div>
            <div className="flex gap-2"><button className="btn-ok !py-2 !text-xs" onClick={saveBk}>Lưu</button><button className="btn-ghost !py-2 !text-xs" onClick={() => setBk(null)}>Hủy</button></div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="font-extrabold mb-1">Khu vực (dùng khi thêm/sửa kho và trong báo cáo)</div>
        <p className="text-xs text-[#5A6572] mb-3">Mỗi dòng 1 khu vực. Đổi tên danh sách này không tự đổi khu vực của kho cũ — vào Kho / Cửa hàng → Sửa để gán lại từng kho.</p>
        {reg === null ? (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-1.5 flex-wrap">{regions.map((x) => <Badge key={x} tone="green">{x}</Badge>)}</div>
            <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setReg(regions.join("\n"))}>✎ Sửa danh sách</button>
          </div>
        ) : (
          <div className="max-w-sm">
            <textarea className="inp !h-24" value={reg} onChange={(e) => setReg(e.target.value)} />
            <div className="flex gap-2 mt-2">
              <button className="btn-ok !py-2 !text-xs" onClick={saveRegions}>Lưu</button>
              <button className="btn-ghost !py-2 !text-xs" onClick={() => setReg(null)}>Hủy</button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="font-extrabold mb-1">Tỉnh/Thành phố & Phường/Xã (dùng khi xuất hóa đơn)</div>
        <p className="text-xs text-[#5A6572] mb-3">Mỗi dòng 1 Tỉnh/Thành phố, theo định dạng <b>Tên tỉnh/TP | Phường 1, Phường 2, …</b>. Danh sách này hiện trong ô chọn "Tỉnh/Thành phố" và "Phường/Xã" ở bước xuất hóa đơn khi tạo đơn bán.</p>
        {db === null ? (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-xs">
              {Object.keys(diaBan).length === 0 ? "Chưa cấu hình." : <><b>{Object.keys(diaBan).length}</b> Tỉnh/Thành phố đã cấu hình</>}
            </div>
            <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setDb(settings.dia_ban || "")}>✎ Sửa danh sách</button>
          </div>
        ) : (
          <div className="max-w-2xl">
            <textarea className="inp !h-40 !text-xs font-mono" value={db} onChange={(e) => setDb(e.target.value)} placeholder={"Hà Nội | Phường Ba Đình, Phường Hoàn Kiếm\nTP. Hồ Chí Minh | Phường Bến Nghé, Phường Bến Thành"} />
            <div className="flex gap-2 mt-2">
              <button className="btn-ok !py-2 !text-xs" onClick={saveDiaBan}>Lưu</button>
              <button className="btn-ghost !py-2 !text-xs" onClick={() => setDb(null)}>Hủy</button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex items-center mb-1">
          <div className="font-extrabold mr-auto">Trường tùy chỉnh trên đơn bán ({customFields.length})</div>
          <button className="btn-primary !py-2 !text-xs" onClick={() => { setEditField(null); setF(empty); setShow(!show); }}>+ Thêm trường mới</button>
        </div>
        <p className="text-xs text-[#5A6572] mb-3">Trường thêm ở đây sẽ xuất hiện ngay trong form "Tạo đơn bán" và lưu kèm từng đơn.</p>

        {show && (
          <div className="bg-[#F8FAFC] rounded-xl p-4 mb-4">
            <div className="grid gap-x-4 md:grid-cols-3 sm:grid-cols-2">
              <Field label="Tên trường" required><input className="inp" value={f.label} onChange={(e) => set("label", e.target.value)} placeholder='VD: Tặng mũ bảo hiểm' /></Field>
              <Field label="Kiểu dữ liệu" required>
                <select className="inp" value={f.field_type} onChange={(e) => set("field_type", e.target.value)}>
                  {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Bắt buộc nhập?">
                <label className="flex items-center gap-2 text-sm py-2"><input type="checkbox" checked={f.required} onChange={(e) => set("required", e.target.checked)} /> Bắt buộc</label>
              </Field>
              {f.field_type === "dropdown" && (
                <Field label="Các lựa chọn (mỗi dòng 1 lựa chọn)" required>
                  <textarea className="inp !h-20" value={f.optionsText} onChange={(e) => set("optionsText", e.target.value)} placeholder={"Có\nKhông"} />
                </Field>
              )}
              {f.field_type === "formula" && (
                <>
                  <Field label="Công thức: Giá bán thực tế…">
                    <select className="inp" value={f.op} onChange={(e) => set("op", e.target.value)}>
                      <option value="divide">chia (÷)</option><option value="multiply">nhân (×)</option>
                      <option value="add">cộng (+)</option><option value="subtract">trừ (−)</option>
                    </select>
                  </Field>
                  <Field label="…cho giá trị" hint='Chọn "(1 + Thuế suất)" cho giá trước thuế, hoặc nhập số bất kỳ.'>
                    <select className="inp" value={f.operand === "TAX" ? "TAX" : "NUM"} onChange={(e) => set("operand", e.target.value === "TAX" ? "TAX" : "")}>
                      <option value="TAX">(1 + Thuế suất) — hiện là {(1 + taxRate).toFixed(2)}</option>
                      <option value="NUM">Số tự nhập…</option>
                    </select>
                    {f.operand !== "TAX" && <input type="number" className="inp mt-1.5" value={f.operand} onChange={(e) => set("operand", e.target.value)} placeholder="VD: 1.1" />}
                  </Field>
                </>
              )}
            </div>
            <button className="btn-ok" onClick={saveField}>{editField ? "Lưu thay đổi" : "Lưu trường mới"}</button>
            {editField && <button className="btn-ghost ml-2" onClick={() => { setEditField(null); setF(empty); setShow(false); }}>Hủy sửa</button>}
          </div>
        )}

        <div className="overflow-x-auto"><table className="w-full border-collapse">
          <thead><tr><th className="th">Tên trường</th><th className="th">Kiểu</th><th className="th">Chi tiết</th><th className="th">Bắt buộc</th><th className="th"></th></tr></thead>
          <tbody>{customFields.map((c) => (
            <tr key={c.id}>
              <td className="td font-bold">{c.label}</td>
              <td className="td"><Badge tone="blue">{TYPE_LABELS[c.field_type]}</Badge></td>
              <td className="td text-xs">
                {c.field_type === "dropdown" && (c.options || []).join(" / ")}
                {c.field_type === "formula" && c.formula && `Giá bán ${opText[c.formula.op] || "?"} ${c.formula.operand === "TAX" ? "(1 + thuế)" : c.formula.operand}`}
              </td>
              <td className="td">{c.required ? "Có" : "—"}</td>
              <td className="td"><div className="flex gap-1.5">
                <button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => startEditField(c)}>✎ Sửa</button>
                <button className="btn-danger !px-2.5 !py-1 !text-xs" onClick={() => remove(c)}>Ẩn</button>
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  );
}
