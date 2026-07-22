"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, Field, LocSearch, Pager, pageSlice } from "@/components/ui";
import { fmtVND, fmtDate, errMsg, downloadCSV } from "@/lib/format";

const iso = (d) => d.toLocaleDateString("sv-SE");
const firstOfMonth = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };

export default function ThuChi() {
  const { supabase, locations, settings, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [tab, setTab] = useState("so");
  const [perms, setPerms] = useState({});
  const [accs, setAccs] = useState([]);
  const [txns, setTxns] = useState([]);
  const [closings, setClosings] = useState([]);
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(iso(new Date()));
  const [fAcc, setFAcc] = useState("");
  const [fDir, setFDir] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ direction: "Thu", account_id: "", amount: "", category: "", counterparty: "", description: "", txn_date: iso(new Date()) });
  const [af, setAf] = useState({ id: null, name: "", type: "Tiền mặt", location_code: "", bank_info: "", opening_balance: 0 });
  const [showAcc, setShowAcc] = useState(false);

  const can = (p) => profile?.role === "CEO" || !!perms[p];
  const cats = (settings?.thu_chi_categories || "Bán xe\nThu dịch vụ\nThu tiền cọc\nThu công nợ bán xe\nThu khác\nLương\nThuê mặt bằng\nĐiện nước\nNhập hàng\nChi khác").split(/\n+/).map((x) => x.trim()).filter(Boolean);

  const load = async () => {
    if (!profile) return;
    setBusy(true);
    let qy = supabase.from("cash_txns").select("*").gte("txn_date", from).lte("txn_date", to).order("txn_date", { ascending: false }).order("id", { ascending: false }).limit(2000);
    if (fAcc) qy = qy.eq("account_id", fAcc);
    const [{ data: a }, { data: t }, { data: c }, { data: pm }] = await Promise.all([
      supabase.from("v_quy_so_du").select("*").order("type").order("name"),
      qy,
      supabase.from("cash_closings").select("*").order("close_date", { ascending: false }).limit(60),
      supabase.from("role_perms").select("perm,allowed").eq("role", profile.role),
    ]);
    setAccs(a || []); setTxns(t || []); setClosings(c || []);
    const m = {}; (pm || []).forEach((x) => { m[x.perm] = x.allowed; }); setPerms(m);
    setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading, profile, from, to, fAcc]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  if (!can("thu_chi_xem")) return <div className="card">Bạn không có quyền xem sổ thu chi.</div>;

  const accName = (id) => accs.find((a) => a.id === id)?.name || id;
  const locName = (c) => locations.find((l) => l.code === c)?.name || c;

  const ghi = async () => {
    if (!f.account_id) return notify("Chọn quỹ.", "err");
    if (!(Number(f.amount) > 0)) return notify("Nhập số tiền.", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_ghi_thu_chi", { p: { ...f, amount: Number(f.amount) } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã ghi ${f.direction.toLowerCase()} — phiếu ${data}.`);
    setF((p) => ({ ...p, amount: "", counterparty: "", description: "" })); load();
  };

  const luuQuy = async () => {
    if (!af.name.trim()) return notify("Nhập tên quỹ.", "err");
    const { error } = await supabase.rpc("fn_them_quy", { p: af });
    if (error) return notify(errMsg(error), "err");
    notify("Đã lưu quỹ."); setAf({ id: null, name: "", type: "Tiền mặt", location_code: "", bank_info: "", opening_balance: 0 }); setShowAcc(false); load();
  };

  const chotQuy = async (acc) => {
    const a = prompt(`Chốt quỹ "${acc.name}" ngày hôm nay.\nSố dư hệ thống: ${fmtVND(acc.so_du)}\n\nNhập số dư THỰC TẾ đếm được:`);
    if (a === null) return;
    const n = prompt("Ghi chú (nếu lệch, ghi rõ nguyên nhân):") || "";
    const { error } = await supabase.rpc("fn_chot_quy", { p: { account_id: acc.id, actual_balance: Number(a) || 0, note: n } });
    if (error) return notify(errMsg(error), "err");
    const lech = (Number(a) || 0) - acc.so_du;
    notify(lech === 0 ? "Đã chốt quỹ — khớp số dư." : `Đã chốt quỹ — LỆCH ${fmtVND(lech)}.`, lech === 0 ? "ok" : "err");
    load();
  };

  const baoCaoDiscord = async () => {
    const { error } = await supabase.rpc("fn_bao_cao_quy_now");
    if (error) return notify(errMsg(error), "err");
    notify("Đã gửi báo cáo số dư quỹ về Discord.");
  };

  const kw = q.trim().toLowerCase();
  const rows = txns.filter((t) => {
    if (fDir && t.direction !== fDir) return false;
    if (!kw) return true;
    return `${t.code} ${t.category} ${t.counterparty} ${t.description} ${t.ref_doc}`.toLowerCase().includes(kw);
  });
  const tongThu = rows.filter((t) => t.direction === "Thu").reduce((a, b) => a + b.amount, 0);
  const tongChi = rows.filter((t) => t.direction === "Chi").reduce((a, b) => a + b.amount, 0);
  const tongQuy = accs.filter((a) => a.status === "Hoạt động").reduce((a, b) => a + Number(b.so_du), 0);

  const exportCSV = () => {
    downloadCSV(`thu_chi_${from}_den_${to}.csv`,
      [["Mã phiếu", "Ngày", "Quỹ", "Loại", "Số tiền", "Danh mục", "Đối tượng", "Diễn giải", "Chứng từ gốc", "Người ghi"],
       ...rows.map((t) => [t.code, t.txn_date, accName(t.account_id), t.direction, t.amount, t.category, t.counterparty, t.description, t.ref_doc, t.created_by_name])]);
    notify(`Đã xuất ${rows.length} phiếu.`);
  };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Thu chi & Quỹ</div>
        <button className="btn-ghost !text-xs" onClick={baoCaoDiscord}>📤 Gửi số dư về Discord</button>
        {can("thu_chi_chot") && <button className="btn-ghost !text-xs" onClick={() => setShowAcc(!showAcc)}>{showAcc ? "Đóng" : "+ Quỹ mới"}</button>}
      </div>

      <div className="flex gap-3 flex-wrap">
        <KPI label="Tổng quỹ hiện có" value={fmtVND(tongQuy)} tone="blue" />
        <KPI label="Thu trong kỳ" value={fmtVND(tongThu)} tone="green" />
        <KPI label="Chi trong kỳ" value={fmtVND(tongChi)} tone="amber" />
        <KPI label="Chênh lệch kỳ" value={fmtVND(tongThu - tongChi)} tone={tongThu - tongChi >= 0 ? "green" : "red"} />
      </div>

      {showAcc && (
        <div className="card !p-4 border-2 border-brand">
          <div className="font-extrabold mb-3">{af.id ? "Sửa quỹ" : "Tạo quỹ mới"}</div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Tên quỹ" required><input className="inp" value={af.name} onChange={(e) => setAf((p) => ({ ...p, name: e.target.value }))} placeholder="VD: Tiền mặt Km40" /></Field>
            <Field label="Loại"><select className="inp" value={af.type} onChange={(e) => setAf((p) => ({ ...p, type: e.target.value }))}><option>Tiền mặt</option><option>Ngân hàng</option></select></Field>
            <Field label="Gắn với điểm"><LocSearch locations={locations} value={af.location_code} onChange={(v) => setAf((p) => ({ ...p, location_code: v }))} placeholder="Không bắt buộc" /></Field>
            <Field label="Thông tin ngân hàng"><input className="inp" value={af.bank_info} onChange={(e) => setAf((p) => ({ ...p, bank_info: e.target.value }))} /></Field>
            <Field label="Số dư đầu kỳ"><input type="number" className="inp" value={af.opening_balance} onChange={(e) => setAf((p) => ({ ...p, opening_balance: +e.target.value || 0 }))} /></Field>
          </div>
          <div className="flex gap-2 mt-3"><button className="btn-ok" onClick={luuQuy}>Lưu quỹ</button><button className="btn-ghost" onClick={() => setShowAcc(false)}>Hủy</button></div>
        </div>
      )}

      <div className="card">
        <div className="font-extrabold mb-2">Số dư từng quỹ ({accs.length})</div>
        {accs.length === 0 ? (
          <div className="text-sm text-[#8A93A0]">Chưa có quỹ nào. {can("thu_chi_chot") ? 'Bấm "+ Quỹ mới" để tạo — cần ít nhất 1 quỹ tiền mặt và 1 quỹ ngân hàng để hệ thống tự ghi phiếu thu.' : "Nhờ Admin/BGĐ tạo quỹ."}</div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {accs.map((a) => (
              <div key={a.id} className={`p-3 rounded-xl border ${a.status === "Hoạt động" ? "border-[#E3E8EF]" : "border-[#EEE] bg-[#FAFAFA]"}`}>
                <div className="flex items-center gap-2">
                  <div className="mr-auto">
                    <div className="font-bold text-sm">{a.name}</div>
                    <div className="text-[11px] text-[#8A93A0]">{a.type}{a.location_code ? " · " + locName(a.location_code) : ""}</div>
                  </div>
                  <Badge tone={a.type === "Tiền mặt" ? "amber" : "blue"}>{a.type}</Badge>
                </div>
                <div className="text-xl font-extrabold mt-1 text-brand">{fmtVND(a.so_du)}</div>
                <div className="flex gap-1.5 mt-2">
                  {can("thu_chi_chot") && <button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => chotQuy(a)}>Chốt quỹ</button>}
                  {can("thu_chi_chot") && <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => { setAf({ id: a.id, name: a.name, type: a.type, location_code: a.location_code || "", bank_info: a.bank_info || "", opening_balance: a.opening_balance }); setShowAcc(true); }}>✎</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-1.5">
        {[["so", "Sổ thu chi"], ["ghi", "Ghi phiếu"], ["chot", "Lịch sử chốt quỹ"]].map(([k, v]) => (
          <button key={k} className={`btn !px-3 !py-2 !text-xs ${tab === k ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => { setTab(k); setPage(1); }}>{v}</button>
        ))}
      </div>

      {tab === "ghi" && (
        <div className="card">
          <div className="font-extrabold mb-3">Ghi phiếu thu / chi thủ công</div>
          {!can("thu_chi_ghi") ? <div className="text-sm text-[#8A93A0]">Bạn không có quyền ghi thu chi.</div> : (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Loại phiếu">
                  <div className="flex gap-1.5">
                    {["Thu", "Chi"].map((d) => (
                      <button key={d} className={`btn !px-4 !py-2 !text-xs ${f.direction === d ? (d === "Thu" ? "btn-ok" : "bg-danger text-white") : "bg-[#EEF1F4]"}`} onClick={() => setF((p) => ({ ...p, direction: d }))}>{d}</button>
                    ))}
                  </div>
                </Field>
                <Field label="Quỹ" required>
                  <select className="inp" value={f.account_id} onChange={(e) => setF((p) => ({ ...p, account_id: e.target.value }))}>
                    <option value="">— Chọn quỹ —</option>
                    {accs.filter((a) => a.status === "Hoạt động").map((a) => <option key={a.id} value={a.id}>{a.name} ({fmtVND(a.so_du)})</option>)}
                  </select>
                </Field>
                <Field label="Số tiền" required><input type="number" className="inp" value={f.amount} onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))} /></Field>
                <Field label="Danh mục">
                  <select className="inp" value={f.category} onChange={(e) => setF((p) => ({ ...p, category: e.target.value }))}>
                    <option value="">— Chọn —</option>
                    {cats.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Đối tượng"><input className="inp" value={f.counterparty} onChange={(e) => setF((p) => ({ ...p, counterparty: e.target.value }))} placeholder="Khách / NCC / nhân viên" /></Field>
                <Field label="Ngày"><input type="date" className="inp" value={f.txn_date} onChange={(e) => setF((p) => ({ ...p, txn_date: e.target.value }))} /></Field>
                <div className="md:col-span-3"><Field label="Diễn giải"><input className="inp" value={f.description} onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} /></Field></div>
              </div>
              <button className="btn-ok mt-3" disabled={busy} onClick={ghi}>{busy ? "Đang ghi…" : `Ghi phiếu ${f.direction.toLowerCase()}`}</button>
              <p className="text-[11px] text-[#8A93A0] mt-2">Phiếu thu từ <b>bán xe, dịch vụ, tiền cọc, thu công nợ</b> đã tự động vào quỹ — chỉ ghi tay các khoản khác (lương, mặt bằng, điện nước…).</p>
            </>
          )}
        </div>
      )}

      {tab === "so" && (
        <div className="card">
          <div className="flex gap-2 items-center mb-3 flex-wrap">
            <div className="font-extrabold mr-auto">Sổ thu chi ({rows.length})</div>
            <input type="date" className="inp !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" className="inp !w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
            <select className="inp !w-auto" value={fAcc} onChange={(e) => setFAcc(e.target.value)}>
              <option value="">Quỹ: tất cả</option>
              {accs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select className="inp !w-auto" value={fDir} onChange={(e) => { setFDir(e.target.value); setPage(1); }}>
              <option value="">Thu + Chi</option><option>Thu</option><option>Chi</option>
            </select>
            <input className="inp !w-48" placeholder="Tìm mã, diễn giải…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            <button className="btn-ghost !text-xs" onClick={exportCSV}>⬇ CSV</button>
          </div>
          <div className="flex flex-col gap-1.5">
            {pageSlice(rows, page, 20).map((t) => (
              <div key={t.id} className="flex items-center gap-2 p-2.5 rounded-xl border border-[#E3E8EF] text-[13px]">
                <Badge tone={t.direction === "Thu" ? "green" : "amber"}>{t.direction}</Badge>
                <div className="mr-auto min-w-0">
                  <div className="font-semibold truncate">{t.category}{t.counterparty ? " · " + t.counterparty : ""}</div>
                  <div className="text-[11px] text-[#8A93A0] truncate">{t.code} · {fmtDate(t.txn_date)} · {accName(t.account_id)} · {t.created_by_name}{t.ref_doc ? " · " + t.ref_doc : ""}{t.description ? " · " + t.description : ""}</div>
                </div>
                <b className={t.direction === "Thu" ? "text-[#0E7A4A]" : "text-danger"}>{t.direction === "Thu" ? "+" : "−"}{fmtVND(t.amount)}</b>
              </div>
            ))}
            {rows.length === 0 && <div className="text-sm text-[#8A93A0]">Không có phiếu nào trong khoảng ngày này.</div>}
          </div>
          <Pager total={rows.length} page={page} setPage={setPage} pageSize={20} setPageSize={() => {}} />
        </div>
      )}

      {tab === "chot" && (
        <div className="card">
          <div className="font-extrabold mb-2">Lịch sử chốt quỹ ({closings.length})</div>
          <div className="overflow-x-auto"><table className="w-full border-collapse">
            <thead><tr><th className="th">Ngày</th><th className="th">Quỹ</th><th className="th">Số dư hệ thống</th><th className="th">Thực tế đếm</th><th className="th">Lệch</th><th className="th">Người chốt</th><th className="th">Ghi chú</th></tr></thead>
            <tbody>{closings.map((c) => (
              <tr key={c.id} className={c.diff !== 0 ? "bg-[#FFF6F6]" : "hover:bg-[#F8FAFC]"}>
                <td className="td whitespace-nowrap">{fmtDate(c.close_date)}</td>
                <td className="td text-[13px]">{accName(c.account_id)}</td>
                <td className="td">{fmtVND(c.system_balance)}</td>
                <td className="td">{fmtVND(c.actual_balance)}</td>
                <td className="td"><b className={c.diff === 0 ? "text-[#0E7A4A]" : "text-danger"}>{fmtVND(c.diff)}</b></td>
                <td className="td text-xs">{c.closed_by_name}</td>
                <td className="td text-xs">{c.note}</td>
              </tr>
            ))}
            {closings.length === 0 && <tr><td className="td" colSpan={7}>Chưa chốt quỹ ngày nào.</td></tr>}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}
