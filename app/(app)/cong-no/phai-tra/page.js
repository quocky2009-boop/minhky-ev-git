"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, Field, Pager, pageSlice, useSortable, Th, useSelection, ThCheck, TdCheck, SelectionBar } from "@/components/ui";
import { fmtVND, fmtDate, fmtTime, errMsg, downloadCSV } from "@/lib/format";

const iso = (d) => d.toLocaleDateString("sv-SE");

export default function CongNoPhaiTra() {
  const { supabase, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [rows, setRows] = useState([]);
  const [payments, setPayments] = useState({}); // { debt_id: [...] }
  const [busy, setBusy] = useState(true);
  const [q, setQ] = useState("");
  const [fLoc, setFLoc] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [showNew, setShowNew] = useState(false);
  const [newF, setNewF] = useState({ import_doc: "", supplier: "", location_code: "", tong_tien: "", da_tra: "", due_date: "", note: "" });
  const [payId, setPayId] = useState(null);
  const [payF, setPayF] = useState({ amount: "", method: "Chuyển khoản", paid_at: iso(new Date()), note: "" });
  const [showPayHist, setShowPayHist] = useState(null);
  const sort = useSortable();
  const sel = useSelection();

  const load = async () => {
    setBusy(true);
    const [{ data: r }, { data: p }] = await Promise.all([
      supabase.from("v_cong_no_phai_tra").select("*").order("qua_han", { ascending: false }).order("created_at", { ascending: false }).limit(500),
      supabase.from("supplier_debt_payments").select("*").order("created_at", { ascending: false }).limit(1000),
    ]);
    setRows(r || []);
    const m = {}; (p || []).forEach((x) => { if (!m[x.debt_id]) m[x.debt_id] = []; m[x.debt_id].push(x); });
    setPayments(m);
    setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải…</div>;
  const locName = (c) => locations.find((l) => l.code === c)?.name || c || "—";

  const kw = q.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (fLoc && r.location_code !== fLoc) return false;
    if (!kw) return true;
    return `${r.code} ${r.import_doc} ${r.supplier}`.toLowerCase().includes(kw);
  });
  const sorted = sort.sortFn(filtered, {
    code: (r) => r.code, ncc: (r) => r.supplier, no: (r) => r.con_no,
    tra: (r) => r.da_tra, han: (r) => r.due_date || "", loc: (r) => locName(r.location_code),
  });

  const tongNo = rows.reduce((s, r) => s + (r.con_no || 0), 0);
  const quaHan = rows.filter((r) => r.qua_han).reduce((s, r) => s + (r.con_no || 0), 0);

  const luuNoMoi = async () => {
    if (!newF.supplier.trim()) return notify("Nhập tên NCC.", "err");
    if (!Number(newF.tong_tien)) return notify("Nhập tổng tiền.", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_tao_no_ncc", { p: {
      import_doc: newF.import_doc, supplier: newF.supplier, location_code: newF.location_code || null,
      tong_tien: Number(newF.tong_tien), da_tra: Number(newF.da_tra) || 0,
      due_date: newF.due_date || null, note: newF.note,
    }});
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã ghi nợ NCC."); setShowNew(false);
    setNewF({ import_doc: "", supplier: "", location_code: "", tong_tien: "", da_tra: "", due_date: "", note: "" });
    load();
  };

  const luuThanhToan = async () => {
    if (!Number(payF.amount)) return notify("Nhập số tiền.", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_tra_no_ncc", { p: {
      debt_id: payId, amount: Number(payF.amount),
      method: payF.method, paid_at: payF.paid_at, note: payF.note,
    }});
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã ghi nhận thanh toán NCC."); setPayId(null); load();
  };

  const chon = () => sorted.filter((r) => sel.has(r.id));

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Công nợ phải trả NCC ({rows.length})</div>
        <button className="btn-primary !text-xs" onClick={() => setShowNew(!showNew)}>+ Ghi nợ NCC</button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <KPI label="Tổng nợ NCC" value={fmtVND(tongNo)} tone="amber" />
        <KPI label="Đã quá hạn" value={fmtVND(quaHan)} tone={quaHan > 0 ? "red" : "dark"} />
        <KPI label="Số khoản nợ" value={rows.length} tone="dark" />
      </div>

      {/* FORM GHI NO MOI */}
      {showNew && (
        <div className="card border-l-4 border-l-amber-400">
          <div className="font-extrabold mb-3">Ghi nợ nhà cung cấp</div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Nhà cung cấp *"><input className="inp" value={newF.supplier} onChange={(e) => setNewF((p) => ({ ...p, supplier: e.target.value }))} placeholder="Tên NCC" /></Field>
            <Field label="Mã phiếu nhập"><input className="inp" value={newF.import_doc} onChange={(e) => setNewF((p) => ({ ...p, import_doc: e.target.value }))} placeholder="VD: IMP-2607-..." /></Field>
            <Field label="Kho nhập">
              <select className="inp" value={newF.location_code} onChange={(e) => setNewF((p) => ({ ...p, location_code: e.target.value }))}>
                <option value="">— Chọn kho —</option>
                {locations.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </Field>
            <Field label="Tổng tiền hàng *"><input type="number" className="inp" value={newF.tong_tien} onChange={(e) => setNewF((p) => ({ ...p, tong_tien: e.target.value }))} placeholder="VD: 50000000" /></Field>
            <Field label="Đã trả ngay (nếu có)"><input type="number" className="inp" value={newF.da_tra} onChange={(e) => setNewF((p) => ({ ...p, da_tra: e.target.value }))} placeholder="0 nếu nợ toàn bộ" /></Field>
            <Field label="Hạn thanh toán"><input type="date" className="inp" value={newF.due_date} onChange={(e) => setNewF((p) => ({ ...p, due_date: e.target.value }))} /></Field>
            <div className="md:col-span-3"><Field label="Ghi chú"><input className="inp" value={newF.note} onChange={(e) => setNewF((p) => ({ ...p, note: e.target.value }))} /></Field></div>
          </div>
          <div className="flex gap-2 mt-3">
            <button className="btn-ok !text-xs" disabled={busy} onClick={luuNoMoi}>Lưu khoản nợ</button>
            <button className="btn-ghost !text-xs" onClick={() => setShowNew(false)}>Hủy</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <input className="inp !w-52" placeholder="Tìm mã nợ, NCC, phiếu nhập…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <select className="inp !w-auto" value={fLoc} onChange={(e) => { setFLoc(e.target.value); setPage(1); }}>
            <option value="">Tất cả kho</option>
            {locations.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </div>

        <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
          <thead><tr>
            <ThCheck sel={sel} rows={pageSlice(sorted, page, pageSize)} idOf={(r) => r.id} />
            <Th label="Mã nợ" k="code" sort={sort} />
            <Th label="NCC" k="ncc" sort={sort} />
            <Th label="Phiếu nhập" k="doc" sort={sort} />
            <Th label="Kho" k="loc" sort={sort} />
            <Th label="Còn nợ" k="no" sort={sort} />
            <Th label="Đã trả / Tổng" k="tra" sort={sort} />
            <Th label="Hạn TT" k="han" sort={sort} />
            <th className="th">Trạng thái</th>
            <th className="th"></th>
          </tr></thead>
          <tbody>{pageSlice(sorted, page, pageSize).map((r) => {
            const pays = payments[r.id] || [];
            return [
              <tr key={r.id} className={`${r.qua_han ? "bg-[#FFF6F6] hover:bg-[#FDEDED]" : "hover:bg-[#F8FAFC]"}`}>
                <TdCheck sel={sel} id={r.id} />
                <td data-label="Mã nợ" className="td font-bold text-xs">{r.code}</td>
                <td data-label="NCC" className="td font-semibold">{r.supplier}</td>
                <td data-label="Phiếu nhập" className="td text-xs">{r.import_doc || "—"}</td>
                <td data-label="Kho" className="td text-xs">{locName(r.location_code)}</td>
                <td data-label="Còn nợ" className="td text-right font-bold text-danger text-[15px]">{fmtVND(r.con_no)}</td>
                <td data-label="Đã trả" className="td text-right text-xs">
                  <div className="text-[#0E7A4A] font-semibold">{fmtVND(r.da_tra)}</div>
                  <div className="text-[#8A93A0]">/ {fmtVND(r.tong_tien)}</div>
                </td>
                <td data-label="Hạn TT" className="td text-xs">
                  {r.due_date ? <span className={r.qua_han ? "text-danger font-bold" : ""}>{fmtDate(r.due_date)}</span> : <span className="text-[#C6CDD6]">Chưa đặt</span>}
                  {r.qua_han && <div className="text-[10px] text-danger">{r.so_ngay_qua_han} ngày</div>}
                </td>
                <td className="td"><Badge tone={r.qua_han ? "red" : r.status === "Đã thanh toán" ? "green" : "amber"}>{r.status}</Badge></td>
                <td className="td">
                  <div className="flex flex-col gap-1">
                    {r.con_no > 0 && <button className="btn-ok !px-2 !py-1 !text-xs" onClick={() => { setPayId(r.id); setPayF({ amount: r.con_no, method: "Chuyển khoản", paid_at: iso(new Date()), note: "" }); }}>💸 Thanh toán</button>}
                    {pays.length > 0 && <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => setShowPayHist(showPayHist === r.id ? null : r.id)}>{pays.length} lần trả {showPayHist === r.id ? "▲" : "▼"}</button>}
                  </div>
                </td>
              </tr>,
              payId === r.id && (
                <tr key={r.id + "_pay"}>
                  <td colSpan={10} className="td bg-[#FFF8E5] !p-3">
                    <div className="font-semibold mb-2">💸 Thanh toán cho {r.supplier}</div>
                    <div className="grid gap-2 md:grid-cols-4">
                      <Field label="Số tiền *"><input type="number" className="inp" value={payF.amount} onChange={(e) => setPayF((p) => ({ ...p, amount: e.target.value }))} /></Field>
                      <Field label="Phương thức">
                        <select className="inp" value={payF.method} onChange={(e) => setPayF((p) => ({ ...p, method: e.target.value }))}>
                          {["Tiền mặt","Chuyển khoản"].map((m) => <option key={m}>{m}</option>)}
                        </select>
                      </Field>
                      <Field label="Ngày trả"><input type="date" className="inp" value={payF.paid_at} onChange={(e) => setPayF((p) => ({ ...p, paid_at: e.target.value }))} /></Field>
                      <Field label="Ghi chú"><input className="inp" value={payF.note} onChange={(e) => setPayF((p) => ({ ...p, note: e.target.value }))} /></Field>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <button className="btn-ok !text-xs" disabled={busy} onClick={luuThanhToan}>Xác nhận thanh toán</button>
                      <button className="btn-ghost !text-xs" onClick={() => setPayId(null)}>Hủy</button>
                    </div>
                  </td>
                </tr>
              ),
              showPayHist === r.id && pays.length > 0 && (
                <tr key={r.id + "_hist"}>
                  <td colSpan={10} className="td bg-[#F8FAFC] !p-2">
                    <div className="font-semibold text-[12px] mb-1">Lịch sử thanh toán</div>
                    {pays.map((p) => (
                      <div key={p.id} className="flex items-center gap-3 text-[12px] p-1.5 border-b border-[#F0F2F5] last:border-0">
                        <Badge tone="green">{p.method}</Badge>
                        <b>{fmtVND(p.amount)}</b>
                        <span className="text-[#8A93A0]">{fmtDate(p.paid_at)} · {p.created_by_name}</span>
                        {p.note && <span className="text-[#5A6572]">{p.note}</span>}
                      </div>
                    ))}
                  </td>
                </tr>
              ),
            ];
          })}
          {sorted.length === 0 && <tr><td className="td" colSpan={10}>Không có khoản nợ NCC nào.</td></tr>}
          </tbody>
        </table></div>
        <Pager total={sorted.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
      </div>
    </div>
  );
}
