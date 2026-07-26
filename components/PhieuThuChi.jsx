"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, Field, LocSearch, MoneyInput, Pager, pageSlice, pageClamp, useSortable, Th, useSelection, ThCheck, TdCheck, SelectionBar } from "@/components/ui";
import { fmtVND, fmtTime, fmtDate, errMsg, downloadCSV } from "@/lib/format";

const iso = (d) => d.toLocaleDateString("sv-SE");
const firstOfMonth = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };

// dir = "Thu" | "Chi"
export default function PhieuThuChi({ dir }) {
  const isThu = dir === "Thu";
  const { supabase, locations, settings, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [perms, setPerms] = useState({});
  const [accs, setAccs] = useState([]);
  const [txns, setTxns] = useState([]);
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(iso(new Date()));
  const [fAcc, setFAcc] = useState("");
  const [fCat, setFCat] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const sort = useSortable();
  const sel = useSelection();
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState(null);
  const [f, setF] = useState({ account_id: "", amount: "", category: "", counterparty: "", description: "", txn_date: iso(new Date()) });

  const can = (p) => profile?.role === "CEO" || !!perms[p];
  const allCats = (settings?.thu_chi_categories || "Bán xe\nThu dịch vụ\nThu tiền cọc\nThu công nợ bán xe\nThu khác\nLương\nThuê mặt bằng\nĐiện nước\nNhập hàng\nChi khác")
    .split(/\n+/).map((x) => x.trim()).filter(Boolean);
  // Goi y danh muc theo loai phieu
  const cats = isThu ? allCats.filter((c) => /thu|bán|cọc|công nợ/i.test(c)) : allCats.filter((c) => !/thu|bán|cọc|công nợ/i.test(c));

  const load = async () => {
    if (!profile) return;
    setBusy(true);
    let qy = supabase.from("cash_txns").select("*").eq("direction", dir)
      .gte("txn_date", from).lte("txn_date", to)
      .order("txn_date", { ascending: false }).order("id", { ascending: false }).limit(3000);
    if (fAcc) qy = qy.eq("account_id", fAcc);
    const [{ data: a }, { data: t }, { data: pm }] = await Promise.all([
      supabase.from("v_quy_so_du").select("*").order("type").order("name"),
      qy,
      supabase.from("role_perms").select("perm,allowed").eq("role", profile.role),
    ]);
    setAccs(a || []); setTxns(t || []);
    const m = {}; (pm || []).forEach((x) => { m[x.perm] = x.allowed; }); setPerms(m);
    setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading, profile, from, to, fAcc]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  if (!can("thu_chi_xem")) return <div className="card">Bạn không có quyền xem sổ quỹ.</div>;

  const accName = (id) => accs.find((a) => a.id === id)?.name || id;
  const locName = (c) => locations.find((l) => l.code === c)?.name || c;

  const kw = q.trim().toLowerCase();
  const rows = txns.filter((t) => {
    if (fCat && t.category !== fCat) return false;
    if (!kw) return true;
    return `${t.code} ${t.category} ${t.counterparty} ${t.description} ${t.ref_doc}`.toLowerCase().includes(kw);
  });
  const sorted = sort.sortFn(rows, {
    code: (t) => t.code, date: (t) => t.txn_date, acc: (t) => accName(t.account_id),
    cat: (t) => t.category, ct: (t) => t.counterparty, tien: (t) => t.amount, ref: (t) => t.ref_doc,
  });
  const tong = rows.reduce((a, b) => a + b.amount, 0);
  const tuDong = rows.filter((t) => t.ref_doc).length;

  const ghi = async () => {
    if (!f.account_id) return notify("Chọn quỹ.", "err");
    if (!(Number(f.amount) > 0)) return notify("Nhập số tiền.", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_ghi_thu_chi", { p: { ...f, direction: dir, amount: Number(f.amount) } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã tạo phiếu ${isThu ? "thu" : "chi"} ${data}.`);
    setF({ account_id: "", amount: "", category: "", counterparty: "", description: "", txn_date: iso(new Date()) });
    setShowForm(false); load();
  };

  const exportCSV = () => {
    downloadCSV(`phieu_${isThu ? "thu" : "chi"}_${from}_den_${to}.csv`,
      [["Mã phiếu", "Ngày", "Quỹ", "Danh mục", "Số tiền", "Đối tượng", "Diễn giải", "Chứng từ gốc", "Người tạo"],
       ...sorted.map((t) => [t.code, fmtTime(t.created_at), accName(t.account_id), t.category, t.amount, t.counterparty, t.description, t.ref_doc, t.created_by_name])]);
    notify(`Đã xuất ${sorted.length} phiếu.`);
  };

  // ===== THAO TÁC HÀNG LOẠT trên phiếu đã chọn =====
  const chon = () => sorted.filter((t) => sel.has(t.id));
  const tongChon = chon().reduce((a, b) => a + b.amount, 0);
  const exportChon = () => {
    const rs = chon();
    downloadCSV(`phieu_${isThu ? "thu" : "chi"}_chon_${sorted.length ? iso(new Date()) : ""}.csv`,
      [["Mã phiếu", "Ngày", "Quỹ", "Danh mục", "Số tiền", "Đối tượng", "Diễn giải", "Chứng từ gốc", "Người tạo"],
       ...rs.map((t) => [t.code, fmtTime(t.created_at), accName(t.account_id), t.category, t.amount, t.counterparty, t.description, t.ref_doc, t.created_by_name])]);
    notify(`Đã xuất ${rs.length} phiếu đã chọn.`);
  };
  const huyChon = async () => {
    const rs = chon();
    const tuDong = rs.filter((t) => t.ref_doc);
    if (tuDong.length) return notify(`Có ${tuDong.length} phiếu tự động (từ đơn/DV) — không hủy trực tiếp được. Bỏ chọn các phiếu này rồi thử lại.`, "err");
    if (!confirm(`Hủy ${rs.length} ${tenPhieu.toLowerCase()} thủ công đã chọn? Số dư quỹ sẽ điều chỉnh tương ứng.`)) return;
    setBusy(true);
    let ok = 0, fail = 0;
    for (const t of rs) {
      const { error } = await supabase.rpc("fn_huy_phieu_thu_chi", { p_id: t.id });
      if (error) fail++; else ok++;
    }
    setBusy(false);
    sel.clear();
    notify(fail ? `Đã hủy ${ok} phiếu, ${fail} phiếu lỗi.` : `Đã hủy ${ok} phiếu.`, fail ? "err" : "ok");
    load();
  };

  const tone = isThu ? "green" : "amber";
  const tenPhieu = isThu ? "Phiếu thu" : "Phiếu chi";
  const nhomNhan = isThu ? "người nộp" : "người nhận";

  // ===== CHI TIẾT PHIẾU =====
  if (detail) {
    const t = detail;
    const row = (label, val, link) => (
      <div className="flex gap-2 text-[13px] py-1">
        <span className="text-[#8A93A0] w-32 shrink-0">{label}</span>
        <span className={`font-semibold ${link ? "text-brand" : ""}`}>{val}</span>
      </div>
    );
    return (
      <div className="flex flex-col gap-4 pb-8">
        <Toast toast={toast} />
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-ghost !text-xs" onClick={() => setDetail(null)}>← Quay lại danh sách {tenPhieu.toLowerCase()}</button>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xl font-extrabold">{t.code}</div>
          <Badge tone="green">Hoàn thành</Badge>
          {t.ref_doc && <Badge tone="blue">Tự động</Badge>}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <div className="card">
              <div className="font-extrabold mb-3">Thông tin chung</div>
              <div className="grid md:grid-cols-2 gap-x-6">
                {row(`Nhóm ${nhomNhan}`, t.counterparty ? "Khách/Đối tượng" : "—")}
                {row(`Tên ${nhomNhan}`, t.counterparty || "—", true)}
                {row(`Loại ${tenPhieu.toLowerCase()}`, t.ref_doc ? "Tự động" : (t.category || "Thủ công"))}
                {row("Mã phiếu", t.code)}
              </div>
            </div>
            <div className="card">
              <div className="font-extrabold mb-3">Giá trị ghi nhận</div>
              <div className="grid md:grid-cols-2 gap-x-6">
                {row("Giá trị", <span className={`text-lg font-extrabold ${isThu ? "text-[#0E7A4A]" : "text-danger"}`}>{fmtVND(t.amount)}</span>)}
                {row("Hình thức thanh toán", accs.find((a) => a.id === t.account_id)?.type || "—")}
                {row("Quỹ", accName(t.account_id))}
                {row("Danh mục", t.category || "—")}
              </div>
              {t.ref_doc && (
                <div className="mt-3 text-[13px] text-[#5A6572]">
                  Phiếu được tạo tự động. Chứng từ gốc: <b className="text-brand">{t.ref_doc}</b>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="card">
              <div className="font-extrabold mb-3">Thông tin bổ sung</div>
              <div className="flex flex-col gap-1 text-[13px]">
                <div className="flex gap-2"><span className="text-[#8A93A0] w-28 shrink-0">Chi nhánh</span><span>{accs.find((a) => a.id === t.account_id)?.location_code ? locName(accs.find((a) => a.id === t.account_id).location_code) : "Mặc định"}</span></div>
                <div className="flex gap-2"><span className="text-[#8A93A0] w-28 shrink-0">Người tạo</span><span>{t.created_by_name}</span></div>
                <div className="flex gap-2"><span className="text-[#8A93A0] w-28 shrink-0">Ngày tạo</span><span>{fmtTime(t.created_at)}</span></div>
                <div className="flex gap-2"><span className="text-[#8A93A0] w-28 shrink-0">Ngày ghi nhận</span><span>{fmtDate(t.txn_date)}</span></div>
              </div>
            </div>
            <div className="card">
              <div className="font-extrabold mb-2">Mô tả</div>
              <div className="text-[13px] text-[#3B4552]">{t.description || (t.ref_doc ? `${tenPhieu} tự động tạo khi ${isThu ? "khách thanh toán cho đơn hàng" : "phát sinh chi phí"}` : "—")}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===== FORM TẠO PHIẾU =====
  if (showForm) {
    return (
      <div className="flex flex-col gap-4 pb-8">
        <Toast toast={toast} />
        <div className="flex items-center gap-2">
          <button className="btn-ghost !text-xs" onClick={() => setShowForm(false)}>← Danh sách {tenPhieu.toLowerCase()}</button>
          <div className="font-extrabold text-lg mr-auto">Tạo {tenPhieu.toLowerCase()} mới</div>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card lg:col-span-2">
            <div className="font-extrabold mb-3">Thông tin chung</div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Quỹ nhận/chi tiền" required>
                <select className="inp" value={f.account_id} onChange={(e) => setF((p) => ({ ...p, account_id: e.target.value }))}>
                  <option value="">— Chọn quỹ —</option>
                  {accs.filter((a) => a.status === "Hoạt động").map((a) => <option key={a.id} value={a.id}>{a.name} ({fmtVND(a.so_du)})</option>)}
                </select>
              </Field>
              <Field label={`Loại ${tenPhieu.toLowerCase()}`}>
                <select className="inp" value={f.category} onChange={(e) => setF((p) => ({ ...p, category: e.target.value }))}>
                  <option value="">— Chọn danh mục —</option>
                  {cats.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <div className="md:col-span-2">
                <Field label={`Tên ${nhomNhan}`}>
                  <input className="inp" value={f.counterparty} onChange={(e) => setF((p) => ({ ...p, counterparty: e.target.value }))} placeholder="Khách / NCC / nhân viên" />
                </Field>
              </div>
            </div>

            <div className="font-extrabold mt-4 mb-3">Giá trị ghi nhận</div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Giá trị" required><MoneyInput value={f.amount} onChange={(v) => setF((p) => ({ ...p, amount: v }))} /></Field>
              <Field label="Ngày ghi nhận"><input type="date" className="inp" value={f.txn_date} onChange={(e) => setF((p) => ({ ...p, txn_date: e.target.value }))} /></Field>
              <div className="md:col-span-2">
                <Field label="Diễn giải / tham chiếu">
                  <input className="inp" value={f.description} onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} placeholder="Nội dung phiếu" />
                </Field>
              </div>
            </div>
          </div>

          <div className="card h-fit">
            <div className="font-extrabold mb-3">Tổng kết</div>
            <div className="rounded-xl border border-[#E3E8EF] overflow-hidden">
              <div className="flex justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF] text-[13px]"><span className="text-[#5A6572]">Loại phiếu</span><Badge tone={tone}>{tenPhieu}</Badge></div>
              <div className="flex justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF] text-[13px]"><span className="text-[#5A6572]">Quỹ</span><b>{f.account_id ? accName(Number(f.account_id)) : "—"}</b></div>
              <div className={`flex justify-between px-3 py-2.5 ${isThu ? "bg-[#E7F6EE]" : "bg-[#FFF6E5]"}`}>
                <span className="font-bold text-[13.5px]">Số tiền</span>
                <span className={`text-[18px] font-extrabold ${isThu ? "text-[#0E7A4A]" : "text-[#A25F00]"}`}>{fmtVND(Number(f.amount) || 0)}</span>
              </div>
            </div>
            <button className="btn-ok w-full mt-3" disabled={busy} onClick={ghi}>{busy ? "Đang lưu…" : `Lưu ${tenPhieu.toLowerCase()}`}</button>
            <p className="text-[11px] text-[#8A93A0] mt-2">Phiếu từ bán xe, dịch vụ, cọc, hoàn hủy đơn đã tự động vào quỹ — chỉ tạo tay các khoản khác.</p>
          </div>
        </div>
      </div>
    );
  }

  // ===== DANH SÁCH =====
  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">{tenPhieu}</div>
        <button className="btn-ghost !text-xs" onClick={exportCSV}>⬇ Xuất file</button>
        {can("thu_chi_ghi") && <button className="btn-primary !text-xs" onClick={() => setShowForm(true)}>+ Tạo {tenPhieu.toLowerCase()}</button>}
      </div>

      <div className="flex gap-3 flex-wrap">
        <KPI label={`Tổng ${isThu ? "thu" : "chi"} trong kỳ`} value={fmtVND(tong)} tone={tone} />
        <KPI label="Số phiếu" value={sorted.length} tone="dark" />
        <KPI label="Tự động (từ đơn/DV)" value={tuDong} tone="blue" />
      </div>

      <div className="card">
        <div className="flex gap-2 items-center mb-3 flex-wrap">
          <div className="font-extrabold mr-auto">Danh sách {tenPhieu.toLowerCase()} ({sorted.length})</div>
          <input type="date" className="inp !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" className="inp !w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
          <select className="inp !w-auto" value={fAcc} onChange={(e) => setFAcc(e.target.value)}>
            <option value="">Quỹ: tất cả</option>
            {accs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className="inp !w-auto" value={fCat} onChange={(e) => { setFCat(e.target.value); setPage(1); }}>
            <option value="">Danh mục: tất cả</option>
            {[...new Set(txns.map((t) => t.category))].filter(Boolean).map((c) => <option key={c}>{c}</option>)}
          </select>
          <input className="inp !w-56" placeholder="Tìm mã phiếu, chứng từ gốc, đối tượng…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>

        {busy && txns.length === 0 ? <div className="text-sm text-[#8A93A0] py-4">Đang tải…</div> : (
          <>
            <SelectionBar sel={sel}>
              <button className="btn-ghost !text-xs !py-1" onClick={exportChon}>⬇ Xuất Excel</button>
              <span className="text-[12px] font-bold text-brand px-1.5 self-center">Tổng: {fmtVND(tongChon)}</span>
              {can("thu_chi_chot") && <button className="btn-ghost !text-xs !py-1 !text-danger" onClick={huyChon}>✕ Hủy phiếu</button>}
            </SelectionBar>
            <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
              <thead><tr>
                <ThCheck sel={sel} rows={pageSlice(sorted, page, pageSize)} idOf={(t) => t.id} />
                <Th label="Ngày tạo" k="date" sort={sort} />
                <Th label="Mã phiếu" k="code" sort={sort} />
                <Th label="Danh mục" k="cat" sort={sort} />
                <Th label={`Tên ${nhomNhan}`} k="ct" sort={sort} />
                <Th label={`Số tiền ${isThu ? "thu" : "chi"}`} k="tien" sort={sort} className="text-right" />
                <Th label="Quỹ" k="acc" sort={sort} />
                <Th label="Chứng từ gốc" k="ref" sort={sort} />
              </tr></thead>
              <tbody>{pageSlice(sorted, page, pageSize).map((t) => (
                <tr key={t.id} className={`hover:bg-[#F8FAFC] ${sel.has(t.id) ? "bg-[#EAF2FF]" : ""}`}>
                  <TdCheck sel={sel} id={t.id} />
                  <td data-label="Ngày tạo" className="td text-xs whitespace-nowrap">{fmtTime(t.created_at)}</td>
                  <td data-label="Mã phiếu" className="td"><button className="font-bold text-brand hover:underline" onClick={() => setDetail(t)}>{t.code}</button></td>
                  <td data-label="Danh mục" className="td text-[13px]">{t.ref_doc ? <Badge tone="blue">Tự động</Badge> : null} {t.category}</td>
                  <td data-label={`Tên ${nhomNhan}`} className="td text-[13px]">{t.counterparty || <span className="text-[#8A93A0]">—</span>}</td>
                  <td data-label="Số tiền" className="td rt font-bold"><span className={isThu ? "text-[#0E7A4A]" : "text-danger"}>{fmtVND(t.amount)}</span></td>
                  <td data-label="Quỹ" className="td text-xs">{accName(t.account_id)}</td>
                  <td data-label="Chứng từ gốc" className="td text-xs text-brand">{t.ref_doc || "—"}</td>
                </tr>
              ))}
              {sorted.length === 0 && <tr><td className="td" colSpan={8}>Không có {tenPhieu.toLowerCase()} nào trong khoảng ngày này.</td></tr>}
              </tbody>
            </table></div>
            <Pager total={sorted.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
          </>
        )}
      </div>
    </div>
  );
}
