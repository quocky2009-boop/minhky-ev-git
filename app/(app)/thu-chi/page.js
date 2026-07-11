"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, KPI } from "@/components/ui";
import { fmtVND, fmtDate, errMsg, downloadCSV } from "@/lib/format";

const today = () => new Date().toLocaleDateString("sv-SE"); // yyyy-mm-dd theo gio may

export default function ThuChi() {
  const { supabase, locations, profile, loading, settings } = useCatalog();
  const { toast, notify } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [txns, setTxns] = useState([]);
  const [closings, setClosings] = useState([]);
  const [bal, setBal] = useState({});
  const [from, setFrom] = useState(today().slice(0, 8) + "01");
  const [to, setTo] = useState(today());
  const [fAcc, setFAcc] = useState("");
  const [fDir, setFDir] = useState("");
  // form ghi thu chi
  const emptyT = { txn_date: today(), account_id: "", direction: "Thu", amount: "", category: "", counterparty: "", description: "" };
  const [t, setT] = useState(emptyT);
  const setTf = (k, v) => setT((p) => ({ ...p, [k]: v }));
  // form quy
  const [showAcc, setShowAcc] = useState(false);
  const emptyA = { id: "", name: "", type: "Tiền mặt", location_code: "", bank_info: "", opening_balance: 0, status: "Hoạt động" };
  const [a, setA] = useState(emptyA);
  const setAf = (k, v) => setA((p) => ({ ...p, [k]: v }));
  // chot quy
  const [closeAcc, setCloseAcc] = useState("");
  const [closeActual, setCloseActual] = useState("");
  const [closeNote, setCloseNote] = useState("");

  const load = async () => {
    const [{ data: ac }, { data: tx }, { data: cl }] = await Promise.all([
      supabase.from("cash_accounts").select("*").order("type").order("name"),
      supabase.from("cash_txns").select("*").gte("txn_date", from).lte("txn_date", to).order("txn_date", { ascending: false }).order("id", { ascending: false }).limit(1000),
      supabase.from("cash_closings").select("*").eq("close_date", today()),
    ]);
    setAccounts(ac || []); setTxns(tx || []); setClosings(cl || []);
  };
  useEffect(() => { if (!loading) load(); }, [loading, from, to]);
  useEffect(() => { if (!loading) loadBalances(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  if (!["CEO", "ADMIN", "MANAGER"].includes(profile.role)) return <div className="card">Phần Thu - Chi chỉ dành cho BGĐ / Admin / Quản lý.</div>;
  const canManageAcc = ["CEO", "ADMIN"].includes(profile.role);

  const accName = (id) => accounts.find((x) => x.id === Number(id))?.name || id;
  const locName = (c) => locations.find((l) => l.code === c)?.name || "";
  const thuCats = (settings.thu_categories || "Bán xe\nThu khác").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
  const chiCats = (settings.chi_categories || "Nhập hàng\nChi khác").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

  const list = txns.filter((x) => (!fAcc || String(x.account_id) === fAcc) && (!fDir || x.direction === fDir));
  const sumThu = list.filter((x) => x.direction === "Thu").reduce((s, x) => s + x.amount, 0);
  const sumChi = list.filter((x) => x.direction === "Chi").reduce((s, x) => s + x.amount, 0);

  const saveTxn = async () => {
    const { data, error } = await supabase.rpc("fn_ghi_thu_chi", { p: { ...t, amount: Number(t.amount) } });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã ghi phiếu ${data}.`); setT({ ...emptyT, account_id: t.account_id }); load(); loadBalances();
  };
  const saveAcc = async () => {
    const { error } = await supabase.rpc("fn_them_quy", { p: { ...a, opening_balance: Number(a.opening_balance) || 0 } });
    if (error) return notify(errMsg(error), "err");
    notify(a.id ? "Đã cập nhật quỹ." : "Đã tạo quỹ mới."); setA(emptyA); setShowAcc(false); load(); loadBalances();
  };
  const doClose = async () => {
    if (!closeAcc) return notify("Chọn quỹ cần chốt.", "err");
    const { error } = await supabase.rpc("fn_chot_quy", { p: { account_id: Number(closeAcc), actual_balance: Number(closeActual) || 0, note: closeNote } });
    if (error) return notify(errMsg(error), "err");
    notify("Đã chốt quỹ hôm nay."); setCloseAcc(""); setCloseActual(""); setCloseNote(""); load();
  };
  const sendReport = async () => {
    const { error } = await supabase.rpc("fn_test_discord_thuchi");
    if (error) return notify(errMsg(error), "err");
    notify("Đã gửi báo cáo quỹ vào Discord — kiểm tra channel.");
  };

  // So du hien tai tung quy (goi rpc fn_so_du)
  const loadBalances = async () => {
    const { data: ac } = await supabase.from("cash_accounts").select("id");
    const res = {};
    for (const x of ac || []) {
      const { data } = await supabase.rpc("fn_so_du", { p_account: x.id });
      res[x.id] = data || 0;
    }
    setBal(res);
  };
  const totalBal = accounts.reduce((s, x) => s + (bal[x.id] || 0), 0);

  const exportCSV = () => {
    downloadCSV(`thu_chi_${from}_den_${to}.csv`,
      [["Phieu","Ngay","Quy","Loai","So_Tien","Hang_Muc","Doi_Tuong","Dien_Giai","Nguoi_Ghi"],
       ...list.map((x) => [x.code, x.txn_date, accName(x.account_id), x.direction, x.amount, x.category, x.counterparty, x.description, x.created_by_name])]);
  };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex gap-3 flex-wrap">
        <KPI label="Tổng số dư các quỹ" value={fmtVND(totalBal)} tone="dark" />
        <KPI label={`Thu (${fmtDate(from)} – ${fmtDate(to)})`} value={fmtVND(sumThu)} tone="green" />
        <KPI label={`Chi (${fmtDate(from)} – ${fmtDate(to)})`} value={fmtVND(sumChi)} tone="red" />
        {canManageAcc && <button className="btn-ghost self-center ml-auto !text-xs" onClick={sendReport}>📨 Gửi báo cáo quỹ Discord ngay</button>}
      </div>

      {/* QUY TIEN */}
      <div className="card">
        <div className="flex items-center mb-2.5">
          <div className="font-extrabold mr-auto">Quỹ tiền ({accounts.length})</div>
          {canManageAcc && <button className="btn-primary !py-2 !text-xs" onClick={() => { setA(emptyA); setShowAcc(!showAcc); }}>+ Thêm quỹ</button>}
        </div>
        {showAcc && (
          <div className="bg-[#F8FAFC] rounded-xl p-3.5 mb-3">
            <div className="grid gap-x-3.5 md:grid-cols-3 sm:grid-cols-2">
              <Field label="Tên quỹ" required><input className="inp" value={a.name} onChange={(e) => setAf("name", e.target.value)} placeholder="VD: Quỹ tiền mặt 322 QT" /></Field>
              <Field label="Loại"><select className="inp" value={a.type} onChange={(e) => setAf("type", e.target.value)}><option>Tiền mặt</option><option>Ngân hàng</option></select></Field>
              <Field label="Gắn điểm bán (tùy chọn)"><select className="inp" value={a.location_code} onChange={(e) => setAf("location_code", e.target.value)}>
                <option value="">— Không gắn —</option>{locations.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select></Field>
              {a.type === "Ngân hàng" && <Field label="Thông tin TK"><input className="inp" value={a.bank_info} onChange={(e) => setAf("bank_info", e.target.value)} placeholder="VD: VCB 0123456789 - Cty Minh Kỳ" /></Field>}
              <Field label="Số dư đầu kỳ"><input type="number" className="inp" value={a.opening_balance} onChange={(e) => setAf("opening_balance", e.target.value)} /></Field>
              {a.id && <Field label="Trạng thái"><select className="inp" value={a.status} onChange={(e) => setAf("status", e.target.value)}><option>Hoạt động</option><option>Khóa</option></select></Field>}
            </div>
            <button className="btn-ok !py-2 !text-xs" onClick={saveAcc}>{a.id ? "Lưu thay đổi" : "Tạo quỹ"}</button>
          </div>
        )}
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))" }}>
          {accounts.map((x) => {
            const cl = closings.find((c) => c.account_id === x.id);
            return (
              <div key={x.id} className="border border-[#E6EAEF] rounded-xl p-3.5">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <div className="font-extrabold text-[14px]">{x.type === "Tiền mặt" ? "💵" : "🏦"} {x.name}</div>
                    <div className="text-[11px] text-[#8A93A0]">{x.type}{x.location_code ? ` · ${locName(x.location_code)}` : ""}{x.bank_info ? ` · ${x.bank_info}` : ""}</div>
                  </div>
                  {canManageAcc && <button className="text-[#8A93A0] hover:text-brand text-xs" onClick={() => { setA({ id: x.id, name: x.name, type: x.type, location_code: x.location_code || "", bank_info: x.bank_info, opening_balance: x.opening_balance, status: x.status }); setShowAcc(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}>✎</button>}
                </div>
                <div className="text-xl font-extrabold tabular-nums mt-1.5">{fmtVND(bal[x.id] || 0)}</div>
                <div className="mt-1">{cl ? (cl.diff === 0 ? <Badge tone="green">Đã chốt hôm nay · khớp</Badge> : <Badge tone="red">Đã chốt · lệch {fmtVND(cl.diff)}</Badge>) : <Badge tone="amber">Chưa chốt hôm nay</Badge>}</div>
              </div>
            );
          })}
          {accounts.length === 0 && <div className="text-sm text-[#8A93A0]">Chưa có quỹ nào — bấm "+ Thêm quỹ" để tạo (VD: Quỹ tiền mặt từng cửa hàng, TK ngân hàng công ty).</div>}
        </div>
      </div>

      {/* GHI THU CHI */}
      <div className="card">
        <div className="font-extrabold mb-3">Ghi phiếu thu / chi</div>
        <div className="grid gap-x-4 md:grid-cols-4 sm:grid-cols-2">
          <Field label="Ngày" required><input type="date" className="inp" value={t.txn_date} onChange={(e) => setTf("txn_date", e.target.value)} /></Field>
          <Field label="Quỹ" required><select className="inp" value={t.account_id} onChange={(e) => setTf("account_id", e.target.value)}>
            <option value="">— Chọn quỹ —</option>{accounts.filter((x) => x.status === "Hoạt động").map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select></Field>
          <Field label="Loại phiếu" required>
            <div className="flex gap-1.5">
              <button className={`btn flex-1 !py-2.5 ${t.direction === "Thu" ? "bg-ok text-white" : "bg-[#EEF1F4] text-[#3B4552]"}`} onClick={() => setTf("direction", "Thu")}>Thu</button>
              <button className={`btn flex-1 !py-2.5 ${t.direction === "Chi" ? "bg-[#DC2F3E] text-white" : "bg-[#EEF1F4] text-[#3B4552]"}`} onClick={() => setTf("direction", "Chi")}>Chi</button>
            </div>
          </Field>
          <Field label="Số tiền (đ)" required><input type="number" min="0" className="inp" value={t.amount} onChange={(e) => setTf("amount", e.target.value)} /></Field>
          <Field label="Hạng mục" required><select className="inp" value={t.category} onChange={(e) => setTf("category", e.target.value)}>
            <option value="">— Chọn hạng mục —</option>{(t.direction === "Thu" ? thuCats : chiCats).map((c) => <option key={c}>{c}</option>)}
          </select></Field>
          <Field label="Đối tượng (khách/NCC/nhân viên)"><input className="inp" value={t.counterparty} onChange={(e) => setTf("counterparty", e.target.value)} /></Field>
          <Field label="Diễn giải"><input className="inp" value={t.description} onChange={(e) => setTf("description", e.target.value)} /></Field>
        </div>
        <button className="btn-ok" onClick={saveTxn}>Lưu phiếu {t.direction.toLowerCase()}</button>
      </div>

      {/* CHOT QUY */}
      <div className="card">
        <div className="font-extrabold">Chốt quỹ cuối ngày ({fmtDate(today())})</div>
        <p className="text-xs text-[#5A6572] mb-3">Đếm tiền thực tế trong két / kiểm tra số dư tài khoản, nhập vào đây. Hệ thống so với số dư sổ sách và lưu chênh lệch. 21h00 mỗi tối, báo cáo tổng hợp tự gửi vào Discord kèm cảnh báo quỹ chưa chốt.</p>
        <div className="flex gap-2 flex-wrap items-end">
          <div><label className="lbl">Quỹ</label><select className="inp !w-auto" value={closeAcc} onChange={(e) => setCloseAcc(e.target.value)}>
            <option value="">— Chọn quỹ —</option>{accounts.filter((x) => x.status === "Hoạt động").map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select></div>
          {closeAcc && <div className="text-sm pb-2.5">Số dư sổ sách: <b>{fmtVND(bal[Number(closeAcc)] || 0)}</b></div>}
          <div><label className="lbl">Thực tế đếm được (đ)</label><input type="number" className="inp !w-44" value={closeActual} onChange={(e) => setCloseActual(e.target.value)} /></div>
          {closeAcc && closeActual !== "" && (
            <div className="text-sm pb-2.5">Chênh: <b className={Number(closeActual) - (bal[Number(closeAcc)] || 0) === 0 ? "text-[#0E7A4A]" : "text-danger"}>{fmtVND(Number(closeActual) - (bal[Number(closeAcc)] || 0))}</b></div>
          )}
          <div className="flex-1 min-w-[160px]"><label className="lbl">Ghi chú</label><input className="inp" value={closeNote} onChange={(e) => setCloseNote(e.target.value)} /></div>
          <button className="btn-primary" onClick={doClose}>Chốt quỹ</button>
        </div>
      </div>

      {/* SO THU CHI */}
      <div className="card">
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <div className="font-extrabold mr-auto">Sổ thu chi ({list.length})</div>
          <input type="date" className="inp !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" className="inp !w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
          <select className="inp !w-auto" value={fAcc} onChange={(e) => setFAcc(e.target.value)}>
            <option value="">Quỹ: tất cả</option>{accounts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <select className="inp !w-auto" value={fDir} onChange={(e) => setFDir(e.target.value)}>
            <option value="">Thu & Chi</option><option>Thu</option><option>Chi</option>
          </select>
          <button className="btn-ghost !text-xs" onClick={exportCSV}>⬇ Xuất CSV</button>
        </div>
        <div className="overflow-x-auto"><table className="w-full border-collapse">
          <thead><tr><th className="th">Phiếu</th><th className="th">Ngày</th><th className="th">Quỹ</th><th className="th">Hạng mục</th><th className="th">Thu</th><th className="th">Chi</th><th className="th">Đối tượng · Diễn giải</th><th className="th">Người ghi</th></tr></thead>
          <tbody>{list.map((x) => (
            <tr key={x.id}>
              <td className="td font-bold">{x.code}</td>
              <td className="td">{fmtDate(x.txn_date)}</td>
              <td className="td">{accName(x.account_id)}</td>
              <td className="td"><Badge tone={x.direction === "Thu" ? "green" : "red"}>{x.category}</Badge></td>
              <td className="td font-bold text-[#0E7A4A]">{x.direction === "Thu" ? fmtVND(x.amount) : ""}</td>
              <td className="td font-bold text-danger">{x.direction === "Chi" ? fmtVND(x.amount) : ""}</td>
              <td className="td text-xs">{x.counterparty}{x.description ? (x.counterparty ? " · " : "") + x.description : ""}</td>
              <td className="td text-xs">{x.created_by_name}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="text-[11px] text-[#8A93A0] mt-2">Sổ thu chi không sửa/xóa được — ghi nhầm thì lập phiếu ngược chiều để bù, ghi rõ diễn giải.</p>
      </div>
    </div>
  );
}
