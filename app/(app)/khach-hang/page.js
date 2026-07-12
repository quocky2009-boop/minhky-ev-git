"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, KPI, Pager, pageSlice } from "@/components/ui";
import { fmtVND, fmtDate, fmtTime, errMsg } from "@/lib/format";
import { CUSTOMER_TYPES, CUSTOMER_SOURCES } from "@/lib/const";

const STATUSES = ["Lead mới", "Đang tư vấn", "Hẹn xem xe", "Đã mua", "Không mua", "Chăm sóc lại"];
const TEMPS = ["Hot", "Warm", "Cold"];
const stTone = (s) => s === "Đã mua" ? "green" : s === "Lead mới" ? "blue" : s === "Không mua" ? "gray" : s === "Chăm sóc lại" ? "purple" : "amber";
const tempTone = (t) => t === "Hot" ? "red" : t === "Warm" ? "amber" : t === "Cold" ? "blue" : "gray";
const digits = (p) => (p || "").replace(/\D/g, "");

export default function KhachHang() {
  const { supabase, vehicles, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fTemp, setFTemp] = useState("");
  const [show, setShow] = useState(false);
  const empty = { id: "", name: "", phone: "", cccd: "", address: "", customer_type: "Khách lẻ", source: "Khách vãng lai", status: "Lead mới", temperature: "", note: "", next_care_date: "", next_care_note: "" };
  const [f, setF] = useState(empty);
  const [origStatus, setOrigStatus] = useState(null); // trang thai truoc khi sua, de khoa "Da mua"
  const [dup, setDup] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [history, setHistory] = useState({});
  const [careLogs, setCareLogs] = useState({});
  const [careForm, setCareForm] = useState({});   // customer_id -> {content, result, care_date}
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const load = async () => {
    const { data } = await supabase.from("customers").select("*").order("updated_at", { ascending: false }).limit(500);
    setList(data || []);
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const d = digits(f.phone);
    if (d.length < 9) { setDup(null); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("customers").select("id, code, name, phone, status").eq("phone_digits", d).limit(1);
      const hit = (data || [])[0];
      setDup(hit && String(hit.id) !== String(f.id) ? hit : null);
    }, 350);
    return () => clearTimeout(t);
  }, [f.phone, f.id]);

  const save = async () => {
    const { data, error } = await supabase.rpc("fn_luu_khach_hang", { p: f });
    if (error) return notify(errMsg(error), "err");
    notify(f.id ? "Đã cập nhật khách hàng." : `Đã tạo khách hàng mới (mã ${data}).`);
    setF(empty); setOrigStatus(null); setShow(false); setDup(null); load();
  };

  const startEdit = (c) => {
    setF({ id: c.id, name: c.name, phone: c.phone, cccd: c.cccd, address: c.address, customer_type: c.customer_type, source: c.source, status: c.status, temperature: c.temperature || "", note: c.note, next_care_date: c.next_care_date || "", next_care_note: c.next_care_note || "" });
    setOrigStatus(c.status); setShow(true); window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleHistory = async (c) => {
    if (openId === c.id) return setOpenId(null);
    setOpenId(c.id);
    if (!history[c.id]) {
      const { data } = await supabase.from("sales_orders").select("*")
        .or(`customer_id.eq.${c.id},customer_phone.eq.${c.phone}`).order("sale_date", { ascending: false });
      setHistory((p) => ({ ...p, [c.id]: data || [] }));
    }
    if (!careLogs[c.id]) {
      const { data } = await supabase.from("customer_care_logs").select("*").eq("customer_id", c.id).order("care_date", { ascending: false });
      setCareLogs((p) => ({ ...p, [c.id]: data || [] }));
    }
  };

  const saveCare = async (cid) => {
    const cf = careForm[cid] || {};
    if (!cf.content?.trim()) return notify("Nhập nội dung chăm sóc.", "err");
    const payload = { customer_id: cid, care_date: cf.care_date || "", content: cf.content, result: cf.result || "" };
    if (cf.next) { payload.next_care_date = cf.next; payload.next_care_note = cf.content; }
    const { error } = await supabase.rpc("fn_luu_cham_soc", { p: payload });
    if (error) return notify(errMsg(error), "err");
    notify("Đã lưu lịch sử chăm sóc.");
    setCareForm((p) => ({ ...p, [cid]: { content: "", result: "", care_date: "", next: "" } }));
    load();
    const { data } = await supabase.from("customer_care_logs").select("*").eq("customer_id", cid).order("care_date", { ascending: false });
    setCareLogs((p) => ({ ...p, [cid]: data || [] }));
  };

  const removeCare = async (cid, id) => {
    if (!confirm("Xóa dòng chăm sóc này?")) return;
    const { error } = await supabase.rpc("fn_xoa_cham_soc", { p_id: id });
    if (error) return notify(errMsg(error), "err");
    setCareLogs((p) => ({ ...p, [cid]: p[cid].filter((x) => x.id !== id) }));
  };

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  const vOf = (id) => vehicles.find((x) => x.id === id);
  const locName = (c) => locations.find((l) => l.code === c)?.name || c;
  const filtered = list.filter((c) => {
    if (fStatus && c.status !== fStatus) return false;
    if (fTemp && c.temperature !== fTemp) return false;
    const t = (c.code + c.name + c.phone + (c.address || "")).toLowerCase();
    return !q || t.includes(q.toLowerCase());
  });
  const bought = list.filter((c) => c.status === "Đã mua").length;
  const leads = list.filter((c) => !["Đã mua", "Không mua"].includes(c.status)).length;
  const statusLocked = origStatus === "Đã mua";

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex gap-3 flex-wrap">
        <KPI label="Tổng khách hàng" value={list.length} tone="dark" />
        <KPI label="Lead đang theo" value={leads} tone="blue" />
        <KPI label="Đã mua xe" value={bought} tone="green" />
      </div>

      {!show && <button className="btn-primary self-start" onClick={() => { setF(empty); setOrigStatus(null); setShow(true); }}>+ Thêm khách hàng / lead</button>}
      {show && (
        <div className="card">
          <div className="font-extrabold mb-3">{f.id ? "Sửa khách hàng" : "Thêm khách hàng / lead mới (mã KH tự sinh)"}</div>
          <div className="grid gap-x-4 md:grid-cols-3 sm:grid-cols-2">
            <Field label="Họ tên" required><input className="inp" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="Số điện thoại" required>
              <input className="inp" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
              {dup && (
                <div className="mt-1.5 bg-[#FDF1DF] text-[#A25F00] text-xs font-semibold rounded-lg px-3 py-2">
                  ⚠ SĐT này đã có trên hệ thống: <b>{dup.name}</b> ({dup.code} · {dup.status}).
                </div>
              )}
            </Field>
            <Field label="CCCD"><input className="inp" value={f.cccd} onChange={(e) => set("cccd", e.target.value)} /></Field>
            <Field label="Địa chỉ"><input className="inp" value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
            <Field label="Loại khách"><select className="inp" value={f.customer_type} onChange={(e) => set("customer_type", e.target.value)}>{CUSTOMER_TYPES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Nguồn khách"><select className="inp" value={f.source} onChange={(e) => set("source", e.target.value)}>{CUSTOMER_SOURCES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Trạng thái" hint={statusLocked ? "Khách đã mua xe — trạng thái này cố định, không thể đổi." : ""}>
              <select className="inp" value={f.status} disabled={statusLocked} onChange={(e) => set("status", e.target.value)}>
                {STATUSES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Tình trạng lead"><select className="inp" value={f.temperature} onChange={(e) => set("temperature", e.target.value)}>
              <option value="">— Chưa đánh giá —</option>{TEMPS.map((t) => <option key={t}>{t}</option>)}
            </select></Field>
            <Field label="Hẹn chăm sóc tiếp (ngày)"><input type="date" className="inp" value={f.next_care_date} onChange={(e) => set("next_care_date", e.target.value)} /></Field>
            <Field label="Việc cần làm khi đến hẹn"><input className="inp" value={f.next_care_note} onChange={(e) => set("next_care_note", e.target.value)} placeholder="VD: Gọi mời xem VF6, báo giá lăn bánh…" /></Field>
            <Field label="Ghi chú (nhu cầu, xe quan tâm…)"><input className="inp" value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
          </div>
          <div className="flex gap-2.5">
            <button className="btn-ok" onClick={save}>{f.id ? "Lưu thay đổi" : "Tạo khách hàng"}</button>
            <button className="btn-ghost" onClick={() => { setShow(false); setF(empty); setOrigStatus(null); setDup(null); }}>Hủy</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <div className="font-extrabold mr-auto">Danh sách khách hàng ({filtered.length})</div>
          <input className="inp !w-64" placeholder="Tìm tên, SĐT, mã KH, địa chỉ…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="inp !w-auto" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">Trạng thái: tất cả</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select className="inp !w-auto" value={fTemp} onChange={(e) => setFTemp(e.target.value)}>
            <option value="">Lead: tất cả</option>{TEMPS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto"><table className="w-full border-collapse">
          <thead><tr><th className="th">Mã KH</th><th className="th">Khách hàng</th><th className="th">Ngày tạo</th><th className="th">Loại · Nguồn</th><th className="th">Trạng thái</th><th className="th">Lead</th><th className="th">Hẹn CS</th><th className="th">Phụ trách</th><th className="th"></th></tr></thead>
          <tbody>{pageSlice(filtered, page, pageSize).map((c) => {
            const hist = history[c.id] || [];
            const logs = careLogs[c.id] || [];
            const cf = careForm[c.id] || { content: "", result: "", care_date: "" };
            const total = hist.reduce((s, o) => s + o.sale_price * o.quantity, 0);
            return [
              <tr key={c.id} className="hover:bg-[#F8FAFC]">
                <td className="td font-bold">{c.code}</td>
                <td className="td"><b>{c.name}</b><div className="text-[11px] text-[#8A93A0]">{c.phone}{c.address ? " · " + c.address : ""}</div></td>
                <td className="td text-xs">{fmtDate(c.created_at)}</td>
                <td className="td text-xs">{c.customer_type}<div className="text-[#8A93A0]">{c.source}</div></td>
                <td className="td"><Badge tone={stTone(c.status)}>{c.status}</Badge></td>
                <td className="td">{c.temperature ? <Badge tone={tempTone(c.temperature)}>{c.temperature}</Badge> : <span className="text-[#C6CDD6]">—</span>}</td>
                <td className="td text-xs whitespace-nowrap">{c.next_care_date
                  ? <b className={c.next_care_date <= new Date().toLocaleDateString("sv-SE") ? "text-danger" : ""}>{fmtDate(c.next_care_date)}</b>
                  : <span className="text-[#C6CDD6]">—</span>}</td>
                <td className="td text-xs">{c.assigned_name || c.created_by_name}</td>
                <td className="td"><div className="flex gap-1.5">
                  <button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => toggleHistory(c)}>{openId === c.id ? "Thu gọn" : "Chi tiết"}</button>
                  <button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => startEdit(c)}>✎ Sửa</button>
                </div></td>
              </tr>,
              openId === c.id && (
                <tr key={c.id + "h"}><td colSpan={9} className="td bg-[#F8FAFC]">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-xs font-bold mb-2">Lịch sử mua {hist.length > 0 && <>· {hist.reduce((s, o) => s + o.quantity, 0)} xe · <span className="text-brand">{fmtVND(total)}</span></>}</div>
                      {hist.length === 0 ? <span className="text-sm text-[#8A93A0]">Chưa có đơn mua nào.</span> : hist.map((o) => {
                        const v = vOf(o.vehicle_id);
                        return (
                          <div key={o.id} className="flex gap-2.5 flex-wrap items-center py-1.5 border-t border-[#EEF1F4] text-[12.5px]">
                            <b>{o.code}</b><span>{fmtDate(o.sale_date)}</span>
                            <span>{v ? `${v.name} ${v.color}` : o.vehicle_id} × {o.quantity}</span>
                            <span className="text-[#8A93A0]">{locName(o.location_code)}</span>
                            <b className="text-brand">{fmtVND(o.sale_price * o.quantity)}</b>
                          </div>
                        );
                      })}
                    </div>
                    <div>
                      <div className="text-xs font-bold mb-2">Lịch sử chăm sóc ({logs.length})</div>
                      <div className="max-h-40 overflow-y-auto mb-2">
                        {logs.length === 0 && <span className="text-sm text-[#8A93A0]">Chưa có lần chăm sóc nào.</span>}
                        {logs.map((l) => {
                          const backdated = new Date(l.created_at).toISOString().slice(0, 10) !== l.care_date;
                          return (
                            <div key={l.id} className="py-1.5 border-t border-[#EEF1F4] text-[12.5px]">
                              <div className="flex items-center gap-2"><b>{fmtDate(l.care_date)}</b><span className="text-[#8A93A0]">· {l.created_by_name}</span>
                                <button className="ml-auto text-[#C6CDD6] hover:text-danger text-xs" onClick={() => removeCare(c.id, l.id)}>✕</button></div>
                              <div>{l.content}</div>
                              {l.result && <div className="text-[#5A6572]">Kết quả: {l.result}</div>}
                              <div className={`text-[10.5px] italic ${backdated ? "text-[#A25F00]" : "text-[#C6CDD6]"}`}>
                                Nhập lúc {fmtTime(l.created_at)}{backdated ? " ⚠ khác ngày chăm sóc đã chọn" : ""}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="bg-white border border-[#E6EAEF] rounded-lg p-2.5">
                        <div className="flex gap-1.5 mb-1.5">
                          <input type="date" className="inp !py-1.5 !text-xs !w-36" value={cf.care_date} onChange={(e) => setCareForm((p) => ({ ...p, [c.id]: { ...cf, care_date: e.target.value } }))} />
                          <input className="inp !py-1.5 !text-xs flex-1" placeholder="Nội dung chăm sóc…" value={cf.content} onChange={(e) => setCareForm((p) => ({ ...p, [c.id]: { ...cf, content: e.target.value } }))} />
                        </div>
                        <div className="flex gap-1.5">
                          <input className="inp !py-1.5 !text-xs flex-1" placeholder="Kết quả (tùy chọn)…" value={cf.result} onChange={(e) => setCareForm((p) => ({ ...p, [c.id]: { ...cf, result: e.target.value } }))} />
                          <input type="date" title="Hẹn chăm sóc lần sau" className="inp !py-1.5 !text-xs !w-36" value={cf.next || ""} onChange={(e) => setCareForm((p) => ({ ...p, [c.id]: { ...cf, next: e.target.value } }))} />
                          <button className="btn-primary !py-1.5 !text-xs" onClick={() => saveCare(c.id)}>Lưu</button>
                        </div>
                        <div className="text-[10.5px] text-[#8A93A0] mt-1">Ô ngày bên phải = hẹn chăm sóc lần sau (hiện ở "Việc cần chăm sóc").</div>
                      </div>
                    </div>
                  </div>
                </td></tr>
              ),
            ];
          })}</tbody>
        </table></div>
        <Pager total={filtered.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
      </div>
    </div>
  );
}
