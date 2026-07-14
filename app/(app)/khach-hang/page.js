"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, KPI, Pager, pageSlice , useSortable, Th } from "@/components/ui";
import { fmtVND, fmtDate, errMsg } from "@/lib/format";

const digits = (p) => (p || "").replace(/\D/g, "");

export default function KhachHang() {
  const { supabase, vehicles, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [list, setList] = useState([]);
  const [lastBuy, setLastBuy] = useState({}); // customer_id -> don gan nhat
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fType, setFType] = useState("");
  const [show, setShow] = useState(false);
  const empty = { id: "", name: "", phone: "", cccd: "", address: "", note: "" };
  const [f, setF] = useState(empty);
  const [dup, setDup] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [history, setHistory] = useState({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const sort = useSortable();
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const load = async () => {
    const [{ data: cs }, { data: os }] = await Promise.all([
      supabase.from("customers").select("*").order("updated_at", { ascending: false }).limit(500),
      supabase.from("sales_orders").select("customer_id, vehicle_id, location_code, sale_date").order("sale_date", { ascending: false }).limit(2000),
    ]);
    setList(cs || []);
    const m = {};
    (os || []).forEach((o) => { if (o.customer_id && !m[o.customer_id]) m[o.customer_id] = o; });
    setLastBuy(m);
  };
  useEffect(() => { load(); }, []);

  // Canh bao trung SDT khi go
  useEffect(() => {
    const d = digits(f.phone);
    if (d.length < 9) { setDup(null); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("customers").select("id, code, name, phone").eq("phone_digits", d).limit(1);
      const hit = (data || [])[0];
      setDup(hit && String(hit.id) !== String(f.id) ? hit : null);
    }, 350);
    return () => clearTimeout(t);
  }, [f.phone, f.id]);

  const save = async () => {
    const { data, error } = await supabase.rpc("fn_luu_khach_hang", { p: f });
    if (error) return notify(errMsg(error), "err");
    notify(f.id ? "Đã cập nhật khách hàng." : `Đã lưu khách hàng (mã ${data}).`);
    setF(empty); setShow(false); setDup(null); load();
  };

  const startEdit = (c) => {
    setF({ id: c.id, name: c.name, phone: c.phone, cccd: c.cccd || "", address: c.address || "", note: c.note || "" });
    setShow(true); window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleHistory = async (c) => {
    if (openId === c.id) return setOpenId(null);
    setOpenId(c.id);
    if (!history[c.id]) {
      const { data } = await supabase.from("sales_orders").select("*")
        .or(`customer_id.eq.${c.id},customer_phone.eq.${c.phone}`).order("sale_date", { ascending: false });
      setHistory((p) => ({ ...p, [c.id]: data || [] }));
    }
  };

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  const vName = (id) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.name} ${v.color}` : id || ""; };
  const locName = (c) => locations.find((l) => l.code === c)?.name || c;
  const bought = (c) => c.status === "Đã mua" || !!lastBuy[c.id];
  const filtered = list.filter((c) => {
    if (fStatus === "mua" && !bought(c)) return false;
    if (fStatus === "hoso" && bought(c)) return false;
    if (fType && (c.customer_type || "") !== fType) return false;
    const t = (c.code + c.name + c.phone + (c.address || "") + (c.note || "")).toLowerCase();
    return !q || t.includes(q.toLowerCase());
  });
  const nBought = list.filter(bought).length;

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex gap-3 flex-wrap">
        <KPI label="Tổng khách hàng" value={list.length} tone="dark" />
        <KPI label="Đã mua xe" value={nBought} tone="green" />
      </div>

      {!show && <button className="btn-primary self-start" onClick={() => { setF(empty); setShow(true); }}>+ Thêm khách hàng</button>}
      {show && (
        <div className="card">
          <div className="font-extrabold mb-3">{f.id ? "Sửa khách hàng" : "Thêm khách hàng (mã KH tự sinh)"}</div>
          <div className="grid gap-x-4 md:grid-cols-3 sm:grid-cols-2">
            <Field label="Họ tên" required><input className="inp" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="Số điện thoại" required>
              <input className="inp" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
              {dup && <div className="mt-1.5 bg-[#FDF1DF] text-[#A25F00] text-xs font-semibold rounded-lg px-3 py-2">⚠ SĐT đã có trên hệ thống: <b>{dup.name}</b> ({dup.code}).</div>}
            </Field>
            <Field label="CCCD"><input className="inp" value={f.cccd} onChange={(e) => set("cccd", e.target.value)} /></Field>
            <Field label="Địa chỉ"><input className="inp" value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
            <Field label="Ghi chú"><input className="inp" value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
          </div>
          <div className="flex gap-2.5">
            <button className="btn-ok" onClick={save}>{f.id ? "Lưu thay đổi" : "Lưu khách hàng"}</button>
            <button className="btn-ghost" onClick={() => { setShow(false); setF(empty); setDup(null); }}>Hủy</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <div className="font-extrabold mr-auto">Danh sách khách hàng ({filtered.length})</div>
          <input className="inp !w-64" placeholder="Tìm tên, SĐT, mã KH, địa chỉ…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="inp !w-auto" value={fType} onChange={(e) => setFType(e.target.value)}>
            <option value="">Loại khách: tất cả</option>
            {[...new Set(["Khách lẻ", "Khách buôn", "CBNV", ...list.map((c) => c.customer_type).filter(Boolean)])].map((t) => <option key={t}>{t}</option>)}
          </select>
          <select className="inp !w-auto" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">Tất cả</option><option value="mua">Đã mua xe</option><option value="hoso">Hồ sơ (chưa mua)</option>
          </select>
        </div>
        <div className="overflow-x-auto"><table className="w-full border-collapse">
          <thead><tr><Th label="Mã KH" k="code" sort={sort} /><Th label="Khách hàng" k="ten" sort={sort} /><Th label="Loại khách" k="loai" sort={sort} /><Th label="Xe đã mua gần nhất" k="xe" sort={sort} /><Th label="Trạng thái" k="tt" sort={sort} /><Th label="Sales phụ trách" k="nv" sort={sort} /><th className="th">Ghi chú</th><th className="th"></th></tr></thead>
          <tbody>{pageSlice(sort.sortFn(filtered, { code: (c) => c.code, ten: (c) => c.name, loai: (c) => c.customer_type || "", xe: (c) => lastBuy[c.id] ? vName(lastBuy[c.id].vehicle_id) : "", tt: (c) => (bought(c) ? "Đã mua" : "Hồ sơ"), nv: (c) => c.assigned_name || c.created_by_name }), page, pageSize).map((c) => {
            const lb = lastBuy[c.id];
            const hist = history[c.id] || [];
            const total = hist.reduce((s, o) => s + o.sale_price * o.quantity, 0);
            return [
              <tr key={c.id} className="hover:bg-[#F8FAFC]">
                <td className="td font-bold">{c.code}</td>
                <td className="td"><b>{c.name}</b><div className="text-[11px] text-[#8A93A0]">{c.phone}{c.address ? " · " + c.address : ""}</div></td>
                <td className="td text-xs">{c.customer_type ? <Badge tone={c.customer_type === "Khách buôn" ? "purple" : c.customer_type === "CBNV" ? "blue" : "gray"}>{c.customer_type}</Badge> : <span className="text-[#C6CDD6]">—</span>}</td>
                <td className="td text-xs">{lb ? <><b>{vName(lb.vehicle_id)}</b><div className="text-[#8A93A0]">{fmtDate(lb.sale_date)} · {locName(lb.location_code)}</div></> : <span className="text-[#C6CDD6]">—</span>}</td>
                <td className="td">{bought(c) ? <Badge tone="green">Đã mua</Badge> : <Badge tone="gray">Hồ sơ</Badge>}</td>
                <td className="td text-xs">{c.assigned_name || c.created_by_name}</td>
                <td className="td text-xs max-w-[180px]">{c.note}</td>
                <td className="td"><div className="flex gap-1.5">
                  <button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => toggleHistory(c)}>{openId === c.id ? "Thu gọn" : "Lịch sử mua"}</button>
                  <button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => startEdit(c)}>✎ Sửa</button>
                </div></td>
              </tr>,
              openId === c.id && (
                <tr key={c.id + "h"}><td colSpan={8} className="td bg-[#F8FAFC]">
                  {hist.length === 0 ? <span className="text-sm text-[#8A93A0]">Khách này chưa có đơn mua nào trên hệ thống.</span> : (
                    <div>
                      <div className="text-xs font-bold mb-2">Đã mua {hist.reduce((s, o) => s + o.quantity, 0)} xe · Tổng giá trị: <span className="text-brand">{fmtVND(total)}</span></div>
                      {hist.map((o) => (
                        <div key={o.id} className="flex gap-3 flex-wrap items-center py-1.5 border-t border-[#EEF1F4] text-[13px]">
                          <b>{o.code}</b><span>{fmtDate(o.sale_date)}</span>
                          <span>{vName(o.vehicle_id)} × {o.quantity}</span>
                          <span className="text-[#8A93A0]">{locName(o.location_code)}</span>
                          <b className="text-brand">{fmtVND(o.sale_price * o.quantity)}</b>
                          {o.frame_number && <span className="font-mono text-[11px] text-[#8A93A0]">SK: {o.frame_number}</span>}
                          <span className="text-[11px] text-[#8A93A0]">NV: {o.seller_name}</span>
                        </div>
                      ))}
                    </div>
                  )}
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
