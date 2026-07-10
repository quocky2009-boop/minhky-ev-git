"use client";
import { useState, useRef } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Toast, stockBadge, Badge } from "@/components/ui";
import { fmtVND, errMsg, parseCSV } from "@/lib/format";

export default function DMXe() {
  const { supabase, vehicles, brands, loading, totalQty, refresh } = useCatalog();
  const { toast, notify } = useToast();
  const fileRef = useRef(null);
  const [show, setShow] = useState(false);
  const [q, setQ] = useState(""); const [fBrand, setFBrand] = useState("");
  const [newBrand, setNewBrand] = useState("");
  const empty = { brand: "VinFast", name: "", color: "", mfr_code: "", list_price: "", min_stock: 2 };
  const [f, setF] = useState(empty);
  const [editId, setEditId] = useState(null);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const startEdit = (v) => {
    setEditId(v.id);
    setF({ brand: v.brand, name: v.name, color: v.color, mfr_code: v.mfr_code || "", list_price: v.list_price, min_stock: v.min_stock });
    setShow(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveEdit = async () => {
    const { error } = await supabase.rpc("fn_sua_xe", { p: { id: editId, ...f, list_price: Number(f.list_price) || 0, min_stock: Number(f.min_stock) || 2 } });
    if (error) return notify(errMsg(error), "err");
    notify("Đã cập nhật thông tin xe.");
    setF(empty); setEditId(null); setShow(false); refresh();
  };

  const add = async () => {
    const { data, error } = await supabase.rpc("fn_them_xe", { p: { ...f, list_price: Number(f.list_price) || 0, min_stock: Number(f.min_stock) || 2 } });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã thêm xe với mã chuẩn: ${data}`);
    setF(empty); setShow(false); refresh();
  };

  const addBrand = async () => {
    if (!newBrand.trim()) return;
    const { error } = await supabase.rpc("fn_them_hang", { p_name: newBrand });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã thêm hãng ${newBrand.trim()} vào danh mục.`); setNewBrand(""); refresh();
  };

  const exportCSV = () => {
    const rows = [["brand","name","color","mfr_code","list_price","min_stock","id","tong_ton"],
      ...vehicles.map((v) => [v.brand, v.name, v.color, v.mfr_code || "", v.list_price, v.min_stock, v.id, totalQty(v.id)])];
    const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "danh_muc_xe.csv"; a.click(); URL.revokeObjectURL(url);
  };

  const importCSV = async (file) => {
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length < 2) return notify("File trống hoặc sai định dạng.", "err");
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (k) => header.indexOf(k);
    if (idx("brand") < 0 || idx("name") < 0 || idx("color") < 0)
      return notify("File cần tối thiểu 3 cột: brand, name, color (thêm mfr_code, list_price, min_stock nếu có). Xuất CSV mẫu để xem định dạng.", "err");
    const items = rows.slice(1).map((r) => ({
      brand: r[idx("brand")]?.trim(), name: r[idx("name")]?.trim(), color: r[idx("color")]?.trim(),
      mfr_code: idx("mfr_code") >= 0 ? r[idx("mfr_code")]?.trim() : "",
      list_price: idx("list_price") >= 0 ? Number(String(r[idx("list_price")]).replace(/[^0-9]/g, "")) || 0 : 0,
      min_stock: idx("min_stock") >= 0 ? Number(r[idx("min_stock")]) || 2 : 2,
    }));
    const { data, error } = await supabase.rpc("fn_import_xe", { p: items });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã import ${data} mã xe (trùng mã sẽ được cập nhật giá/tồn min).`);
    refresh();
  };

  if (loading) return <div className="card">Đang tải dữ liệu…</div>;
  const list = vehicles.filter((v) => {
    if (fBrand && v.brand !== fBrand) return false;
    const t = (v.id + v.name + v.color + (v.mfr_code || "")).toLowerCase();
    return !q || t.includes(q.toLowerCase());
  });

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex gap-2 flex-wrap items-center">
        <button className="btn-primary" onClick={() => { setEditId(null); setF(empty); setShow(!show); }}>+ Thêm xe mới</button>
        <button className="btn-ghost" onClick={exportCSV}>⬇ Xuất CSV</button>
        <button className="btn-ghost" onClick={() => fileRef.current?.click()}>⬆ Import CSV</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { if (e.target.files[0]) importCSV(e.target.files[0]); e.target.value = ""; }} />
        <span className="text-xs text-[#8A93A0]">Import: file CSV có cột brand, name, color (+ mfr_code, list_price, min_stock). Excel: Save As → CSV UTF-8.</span>
      </div>

      {show && (
        <div className="card">
          <div className="font-extrabold mb-3">{editId ? `Sửa thông tin xe — ${editId} (mã nội bộ giữ nguyên)` : "Thêm xe — mã tự sinh theo chuẩn HÃNG_TÊN_MÀU"}</div>
          <div className="grid gap-x-3.5 md:grid-cols-3 sm:grid-cols-2">
            <Field label="Hãng xe" required>
              <select className="inp" value={f.brand} onChange={(e) => set("brand", e.target.value)}>
                {brands.map((b) => <option key={b.name}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Tên xe" required><input className="inp" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="VD: Evo Grand" /></Field>
            <Field label="Màu xe" required><input className="inp" value={f.color} onChange={(e) => set("color", e.target.value)} placeholder="VD: Xanh Oliu" /></Field>
            <Field label="Mã hãng"><input className="inp" value={f.mfr_code} onChange={(e) => set("mfr_code", e.target.value)} /></Field>
            <Field label="Giá niêm yết"><input type="number" className="inp" value={f.list_price} onChange={(e) => set("list_price", e.target.value)} /></Field>
            <Field label="Tồn tối thiểu"><input type="number" className="inp" value={f.min_stock} onChange={(e) => set("min_stock", e.target.value)} /></Field>
          </div>
          <div className="flex gap-2.5 items-center flex-wrap">
            <button className="btn-ok" onClick={editId ? saveEdit : add}>{editId ? "Lưu thay đổi" : "Lưu vào danh mục"}</button>
            <button className="btn-ghost" onClick={() => { setShow(false); setEditId(null); setF(empty); }}>Đóng</button>
            <span className="text-xs text-[#8A93A0] ml-3">Thiếu hãng?</span>
            <input className="inp !w-40 !py-1.5 !text-xs" placeholder="Tên hãng mới…" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} />
            <button className="btn-ghost !py-1.5 !text-xs" onClick={addBrand}>+ Thêm hãng</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <div className="font-extrabold mr-auto">Danh mục xe ({list.length}/{vehicles.length} mã)</div>
          <input className="inp !w-56" placeholder="Tìm tên xe, màu, mã…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="inp !w-auto" value={fBrand} onChange={(e) => setFBrand(e.target.value)}>
            <option value="">Hãng: tất cả</option>{brands.map((b) => <option key={b.name}>{b.name}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto"><table className="w-full border-collapse">
          <thead><tr><th className="th">Mã nội bộ</th><th className="th">Mã hãng</th><th className="th">Hãng</th><th className="th">Tên xe</th><th className="th">Màu</th><th className="th">Giá niêm yết</th><th className="th">Tồn min</th><th className="th">Tổng tồn</th><th className="th">Cảnh báo</th><th className="th"></th></tr></thead>
          <tbody>{list.map((v) => {
            const qty = totalQty(v.id);
            return (
              <tr key={v.id}>
                <td className="td text-xs">{v.id}</td><td className="td text-xs">{v.mfr_code || "—"}</td>
                <td className="td"><Badge tone={v.brand === "VinFast" ? "blue" : "purple"}>{v.brand}</Badge></td>
                <td className="td font-bold">{v.name}</td><td className="td">{v.color}</td>
                <td className="td">{fmtVND(v.list_price)}</td><td className="td">{v.min_stock}</td><td className="td font-bold">{qty}</td>
                <td className="td">{stockBadge(qty, v.min_stock)}</td>
                <td className="td"><button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => startEdit(v)}>✎ Sửa</button></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </div>
    </div>
  );
}
