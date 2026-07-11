"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, KPI } from "@/components/ui";
import { fmtVND, fmtDate, fmtTime, errMsg } from "@/lib/format";
import { CUSTOMER_TYPES, CUSTOMER_SOURCES } from "@/lib/const";

const STATUSES = ["Lead mới", "Đang tư vấn", "Hẹn xem xe", "Đã mua", "Không mua", "Chăm sóc lại"];
const stTone = (s) => s === "Đã mua" ? "green" : s === "Lead mới" ? "blue" : s === "Không mua" ? "gray" : s === "Chăm sóc lại" ? "purple" : "amber";
const digits = (p) => (p || "").replace(/\D/g, "");

export default function KhachHang() {
  const { supabase, vehicles, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [show, setShow] = useState(false);
  const empty = { id: "", name: "", phone: "", cccd: "", address: "", customer_type: "Khách lẻ", source: "Khách vãng lai", status: "Lead mới", note: "" };
  const [f, setF] = useState(empty);
  const [dup, setDup] = useState(null);          // khach trung SDT
  const [openId, setOpenId] = useState(null);    // dong dang mo lich su
  const [history, setHistory] = useState({});    // customer_id -> don ban
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const load = async () => {
    const { data } = await supabase.from("customers").select("*").order("updated_at", { ascending: false }).limit(500);
    setList(data || []);
  };
  useEffect(() => { load(); }, []);

  // Canh bao trung SDT ngay khi go xong
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
    setF(empty); setShow(false); setDup(null); load();
  };

  const startEdit = (c) => { setF({ id: c.id, name: c.name, phone: c.phone, cccd: c.cccd, address: c.address, customer_type: c.customer_type, source: c.source, status: c.status, note: c.note }); setShow(true); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const toggleHistory = async (c) => {
    if (openId === c.id) return setOpenId(null);
    setOpenId(c.id);
    if (!history[c.id]) {
      const { data } = await supabase.from("sales_orders").select("*")
        .or(`customer_id.eq.${c.id},customer_phone.eq.${c.phone}`)
        .order("sale_date", { ascending: false });
      setHistory((p) => ({ ...p, [c.id]: data || [] }));
    }
  };

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  const vOf = (id) => vehicles.find((x) => x.id === id);
  const locName = (c) => locations.find((l) => l.code === c)?.name || c;
  const filtered = list.filter((c) => {
    if (fStatus && c.status !== fStatus) return false;
    const t = (c.code + c.name + c.phone + (c.address || "")).toLowerCase();
    return !q || t.includes(q.toLowerCase());
  });
  const bought = list.filter((c) => c.status === "Đã mua").length;
  const leads = list.filter((c) => !["Đã mua", "Không mua"].includes(c.status)).length;

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex gap-3 flex-wrap">
        <KPI label="Tổng khách hàng" value={list.length} tone="dark" />
        <KPI label="Lead đang theo" value={leads} tone="blue" />
        <KPI label="Đã mua xe" value={bought} tone="green" />
      </div>

      {!show && <button className="btn-primary self-start" onClick={() => { setF(empty); setShow(true); }}>+ Thêm khách hàng / lead</button>}
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
                  <button className="underline ml-1" onClick={() => { setShow(false); setF(empty); setQ(dup.phone); }}>Xem khách này</button>
                </div>
              )}
            </Field>
            <Field label="CCCD"><input className="inp" value={f.cccd} onChange={(e) => set("cccd", e.target.value)} /></Field>
            <Field label="Địa chỉ"><input className="inp" value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
            <Field label="Loại khách"><select className="inp" value={f.customer_type} onChange={(e) => set("customer_type", e.target.value)}>{CUSTOMER_TYPES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Nguồn khách"><select className="inp" value={f.source} onChange={(e) => set("source", e.target.value)}>{CUSTOMER_SOURCES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Trạng thái"><select className="inp" value={f.status} onChange={(e) => set("status", e.target.value)}>{STATUSES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Ghi chú (nhu cầu, xe quan tâm…)"><input className="inp" value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
          </div>
          <div className="flex gap-2.5">
            <button className="btn-ok" onClick={save}>{f.id ? "Lưu thay đổi" : "Tạo khách hàng"}</button>
            <button className="btn-ghost" onClick={() => { setShow(false); setF(empty); setDup(null); }}>Hủy</button>
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
        </div>
        <div className="overflow-x-auto"><table className="w-full border-collapse">
          <thead><tr><th className="th">Mã KH</th><th className="th">Khách hàng</th><th className="th">Loại · Nguồn</th><th className="th">Trạng thái</th><th className="th">Phụ trách</th><th className="th">Ghi chú</th><th className="th"></th></tr></thead>
          <tbody>{filtered.map((c) => {
            const hist = history[c.id] || [];
            const total = hist.reduce((s, o) => s + o.sale_price * o.quantity, 0);
            return [
              <tr key={c.id} className="hover:bg-[#F8FAFC]">
                <td className="td font-bold">{c.code}</td>
                <td className="td"><b>{c.name}</b><div className="text-[11px] text-[#8A93A0]">{c.phone}{c.address ? " · " + c.address : ""}</div></td>
                <td className="td text-xs">{c.customer_type}<div className="text-[#8A93A0]">{c.source}</div></td>
                <td className="td"><Badge tone={stTone(c.status)}>{c.status}</Badge></td>
                <td className="td text-xs">{c.assigned_name || c.created_by_name}</td>
                <td className="td text-xs max-w-[180px]">{c.note}</td>
                <td className="td"><div className="flex gap-1.5">
                  <button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => toggleHistory(c)}>{openId === c.id ? "Thu gọn" : "Lịch sử mua"}</button>
                  <button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => startEdit(c)}>✎ Sửa</button>
                </div></td>
              </tr>,
              openId === c.id && (
                <tr key={c.id + "h"}><td colSpan={7} className="td bg-[#F8FAFC]">
                  {hist.length === 0 ? <span className="text-sm text-[#8A93A0]">Khách này chưa có đơn mua nào trên hệ thống.</span> : (
                    <div>
                      <div className="text-xs font-bold mb-2">Đã mua {hist.reduce((s, o) => s + o.quantity, 0)} xe · Tổng giá trị: <span className="text-brand">{fmtVND(total)}</span></div>
                      {hist.map((o) => {
                        const v = vOf(o.vehicle_id);
                        return (
                          <div key={o.id} className="flex gap-3 flex-wrap items-center py-1.5 border-t border-[#EEF1F4] text-[13px]">
                            <b>{o.code}</b><span>{fmtDate(o.sale_date)}</span>
                            <span>{v ? `${v.name} ${v.color}` : o.vehicle_id} × {o.quantity}</span>
                            <span className="text-[#8A93A0]">{locName(o.location_code)}</span>
                            <b className="text-brand">{fmtVND(o.sale_price * o.quantity)}</b>
                            {o.frame_number && <span className="font-mono text-[11px] text-[#8A93A0]">SK: {o.frame_number}</span>}
                            <span className="text-[11px] text-[#8A93A0]">NV: {o.seller_name}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </td></tr>
              ),
            ];
          })}</tbody>
        </table></div>
      </div>
    </div>
  );
}
