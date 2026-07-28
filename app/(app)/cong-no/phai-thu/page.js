"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, Field, Pager, pageSlice, useSortable, Th, useSelection, ThCheck, TdCheck, SelectionBar } from "@/components/ui";
import { fmtVND, fmtDate, fmtTime, errMsg, downloadCSV } from "@/lib/format";

const iso = (d) => d.toLocaleDateString("sv-SE");
const NHOM_TONE = { "Chưa đến hạn": "green", "Quá hạn 1–7 ngày": "amber", "Quá hạn 8–30 ngày": "red", "Quá hạn trên 30 ngày": "red" };
const NHOM_ORDER = ["Chưa đến hạn", "Quá hạn 1–7 ngày", "Quá hạn 8–30 ngày", "Quá hạn trên 30 ngày"];
const CHANNELS = ["Gọi điện", "Nhắn tin", "Zalo", "Gặp trực tiếp", "Email"];

export default function CongNoPhai() {
  const { supabase, vehicles, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [rows, setRows] = useState([]);
  const [reminders, setReminders] = useState({}); // { order_id: [reminder...] }
  const [busy, setBusy] = useState(true);
  const [fNhom, setFNhom] = useState("");
  const [fLoc, setFLoc] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  // Han thanh toan inline
  const [editId, setEditId] = useState(null);
  const [editF, setEditF] = useState({ due_date: "", debt_note: "" });
  // Nhac no
  const [remindId, setRemindId] = useState(null); // order_id dang nhac
  const [remindF, setRemindF] = useState({ channel: "Gọi điện", content: "", result: "", next_remind_date: "", due_date: "" });
  const [showHistory, setShowHistory] = useState(null); // order_id dang xem lich su
  const sort = useSortable();
  const sel = useSelection();

  const load = async () => {
    setBusy(true);
    const [{ data: r }, { data: rem }] = await Promise.all([
      supabase.from("v_cong_no_phai_thu").select("*").order("so_ngay_qua_han", { ascending: false }).limit(2000),
      supabase.from("debt_reminders").select("*").order("created_at", { ascending: false }).limit(1000),
    ]);
    setRows(r || []);
    // Group reminders by order_id
    const m = {};
    (rem || []).forEach((x) => { if (!m[x.order_id]) m[x.order_id] = []; m[x.order_id].push(x); });
    setReminders(m);
    setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải…</div>;

  const locName = (c) => locations.find((l) => l.code === c)?.name || c || "—";
  const vName = (id) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.name} ${v.color}` : id; };

  const kw = q.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (fNhom && r.nhom_qua_han !== fNhom) return false;
    if (fLoc && r.location_code !== fLoc) return false;
    if (!kw) return true;
    return `${r.code} ${r.customer_name} ${r.customer_phone} ${r.frame_number}`.toLowerCase().includes(kw);
  });
  const sorted = sort.sortFn(filtered, {
    code: (r) => r.code, kh: (r) => r.customer_name, don: (r) => r.tong_don,
    no: (r) => r.con_no, tra: (r) => r.da_tra, han: (r) => r.due_date || "",
    qh: (r) => r.so_ngay_qua_han, loc: (r) => locName(r.location_code),
  });

  const tongNo = rows.reduce((s, r) => s + r.con_no, 0);
  const chuaDenHan = rows.filter((r) => r.nhom_qua_han === "Chưa đến hạn").reduce((s, r) => s + r.con_no, 0);
  const quaHan7 = rows.filter((r) => r.nhom_qua_han === "Quá hạn 1–7 ngày").reduce((s, r) => s + r.con_no, 0);
  const quaHan30 = rows.filter((r) => r.nhom_qua_han === "Quá hạn 8–30 ngày").reduce((s, r) => s + r.con_no, 0);
  const quaHanNang = rows.filter((r) => r.nhom_qua_han === "Quá hạn trên 30 ngày").reduce((s, r) => s + r.con_no, 0);

  const luuHan = async () => {
    const { error } = await supabase.from("sales_orders").update({ due_date: editF.due_date || null, debt_note: editF.debt_note || "" }).eq("id", editId);
    if (error) return notify(errMsg(error), "err");
    notify("Đã lưu hạn thanh toán."); setEditId(null); load();
  };

  const luuNhacNo = async () => {
    if (!remindF.content.trim()) return notify("Nhập nội dung nhắc nợ.", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_ghi_nhac_no", { p: {
      order_id: remindId, channel: remindF.channel, content: remindF.content,
      result: remindF.result, next_remind_date: remindF.next_remind_date || null,
      due_date: remindF.due_date || null,
    }});
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã ghi nhận nhắc nợ."); setRemindId(null); load();
  };

  const chon = () => sorted.filter((r) => sel.has(r.id));
  const xuatExcel = (rs) => {
    downloadCSV("cong_no_phai_thu.csv", [
      ["Mã đơn","Khách","SĐT","Loại KH","Điểm bán","Xe","Ngày bán","Hạn TT","Tổng đơn","Đã trả","Còn nợ","Nhóm","Số ngày QH","Cam kết","Số lần nhắc"],
      ...rs.map((r) => [r.code, r.customer_name, r.customer_phone, r.customer_type,
        locName(r.location_code), vName(r.vehicle_id), fmtDate(r.sale_date),
        r.due_date ? fmtDate(r.due_date) : "—", r.tong_don, r.da_tra, r.con_no,
        r.nhom_qua_han, r.so_ngay_qua_han, r.debt_note, (reminders[r.id] || []).length]),
    ]);
    notify(`Đã xuất ${rs.length} dòng.`);
  };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Công nợ phải thu ({rows.length} đơn)</div>
        <button className="btn-ghost !text-xs" onClick={() => xuatExcel(sorted)}>⬇ Xuất Excel</button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <KPI label="Tổng công nợ" value={fmtVND(tongNo)} tone="red" />
        <KPI label="Chưa đến hạn" value={fmtVND(chuaDenHan)} tone="green" />
        <KPI label="Quá hạn 1–7 ngày" value={fmtVND(quaHan7)} tone="amber" />
        <KPI label="Quá hạn 8–30 ngày" value={fmtVND(quaHan30)} tone="red" />
        <KPI label="Quá hạn trên 30 ngày" value={fmtVND(quaHanNang)} tone={quaHanNang > 0 ? "red" : "dark"} />
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {["", ...NHOM_ORDER].map((k) => (
          <button key={k || "all"} onClick={() => { setFNhom(k); setPage(1); }}
            className={`btn !px-3 !py-1.5 !text-xs ${fNhom === k ? "bg-brand text-white" : "bg-[#EEF1F4]"}`}>
            {k || "Tất cả"}
            {k && <span className="ml-1 font-bold">{fmtVND(rows.filter((r) => r.nhom_qua_han === k).reduce((s, r) => s + r.con_no, 0))}</span>}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <input className="inp !w-52" placeholder="Tìm mã đơn, khách, SĐT, số khung…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <select className="inp !w-auto" value={fLoc} onChange={(e) => { setFLoc(e.target.value); setPage(1); }}>
            <option value="">Tất cả điểm bán</option>
            {locations.filter((l) => l.type === "Cửa hàng" || l.type === "Showroom").map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
          <div className="ml-auto text-[13px] font-bold text-danger">Tổng lọc: {fmtVND(filtered.reduce((s, r) => s + r.con_no, 0))}</div>
        </div>

        <SelectionBar sel={sel}>
          <span className="text-[12px] font-bold text-danger px-1 self-center">Còn nợ: {fmtVND(chon().reduce((s, r) => s + r.con_no, 0))}</span>
          <button className="btn-ghost !text-xs !py-1" onClick={() => xuatExcel(chon())}>⬇ Xuất Excel</button>
        </SelectionBar>

        {busy ? <div className="text-sm text-[#8A93A0]">Đang tải…</div> : (
          <>
            <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
              <thead><tr>
                <ThCheck sel={sel} rows={pageSlice(sorted, page, pageSize)} idOf={(r) => r.id} />
                <Th label="Mã đơn" k="code" sort={sort} />
                <Th label="Khách hàng" k="kh" sort={sort} />
                <Th label="Điểm bán" k="loc" sort={sort} />
                <Th label="Xe" k="xe" sort={sort} />
                <Th label="Còn nợ" k="no" sort={sort} />
                <Th label="Đã trả / Tổng" k="tra" sort={sort} />
                <Th label="Hạn TT" k="han" sort={sort} />
                <Th label="Nhóm" k="qh" sort={sort} />
                <th className="th">Nhắc nợ</th>
                <th className="th"></th>
              </tr></thead>
              <tbody>{pageSlice(sorted, page, pageSize).map((r) => {
                const rems = reminders[r.id] || [];
                const lastRem = rems[0];
                return [
                  <tr key={r.id} className={`${sel.has(r.id) ? "bg-[#EAF2FF]" : r.nhom_qua_han !== "Chưa đến hạn" ? "bg-[#FFF6F6] hover:bg-[#FDEDED]" : "hover:bg-[#F8FAFC]"}`}>
                    <TdCheck sel={sel} id={r.id} />
                    <td data-label="Mã đơn" className="td font-bold">
                      <Link href={`/don-ban/${r.id}`} className="text-brand hover:underline">{r.code}</Link>
                      <div className="text-[10.5px] text-[#8A93A0]">{fmtDate(r.sale_date)}</div>
                    </td>
                    <td data-label="Khách" className="td text-[13px]">
                      <div className="font-semibold">{r.customer_name}</div>
                      <div className="text-[10.5px] text-[#8A93A0]">{r.customer_phone}</div>
                    </td>
                    <td data-label="Điểm bán" className="td text-xs">{locName(r.location_code)}</td>
                    <td data-label="Xe" className="td text-[13px]">
                      <div>{vName(r.vehicle_id)}</div>
                      <div className="font-mono text-[10.5px] text-[#8A93A0]">{r.frame_number}</div>
                    </td>
                    <td data-label="Còn nợ" className="td text-right font-bold text-danger text-[15px]">{fmtVND(r.con_no)}</td>
                    <td data-label="Đã trả" className="td text-right text-xs">
                      <div className="text-[#0E7A4A] font-semibold">{fmtVND(r.da_tra)}</div>
                      <div className="text-[#8A93A0]">/ {fmtVND(r.tong_don)}</div>
                    </td>
                    <td data-label="Hạn TT" className="td text-xs">
                      {editId === r.id ? (
                        <div className="flex flex-col gap-1">
                          <input type="date" className="inp !py-1 !text-xs !w-32" value={editF.due_date} onChange={(e) => setEditF((p) => ({ ...p, due_date: e.target.value }))} />
                          <textarea className="inp !py-1 !text-xs !h-14 !w-36" placeholder="Cam kết…" value={editF.debt_note} onChange={(e) => setEditF((p) => ({ ...p, debt_note: e.target.value }))} />
                          <div className="flex gap-1">
                            <button className="btn-ok !px-2 !py-0.5 !text-xs" onClick={luuHan}>Lưu</button>
                            <button className="btn-ghost !px-2 !py-0.5 !text-xs" onClick={() => setEditId(null)}>Hủy</button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          {r.due_date
                            ? <div className={r.so_ngay_qua_han > 0 ? "text-danger font-bold" : ""}>{fmtDate(r.due_date)}</div>
                            : <span className="text-[#C6CDD6]">Chưa đặt</span>}
                          {r.debt_note && <div className="text-[10px] text-[#5A6572] italic mt-0.5">{r.debt_note}</div>}
                          <button className="text-brand text-[10.5px] hover:underline mt-0.5" onClick={() => { setEditId(r.id); setEditF({ due_date: r.due_date || iso(new Date()), debt_note: r.debt_note || "" }); }}>✎ Sửa</button>
                        </div>
                      )}
                    </td>
                    <td data-label="Nhóm" className="td">
                      <Badge tone={NHOM_TONE[r.nhom_qua_han] || "gray"}>{r.nhom_qua_han}</Badge>
                      {r.so_ngay_qua_han > 0 && <div className="text-[10.5px] text-danger mt-0.5">{r.so_ngay_qua_han} ngày</div>}
                    </td>
                    <td data-label="Nhắc nợ" className="td text-xs">
                      {rems.length > 0 && (
                        <div className="mb-1">
                          <button className="text-brand text-[10.5px] hover:underline" onClick={() => setShowHistory(showHistory === r.id ? null : r.id)}>
                            {rems.length} lần nhắc {showHistory === r.id ? "▲" : "▼"}
                          </button>
                          {lastRem?.next_remind_date && (
                            <div className={`text-[10px] ${new Date(lastRem.next_remind_date) < new Date() ? "text-danger font-bold" : "text-[#8A93A0]"}`}>
                              Hẹn: {fmtDate(lastRem.next_remind_date)}
                            </div>
                          )}
                        </div>
                      )}
                      <button className="btn-ok !px-2 !py-1 !text-xs" onClick={() => { setRemindId(r.id); setRemindF({ channel: "Gọi điện", content: "", result: "", next_remind_date: "", due_date: r.due_date || "" }); }}>
                        📞 Nhắc nợ
                      </button>
                    </td>
                    <td className="td"></td>
                  </tr>,
                  // PANEL NHAC NO
                  remindId === r.id && (
                    <tr key={r.id + "_remind"}>
                      <td colSpan={11} className="td bg-[#EAF2FF] !p-3">
                        <div className="font-semibold text-brand mb-2">📞 Ghi nhận nhắc nợ — {r.customer_name} ({r.code})</div>
                        <div className="grid gap-2 md:grid-cols-3">
                          <Field label="Kênh liên hệ">
                            <select className="inp" value={remindF.channel} onChange={(e) => setRemindF((p) => ({ ...p, channel: e.target.value }))}>
                              {CHANNELS.map((c) => <option key={c}>{c}</option>)}
                            </select>
                          </Field>
                          <Field label="Hẹn nhắc lại">
                            <input type="date" className="inp" value={remindF.next_remind_date} onChange={(e) => setRemindF((p) => ({ ...p, next_remind_date: e.target.value }))} />
                          </Field>
                          <Field label="Cập nhật hạn TT">
                            <input type="date" className="inp" value={remindF.due_date} onChange={(e) => setRemindF((p) => ({ ...p, due_date: e.target.value }))} />
                          </Field>
                          <div className="md:col-span-2">
                            <Field label="Nội dung trao đổi *">
                              <textarea className="inp !h-16" value={remindF.content} onChange={(e) => setRemindF((p) => ({ ...p, content: e.target.value }))} placeholder="VD: đã gọi, khách nói sẽ trả ngày 30/7" />
                            </Field>
                          </div>
                          <Field label="Kết quả">
                            <textarea className="inp !h-16" value={remindF.result} onChange={(e) => setRemindF((p) => ({ ...p, result: e.target.value }))} placeholder="VD: khách đồng ý trả, cam kết…" />
                          </Field>
                        </div>
                        <div className="flex gap-2 mt-2">
                          <button className="btn-ok !text-xs" disabled={busy} onClick={luuNhacNo}>Lưu nhắc nợ</button>
                          <button className="btn-ghost !text-xs" onClick={() => setRemindId(null)}>Hủy</button>
                        </div>
                      </td>
                    </tr>
                  ),
                  // PANEL LICH SU NHAC NO
                  showHistory === r.id && (
                    <tr key={r.id + "_hist"}>
                      <td colSpan={11} className="td bg-[#F8FAFC] !p-3">
                        <div className="font-semibold mb-2">Lịch sử nhắc nợ — {r.customer_name}</div>
                        <div className="flex flex-col gap-1.5">
                          {(reminders[r.id] || []).map((rm) => (
                            <div key={rm.id} className="p-2 rounded-lg border border-[#E3E8EF] text-[13px]">
                              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                <Badge tone="blue">{rm.channel}</Badge>
                                <span className="text-[11px] text-[#8A93A0]">{fmtTime(rm.created_at)} · {rm.created_by_name}</span>
                                {rm.next_remind_date && <Badge tone={new Date(rm.next_remind_date) < new Date() ? "red" : "amber"}>Hẹn {fmtDate(rm.next_remind_date)}</Badge>}
                              </div>
                              <div>{rm.content}</div>
                              {rm.result && <div className="text-[12px] text-[#0E7A4A] mt-0.5">→ {rm.result}</div>}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
              {sorted.length === 0 && <tr><td className="td" colSpan={11}>Không có công nợ nào.</td></tr>}
              </tbody>
            </table></div>
            <Pager total={sorted.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
          </>
        )}
      </div>
    </div>
  );
}
