"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Toast, KPI, Field, Badge, MoneyInput } from "@/components/ui";
import { fmtVND, fmtDate, errMsg } from "@/lib/format";

const CAT_TRA = "Chuyển trả pháp nhân";

export default function GiuHoPhapNhan() {
  const { supabase, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [accs, setAccs] = useState([]);
  const [cos, setCos] = useState([]);
  const [bankCty, setBankCty] = useState([]);
  const [txns, setTxns] = useState([]);
  const [busy, setBusy] = useState(true);
  const [f, setF] = useState(null); // { from, to, amount, note }
  const ok = ["CEO", "ADMIN"].includes(profile?.role);

  const load = async () => {
    setBusy(true);
    const { data: a } = await supabase.from("cash_accounts").select("*").eq("ca_nhan", true).order("name");
    const { data: b } = await supabase.from("cash_accounts").select("id,name,company_id,bank_info,status").eq("ca_nhan", false).eq("type", "Ngân hàng").eq("status", "Hoạt động").order("name");
    const { data: c } = await supabase.from("companies").select("id,name");
    const ids = (a || []).map((x) => x.id);
    let t = [];
    if (ids.length) {
      const r = await supabase.from("cash_txns").select("*").in("account_id", ids).order("txn_date", { ascending: false }).order("id", { ascending: false }).limit(1000);
      t = r.data || [];
    }
    setAccs(a || []); setBankCty(b || []); setCos(c || []); setTxns(t); setBusy(false);
  };
  useEffect(() => { if (!loading && ok) load(); else if (!loading) setBusy(false); }, [loading, ok]);

  if (loading || busy) return <div className="p-6 text-sm text-[#5A6572]">Đang tải…</div>;
  if (!ok) return <div className="p-6 text-sm text-[#5A6572]">Chỉ Ban giám đốc / Admin xem được báo cáo này.</div>;

  const coName = (id) => cos.find((c) => c.id === id)?.name || "";
  const tong = (id) => {
    const a = accs.find((x) => x.id === id);
    const mine = txns.filter((t) => t.account_id === id && t.approval_status !== "rejected");
    const thu = mine.filter((t) => t.direction === "Thu").reduce((s, t) => s + Number(t.amount), 0);
    const tra = mine.filter((t) => t.direction === "Chi" && t.category === CAT_TRA).reduce((s, t) => s + Number(t.amount), 0);
    const chiKhac = mine.filter((t) => t.direction === "Chi" && t.category !== CAT_TRA).reduce((s, t) => s + Number(t.amount), 0);
    return { thu, tra, chiKhac, giu: Number(a?.opening_balance || 0) + thu - tra - chiKhac };
  };
  const tongGiu = accs.reduce((s, a) => s + tong(a.id).giu, 0);

  const chuyen = async () => {
    if (!f.from || !f.to) return notify("Chọn tài khoản cá nhân và tài khoản pháp nhân nhận.", "err");
    if (!(Number(f.amount) > 0)) return notify("Nhập số tiền chuyển trả.", "err");
    const { data, error } = await supabase.rpc("fn_chuyen_tra_phap_nhan", { p_from: Number(f.from), p_to: Number(f.to), p_amount: Number(f.amount), p_note: f.note || "" });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã ghi chuyển trả (${data}).`);
    setF(null); load();
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto flex flex-col gap-4">
      <Toast toast={toast} />
      <div>
        <h1 className="text-xl font-extrabold">Tiền giữ hộ pháp nhân (tài khoản cá nhân)</h1>
        <p className="text-xs text-[#5A6572]">Tiền bán buôn khách chuyển vào tài khoản cá nhân. Khi chuyển lại cho công ty, bấm "Ghi chuyển trả" để hệ thống ghi phiếu chi (tài khoản cá nhân) và phiếu thu (tài khoản công ty).</p>
      </div>
      {accs.length === 0 ? (
        <div className="card text-sm">Chưa có tài khoản cá nhân. Vào <b>Cài đặt → Tài khoản nhận tiền</b>, thêm tài khoản với Chủ tài khoản = "Cá nhân (giữ hộ pháp nhân)".</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <KPI label="Đang giữ hộ (tổng)" value={fmtVND(tongGiu)} />
            <KPI label="Đã nhận bán buôn" value={fmtVND(accs.reduce((s, a) => s + tong(a.id).thu, 0))} />
            <KPI label="Đã chuyển trả công ty" value={fmtVND(accs.reduce((s, a) => s + tong(a.id).tra, 0))} />
          </div>
          {accs.map((a) => {
            const k = tong(a.id);
            const list = txns.filter((t) => t.account_id === a.id);
            return (
              <div className="card" key={a.id}>
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <b className="mr-auto">{a.name} <span className="text-xs font-normal text-[#5A6572]">{a.bank_info}</span></b>
                  <span className="text-sm">Đang giữ: <b className={k.giu > 0 ? "text-[#B45309]" : ""}>{fmtVND(k.giu)}</b></span>
                  <button className="btn-primary !py-1.5 !text-xs" onClick={() => setF({ from: String(a.id), to: "", amount: k.giu > 0 ? k.giu : 0, note: "" })}>Ghi chuyển trả</button>
                </div>
                <div className="text-xs text-[#5A6572] mb-2">Nhận {fmtVND(k.thu)} · Đã chuyển trả {fmtVND(k.tra)}{k.chiKhac ? ` · Chi khác ${fmtVND(k.chiKhac)}` : ""}{a.opening_balance ? ` · Đầu kỳ ${fmtVND(a.opening_balance)}` : ""}</div>
                <div className="overflow-x-auto"><table className="w-full text-[12.5px]">
                  <thead><tr className="text-left text-[#5A6572]"><th className="py-1 pr-2">Ngày</th><th className="pr-2">Mã phiếu</th><th className="pr-2">Loại</th><th className="pr-2">Diễn giải</th><th className="text-right">Số tiền</th></tr></thead>
                  <tbody>
                    {list.map((t) => (
                      <tr key={t.id} className="border-t border-[#EEF1F5]">
                        <td className="py-1 pr-2 whitespace-nowrap">{fmtDate(t.txn_date)}</td>
                        <td className="pr-2">{t.code}</td>
                        <td className="pr-2"><Badge tone={t.direction === "Thu" ? "green" : "amber"}>{t.category === CAT_TRA ? "Chuyển trả" : t.direction}</Badge></td>
                        <td className="pr-2">{t.description || t.counterparty}{t.ref_doc ? ` · ${t.ref_doc}` : ""}</td>
                        <td className={`text-right font-semibold ${t.direction === "Thu" ? "text-[#0F7B3F]" : "text-[#B45309]"}`}>{t.direction === "Thu" ? "+" : "−"}{fmtVND(t.amount)}</td>
                      </tr>
                    ))}
                    {list.length === 0 && <tr><td colSpan={5} className="py-2 text-[#8A93A0]">Chưa có giao dịch.</td></tr>}
                  </tbody>
                </table></div>
              </div>
            );
          })}
        </>
      )}
      {f && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setF(null)}>
          <div className="bg-white rounded-xl p-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="font-extrabold mb-2">Ghi chuyển trả tiền giữ hộ cho pháp nhân</div>
            <Field label="Từ tài khoản cá nhân"><select className="inp" value={f.from} onChange={(e) => setF((p) => ({ ...p, from: e.target.value }))}>{accs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            <Field label="Vào tài khoản pháp nhân" required>
              <select className="inp" value={f.to} onChange={(e) => setF((p) => ({ ...p, to: e.target.value }))}>
                <option value="">— Chọn tài khoản nhận —</option>
                {bankCty.map((b) => <option key={b.id} value={b.id}>{b.name}{coName(b.company_id) ? ` — ${coName(b.company_id)}` : ""}</option>)}
              </select>
            </Field>
            <Field label="Số tiền" required><MoneyInput value={f.amount} onChange={(v) => setF((p) => ({ ...p, amount: v || 0 }))} /></Field>
            <Field label="Ghi chú"><input className="inp" value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} placeholder="VD: chuyển trả đơn bán buôn tháng 10" /></Field>
            <div className="flex gap-2 mt-2"><button className="btn-ok !text-xs" onClick={chuyen}>Xác nhận</button><button className="btn-ghost !text-xs" onClick={() => setF(null)}>Hủy</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
