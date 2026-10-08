"use client";
import { useState } from "react";
import { fmtVND, fmtTime, errMsg } from "@/lib/format";
import PayAccountInfo from "@/components/PayAccountInfo";
import BankOptions from "@/components/BankOptions";

// Cac khoan DA THU cua don dang sua (Wizard che do Sua don): hien chi tiet tung khoan; Admin/BGD sua duoc
// bang cach "dao nguoc + ghi lai" (fn_dao_nguoc_khoan_thu) — sai phuong thuc / sai tai khoan / tach nhieu phuong thuc.
export default function PayCuSua({ pays, accs, cos, locations, canEdit, supabase, notify, onChanged, bankAccounts, companies, companyId, PTTT, quyTypeOf, extra }) {
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);

  const mo = (p) => setF({ id: p.id, amount: p.amount, ly_do: "", lines: [{ method: p.method === "Trả góp" ? "Chuyển khoản" : p.method, amount: p.amount, account_id: "", finance_company: "" }] });
  const setLine = (i, k, v) => setF((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, [k]: v, ...(k === "method" ? { account_id: "", finance_company: "" } : {}) } : l)) }));

  const luu = async () => {
    if (!f.ly_do.trim()) return notify("Nhập lý do sửa khoản thu.", "err");
    const ls = f.lines.filter((l) => Number(l.amount) > 0);
    if (ls.length === 0) return notify("Nhập ít nhất 1 phương thức mới.", "err");
    if (ls.find((l) => l.method === "Trả góp" && !l.finance_company)) return notify("Chọn đơn vị trả góp.", "err");
    if (ls.find((l) => quyTypeOf(l.method) === "Ngân hàng" && !l.account_id)) return notify("Chọn tài khoản ngân hàng nhận tiền.", "err");
    const tong = ls.reduce((a, l) => a + Number(l.amount), 0);
    if (tong !== Number(f.amount) && !confirm(`Tổng các dòng mới (${fmtVND(tong)}) khác khoản thu cũ (${fmtVND(f.amount)}). Vẫn tiếp tục?`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("fn_dao_nguoc_khoan_thu", { p_payment_id: f.id, p_ly_do: f.ly_do,
      p_new_payments: ls.map((l) => ({ method: l.method, amount: Number(l.amount), finance_company: l.finance_company || null, account_id: l.account_id || null })) });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã sửa khoản thu (đảo ngược và ghi lại).");
    setF(null); onChanged && onChanged();
  };

  if (!pays) return null;
  return (
    <div className="mb-3 rounded-xl border border-[#F0D9A8] bg-[#FFFBF0] p-2.5">
      <div className="text-[12px] font-bold text-[#A25F00] mb-1.5">🔒 Các khoản đã thu trước đó ({pays.length})</div>
      {pays.length === 0 && <div className="text-[12px] text-[#8A93A0]">Đơn chưa có khoản thu nào đang hiệu lực (có thể đã hoàn tiền) — nhập các khoản thu bên dưới để ghi lại.</div>}
      {pays.map((p) => (
        <div key={p.id} className="py-1.5 border-b border-dashed border-[#F0E3C4] last:border-0">
          <div className="flex items-center gap-2 flex-wrap text-[13px]">
            <b>{p.method}</b><b>{fmtVND(p.amount)}</b>
            {p.status !== "Đã thu" && <span className="text-[11px] text-[#A25F00]">({p.status})</span>}
            {p.refunded_amount > 0 && <span className="text-[11px] text-danger">đã hoàn {fmtVND(p.refunded_amount)}</span>}
            {p.note && <span className="text-[11px] text-[#8A93A0]">— {p.note}</span>}
            <span className="ml-auto text-[10.5px] text-[#8A93A0]">{fmtTime(p.created_at)}</span>
            {canEdit && p.refunded_amount === 0 && <button className="btn-ghost !px-2 !py-0.5 !text-xs" onClick={() => mo(p)}>✎ Sửa</button>}
          </div>
          <PayAccountInfo p={p} accs={accs} cos={cos} locations={locations} extra={extra} />
        </div>
      ))}
      {!canEdit && pays.length > 0 && <div className="text-[11px] text-[#8A93A0] mt-1.5">Sửa phương thức/tài khoản của khoản đã thu: nhờ Admin / Ban giám đốc (hoặc chỉ cần thu thêm ở dưới nếu khách trả thêm). <b>Không cần hoàn tiền để nhập lại.</b></div>}

      {f && (
        <div className="mt-2 p-2.5 rounded-lg bg-white border border-brand">
          <div className="text-[12px] font-bold text-brand mb-1.5">Sửa khoản thu #{f.id} ({fmtVND(f.amount)}) — đảo ngược và ghi lại</div>
          {f.lines.map((l, i) => (
            <div key={i} className="flex gap-1.5 flex-wrap items-center mb-1.5">
              <select className="inp !w-auto !py-1.5 !text-xs" value={l.method} onChange={(e) => setLine(i, "method", e.target.value)}>
                {PTTT.map((m) => <option key={m}>{m}</option>)}
              </select>
              <input type="number" className="inp !w-36 !py-1.5 !text-xs" value={l.amount} onChange={(e) => setLine(i, "amount", e.target.value)} />
              {l.method === "Trả góp" && <input className="inp !w-40 !py-1.5 !text-xs" placeholder="Đơn vị trả góp" value={l.finance_company} onChange={(e) => setLine(i, "finance_company", e.target.value)} />}
              {quyTypeOf(l.method) === "Ngân hàng" && (
                <select className="inp !w-auto !py-1.5 !text-xs max-w-full" value={l.account_id} onChange={(e) => setLine(i, "account_id", e.target.value)}>
                  <option value="">— Tài khoản nhận tiền —</option>
                  <BankOptions accounts={bankAccounts} companies={companies} companyId={companyId} />
                </select>
              )}
              {f.lines.length > 1 && <button className="text-danger font-bold" onClick={() => setF((x) => ({ ...x, lines: x.lines.filter((_, j) => j !== i) }))}>✕</button>}
            </div>
          ))}
          <button className="btn-ghost !text-xs mb-1.5" onClick={() => setF((x) => ({ ...x, lines: [...x.lines, { method: "Tiền mặt", amount: "", account_id: "", finance_company: "" }] }))}>⊕ Thêm dòng</button>
          <input className="inp !py-1.5 !text-xs mb-1.5" placeholder="Lý do sửa (bắt buộc) — VD: chọn nhầm tài khoản" value={f.ly_do} onChange={(e) => setF((x) => ({ ...x, ly_do: e.target.value }))} />
          <div className="flex gap-2"><button className="btn-ok !text-xs" disabled={busy} onClick={luu}>{busy ? "Đang lưu…" : "Lưu sửa khoản thu"}</button><button className="btn-ghost !text-xs" onClick={() => setF(null)}>Hủy</button></div>
        </div>
      )}
    </div>
  );
}
