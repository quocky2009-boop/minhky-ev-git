"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, Field, CustomerSearch, LocSearch, Pager, pageSlice } from "@/components/ui";
import { fmtVND, fmtDate, errMsg } from "@/lib/format";

const iso = (d) => d.toLocaleDateString("sv-SE");
const ST = { DANG_GIU: { label: "Đang giữ", tone: "amber" }, DA_BAN: { label: "Đã bán", tone: "green" }, HET_HAN: { label: "Hết hạn", tone: "dark" }, HUY: { label: "Đã hủy", tone: "red" } };

export default function DatCoc() {
  const { supabase, vehicles, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [rows, setRows] = useState([]);
  const [custs, setCusts] = useState([]);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fSt, setFSt] = useState("DANG_GIU");
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ frame_number: "", customer_id: "", customer_name: "", customer_phone: "", amount: "", hold_until: iso(new Date(Date.now() + 3 * 86400000)), note: "" });
  const [newC, setNewC] = useState(null);
  const [frameInfo, setFrameInfo] = useState(null);

  const load = async () => {
    const [{ data: d }, { data: c }] = await Promise.all([
      supabase.from("deposits").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("customers").select("id,code,name,phone,status").order("created_at", { ascending: false }).limit(2000),
    ]);
    setRows(d || []); setCusts(c || []);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  const vName = (id) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.name} ${v.color}` : id; };
  const locName = (c) => locations.find((l) => l.code === c)?.name || c;

  const timXe = async (sk) => {
    if (!sk.trim()) return setFrameInfo(null);
    const { data } = await supabase.from("vehicle_units").select("*").eq("frame_number", sk.trim().toUpperCase()).maybeSingle();
    setFrameInfo(data || { notfound: true });
  };

  const createQuick = async () => {
    if (!newC.name.trim() || !newC.phone.trim()) return notify("Nhập tên và SĐT khách.", "err");
    const { data, error } = await supabase.rpc("fn_luu_khach_hang", { p: { name: newC.name, phone: newC.phone, source: "Đặt cọc" } });
    if (error) return notify(errMsg(error), "err");
    await load();
    setF((p) => ({ ...p, customer_id: data, customer_name: newC.name, customer_phone: newC.phone }));
    setNewC(null); notify("Đã tạo khách mới.");
  };

  const datCoc = async () => {
    if (!f.frame_number || !f.customer_name || !f.customer_phone) return notify("Nhập số khung và chọn khách.", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_dat_coc", { p: { ...f, amount: Number(f.amount) || 0 } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã giữ xe — phiếu cọc ${data}. Xe chuyển trạng thái "Giữ chỗ", không ai bán trùng được.`);
    setShow(false); setFrameInfo(null);
    setF({ frame_number: "", customer_id: "", customer_name: "", customer_phone: "", amount: "", hold_until: iso(new Date(Date.now() + 3 * 86400000)), note: "" });
    load();
  };

  const huyCoc = async (d) => {
    const ly = prompt(`Hủy giữ xe ${d.frame_number} (cọc ${d.code})?\nXe sẽ trở lại tồn kho.\nNhập lý do:`);
    if (ly === null) return;
    const { error } = await supabase.rpc("fn_huy_coc", { p_id: d.id, p_ly_do: ly });
    if (error) return notify(errMsg(error), "err");
    notify("Đã hủy giữ xe — xe trở lại tồn kho."); load();
  };

  const nhaQuaHan = async () => {
    const { data, error } = await supabase.rpc("fn_nha_coc_qua_han");
    if (error) return notify(errMsg(error), "err");
    notify(data > 0 ? `Đã nhả ${data} xe quá hạn giữ về tồn kho.` : "Không có phiếu cọc nào quá hạn.");
    load();
  };

  const filtered = rows.filter((d) => !fSt || d.status === fSt);
  const dangGiu = rows.filter((d) => d.status === "DANG_GIU");
  const quaHan = dangGiu.filter((d) => new Date(d.hold_until) < new Date(iso(new Date())));
  const tongCoc = dangGiu.reduce((a, b) => a + Number(b.amount), 0);

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Đặt cọc / Giữ xe</div>
        {quaHan.length > 0 && <button className="btn-ghost !text-xs" onClick={nhaQuaHan}>↺ Nhả {quaHan.length} xe quá hạn</button>}
        <button className="btn-primary !text-sm" onClick={() => setShow(!show)}>{show ? "Đóng" : "+ Nhận cọc giữ xe"}</button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <KPI label="Xe đang giữ" value={dangGiu.length} tone={dangGiu.length ? "amber" : "dark"} />
        <KPI label="Tiền cọc đang giữ" value={fmtVND(tongCoc)} tone="blue" />
        <KPI label="Quá hạn giữ" value={quaHan.length} tone={quaHan.length ? "red" : "green"} />
        <KPI label="Đã chuyển thành đơn" value={rows.filter((d) => d.status === "DA_BAN").length} tone="green" />
      </div>

      {show && (
        <div className="card !p-4 border-2 border-brand">
          <div className="font-extrabold mb-3">Nhận cọc giữ xe</div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Số khung xe cần giữ" required>
              <input className="inp" value={f.frame_number} placeholder="Nhập/quét số khung"
                onChange={(e) => { const v = e.target.value.toUpperCase(); setF((p) => ({ ...p, frame_number: v })); }}
                onBlur={(e) => timXe(e.target.value)} />
              {frameInfo && (frameInfo.notfound
                ? <div className="text-[11px] text-danger mt-1">Không tìm thấy số khung này trong kho.</div>
                : <div className="text-[11px] mt-1">
                    <b>{vName(frameInfo.vehicle_id)}</b> · {locName(frameInfo.location_code)} ·{" "}
                    {frameInfo.status === "TON_KHO" ? <span className="text-[#0E7A4A]">sẵn sàng giữ</span>
                      : frameInfo.status === "GIU_CHO" ? <span className="text-danger">đang giữ cho khách khác</span>
                      : <span className="text-danger">trạng thái {frameInfo.status}</span>}
                  </div>)}
            </Field>
            <Field label="Khách đặt cọc" required>
              {newC ? (
                <div className="grid gap-2 p-2.5 bg-[#F0FDF6] rounded-xl">
                  <input className="inp" placeholder="Họ tên *" value={newC.name} onChange={(e) => setNewC((p) => ({ ...p, name: e.target.value }))} />
                  <input className="inp" placeholder="SĐT *" value={newC.phone} onChange={(e) => setNewC((p) => ({ ...p, phone: e.target.value }))} />
                  <div className="flex gap-2"><button className="btn-ok !text-xs" onClick={createQuick}>Lưu khách</button><button className="btn-ghost !text-xs" onClick={() => setNewC(null)}>Hủy</button></div>
                </div>
              ) : (
                <CustomerSearch customers={custs} value={f.customer_id}
                  onPick={(c) => setF((p) => ({ ...p, customer_id: c?.id || "", customer_name: c?.name || "", customer_phone: c?.phone || "" }))}
                  onCreate={(name) => setNewC({ name: name || "", phone: "" })} />
              )}
            </Field>
            <Field label="Số tiền cọc"><input type="number" className="inp" value={f.amount} onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))} placeholder="VD: 2000000" /></Field>
            <Field label="Giữ xe đến ngày" required><input type="date" className="inp" value={f.hold_until} onChange={(e) => setF((p) => ({ ...p, hold_until: e.target.value }))} /></Field>
            <div className="md:col-span-2"><Field label="Ghi chú"><input className="inp" value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} /></Field></div>
          </div>
          <div className="flex gap-2 mt-3">
            <button className="btn-ok" disabled={busy} onClick={datCoc}>{busy ? "Đang lưu…" : "🔒 Giữ xe này"}</button>
            <button className="btn-ghost" onClick={() => setShow(false)}>Hủy</button>
          </div>
          <p className="text-[11px] text-[#8A93A0] mt-2">Xe được giữ sẽ chuyển trạng thái "Giữ chỗ" — sales khác không tạo đơn bán chiếc này được, trừ khi đúng SĐT khách đã cọc. Khi bán, tiền cọc tự cộng vào "đã thanh toán" của đơn.</p>
        </div>
      )}

      <div className="card">
        <div className="flex gap-2 items-center mb-3 flex-wrap">
          <div className="font-extrabold mr-auto">Danh sách phiếu cọc ({filtered.length})</div>
          <select className="inp !w-auto" value={fSt} onChange={(e) => { setFSt(e.target.value); setPage(1); }}>
            <option value="">Tất cả</option>
            {Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          {pageSlice(filtered, page, 15).map((d) => {
            const st = ST[d.status] || { label: d.status, tone: "dark" };
            const qh = d.status === "DANG_GIU" && new Date(d.hold_until) < new Date(iso(new Date()));
            return (
              <div key={d.id} className={`flex items-center gap-2 p-2.5 rounded-xl border ${qh ? "border-[#F5B5B5] bg-[#FFF6F6]" : "border-[#E3E8EF]"}`}>
                <div className="mr-auto min-w-0">
                  <div className="font-semibold text-sm">{d.code} · {d.customer_name} <span className="text-[11px] text-[#8A93A0]">{d.customer_phone}</span></div>
                  <div className="text-[11px] text-[#8A93A0] truncate">{vName(d.vehicle_id)} · SK {d.frame_number} · {locName(d.location_code)} · giữ đến {fmtDate(d.hold_until)}{d.note ? " · " + d.note : ""}</div>
                </div>
                {d.amount > 0 && <b className="text-[13px] whitespace-nowrap">{fmtVND(d.amount)}</b>}
                {qh && <Badge tone="red">Quá hạn</Badge>}
                <Badge tone={st.tone}>{st.label}</Badge>
                {d.status === "DANG_GIU" && <button className="btn-ghost !px-2 !py-1 !text-xs !text-danger" onClick={() => huyCoc(d)}>Hủy giữ</button>}
              </div>
            );
          })}
          {filtered.length === 0 && <div className="text-sm text-[#8A93A0]">Không có phiếu cọc nào.</div>}
        </div>
        <Pager total={filtered.length} page={page} setPage={setPage} pageSize={15} setPageSize={() => {}} />
      </div>
    </div>
  );
}
