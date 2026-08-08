"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, Field, Pager, pageSlice, useSortable, Th, MoneyInput } from "@/components/ui";
import { fmtVND, fmtDate, fmtTime, errMsg } from "@/lib/format";

const GROUPS = ["Phụ kiện", "Phụ tùng", "Quà tặng", "Vật tư", "Khác"];
const UNITS = ["Cái", "Bộ", "Hộp", "Chiếc", "Kg", "Lít", "Cuộn", "Đôi"];
const emptyF = { name: "", group_name: "Phụ kiện", unit: "Cái", cost_price: "", sale_price: "", min_qty: "0", barcode: "", note: "", location_code: "", status: "Hoạt động" };

export default function HangHoa() {
  const { supabase, locations, profile, loading, refresh } = useCatalog();
  const { toast, notify } = useToast();
  const [products, setProducts] = useState([]);
  const [stockMap, setStockMap] = useState({}); // { productId: { locCode: qty } }
  const [busy, setBusy] = useState(true);
  const [tab, setTab] = useState("ton"); // ton | dieu_chuyen | kiem_ke
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
  // Panel nhap ton (theo kho)
  const [nhapId, setNhapId] = useState(null);
  const [nhapF, setNhapF] = useState({ location_code: "", qty: "", cost_price: "", note: "" });
  // Panel dieu chinh nhanh 1 san pham (dung chung logic kiem ke 1 dong)
  const [dieuChinhId, setDieuChinhId] = useState(null);
  const [dcF, setDcF] = useState({ location_code: "", qty: "", note: "" });
  // Lich su
  const [histId, setHistId] = useState(null);
  const [hist, setHist] = useState([]);
  // Dieu chuyen
  const [transfers, setTransfers] = useState([]);
  const [tcF, setTcF] = useState({ from_location: "", to_location: "", product_id: "", qty: "", note: "" });
  // Kiem ke
  const [kkLoc, setKkLoc] = useState("");
  const [kkRows, setKkRows] = useState([]); // [{product_id, name, unit, ton, dem}]

  const load = async () => {
    setBusy(true);
    const [{ data: prods }, { data: stock }] = await Promise.all([
      supabase.from("products").select("*").order("group_name").order("name"),
      supabase.from("products_stock").select("*"),
    ]);
    setProducts(prods || []);
    const m = {};
    (stock || []).forEach((s) => { (m[s.product_id] = m[s.product_id] || {})[s.location_code] = s.qty; });
    setStockMap(m);
    setBusy(false);
  };
  const loadTransfers = async () => {
    const { data } = await supabase.from("product_transfers").select("*").order("requested_at", { ascending: false }).limit(200);
    setTransfers(data || []);
  };
  useEffect(() => { if (!loading) { load(); loadTransfers(); } }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải…</div>;
  const isManager = ["CEO","MANAGER","ADMIN"].includes(profile.role);
  const locName = (c) => locations.find(l => l.code === c)?.name || c || "—";

  const tonTong = (p) => Object.values(stockMap[p.id] || {}).reduce((s, n) => s + n, 0);
  const tonTaiKho = (p, loc) => (stockMap[p.id] || {})[loc] || 0;

  const kw = q.trim().toLowerCase();
  const filtered = products.filter(p => {
    if (fGroup && p.group_name !== fGroup) return false;
    if (!kw) return true;
    return `${p.code} ${p.name} ${p.barcode}`.toLowerCase().includes(kw);
  });
  const sorted = sort.sortFn(filtered, {
    name: p => p.name, group: p => p.group_name, ton: p => fLoc ? tonTaiKho(p, fLoc) : tonTong(p),
    gia: p => p.sale_price,
  });

  const tongSP = products.filter(p => p.status === "Hoạt động").length;
  const canBaoHieu = products.filter(p => (fLoc ? tonTaiKho(p, fLoc) : tonTong(p)) <= p.min_qty && p.min_qty > 0).length;
  const hetHang = products.filter(p => (fLoc ? tonTaiKho(p, fLoc) : tonTong(p)) === 0 && p.status === "Hoạt động").length;
  const tongGiaTri = products.reduce((s, p) => s + (fLoc ? tonTaiKho(p, fLoc) : tonTong(p)) * p.cost_price, 0);

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
    if (!nhapF.location_code) return notify("Chọn kho nhập.", "err");
    if (!Number(nhapF.qty)) return notify("Nhập số lượng.", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_hh_nhap_v2", { p: {
      product_id: nhapId, location_code: nhapF.location_code, qty: Number(nhapF.qty),
      unit_cost: Number(nhapF.cost_price) || 0, note: nhapF.note,
    }});
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã nhập tồn kho."); setNhapId(null); load();
  };

  const luuDieuChinh = async () => {
    if (!dcF.location_code) return notify("Chọn kho.", "err");
    const qty = Number(dcF.qty);
    if (!qty) return notify("Nhập số lượng điều chỉnh (có thể âm để giảm).", "err");
    if (!dcF.note.trim()) return notify("Nhập lý do điều chỉnh.", "err");
    const tonHienTai = tonTaiKho(products.find(p => p.id === dieuChinhId) || {}, dcF.location_code);
    const demMoi = tonHienTai + qty;
    if (demMoi < 0) return notify("Tồn kho sau điều chỉnh không được âm.", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_hh_kiem_ke", { p: {
      location_code: dcF.location_code, note: dcF.note,
      items: [{ product_id: dieuChinhId, dem_thuc_te: demMoi }],
    }});
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

  // ===== ĐIỀU CHUYỂN =====
  const taoDieuChuyen = async () => {
    if (!tcF.from_location || !tcF.to_location) return notify("Chọn kho đi và kho đến.", "err");
    if (!tcF.product_id) return notify("Chọn sản phẩm.", "err");
    if (!Number(tcF.qty)) return notify("Nhập số lượng.", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_hh_dieu_chuyen_tao", { p: {
      from_location: tcF.from_location, to_location: tcF.to_location,
      product_id: Number(tcF.product_id), qty: Number(tcF.qty), note: tcF.note,
    }});
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã tạo phiếu điều chuyển ${data.code}.`);
    setTcF({ from_location: "", to_location: "", product_id: "", qty: "", note: "" });
    load(); loadTransfers();
  };
  const nhanDieuChuyen = async (id) => {
    setBusy(true);
    const { error } = await supabase.rpc("fn_hh_dieu_chuyen_nhan", { p_id: id });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã xác nhận nhận hàng."); load(); loadTransfers();
  };
  const huyDieuChuyen = async (id) => {
    const ly_do = prompt("Lý do hủy phiếu điều chuyển:");
    if (ly_do === null) return;
    setBusy(true);
    const { error } = await supabase.rpc("fn_hh_dieu_chuyen_huy", { p_id: id, p_ly_do: ly_do });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã hủy phiếu, hoàn tồn kho đi."); load(); loadTransfers();
  };

  // ===== KIỂM KÊ =====
  const moKiemKe = (loc) => {
    setKkLoc(loc);
    setKkRows(products.filter(p => p.status === "Hoạt động").map(p => ({
      product_id: p.id, name: p.name, unit: p.unit, ton: tonTaiKho(p, loc), dem: tonTaiKho(p, loc),
    })));
  };
  const luuKiemKe = async () => {
    const items = kkRows.filter(r => Number(r.dem) !== r.ton).map(r => ({ product_id: r.product_id, dem_thuc_te: Number(r.dem) }));
    if (items.length === 0) return notify("Không có sản phẩm nào lệch tồn để lưu.", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_hh_kiem_ke", { p: { location_code: kkLoc, note: "Kiểm kê định kỳ", items } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã ghi nhận ${data.so_dong_lech} dòng lệch tồn.`);
    setKkLoc(""); setKkRows([]); load();
  };

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Toast toast={toast} />

      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Quản lý Hàng hóa</div>
        {isManager && tab === "ton" && <button className="btn-primary !text-xs" onClick={() => { setEditId(null); setF(emptyF); setShowForm(true); }}>+ Thêm sản phẩm</button>}
      </div>

      <div className="flex gap-1 border-b border-[#E3E8EF]">
        {[["ton","Tồn kho"],["dieu_chuyen","Điều chuyển"],["kiem_ke","Kiểm kê"]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3.5 py-2 text-[13px] font-semibold border-b-2 -mb-px ${tab === k ? "border-brand text-brand" : "border-transparent text-[#5A6572] hover:text-brand"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "ton" && (
        <>
          <div className="flex gap-3 flex-wrap">
            <KPI label="Tổng sản phẩm" value={tongSP} tone="dark" />
            <KPI label="Giá trị tồn" value={fmtVND(tongGiaTri)} tone="blue" />
            <KPI label="Sắp hết hàng" value={canBaoHieu} tone={canBaoHieu > 0 ? "amber" : "dark"} />
            <KPI label="Hết hàng" value={hetHang} tone={hetHang > 0 ? "red" : "dark"} />
          </div>

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
                <Field label="Giá vốn (lần nhập gần nhất)"><MoneyInput value={f.cost_price} onChange={v => setF(p => ({...p, cost_price: v}))} /></Field>
                <Field label="Giá bán lẻ"><MoneyInput value={f.sale_price} onChange={v => setF(p => ({...p, sale_price: v}))} /></Field>
                <Field label="Cảnh báo tồn tối thiểu"><input type="number" className="inp" value={f.min_qty} onChange={e => setF(p => ({...p, min_qty: e.target.value}))} /></Field>
                <Field label="Kho mặc định (chỉ để tham chiếu)">
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

          <div className="flex gap-2 flex-wrap">
            <input className="inp !w-52" placeholder="Tìm tên, mã, barcode…" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} />
            <select className="inp !w-auto" value={fGroup} onChange={e => { setFGroup(e.target.value); setPage(1); }}>
              <option value="">Tất cả nhóm</option>
              {GROUPS.map(g => <option key={g}>{g}</option>)}
            </select>
            <select className="inp !w-auto" value={fLoc} onChange={e => { setFLoc(e.target.value); setPage(1); }}>
              <option value="">Tất cả kho (xem tổng)</option>
              {locations.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </div>

          <div className="card">
            {busy ? <div className="text-[#8A93A0] text-sm">Đang tải…</div> : (
              <>
                <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
                  <thead><tr>
                    <Th label="Tên sản phẩm" k="name" sort={sort} />
                    <Th label="Nhóm" k="group" sort={sort} />
                    <Th label="ĐVT" k="unit" sort={sort} />
                    <Th label={fLoc ? `Tồn tại ${locName(fLoc)}` : "Tồn (tổng mọi kho)"} k="ton" sort={sort} />
                    <Th label="Giá vốn" k="gv" sort={sort} />
                    <Th label="Giá bán" k="gia" sort={sort} />
                    <th className="th"></th>
                  </tr></thead>
                  <tbody>{pageSlice(sorted, page, pageSize).map(prod => {
                    const ton = fLoc ? tonTaiKho(prod, fLoc) : tonTong(prod);
                    const canBao = ton <= prod.min_qty && prod.min_qty > 0;
                    const hetH = ton === 0;
                    return [
                      <tr key={prod.id} className={`${hetH ? "bg-[#FFF6F6]" : canBao ? "bg-[#FFFCF0]" : "hover:bg-[#F8FAFC]"} ${prod.status === "Ngừng" ? "opacity-50" : ""}`}>
                        <td className="td">
                          <div className="font-semibold text-[13px]">{prod.name}</div>
                          <div className="text-[10.5px] text-[#8A93A0]">{prod.code}{prod.barcode && ` · ${prod.barcode}`}</div>
                          {!fLoc && Object.keys(stockMap[prod.id] || {}).length > 0 && (
                            <div className="text-[10px] text-[#8A93A0] mt-0.5">
                              {Object.entries(stockMap[prod.id] || {}).map(([loc, n]) => `${locName(loc)}: ${n}`).join(" · ")}
                            </div>
                          )}
                        </td>
                        <td className="td text-xs">{prod.group_name}</td>
                        <td className="td text-xs text-center">{prod.unit}</td>
                        <td className="td text-center">
                          <span className={`font-bold text-[15px] ${hetH ? "text-danger" : canBao ? "text-[#A25F00]" : "text-[#0E7A4A]"}`}>{ton}</span>
                          {canBao && !hetH && <div className="text-[9.5px] text-[#A25F00]">⚠ tối thiểu {prod.min_qty}</div>}
                          {hetH && <div className="text-[9.5px] text-danger">Hết hàng</div>}
                        </td>
                        <td className="td text-right text-xs">{prod.cost_price > 0 ? fmtVND(prod.cost_price) : "—"}</td>
                        <td className="td text-right font-bold">{prod.sale_price > 0 ? fmtVND(prod.sale_price) : "—"}</td>
                        <td className="td">
                          <div className="flex flex-col gap-1">
                            {isManager && <button className="btn-ok !px-2 !py-1 !text-xs" onClick={() => { setNhapId(prod.id); setNhapF({ location_code: fLoc || "", qty: "", cost_price: prod.cost_price, note: "" }); }}>+ Nhập</button>}
                            <div className="flex gap-1">
                              {isManager && <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => openEdit(prod)}>✎</button>}
                              {isManager && <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => { setDieuChinhId(prod.id); setDcF({ location_code: fLoc || "", qty: "", note: "" }); }}>±</button>}
                              <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => xemLichSu(prod.id)}>📋</button>
                            </div>
                          </div>
                        </td>
                      </tr>,
                      nhapId === prod.id && (
                        <tr key={prod.id+"_nhap"}><td colSpan={7} className="td bg-[#E5F6EE] !p-3">
                          <div className="font-semibold text-[#0E7A4A] mb-2">📦 Nhập tồn — {prod.name}</div>
                          <div className="flex gap-2 flex-wrap items-end">
                            <Field label="Kho nhập *">
                              <select className="inp !w-40" value={nhapF.location_code} onChange={e => setNhapF(p => ({...p, location_code: e.target.value}))}>
                                <option value="">— Chọn kho —</option>
                                {locations.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                              </select>
                            </Field>
                            <Field label="Số lượng nhập *"><input type="number" className="inp !w-24" value={nhapF.qty} onChange={e => setNhapF(p => ({...p, qty: e.target.value}))} /></Field>
                            <Field label="Giá vốn/đơn vị"><MoneyInput value={nhapF.cost_price} onChange={v => setNhapF(p => ({...p, cost_price: v}))} /></Field>
                            <Field label="Ghi chú"><input className="inp !w-48" value={nhapF.note} onChange={e => setNhapF(p => ({...p, note: e.target.value}))} placeholder="VD: nhập từ NCC X" /></Field>
                            <button className="btn-ok !text-xs" disabled={busy} onClick={luuNhap}>Xác nhận</button>
                            <button className="btn-ghost !text-xs" onClick={() => setNhapId(null)}>Hủy</button>
                          </div>
                        </td></tr>
                      ),
                      dieuChinhId === prod.id && (
                        <tr key={prod.id+"_dc"}><td colSpan={7} className="td bg-[#FFF8E5] !p-3">
                          <div className="font-semibold text-[#A25F00] mb-2">± Điều chỉnh tồn — {prod.name}</div>
                          <div className="flex gap-2 flex-wrap items-end">
                            <Field label="Kho *">
                              <select className="inp !w-40" value={dcF.location_code} onChange={e => setDcF(p => ({...p, location_code: e.target.value}))}>
                                <option value="">— Chọn kho —</option>
                                {locations.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                              </select>
                            </Field>
                            <Field label={`Số lượng (+/-) — hiện: ${dcF.location_code ? tonTaiKho(prod, dcF.location_code) : "?"} ${prod.unit}`}><input type="number" className="inp !w-24" value={dcF.qty} onChange={e => setDcF(p => ({...p, qty: e.target.value}))} placeholder="-2 hoặc +5" /></Field>
                            <Field label="Lý do *"><input className="inp !w-52" value={dcF.note} onChange={e => setDcF(p => ({...p, note: e.target.value}))} placeholder="VD: kiểm kê thực tế" /></Field>
                            <button className="btn-ok !text-xs" disabled={busy} onClick={luuDieuChinh}>Lưu</button>
                            <button className="btn-ghost !text-xs" onClick={() => setDieuChinhId(null)}>Hủy</button>
                          </div>
                        </td></tr>
                      ),
                      histId === prod.id && (
                        <tr key={prod.id+"_hist"}><td colSpan={7} className="td bg-[#F8FAFC] !p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="font-semibold">📋 Lịch sử xuất nhập — {prod.name}</div>
                            <button className="btn-ghost !text-xs ml-auto" onClick={() => setHistId(null)}>✕ Đóng</button>
                          </div>
                          {hist.length === 0 ? <div className="text-[#8A93A0] text-sm">Chưa có giao dịch nào.</div> : (
                            <div className="tbl-scroll"><table className="w-full text-[12px] border-collapse">
                              <thead><tr className="text-[11px] text-[#8A93A0] border-b border-[#E3E8EF]">
                                <th className="text-left py-1.5 pl-2">Thời gian</th>
                                <th className="text-left py-1.5">Loại</th>
                                <th className="text-left py-1.5">Kho</th>
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
                                  <td className="py-1.5"><Badge tone={h.txn_type==="Nhập"?"green":h.txn_type==="Xuất"?"amber":h.txn_type==="Kiểm kê"?"purple":h.txn_type.startsWith("Điều chuyển")?"blue":"dark"}>{h.txn_type}</Badge></td>
                                  <td className="py-1.5 text-[#5A6572]">{locName(h.location_code)}</td>
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
                  {sorted.length === 0 && <tr><td colSpan={7} className="td">Không có sản phẩm nào.</td></tr>}
                  </tbody>
                </table></div>
                <Pager total={sorted.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
              </>
            )}
          </div>
        </>
      )}

      {tab === "dieu_chuyen" && (
        <>
          <div className="card">
            <div className="font-extrabold mb-2.5">Tạo phiếu điều chuyển hàng hóa</div>
            <div className="grid gap-2.5 md:grid-cols-5 sm:grid-cols-2 items-end">
              <Field label="Kho đi *">
                <select className="inp" value={tcF.from_location} onChange={e => setTcF(p => ({...p, from_location: e.target.value}))}>
                  <option value="">— Chọn —</option>
                  {locations.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                </select>
              </Field>
              <Field label="Kho đến *">
                <select className="inp" value={tcF.to_location} onChange={e => setTcF(p => ({...p, to_location: e.target.value}))}>
                  <option value="">— Chọn —</option>
                  {locations.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                </select>
              </Field>
              <Field label="Sản phẩm *">
                <select className="inp" value={tcF.product_id} onChange={e => setTcF(p => ({...p, product_id: e.target.value}))}>
                  <option value="">— Chọn —</option>
                  {products.filter(p => p.status === "Hoạt động").map(p => <option key={p.id} value={p.id}>{p.name} (tồn {tcF.from_location ? tonTaiKho(p, tcF.from_location) : tonTong(p)})</option>)}
                </select>
              </Field>
              <Field label="Số lượng *"><input type="number" className="inp" value={tcF.qty} onChange={e => setTcF(p => ({...p, qty: e.target.value}))} /></Field>
              <button className="btn-ok" disabled={busy} onClick={taoDieuChuyen}>Tạo phiếu</button>
            </div>
          </div>
          <div className="card">
            <div className="font-extrabold mb-2.5">Danh sách phiếu điều chuyển</div>
            <table className="w-full border-collapse tbl-card">
              <thead><tr><th className="th">Mã phiếu</th><th className="th">Sản phẩm</th><th className="th">Từ kho</th><th className="th">Đến kho</th><th className="th">SL</th><th className="th">Trạng thái</th><th className="th"></th></tr></thead>
              <tbody>{transfers.map(t => (
                <tr key={t.id}>
                  <td className="td font-bold text-brand">{t.code}</td>
                  <td className="td text-[13px]">{products.find(p => p.id === t.product_id)?.name || t.product_id}</td>
                  <td className="td text-xs">{locName(t.from_location)}</td>
                  <td className="td text-xs">{locName(t.to_location)}</td>
                  <td className="td">{t.qty}</td>
                  <td className="td"><Badge tone={t.status === "Đang chuyển" ? "amber" : t.status === "Đã nhận" ? "green" : "dark"}>{t.status}</Badge></td>
                  <td className="td">
                    {t.status === "Đang chuyển" && (
                      <div className="flex gap-1">
                        <button className="btn-ok !px-2 !py-1 !text-xs" onClick={() => nhanDieuChuyen(t.id)}>Nhận hàng</button>
                        <button className="btn-ghost !px-2 !py-1 !text-xs !text-danger" onClick={() => huyDieuChuyen(t.id)}>Hủy</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {transfers.length === 0 && <tr><td className="td" colSpan={7}>Chưa có phiếu điều chuyển nào.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "kiem_ke" && (
        <div className="card">
          <div className="font-extrabold mb-2.5">Kiểm kê hàng hóa theo kho</div>
          {!kkLoc ? (
            <div className="flex gap-2 items-end">
              <Field label="Chọn kho cần kiểm kê">
                <select className="inp" onChange={e => e.target.value && moKiemKe(e.target.value)} defaultValue="">
                  <option value="">— Chọn kho —</option>
                  {locations.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                </select>
              </Field>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2.5">
                <div className="font-semibold">Đang kiểm kê: {locName(kkLoc)}</div>
                <button className="btn-ghost !text-xs ml-auto" onClick={() => { setKkLoc(""); setKkRows([]); }}>✕ Đóng</button>
              </div>
              <table className="w-full border-collapse tbl-card">
                <thead><tr><th className="th">Sản phẩm</th><th className="th">ĐVT</th><th className="th">Tồn hệ thống</th><th className="th">Đếm thực tế</th><th className="th">Chênh lệch</th></tr></thead>
                <tbody>{kkRows.map((r, i) => (
                  <tr key={r.product_id} className={Number(r.dem) !== r.ton ? "bg-[#FFF8E5]" : ""}>
                    <td className="td font-semibold">{r.name}</td>
                    <td className="td text-xs">{r.unit}</td>
                    <td className="td text-center">{r.ton}</td>
                    <td className="td text-center"><input type="number" className="inp !w-24 mx-auto" value={r.dem} onChange={e => setKkRows(rows => rows.map((x, j) => j === i ? { ...x, dem: e.target.value } : x))} /></td>
                    <td className={`td text-center font-bold ${Number(r.dem) - r.ton > 0 ? "text-[#0E7A4A]" : Number(r.dem) - r.ton < 0 ? "text-danger" : "text-[#8A93A0]"}`}>{Number(r.dem) - r.ton > 0 ? "+" : ""}{Number(r.dem) - r.ton}</td>
                  </tr>
                ))}</tbody>
              </table>
              <button className="btn-ok mt-3" disabled={busy} onClick={luuKiemKe}>Lưu kết quả kiểm kê</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}