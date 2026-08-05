"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, LocSearch, VehicleSearch, Pager, pageSlice, useSortable, Th } from "@/components/ui";
import { fmtDate, fmtTime, errMsg } from "@/lib/format";

const iso = (d) => d.toLocaleDateString("sv-SE");
const emptyLine = { vehicle_id: "", qty: 1, note: "" };

const TAB_STATUS = { "tat-ca": null, "chua-nhap": "Chưa nhập", "nhap-mot-phan": "Nhập một phần", "hoan-thanh": "Hoàn thành" };
const STATUS_TONE = { "Chưa nhập": "amber", "Nhập một phần": "blue", "Hoàn thành": "green", "Đã hủy": "dark" };

export default function DatHangNhap() {
  const { supabase, vehicles, locations, settings, profile, loading, refresh } = useCatalog();
  const { toast, notify } = useToast();
  const [orders, setOrders] = useState([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("tat-ca");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const sort = useSortable();

  const [showForm, setShowForm] = useState(false);
  const [meta, setMeta] = useState({ location_code: "", supplier: "", ngay_du_kien: "", note: "" });
  const [lines, setLines] = useState([{ ...emptyLine }]);

  const load = async () => {
    setBusy(true);
    const { data: po } = await supabase.from("purchase_orders").select("*").order("created_at", { ascending: false }).limit(2000);
    const { data: ln } = await supabase.from("purchase_order_lines").select("*");
    const byPo = {};
    (ln || []).forEach((l) => { (byPo[l.po_id] = byPo[l.po_id] || []).push(l); });
    setOrders((po || []).map((o) => ({ ...o, lines: byPo[o.id] || [] })));
    setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  const locName = (c) => locations.find((l) => l.code === c)?.name || c;
  const vName = (id) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.brand} ${v.name} ${v.color}` : id; };
  const sups = (settings?.suppliers || "VinFast\nTAILG").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

  const wanted = TAB_STATUS[tab];
  const filtered = orders.filter((o) => {
    if (wanted && o.status !== wanted) return false;
    if (!q) return true;
    const kw = q.toLowerCase();
    const xeStr = o.lines.map((l) => vName(l.vehicle_id)).join(" ");
    return `${o.code} ${o.supplier} ${o.created_by_name} ${xeStr}`.toLowerCase().includes(kw);
  });
  const sorted = sort.sortFn(filtered, {
    doc: (o) => o.code, date: (o) => o.created_at, kho: (o) => locName(o.location_code),
    ncc: (o) => o.supplier, sl: (o) => o.lines.reduce((s, l) => s + l.qty_ordered, 0), nv: (o) => o.created_by_name,
  });

  const soLuong = (o) => o.lines.reduce((s, l) => s + l.qty_ordered, 0);

  const counts = {
    "tat-ca": orders.length,
    "chua-nhap": orders.filter((o) => o.status === "Chưa nhập").length,
    "nhap-mot-phan": orders.filter((o) => o.status === "Nhập một phần").length,
    "hoan-thanh": orders.filter((o) => o.status === "Hoàn thành").length,
  };

  const moForm = () => {
    setShowForm(true); setLines([{ ...emptyLine }]);
    setMeta({ location_code: "", supplier: "", ngay_du_kien: "", note: "" });
  };

  const luuDon = async () => {
    if (!meta.location_code) return notify("Chọn chi nhánh.", "err");
    const ok = lines.filter((l) => l.vehicle_id && Number(l.qty) > 0);
    if (ok.length === 0) return notify("Chưa có dòng sản phẩm hợp lệ.", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_tao_don_dat_hang", { p: {
      location_code: meta.location_code, supplier: meta.supplier, ngay_du_kien: meta.ngay_du_kien || null, note: meta.note,
      lines: ok.map((l) => ({ vehicle_id: l.vehicle_id, qty: Number(l.qty), note: l.note })),
    } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã tạo đơn đặt hàng ${data.code}.`);
    setShowForm(false); load(); refresh();
  };

  // ===== FORM TẠO MỚI =====
  if (showForm) {
    return (
      <div className="flex flex-col gap-4 pb-24">
        <Toast toast={toast} />
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-ghost !text-xs" onClick={() => setShowForm(false)}>← Quay lại danh sách đơn đặt hàng</button>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card lg:col-span-2">
            <div className="font-extrabold mb-2.5">Thông tin nhà cung cấp</div>
            <div className="grid gap-2.5 md:grid-cols-2">
              <Field label="Nhà cung cấp">
                <select className="inp" value={meta.supplier} onChange={(e) => setMeta((p) => ({ ...p, supplier: e.target.value }))}>
                  <option value="">— Chọn NCC —</option>
                  {sups.map((x) => <option key={x}>{x}</option>)}
                </select>
              </Field>
              <Field label="Ngày nhập dự kiến">
                <input type="date" className="inp" value={meta.ngay_du_kien} onChange={(e) => setMeta((p) => ({ ...p, ngay_du_kien: e.target.value }))} />
              </Field>
              <div className="md:col-span-2">
                <Field label="Ghi chú đơn">
                  <input className="inp" value={meta.note} onChange={(e) => setMeta((p) => ({ ...p, note: e.target.value }))} placeholder="VD: Hàng tặng gói riêng" />
                </Field>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="font-extrabold mb-2.5">Thông tin đơn đặt hàng</div>
            <Field label="Chi nhánh" required>
              <LocSearch locations={locations} value={meta.location_code} onChange={(v) => setMeta((p) => ({ ...p, location_code: v }))} />
            </Field>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-2.5">
            <div className="font-extrabold mr-auto">Thông tin sản phẩm</div>
          </div>
          <div className="flex flex-col gap-2.5">
            {lines.map((l, i) => (
              <div key={i} className="grid gap-2.5 md:grid-cols-6 items-end rounded-xl border border-[#E3E8EF] p-2.5">
                <div className="md:col-span-3">
                  <label className="lbl">Model xe + màu</label>
                  <VehicleSearch vehicles={vehicles} value={l.vehicle_id} onChange={(id) => setLines((p) => p.map((x, j) => j === i ? { ...x, vehicle_id: id || "" } : x))} />
                </div>
                <div>
                  <label className="lbl">SL đặt</label>
                  <input type="number" min="1" className="inp" value={l.qty} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
                </div>
                <div className="md:col-span-2 flex gap-2">
                  <div className="flex-1">
                    <label className="lbl">Ghi chú dòng</label>
                    <input className="inp" value={l.note} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, note: e.target.value } : x))} />
                  </div>
                  {lines.length > 1 && (
                    <button className="btn-ghost !px-2.5 !text-danger self-end" onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>✕</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button className="btn-ghost !text-xs mt-2.5" onClick={() => setLines((p) => [...p, { ...emptyLine }])}>⊕ Thêm sản phẩm</button>
        </div>

        <div className="fixed bottom-0 left-0 right-0 lg:left-[248px] bg-white border-t border-[#E6EAEF] px-4 py-3 flex items-center gap-3 z-30">
          <div className="ml-auto flex gap-2">
            <button className="btn-ghost" onClick={() => setShowForm(false)}>Hủy</button>
            <button className="btn-ok !px-6" disabled={busy} onClick={luuDon}>{busy ? "Đang lưu…" : "Tạo đơn đặt hàng"}</button>
          </div>
        </div>
      </div>
    );
  }

  // ===== DANH SÁCH =====
  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Danh sách đơn đặt hàng nhập</div>
        <button className="btn-primary !text-xs" onClick={moForm}>+ Tạo đơn đặt hàng</button>
      </div>

      <div className="card">
        <div className="flex gap-1 border-b border-[#E3E8EF] mb-3 flex-wrap">
          {[["tat-ca", "Tất cả đơn đặt hàng"], ["chua-nhap", "Chưa nhập"], ["nhap-mot-phan", "Nhập một phần"], ["hoan-thanh", "Hoàn thành"]].map(([k, label]) => (
            <button key={k} onClick={() => { setTab(k); setPage(1); }}
              className={`px-3.5 py-2 text-[13px] font-semibold border-b-2 -mb-px ${tab === k ? "border-brand text-brand" : "border-transparent text-[#5A6572] hover:text-brand"}`}>
              {label} <span className="text-[11px] text-[#8A93A0]">({counts[k]})</span>
            </button>
          ))}
        </div>

        <div className="flex gap-2 flex-wrap items-center mb-3">
          <input className="inp !w-64" placeholder="Tìm mã đơn, đơn đặt hàng, tên, NCC…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>

        {busy && orders.length === 0 ? <div className="text-sm text-[#8A93A0] py-4">Đang tải…</div> : (
          <>
            <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
              <thead><tr>
                <Th label="Mã đơn" k="doc" sort={sort} />
                <Th label="Ngày tạo" k="date" sort={sort} />
                <th className="th">Trạng thái</th>
                <Th label="Chi nhánh" k="kho" sort={sort} />
                <Th label="Nhà cung cấp" k="ncc" sort={sort} />
                <Th label="Nhân viên tạo" k="nv" sort={sort} />
                <Th label="SL đặt" k="sl" sort={sort} />
                <th className="th"></th>
              </tr></thead>
              <tbody>{pageSlice(sorted, page, pageSize).map((o) => (
                <tr key={o.id} className="hover:bg-[#F8FAFC]">
                  <td className="td font-bold"><Link href={`/dat-hang-nhap/${o.id}`} className="text-brand hover:underline">{o.code}</Link></td>
                  <td className="td text-xs whitespace-nowrap">{fmtTime(o.created_at)}</td>
                  <td className="td"><Badge tone={STATUS_TONE[o.status]}>{o.status}</Badge></td>
                  <td className="td text-[13px]">{locName(o.location_code)}</td>
                  <td className="td text-[13px]">{o.supplier || <span className="text-[#8A93A0]">—</span>}</td>
                  <td className="td text-xs">{o.created_by_name}</td>
                  <td className="td text-[13px]">{soLuong(o)}</td>
                  <td className="td"><Link href={`/dat-hang-nhap/${o.id}`} className="btn-ghost !px-2 !py-1 !text-xs">👁</Link></td>
                </tr>
              ))}
              {sorted.length === 0 && <tr><td className="td" colSpan={8}>Không có đơn đặt hàng nào khớp bộ lọc.</td></tr>}
              </tbody>
            </table></div>
            <Pager total={sorted.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
          </>
        )}
      </div>
    </div>
  );
}
