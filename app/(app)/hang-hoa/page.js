"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, Field, Pager, pageSlice, useSortable, Th, MoneyInput } from "@/components/ui";
import { fmtVND, fmtDate, fmtTime, errMsg } from "@/lib/format";

const GROUPS = ["Phụ kiện", "Phụ tùng", "Quà tặng", "Vật tư", "Khác"];
const UNITS = ["Cái", "Bộ", "Hộp", "Chiếc", "Kg", "Lít", "Cuộn", "Đôi"];
const emptyF = { name: "", group_name: "Phụ kiện", unit: "Cái", cost_price: "", sale_price: "", min_qty: "0", barcode: "", note: "", location_code: "", status: "Hoạt động" };

export default function HangHoa() {
  const { supabase, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [products, setProducts] = useState([]);
  const [busy, setBusy] = useState(true);
  const [tab, setTab] = useState("list"); // list | txn
  const [q, setQ] = useState("");
  const [fGroup, setFGroup] = useState("");
  const [fLoc, setFLoc] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const sort = useSortable();
  // Form tao/sua SP
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [f, setF] = useState(emptyF);
  // Panel nhap ton
  const [nhapId, setNhapId] = useState(null);
  const [nhapF, setNhapF] = useState({ qty: "", cost_price: "", note: "" });
  // Panel dieu chinh
  const [dieuChinhId, setDieuChinhId] = useState(null);
  const [dcF, setDcF] = useState({ qty: "", note: "" });
  // Lich su
  const [histId, setHistId] = useState(null);
  const [hist, setHist] = useState([]);

  const load = async () => {
    setBusy(true);
    const { data } = await supabase.from("products").select("*").order("group_name").order("name");
    setProducts(data || []);
    setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải…</div>;
  const isManager = ["CEO","MANAGER","ADMIN"].includes(profile.role);
  const locName = (c) => locations.find(l => l.code === c)?.name || c || "—";

  const kw = q.trim().toLowerCase();
  const filtered = products.filter(p => {
    if (fGroup && p.group_name !== fGroup) return false;
    if (fLoc && p.location_code !== fLoc) return false;
    if (!kw) return true;
    return `${p.code} ${p.name} ${p.barcode}`.toLowerCase().includes(kw);
  });
  const sorted = sort.sortFn(filtered, {
    name: p => p.name, group: p => p.group_name, ton: p => p.stock_qty,
    gia: p => p.sale_price, loc: p => locName(p.location_code),
  });

  const tongSP = products.filter(p => p.status === "Hoạt động").length;
  const canBaoHieu = products.filter(p => p.stock_qty <= p.min_qty && p.min_qty > 0).length;
  const hetHang = products.filter(p => p.stock_qty === 0 && p.status === "Hoạt động").length;
  const tongGiaTri = products.reduce((s, p) => s + p.stock_qty * p.cost_price, 0);

  const luuSP = async () => {
    if (!f.name.trim()) return notify("Nhập tên sản phẩm.", "err");
    setBusy(true);
    if (editId) {
      const { error } = await supabase.from("products").update({
        name: f.name.trim(), group_name: f.group_name, unit: f.unit,
        cost_price: Number(f.cost_price) || 0, sale_price: Number(f.sale_price) || 0,
        min_qty: Number(f.min_qty) || 0, barcode: f.barcode, note: f.note,
        location_code: f.location_code || null, status: f.status, updated_at: new Date().toISOString(),
      }).eq("id", editId);
      setBusy(false);
      if (error) return notify(errMsg(error), "err");
    } else {
      const code = "HH" + Date.now().toString().slice(-6);
      const { error } = await supabase.from("products").insert({
        code, name: f.name.trim(), group_name: f.group_name, unit: f.unit,
        cost_price: Number(f.cost_price) || 0, sale_price: Number(f.sale_price) || 0,
        min_qty: Number(f.min_qty) || 0, barcode: f.barcode, note: f.note,
        location_code: f.location_code || null, status: f.status,
        created_by: profile.id, created_by_name: profile.name,
      });
      setBusy(false);
      if (error) return notify(errMsg(error), "err");
    }
    notify(editId ? "Đã cập nhật sản phẩm." : "Đã thêm sản phẩm mới.");
    setShowForm(false); setEditId(null); setF(emptyF); load();
  };

  const luuNhap = async () => {
    if (!Number(nhapF.qty)) return notify("Nhập số lượng.", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_nhap_hang_hoa", { p: {
      product_id: nhapId, qty: Number(nhapF.qty),
      cost_price: Number(nhapF.cost_price) || 0, note: nhapF.note,
    }});
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã nhập tồn kho."); setNhapId(null); load();
  };

  const luuDieuChinh = async () => {
    const qty = Number(dcF.qty);
    if (!qty) return notify("Nhập số lượng điều chỉnh (có thể âm để giảm).", "err");
    if (!dcF.note.trim()) return notify("Nhập lý do điều chỉnh.", "err");
    const prod = products.find(p => p.id === dieuChinhId);
    if (!prod) return;
    const newQty = prod.stock_qty + qty;
    if (newQty < 0) return notify("Tồn kho sau điều chỉnh không được âm.", "err");
    setBusy(true);
    const { error } = await supabase.from("products").update({ stock_qty: newQty, updated_at: new Date().toISOString() }).eq("id", dieuChinhId);
    if (!error) await supabase.from("product_txns").insert({
      product_id: dieuChinhId, txn_type: "Điều chỉnh", qty,
      stock_before: prod.stock_qty, stock_after: newQty,
      note: dcF.note, created_by: profile.id, created_by_name: profile.name,
    });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã điều chỉnh tồn kho."); setDieuChinhId(null); load();
  };

  const xemLichSu = async (id) => {
    setHistId(id);
    const { data } = await supabase.from("product_txns").select("*").eq("product_id", id).order("created_at", { ascending: false }).limit(100);
    setHist(data || []);
  };

  const openEdit = (p) => {
    setEditId(p.id);
    setF({ name: p.name, group_name: p.group_name, unit: p.unit, cost_price: p.cost_price, sale_price: p.sale_price, min_qty: p.min_qty, barcode: p.barcode || "", note: p.note || "", location_code: p.location_code || "", status: p.status });
    setShowForm(true);
  };

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Toast toast={toast} />

      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Quản lý Hàng hóa</div>
        {isManager && <button className="btn-primary !text-xs" onClick={() => { setEditId(null); setF(emptyF); setShowForm(true); }}>+ Thêm sản phẩm</button>}
      </div>

      <div className="flex gap-3 flex-wrap">
        <KPI label="Tổng sản phẩm" value={tongSP} tone="dark" />
        <KPI label="Giá trị tồn" value={fmtVND(tongGiaTri)} tone="blue" />
        <KPI label="Sắp hết hàng" value={canBaoHieu} tone={canBaoHieu > 0 ? "amber" : "dark"} />
        <KPI label="Hết hàng" value={hetHang} tone={hetHang > 0 ? "red" : "dark"} />
      </div>

      {/* FORM THÊM/SỬA */}
      {showForm && (
        <div className="card border-l-4 border-l-brand">
          <div className="font-extrabold mb-3">{editId ? "Sửa sản phẩm" : "Thêm sản phẩm mới"}</div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="md:col-span-2"><Field label="Tên sản phẩm *"><input className="inp" value={f.name} onChange={e => setF(p => ({...p, name: e.target.value}))} placeholder="VD: Mũ bảo hiểm VinFast" /></Field></div>
            <Field label="Nhóm">
              <select className="inp" value={f.group_name} onChange={e => setF(p => ({...p, group_name: e.target.value}))}>
                {GROUPS.map(g => <option key={g}>{g}</option>)}
              </select>
            </Field>
            <Field label="Đơn vị tính">
              <select className="inp" value={f.unit} onChange={e => setF(p => ({...p, unit: e.target.value}))}>
                {UNITS.map(u => <option key={u}>{u}</option>)}
              </select>
            </Field>
            <Field label="Giá vốn"><MoneyInput value={f.cost_price} onChange={v => setF(p => ({...p, cost_price: v}))} /></Field>
            <Field label="Giá bán lẻ"><MoneyInput value={f.sale_price} onChange={v => setF(p => ({...p, sale_price: v}))} /></Field>
            <Field label="Cảnh báo tồn tối thiểu"><input type="number" className="inp" value={f.min_qty} onChange={e => setF(p => ({...p, min_qty: e.target.value}))} /></Field>
            <Field label="Kho lưu trữ">
              <select className="inp" value={f.location_code} onChange={e => setF(p => ({...p, location_code: e.target.value}))}>
                <option value="">— Không chỉ định —</option>
                {locations.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </Field>
            <Field label="Mã vạch / Barcode"><input className="inp" value={f.barcode} onChange={e => setF(p => ({...p, barcode: e.target.value}))} /></Field>
            <Field label="Trạng thái">
              <select className="inp" value={f.status} onChange={e => setF(p => ({...p, status: e.target.value}))}>
                <option>Hoạt động</option><option>Ngừng</option>
              </select>
            </Field>
            <div className="md:col-span-3"><Field label="Ghi chú"><input className="inp" value={f.note} onChange={e => setF(p => ({...p, note: e.target.value}))} /></Field></div>
          </div>
          <div className="flex gap-2 mt-3">
            <button className="btn-ok !text-xs" disabled={busy} onClick={luuSP}>{busy ? "Đang lưu…" : editId ? "Cập nhật" : "Thêm sản phẩm"}</button>
            <button className="btn-ghost !text-xs" onClick={() => { setShowForm(false); setEditId(null); }}>Hủy</button>
          </div>
        </div>
      )}

      {/* BỘ LỌC */}
      <div className="flex gap-2 flex-wrap">
        <input className="inp !w-52" placeholder="Tìm tên, mã, barcode…" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} />
        <select className="inp !w-auto" value={fGroup} onChange={e => { setFGroup(e.target.value); setPage(1); }}>
          <option value="">Tất cả nhóm</option>
          {GROUPS.map(g => <option key={g}>{g}</option>)}
        </select>
        <select className="inp !w-auto" value={fLoc} onChange={e => { setFLoc(e.target.value); setPage(1); }}>
          <option value="">Tất cả kho</option>
          {locations.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </div>

      {/* BẢNG DANH SÁCH */}
      <div className="card">
        {busy ? <div className="text-[#8A93A0] text-sm">Đang tải…</div> : (
          <>
            <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
              <thead><tr>
                <Th label="Tên sản phẩm" k="name" sort={sort} />
                <Th label="Nhóm" k="group" sort={sort} />
                <Th label="ĐVT" k="unit" sort={sort} />
                <Th label="Tồn kho" k="ton" sort={sort} />
                <Th label="Giá vốn" k="gv" sort={sort} />
                <Th label="Giá bán" k="gia" sort={sort} />
                <Th label="Kho lưu" k="loc" sort={sort} />
                <th className="th"></th>
              </tr></thead>
              <tbody>{pageSlice(sorted, page, pageSize).map(prod => {
                const canBao = prod.stock_qty <= prod.min_qty && prod.min_qty > 0;
                const hetH = prod.stock_qty === 0;
                return [
                  <tr key={prod.id} className={`${hetH ? "bg-[#FFF6F6]" : canBao ? "bg-[#FFFCF0]" : "hover:bg-[#F8FAFC]"} ${prod.status === "Ngừng" ? "opacity-50" : ""}`}>
                    <td className="td">
                      <div className="font-semibold text-[13px]">{prod.name}</div>
                      <div className="text-[10.5px] text-[#8A93A0]">{prod.code}{prod.barcode && ` · ${prod.barcode}`}</div>
                    </td>
                    <td className="td text-xs">{prod.group_name}</td>
                    <td className="td text-xs text-center">{prod.unit}</td>
                    <td className="td text-center">
                      <span className={`font-bold text-[15px] ${hetH ? "text-danger" : canBao ? "text-[#A25F00]" : "text-[#0E7A4A]"}`}>{prod.stock_qty}</span>
                      {canBao && !hetH && <div className="text-[9.5px] text-[#A25F00]">⚠ tối thiểu {prod.min_qty}</div>}
                      {hetH && <div className="text-[9.5px] text-danger">Hết hàng</div>}
                    </td>
                    <td className="td text-right text-xs">{prod.cost_price > 0 ? fmtVND(prod.cost_price) : "—"}</td>
                    <td className="td text-right font-bold">{prod.sale_price > 0 ? fmtVND(prod.sale_price) : "—"}</td>
                    <td className="td text-xs">{locName(prod.location_code)}</td>
                    <td className="td">
                      <div className="flex flex-col gap-1">
                        {isManager && <button className="btn-ok !px-2 !py-1 !text-xs" onClick={() => { setNhapId(prod.id); setNhapF({ qty: "", cost_price: prod.cost_price, note: "" }); }}>+ Nhập</button>}
                        <div className="flex gap-1">
                          {isManager && <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => openEdit(prod)}>✎</button>}
                          {isManager && <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => { setDieuChinhId(prod.id); setDcF({ qty: "", note: "" }); }}>±</button>}
                          <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => xemLichSu(prod.id)}>📋</button>
                        </div>
                      </div>
                    </td>
                  </tr>,
                  // PANEL NHẬP TỒN
                  nhapId === prod.id && (
                    <tr key={prod.id+"_nhap"}><td colSpan={8} className="td bg-[#E5F6EE] !p-3">
                      <div className="font-semibold text-[#0E7A4A] mb-2">📦 Nhập tồn — {prod.name}</div>
                      <div className="flex gap-2 flex-wrap items-end">
                        <Field label="Số lượng nhập *"><input type="number" className="inp !w-24" value={nhapF.qty} onChange={e => setNhapF(p => ({...p, qty: e.target.value}))} autoFocus /></Field>
                        <Field label="Giá vốn/đơn vị"><MoneyInput value={nhapF.cost_price} onChange={v => setNhapF(p => ({...p, cost_price: v}))} /></Field>
                        <Field label="Ghi chú"><input className="inp !w-48" value={nhapF.note} onChange={e => setNhapF(p => ({...p, note: e.target.value}))} placeholder="VD: nhập từ NCC X" /></Field>
                        <button className="btn-ok !text-xs" disabled={busy} onClick={luuNhap}>Xác nhận</button>
                        <button className="btn-ghost !text-xs" onClick={() => setNhapId(null)}>Hủy</button>
                      </div>
                    </td></tr>
                  ),
                  // PANEL ĐIỀU CHỈNH
                  dieuChinhId === prod.id && (
                    <tr key={prod.id+"_dc"}><td colSpan={8} className="td bg-[#FFF8E5] !p-3">
                      <div className="font-semibold text-[#A25F00] mb-2">± Điều chỉnh tồn — {prod.name} (hiện: {prod.stock_qty} {prod.unit})</div>
                      <div className="flex gap-2 flex-wrap items-end">
                        <Field label="Số lượng (+/-)"><input type="number" className="inp !w-24" value={dcF.qty} onChange={e => setDcF(p => ({...p, qty: e.target.value}))} placeholder="-2 hoặc +5" autoFocus /></Field>
                        <Field label="Lý do *"><input className="inp !w-52" value={dcF.note} onChange={e => setDcF(p => ({...p, note: e.target.value}))} placeholder="VD: kiểm kê thực tế" /></Field>
                        <button className="btn-ok !text-xs" disabled={busy} onClick={luuDieuChinh}>Lưu</button>
                        <button className="btn-ghost !text-xs" onClick={() => setDieuChinhId(null)}>Hủy</button>
                      </div>
                    </td></tr>
                  ),
                  // PANEL LỊCH SỬ
                  histId === prod.id && (
                    <tr key={prod.id+"_hist"}><td colSpan={8} className="td bg-[#F8FAFC] !p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="font-semibold">📋 Lịch sử xuất nhập — {prod.name}</div>
                        <button className="btn-ghost !text-xs ml-auto" onClick={() => setHistId(null)}>✕ Đóng</button>
                      </div>
                      {hist.length === 0 ? <div className="text-[#8A93A0] text-sm">Chưa có giao dịch nào.</div> : (
                        <div className="tbl-scroll"><table className="w-full text-[12px] border-collapse">
                          <thead><tr className="text-[11px] text-[#8A93A0] border-b border-[#E3E8EF]">
                            <th className="text-left py-1.5 pl-2">Thời gian</th>
                            <th className="text-left py-1.5">Loại</th>
                            <th className="text-right py-1.5">SL</th>
                            <th className="text-right py-1.5">Trước</th>
                            <th className="text-right py-1.5">Sau</th>
                            <th className="text-left py-1.5">Mã đơn</th>
                            <th className="text-left py-1.5">Người</th>
                            <th className="text-left py-1.5 pr-2">Ghi chú</th>
                          </tr></thead>
                          <tbody>{hist.map(h => (
                            <tr key={h.id} className="border-b border-dashed border-[#F0F2F5]">
                              <td className="py-1.5 pl-2 whitespace-nowrap text-[#8A93A0]">{fmtTime(h.created_at)}</td>
                              <td className="py-1.5"><Badge tone={h.txn_type==="Nhập"?"green":h.txn_type==="Xuất"?"amber":"blue"}>{h.txn_type}</Badge></td>
                              <td className="py-1.5 text-right font-bold">{h.qty > 0 ? "+" : ""}{h.qty}</td>
                              <td className="py-1.5 text-right text-[#8A93A0]">{h.stock_before}</td>
                              <td className="py-1.5 text-right font-bold">{h.stock_after}</td>
                              <td className="py-1.5 text-brand">{h.ref_code || "—"}</td>
                              <td className="py-1.5 text-[#5A6572]">{h.created_by_name}</td>
                              <td className="py-1.5 pr-2 text-[#5A6572]">{h.note}</td>
                            </tr>
                          ))}</tbody>
                        </table></div>
                      )}
                    </td></tr>
                  ),
                ];
              })}
              {sorted.length === 0 && <tr><td colSpan={8} className="td">Không có sản phẩm nào.</td></tr>}
              </tbody>
            </table></div>
            <Pager total={sorted.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
          </>
        )}
      </div>
    </div>
  );
}
