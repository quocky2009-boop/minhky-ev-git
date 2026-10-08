"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { QuickDates, AmountFilter, SavedFilters, trongKhoang } from "@/components/FinFilters";
import { Badge, Toast, KPI, Pager, pageSlice, MultiCheck } from "@/components/ui";
import { fmtVND, fmtDate, fmtTime, errMsg, downloadCSV } from "@/lib/format";

const todayISO = () => new Date().toLocaleDateString("sv-SE");

export default function GiaiNgan() {
  const { supabase, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [list, setList] = useState([]);
  const [orders, setOrders] = useState({});
  const [funds, setFunds] = useState([]);
  const [fStatus, setFStatus] = useState("Chờ giải ngân");
  const [q, setQ] = useState("");
  const [fCo, setFCo] = useState([]);
  const [fLoc, setFLoc] = useState([]);
  const [fLate, setFLate] = useState(false);
  const [dFrom, setDFrom] = useState("");
  const [dTo, setDTo] = useState("");
  const [aMin, setAMin] = useState("");
  const [aMax, setAMax] = useState("");
  const [confirmRow, setConfirmRow] = useState(null);
  const [accSel, setAccSel] = useState("");
  const [noteSel, setNoteSel] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const load = async () => {
    const { data } = await supabase.from("sale_payments").select("*").eq("method", "Trả góp").eq("is_reversed", false).order("created_at", { ascending: false }).limit(1000);
    setList(data || []);
    const codes = [...new Set((data || []).map((x) => x.sale_code))];
    if (codes.length) {
      const { data: os } = await supabase.from("sales_orders").select("code, customer_name, customer_phone, seller_name, sale_date, location_code").in("code", codes);
      const m = {}; (os || []).forEach((o) => (m[o.code] = o)); setOrders(m);
    }
    const { data: fs } = await supabase.rpc("fn_ds_quy");
    setFunds((fs || []).filter((x) => x.type === "Ngân hàng"));
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  if (!["CEO", "ADMIN", "MANAGER"].includes(profile.role)) return <div className="card">Phần này chỉ dành cho BGĐ / Admin / Quản lý.</div>;

  const today = todayISO();
  const pending = list.filter((x) => x.status === "Chờ giải ngân");
  const overdue = pending.filter((x) => x.expected_date && x.expected_date < today);
  const sumPending = pending.reduce((s, x) => s + x.amount, 0);

  const filtered = list.filter((x) => {
    if (fStatus && x.status !== fStatus) return false;
    const o = orders[x.sale_code];
    if (fCo.length && !fCo.includes(x.finance_company)) return false;
    if (fLoc.length && !fLoc.includes(o?.location_code)) return false;
    if (fLate && !(x.status === "Chờ giải ngân" && x.expected_date && x.expected_date < today)) return false;
    if (dFrom && (!o?.sale_date || o.sale_date < dFrom)) return false;
    if (dTo && (!o?.sale_date || o.sale_date > dTo)) return false;
    if (!trongKhoang(x.amount, aMin, aMax)) return false;
    const t = (x.sale_code + x.finance_company + (o?.customer_name || "") + (o?.customer_phone || "") + x.amount).toLowerCase();
    return !q || t.includes(q.toLowerCase());
  });

  const doConfirm = async () => {
    if (!accSel) return notify("Chọn tài khoản ngân hàng nhận tiền.", "err");
    const { error } = await supabase.rpc("fn_xac_nhan_giai_ngan", { p_id: confirmRow.id, p_account: Number(accSel), p_note: noteSel });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã xác nhận giải ngân ${fmtVND(confirmRow.amount)} — phiếu thu đã ghi vào quỹ.`);
    setConfirmRow(null); setAccSel(""); setNoteSel(""); load();
  };

  const exportCSV = () => {
    downloadCSV(`cho_giai_ngan.csv`,
      [["Don","Khach","SDT","Cong_Ty","So_Tien","Du_Kien","Trang_Thai","Ngay_Tao","Phieu_Thu","Nguoi_Xac_Nhan"],
       ...filtered.map((x) => { const o = orders[x.sale_code];
         return [x.sale_code, o?.customer_name || "", o?.customer_phone || "", x.finance_company, x.amount, x.expected_date || "", x.status, fmtTime(x.created_at), x.disbursed_txn_code, x.disbursed_by_name]; })]);
  };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex gap-3 flex-wrap">
        <KPI label="Khoản chờ giải ngân" value={pending.length} tone="amber" />
        <KPI label="Tổng tiền chờ về" value={fmtVND(sumPending)} tone="dark" />
        <KPI label="Quá hạn dự kiến" value={overdue.length} tone={overdue.length ? "red" : "dark"} />
      </div>

      <div className="card">
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <div className="font-extrabold mr-auto">Trả góp — theo dõi giải ngân ({filtered.length})</div>
          <input className="inp !w-56" placeholder="Tìm đơn, khách, công ty…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="inp !w-auto" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">Tất cả trạng thái</option><option>Chờ giải ngân</option><option>Đã giải ngân</option>
          </select>
          <button className="btn-ghost !text-xs" onClick={exportCSV}>⬇ Xuất CSV</button>
        </div>
        <div className="flex gap-2 flex-wrap items-center mb-2">
          <span className="text-[11.5px] text-[#8A93A0] font-semibold">Ngày bán:</span>
          <QuickDates from={dFrom} to={dTo} setFrom={setDFrom} setTo={setDTo} onChange={() => setPage(1)} />
          <input type="date" className="inp !w-auto" value={dFrom} onChange={(e) => { setDFrom(e.target.value); setPage(1); }} />
          <input type="date" className="inp !w-auto" value={dTo} onChange={(e) => { setDTo(e.target.value); setPage(1); }} />
          {(dFrom || dTo) && <button className="btn-ghost !text-xs" onClick={() => { setDFrom(""); setDTo(""); }}>✕</button>}
        </div>
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <MultiCheck label="Công ty TC: tất cả" value={fCo} onChange={(v) => { setFCo(v); setPage(1); }}
            options={[...new Set(list.map((x) => x.finance_company))].filter(Boolean).sort().map((n) => ({ key: n, label: n }))} />
          <MultiCheck label="Cửa hàng: tất cả" value={fLoc} onChange={(v) => { setFLoc(v); setPage(1); }}
            options={locations.filter((l) => l.type === "Cửa hàng").map((l) => ({ key: l.code, label: l.name }))} />
          <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer"><input type="checkbox" className="w-4 h-4" checked={fLate} onChange={(e) => { setFLate(e.target.checked); setPage(1); }} />⚠ Chỉ khoản quá hạn</label>
          <AmountFilter min={aMin} max={aMax} setMin={setAMin} setMax={setAMax} onChange={() => setPage(1)} />
          <SavedFilters k="giai-ngan" state={{ fStatus, fCo, fLoc, fLate, aMin, aMax, q }}
            apply={(o) => { setFStatus(o.fStatus || "Chờ giải ngân"); setFCo(o.fCo || []); setFLoc(o.fLoc || []); setFLate(!!o.fLate); setAMin(o.aMin || ""); setAMax(o.aMax || ""); setQ(o.q || ""); }} />
        </div>
        <div className="overflow-x-auto"><table className="w-full border-collapse">
          <thead><tr><th className="th">Đơn bán</th><th className="th">Khách</th><th className="th">Công ty TC</th><th className="th">Số tiền</th><th className="th">Dự kiến</th><th className="th">Trạng thái</th><th className="th"></th></tr></thead>
          <tbody>{pageSlice(filtered, page, pageSize).map((x) => {
            const o = orders[x.sale_code];
            const late = x.status === "Chờ giải ngân" && x.expected_date && x.expected_date < today;
            return (
              <tr key={x.id} className={late ? "bg-[#FDF6F0]" : ""}>
                <td className="td"><b>{x.sale_code}</b><div className="text-[11px] text-[#8A93A0]">{o ? fmtDate(o.sale_date) + " · NV " + o.seller_name : ""}</div></td>
                <td className="td">{o ? <><b>{o.customer_name}</b><div className="text-[11px] text-[#8A93A0]">{o.customer_phone}</div></> : "—"}</td>
                <td className="td">{x.finance_company}</td>
                <td className="td font-extrabold">{fmtVND(x.amount)}</td>
                <td className="td">{x.expected_date ? <span className={late ? "text-danger font-bold" : ""}>{fmtDate(x.expected_date)}{late ? " ⚠" : ""}</span> : "—"}</td>
                <td className="td">{x.status === "Đã giải ngân"
                  ? <><Badge tone="green">Đã giải ngân</Badge><div className="text-[11px] text-[#8A93A0]">{x.disbursed_txn_code} · {x.disbursed_by_name} · {fmtDate(x.disbursed_at)}</div></>
                  : <Badge tone="amber">Chờ giải ngân</Badge>}</td>
                <td className="td">{x.status === "Chờ giải ngân" && (
                  <button className="btn-ok !px-2.5 !py-1.5 !text-xs" onClick={() => { setConfirmRow(x); setAccSel(""); setNoteSel(""); }}>✓ Đã nhận tiền</button>
                )}</td>
              </tr>
            );
          })}
          {filtered.length === 0 && <tr><td className="td" colSpan={7}>Không có khoản nào. Khoản trả góp sinh ra tự động khi đơn bán có dòng thanh toán "Trả góp".</td></tr>}
          </tbody>
        </table></div>
        <Pager total={filtered.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
      </div>

      {confirmRow && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-3" onClick={() => setConfirmRow(null)}>
          <div className="bg-white rounded-2xl w-[440px] max-w-full p-4" onClick={(e) => e.stopPropagation()}>
            <div className="font-extrabold text-base mb-1">Xác nhận đã nhận giải ngân</div>
            <div className="text-sm mb-3">{confirmRow.finance_company} · đơn <b>{confirmRow.sale_code}</b> · <b className="text-brand">{fmtVND(confirmRow.amount)}</b></div>
            <label className="lbl">Tiền về tài khoản nào? *</label>
            <select className="inp mb-2" value={accSel} onChange={(e) => setAccSel(e.target.value)}>
              <option value="">— Chọn tài khoản ngân hàng —</option>
              {funds.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <label className="lbl">Ghi chú</label>
            <input className="inp mb-3" value={noteSel} onChange={(e) => setNoteSel(e.target.value)} placeholder="Số tham chiếu, ngày báo có…" />
            <div className="flex gap-2">
              <button className="btn-ok" onClick={doConfirm}>Xác nhận & ghi phiếu thu</button>
              <button className="btn-ghost" onClick={() => setConfirmRow(null)}>Hủy</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
