"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, Field, LocSearch, Pager, pageSlice, pageClamp, useSortable, Th } from "@/components/ui";
import { fmtVND, fmtTime, fmtDate, errMsg, downloadCSV } from "@/lib/format";

const iso = (d) => d.toLocaleDateString("sv-SE");
const firstOfMonth = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };
const dayBefore = (s) => { const d = new Date(s); d.setDate(d.getDate() - 1); return iso(d); };

export default function SoQuy() {
  const { supabase, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [perms, setPerms] = useState({});
  const [accs, setAccs] = useState([]);
  const [txns, setTxns] = useState([]);
  const [closings, setClosings] = useState([]);
  const [duKy, setDuKy] = useState(0);
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(iso(new Date()));
  const [fAcc, setFAcc] = useState("");
  const [fDir, setFDir] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const sort = useSortable();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("so"); // so | quy | chot
  const [detail, setDetail] = useState(null);
  const [af, setAf] = useState({ id: null, name: "", type: "Tiền mặt", location_code: "", bank_info: "", opening_balance: 0 });
  const [showAcc, setShowAcc] = useState(false);

  const can = (p) => profile?.role === "CEO" || !!perms[p];

  const load = async () => {
    if (!profile) return;
    setBusy(true);
    let qy = supabase.from("cash_txns").select("*").gte("txn_date", from).lte("txn_date", to)
      .order("txn_date", { ascending: false }).order("id", { ascending: false }).limit(3000);
    if (fAcc) qy = qy.eq("account_id", fAcc);
    const [{ data: a }, { data: t }, { data: c }, { data: pm }] = await Promise.all([
      supabase.from("v_quy_so_du").select("*").order("type").order("name"),
      qy,
      supabase.from("cash_closings").select("*").order("close_date", { ascending: false }).limit(60),
      supabase.from("role_perms").select("perm,allowed").eq("role", profile.role),
    ]);
    setAccs(a || []); setTxns(t || []); setClosings(c || []);
    const m = {}; (pm || []).forEach((x) => { m[x.perm] = x.allowed; }); setPerms(m);

    // So du dau ky = tong so du moi quy den het ngay truoc 'from'
    const relevant = (a || []).filter((x) => !fAcc || x.id === Number(fAcc));
    let dk = 0;
    for (const acc of relevant) {
      const { data: sd } = await supabase.rpc("fn_so_du", { p_account: acc.id, p_to: dayBefore(from) });
      dk += Number(sd) || 0;
    }
    setDuKy(dk);
    setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading, profile, from, to, fAcc]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  if (!can("thu_chi_xem")) return <div className="card">Bạn không có quyền xem sổ quỹ.</div>;

  const accName = (id) => accs.find((a) => a.id === id)?.name || id;
  const locName = (c) => locations.find((l) => l.code === c)?.name || c;

  const luuQuy = async () => {
    if (!af.name.trim()) return notify("Nhập tên quỹ.", "err");
    const { error } = await supabase.rpc("fn_them_quy", { p: af });
    if (error) return notify(errMsg(error), "err");
    notify("Đã lưu quỹ."); setAf({ id: null, name: "", type: "Tiền mặt", location_code: "", bank_info: "", opening_balance: 0 }); setShowAcc(false); load();
  };

  const chotQuy = async (acc) => {
    const a = prompt(`Chốt quỹ "${acc.name}" hôm nay.\nSố dư hệ thống: ${fmtVND(acc.so_du)}\n\nNhập số dư THỰC TẾ đếm được:`);
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
  const sorted = sort.sortFn(rows, {
    code: (t) => t.code, date: (t) => t.txn_date, acc: (t) => accName(t.account_id),
    cat: (t) => t.category, thu: (t) => t.direction === "Thu" ? t.amount : 0,
    chi: (t) => t.direction === "Chi" ? t.amount : 0, ref: (t) => t.ref_doc,
  });
  const tongThu = rows.filter((t) => t.direction === "Thu").reduce((a, b) => a + b.amount, 0);
  const tongChi = rows.filter((t) => t.direction === "Chi").reduce((a, b) => a + b.amount, 0);
  const cuoiKy = duKy + tongThu - tongChi;
  const tongQuy = accs.filter((a) => a.status === "Hoạt động").reduce((a, b) => a + Number(b.so_du), 0);

  const exportCSV = () => {
    downloadCSV(`so_quy_${from}_den_${to}.csv`,
      [["Mã phiếu", "Ngày", "Loại phiếu", "Tiền thu", "Tiền chi", "Ngày tạo", "Chứng từ gốc", "Quỹ", "Người tạo"],
       ...sorted.map((t) => [t.code, fmtDate(t.txn_date), t.category, t.direction === "Thu" ? t.amount : "", t.direction === "Chi" ? t.amount : "", fmtTime(t.created_at), t.ref_doc, accName(t.account_id), t.created_by_name])]);
    notify(`Đã xuất ${sorted.length} phiếu.`);
  };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Sổ quỹ</div>
        <button className="btn-ghost !text-xs" onClick={baoCaoDiscord}>📤 Gửi số dư về Discord</button>
        <button className="btn-ghost !text-xs" onClick={exportCSV}>⬇ Xuất file</button>
      </div>

      {/* KPI kieu Sapo: dau ky + thu - chi = cuoi ky */}
      <div className="card !py-4">
        <div className="flex items-center justify-around flex-wrap gap-3 text-center">
          <div>
            <div className="text-[11.5px] text-[#8A93A0] font-semibold uppercase">Số dư đầu kỳ</div>
            <div className="text-lg font-extrabold text-[#3B4552]">{fmtVND(duKy)}</div>
          </div>
          <div className="text-2xl text-[#C8D0DA] font-bold">+</div>
          <div>
            <div className="text-[11.5px] text-[#8A93A0] font-semibold uppercase">Tổng thu</div>
            <div className="text-lg font-extrabold text-[#0E7A4A]">{fmtVND(tongThu)}</div>
          </div>
          <div className="text-2xl text-[#C8D0DA] font-bold">−</div>
          <div>
            <div className="text-[11.5px] text-[#8A93A0] font-semibold uppercase">Tổng chi</div>
            <div className="text-lg font-extrabold text-danger">{fmtVND(tongChi)}</div>
          </div>
          <div className="text-2xl text-[#C8D0DA] font-bold">=</div>
          <div>
            <div className="text-[11.5px] text-[#8A93A0] font-semibold uppercase">Tồn cuối kỳ</div>
            <div className="text-lg font-extrabold text-brand">{fmtVND(cuoiKy)}</div>
          </div>
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {[["so", "Sổ quỹ"], ["quy", `Quỹ tiền (${accs.length})`], ["chot", "Lịch sử chốt quỹ"]].map(([k, v]) => (
          <button key={k} className={`btn !px-3 !py-2 !text-xs ${tab === k ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => { setTab(k); setPage(1); }}>{v}</button>
        ))}
      </div>

      {tab === "so" && (
        <div className="card">
          <div className="flex gap-2 items-center mb-3 flex-wrap">
            <div className="font-extrabold mr-auto">Tất cả phiếu ({sorted.length})</div>
            <input type="date" className="inp !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" className="inp !w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
            <select className="inp !w-auto" value={fAcc} onChange={(e) => setFAcc(e.target.value)}>
              <option value="">Quỹ: tất cả</option>
              {accs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select className="inp !w-auto" value={fDir} onChange={(e) => { setFDir(e.target.value); setPage(1); }}>
              <option value="">Thu + Chi</option><option>Thu</option><option>Chi</option>
            </select>
            <input className="inp !w-52" placeholder="Tìm mã phiếu, chứng từ gốc…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>

          {busy && txns.length === 0 ? <div className="text-sm text-[#8A93A0] py-4">Đang tải…</div> : (
            <>
              <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
                <thead><tr>
                  <th className="th w-10">STT</th>
                  <Th label="Mã phiếu" k="code" sort={sort} />
                  <Th label="Loại phiếu" k="cat" sort={sort} />
                  <Th label="Tiền thu" k="thu" sort={sort} className="text-right" />
                  <Th label="Tiền chi" k="chi" sort={sort} className="text-right" />
                  <Th label="Ngày tạo" k="date" sort={sort} />
                  <Th label="Chứng từ gốc" k="ref" sort={sort} />
                </tr></thead>
                <tbody>{pageSlice(sorted, page, pageSize).map((t, i) => (
                  <tr key={t.id} className="hover:bg-[#F8FAFC]">
                    <td data-label="STT" className="td text-center text-xs text-[#8A93A0]">{(pageClamp(page, sorted.length, pageSize) - 1) * pageSize + i + 1}</td>
                    <td data-label="Mã phiếu" className="td"><button className="font-bold text-brand hover:underline" onClick={() => setDetail(t)}>{t.code}</button></td>
                    <td data-label="Loại phiếu" className="td text-[13px]">{t.ref_doc ? <Badge tone="blue">Tự động</Badge> : <Badge tone="gray">Thủ công</Badge>} {t.category}</td>
                    <td data-label="Tiền thu" className="td rt font-bold text-[#0E7A4A]">{t.direction === "Thu" ? fmtVND(t.amount) : "—"}</td>
                    <td data-label="Tiền chi" className="td rt font-bold text-danger">{t.direction === "Chi" ? fmtVND(t.amount) : "—"}</td>
                    <td data-label="Ngày tạo" className="td text-xs whitespace-nowrap">{fmtTime(t.created_at)}</td>
                    <td data-label="Chứng từ gốc" className="td text-xs text-brand">{t.ref_doc || "—"}</td>
                  </tr>
                ))}
                {sorted.length === 0 && <tr><td className="td" colSpan={7}>Không có phiếu nào trong khoảng ngày này.</td></tr>}
                </tbody>
              </table></div>
              <Pager total={sorted.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
            </>
          )}
        </div>
      )}

      {tab === "quy" && (
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <div className="font-extrabold mr-auto">Quỹ tiền · tổng số dư {fmtVND(tongQuy)}</div>
            {can("thu_chi_chot") && <button className="btn-primary !text-xs" onClick={() => { setAf({ id: null, name: "", type: "Tiền mặt", location_code: "", bank_info: "", opening_balance: 0 }); setShowAcc(!showAcc); }}>{showAcc ? "Đóng" : "+ Quỹ mới"}</button>}
          </div>

          {showAcc && (
            <div className="rounded-xl border-2 border-brand p-4 mb-3">
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
                  {can("thu_chi_chot") && (
                    <div className="flex gap-1.5 mt-2">
                      <button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => chotQuy(a)}>Chốt quỹ</button>
                      <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => { setAf({ id: a.id, name: a.name, type: a.type, location_code: a.location_code || "", bank_info: a.bank_info || "", opening_balance: a.opening_balance }); setShowAcc(true); }}>✎</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "chot" && (
        <div className="card">
          <div className="font-extrabold mb-2">Lịch sử chốt quỹ ({closings.length})</div>
          <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
            <thead><tr><th className="th">Ngày</th><th className="th">Quỹ</th><th className="th">Số dư hệ thống</th><th className="th">Thực tế đếm</th><th className="th">Lệch</th><th className="th">Người chốt</th><th className="th">Ghi chú</th></tr></thead>
            <tbody>{closings.map((c) => (
              <tr key={c.id} className={c.diff !== 0 ? "bg-[#FFF6F6]" : "hover:bg-[#F8FAFC]"}>
                <td data-label="Ngày" className="td whitespace-nowrap">{fmtDate(c.close_date)}</td>
                <td data-label="Quỹ" className="td text-[13px]">{accName(c.account_id)}</td>
                <td data-label="Số dư HT" className="td">{fmtVND(c.system_balance)}</td>
                <td data-label="Thực tế" className="td">{fmtVND(c.actual_balance)}</td>
                <td data-label="Lệch" className="td"><b className={c.diff === 0 ? "text-[#0E7A4A]" : "text-danger"}>{fmtVND(c.diff)}</b></td>
                <td data-label="Người chốt" className="td text-xs">{c.closed_by_name}</td>
                <td data-label="Ghi chú" className="td text-xs">{c.note}</td>
              </tr>
            ))}
            {closings.length === 0 && <tr><td className="td" colSpan={7}>Chưa chốt quỹ ngày nào.</td></tr>}
            </tbody>
          </table></div>
        </div>
      )}
      {detail && (
        <div className="fixed inset-0 z-[95] bg-black/50 flex items-center justify-center p-3" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl w-[520px] max-w-full max-h-[88vh] overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <div className="text-lg font-extrabold mr-auto">{detail.code}</div>
              <Badge tone={detail.direction === "Thu" ? "green" : "amber"}>{detail.direction === "Thu" ? "Phiếu thu" : "Phiếu chi"}</Badge>
              {detail.ref_doc && <Badge tone="blue">Tự động</Badge>}
              <button className="btn-ghost !text-xs" onClick={() => setDetail(null)}>✕</button>
            </div>
            <div className="rounded-xl border border-[#E3E8EF] overflow-hidden mb-3">
              <div className={`flex justify-between px-3 py-2.5 ${detail.direction === "Thu" ? "bg-[#E7F6EE]" : "bg-[#FFF6E5]"}`}>
                <span className="font-bold">Số tiền</span>
                <span className={`text-lg font-extrabold ${detail.direction === "Thu" ? "text-[#0E7A4A]" : "text-danger"}`}>{fmtVND(detail.amount)}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 text-[13px]">
              <div className="flex gap-2"><span className="text-[#8A93A0] w-32 shrink-0">Danh mục</span><span className="font-semibold">{detail.category}</span></div>
              <div className="flex gap-2"><span className="text-[#8A93A0] w-32 shrink-0">Đối tượng</span><span>{detail.counterparty || "—"}</span></div>
              <div className="flex gap-2"><span className="text-[#8A93A0] w-32 shrink-0">Quỹ</span><span>{accName(detail.account_id)}</span></div>
              <div className="flex gap-2"><span className="text-[#8A93A0] w-32 shrink-0">Chứng từ gốc</span><span className="text-brand">{detail.ref_doc || "—"}</span></div>
              <div className="flex gap-2"><span className="text-[#8A93A0] w-32 shrink-0">Người tạo</span><span>{detail.created_by_name}</span></div>
              <div className="flex gap-2"><span className="text-[#8A93A0] w-32 shrink-0">Ngày tạo</span><span>{fmtTime(detail.created_at)}</span></div>
              <div className="flex gap-2"><span className="text-[#8A93A0] w-32 shrink-0">Ngày ghi nhận</span><span>{fmtDate(detail.txn_date)}</span></div>
              {detail.description && <div className="flex gap-2"><span className="text-[#8A93A0] w-32 shrink-0">Diễn giải</span><span>{detail.description}</span></div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
