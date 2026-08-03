"use client";
import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Toast, stockBadge, Badge, Pager, pageSlice, pageClamp, useSortable, Th, LocSearch, VehicleSearch, MoneyInput, ComboFree, useSelection, ThCheck, TdCheck, SelectionBar } from "@/components/ui";
import { fmtVND, fmtDate, errMsg, parseCSV, downloadCSV } from "@/lib/format";

export default function DMXe() {
  const { supabase, vehicles, brands, loading, totalQty, refresh } = useCatalog();
  const { toast, notify } = useToast();
  const fileRef = useRef(null);
  const [show, setShow] = useState(false);
  const [q, setQ] = useState(""); const [fBrand, setFBrand] = useState("");
  const [fWarn, setFWarn] = useState(""); // "" | het | sap | con
  const [newBrand, setNewBrand] = useState("");
  const [busy, setBusy] = useState(false);
  // Cap nhat gia hang loat
  const [showBulk, setShowBulk] = useState(false);
  const [bulk, setBulk] = useState({ brand: "", name: "", list_price: "" });
  const [showBulkSpecs, setShowBulkSpecs] = useState(false);
  const [bulkSpecs, setBulkSpecs] = useState({ brand: "", name: "", cong_suat_dong_co_w: "", dung_luong_pin: "",
    tam_hoat_dong_km: "", toc_do_toi_da_kmh: "", so_luong_pin_ac_quy: "", model_pin: "" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const empty = { brand: "VinFast", name: "", color: "", mfr_code: "", list_price: "", min_stock: 2,
    cong_suat_dong_co_w: "", dung_luong_pin: "", tam_hoat_dong_km: "", toc_do_toi_da_kmh: "",
    so_luong_pin_ac_quy: "", model_pin: "" };
  const [f, setF] = useState(empty);
  const [editId, setEditId] = useState(null);
  const sort = useSortable();
  const [newId, setNewId] = useState(""); // doi ma noi bo
  const [tab, setTab] = useState("loai"); // loai | sokhung
  const { locations } = useCatalog();
  const [units, setUnits] = useState([]);
  const [uLoading, setULoading] = useState(false);
  const [skq, setSkq] = useState("");
  const [hiSk, setHiSk] = useState("");
  const _params = useSearchParams();
  useEffect(() => {
    const sk = _params.get("sk");
    if (sk) { setTab("sokhung"); setSkq(sk); setHiSk(sk.toUpperCase()); }
  }, [_params]);
  const [uFBrand, setUFBrand] = useState("");
  const uSort = useSortable();
  const uSel = useSelection();
  const [uFLoc, setUFLoc] = useState("");
  const [uPage, setUPage] = useState(1);
  const [uPageSize, setUPageSize] = useState(20);
  const [euFrame, setEuFrame] = useState(null); // dang sua chiec nao (frame goc)
  const [eu, setEu] = useState({ new_frame: "", vehicle_id: "", location_code: "", engine_number: "", note: "" });
  const loadUnits = async () => {
    setULoading(true);
    const { data } = await supabase.from("vehicle_units")
      .select("frame_number, vehicle_id, location_code, status, imported_at, is_placeholder, engine_number, note")
      .in("status", ["TON_KHO", "DANG_CHUYEN", "GIU_CHO"]).order("imported_at", { ascending: false }).limit(10000);
    setUnits(data || []); setULoading(false);
  };
  useEffect(() => { if (!loading && tab === "sokhung" && units.length === 0) loadUnits(); }, [loading, tab]);
  const startEditUnit = (u) => {
    setEuFrame(u.frame_number);
    setEu({ new_frame: u.frame_number, vehicle_id: u.vehicle_id, location_code: u.location_code, engine_number: u.engine_number || "", note: u.note || "", cost_price: u.cost_price || 0 });
  };
  const saveUnit = async () => {
    const { error } = await supabase.rpc("fn_sua_unit", {
      p: { frame_number: euFrame, new_frame: eu.new_frame, vehicle_id: eu.vehicle_id, location_code: eu.location_code, engine_number: eu.engine_number, note: eu.note },
    });
    if (error) return notify(errMsg(error), "err");
    const { error: e2 } = await supabase.rpc("fn_set_gia_von", { p: { frames: [eu.new_frame], cost_price: Number(eu.cost_price) || 0 } });
    if (e2) notify("Đã lưu xe nhưng giá vốn lỗi: " + errMsg(e2), "err");
    notify("Đã cập nhật thông tin xe."); setEuFrame(null); loadUnits(); refresh();
  };
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const doiMa = async (oldId) => {
    const v = newId.trim();
    if (!v) return notify("Gõ mã nội bộ mới trước.", "err");
    if (!confirm(`Đổi mã nội bộ:\n${oldId}\n→ ${v.toUpperCase().replace(/\s+/g, "_")}\n\nToàn bộ tồn kho, số khung, lịch sử, đơn bán, phiếu nháp, danh sách hãng... sẽ tự chuyển theo mã mới. Tiếp tục?`)) return;
    const { error } = await supabase.rpc("fn_doi_ma_xe", { p_old: oldId, p_new: v });
    if (error) return notify(errMsg(error), "err");
    notify("Đã đổi mã nội bộ — mọi dữ liệu liên quan đã chuyển theo mã mới.");
    setNewId(""); setEditId(null); setShow(false); setF(empty); refresh();
  };

  const startEdit = (v) => {
    setNewId("");
    setEditId(v.id);
    setF({ brand: v.brand, name: v.name, color: v.color, mfr_code: v.mfr_code || "", list_price: v.list_price, min_stock: v.min_stock,
      cong_suat_dong_co_w: v.cong_suat_dong_co_w ?? "", dung_luong_pin: v.dung_luong_pin || "",
      tam_hoat_dong_km: v.tam_hoat_dong_km ?? "", toc_do_toi_da_kmh: v.toc_do_toi_da_kmh ?? "",
      so_luong_pin_ac_quy: v.so_luong_pin_ac_quy ?? "", model_pin: v.model_pin || "" });
    setShow(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveEdit = async () => {
    const { error } = await supabase.rpc("fn_sua_xe", { p: { id: editId, ...f, list_price: Number(f.list_price) || 0, min_stock: Number(f.min_stock) || 2,
      cong_suat_dong_co_w: f.cong_suat_dong_co_w === "" ? null : Number(f.cong_suat_dong_co_w),
      tam_hoat_dong_km: f.tam_hoat_dong_km === "" ? null : Number(f.tam_hoat_dong_km),
      toc_do_toi_da_kmh: f.toc_do_toi_da_kmh === "" ? null : Number(f.toc_do_toi_da_kmh),
      so_luong_pin_ac_quy: f.so_luong_pin_ac_quy === "" ? null : Number(f.so_luong_pin_ac_quy) } });
    if (error) return notify(errMsg(error), "err");
    notify("Đã cập nhật thông tin xe.");
    setF(empty); setEditId(null); setShow(false); refresh();
  };

  const add = async (keepOpen) => {
    if (!f.name?.trim() || !f.color?.trim()) return notify("Nhập đủ Tên xe và Màu xe.", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_them_xe", { p: { ...f, list_price: Number(f.list_price) || 0, min_stock: Number(f.min_stock) || 2,
      cong_suat_dong_co_w: f.cong_suat_dong_co_w === "" ? null : Number(f.cong_suat_dong_co_w),
      tam_hoat_dong_km: f.tam_hoat_dong_km === "" ? null : Number(f.tam_hoat_dong_km),
      toc_do_toi_da_kmh: f.toc_do_toi_da_kmh === "" ? null : Number(f.toc_do_toi_da_kmh),
      so_luong_pin_ac_quy: f.so_luong_pin_ac_quy === "" ? null : Number(f.so_luong_pin_ac_quy) } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã thêm xe với mã chuẩn: ${data}`);
    refresh();
    if (keepOpen) {
      // Giu lai hang + gia + ton min de tao loat nhanh, chi xoa ten/mau/ma hang
      setF((p) => ({ ...p, name: "", color: "", mfr_code: "" }));
    } else {
      setF(empty); setShow(false);
    }
  };

  const capNhatGiaHangLoat = async () => {
    if (!bulk.brand && !bulk.name) return notify("Chọn ít nhất Hãng hoặc Model để giới hạn phạm vi.", "err");
    const gia = Number(bulk.list_price) || 0;
    if (gia <= 0) return notify("Nhập giá niêm yết mới (> 0).", "err");
    // So sanh chinh xac ten xe
    const soKhop = vehicles.filter((v) =>
      (!bulk.brand || v.brand === bulk.brand) &&
      (!bulk.name || v.name === bulk.name)
    ).length;
    if (soKhop === 0) return notify("Không có mã xe nào khớp điều kiện.", "err");
    if (!confirm(`Cập nhật giá niêm yết = ${fmtVND(gia)} cho ${soKhop} mã xe?\n\nHãng: ${bulk.brand || "tất cả"}\nModel: ${bulk.name || "tất cả"}`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_cap_nhat_gia_hang_loat", { p: { brand: bulk.brand || null, name: bulk.name || null, list_price: gia } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã cập nhật giá cho ${data.so_ma_cap_nhat} mã xe.`);
    setBulk({ brand: "", name: "", list_price: "" }); setShowBulk(false); refresh();
  };

  const capNhatThongSoHangLoat = async () => {
    if (!bulkSpecs.brand || !bulkSpecs.name) return notify("Chọn cả Hãng và Tên xe (Model) để giới hạn phạm vi.", "err");
    const coGiTru = ["cong_suat_dong_co_w","dung_luong_pin","tam_hoat_dong_km","toc_do_toi_da_kmh","so_luong_pin_ac_quy","model_pin"]
      .some((k) => bulkSpecs[k] !== "");
    if (!coGiTru) return notify("Nhập ít nhất 1 thông số cần cập nhật.", "err");
    // So sanh chinh xac ten xe (khong dung includes/ilike, tranh khop nham Flazz vao Flazz Max)
    const soKhop = vehicles.filter((v) => v.brand === bulkSpecs.brand && v.name === bulkSpecs.name).length;
    if (soKhop === 0) return notify("Không có mã xe nào khớp đúng Hãng + Tên xe đã chọn.", "err");
    if (!confirm(`Cập nhật thông số kỹ thuật cho ${soKhop} mã xe (mọi màu) của "${bulkSpecs.brand} ${bulkSpecs.name}"?\n\nChỉ áp dụng đúng tên xe này, KHÔNG áp dụng cho biến thể tên khác (VD: không ảnh hưởng "${bulkSpecs.name} Max").`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_cap_nhat_thong_so_hang_loat", { p: {
      brand: bulkSpecs.brand, name: bulkSpecs.name,
      cong_suat_dong_co_w: bulkSpecs.cong_suat_dong_co_w === "" ? null : Number(bulkSpecs.cong_suat_dong_co_w),
      dung_luong_pin: bulkSpecs.dung_luong_pin || null,
      tam_hoat_dong_km: bulkSpecs.tam_hoat_dong_km === "" ? null : Number(bulkSpecs.tam_hoat_dong_km),
      toc_do_toi_da_kmh: bulkSpecs.toc_do_toi_da_kmh === "" ? null : Number(bulkSpecs.toc_do_toi_da_kmh),
      so_luong_pin_ac_quy: bulkSpecs.so_luong_pin_ac_quy === "" ? null : Number(bulkSpecs.so_luong_pin_ac_quy),
      model_pin: bulkSpecs.model_pin || null,
    } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã cập nhật thông số kỹ thuật cho ${data.so_ma_cap_nhat} mã xe.`);
    setBulkSpecs({ brand: "", name: "", cong_suat_dong_co_w: "", dung_luong_pin: "", tam_hoat_dong_km: "", toc_do_toi_da_kmh: "", so_luong_pin_ac_quy: "", model_pin: "" });
    setShowBulkSpecs(false); refresh();
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
  const warnOf = (qty, min) => qty <= 0 ? "het" : qty <= min ? "sap" : "con";
  const list = vehicles.filter((v) => {
    if (fBrand && v.brand !== fBrand) return false;
    if (fWarn && warnOf(totalQty(v.id), v.min_stock) !== fWarn) return false;
    const t = (v.id + " " + v.name + " " + v.color + " " + v.brand + " " + (v.mfr_code || "")).toLowerCase();
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return terms.every((w) => t.includes(w));
  });
  // Goi y ten/mau tu du lieu da co (loc theo hang dang chon trong form de sat hon)
  const goiYTen = Array.from(new Set(vehicles.filter((v) => !f.brand || v.brand === f.brand).map((v) => v.name)));
  const goiYMau = Array.from(new Set(vehicles.map((v) => v.color)));

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex gap-1 bg-[#EEF1F4] rounded-lg p-0.5 self-start">
        <button className={`!px-4 !py-2 !text-xs rounded-md font-bold ${tab === "loai" ? "bg-white shadow text-brand" : "text-[#5A6572]"}`} onClick={() => setTab("loai")}>◈ Theo loại xe</button>
        <button className={`!px-4 !py-2 !text-xs rounded-md font-bold ${tab === "sokhung" ? "bg-white shadow text-brand" : "text-[#5A6572]"}`} onClick={() => setTab("sokhung")}># Theo số khung</button>
      </div>

      {tab === "loai" && <>
      <div className="flex gap-2 flex-wrap items-center">
        <button className="btn-primary" onClick={() => { setEditId(null); setF(empty); setShow(!show); }}>+ Thêm xe mới</button>
        <button className="btn-ghost" onClick={() => setShowBulk(!showBulk)}>💲 Sửa giá hàng loạt</button>
        <button className="btn-ghost" onClick={() => setShowBulkSpecs(!showBulkSpecs)}>⚙ Sửa thông số kỹ thuật hàng loạt</button>
        <button className="btn-ghost" onClick={exportCSV}>⬇ Xuất CSV</button>
        <button className="btn-ghost" onClick={() => fileRef.current?.click()}>⬆ Import CSV</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { if (e.target.files[0]) importCSV(e.target.files[0]); e.target.value = ""; }} />
        <span className="text-xs text-[#8A93A0]">Import: file CSV có cột brand, name, color (+ mfr_code, list_price, min_stock). Excel: Save As → CSV UTF-8.</span>
      </div>

      {showBulk && (
        <div className="card border-l-4 border-l-brand">
          <div className="font-extrabold mb-1">Cập nhật giá niêm yết hàng loạt</div>
          <p className="text-xs text-[#8A93A0] mb-3">Chọn Hãng và/hoặc gõ Model <b>chính xác</b> để giới hạn phạm vi, rồi nhập giá mới. Áp dụng cho mọi màu của các mã khớp điều kiện.</p>
          <div className="grid gap-x-3.5 md:grid-cols-4 sm:grid-cols-2 items-end">
            <Field label="Hãng (bỏ trống = tất cả)">
              <select className="inp" value={bulk.brand} onChange={(e) => setBulk((p) => ({ ...p, brand: e.target.value, name: "" }))}>
                <option value="">— Tất cả hãng —</option>{brands.map((b) => <option key={b.name}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Model (chọn chính xác)">
              <select className="inp" value={bulk.name} onChange={(e) => setBulk((p) => ({ ...p, name: e.target.value }))}>
                <option value="">— Tất cả model —</option>
                {Array.from(new Set(vehicles.filter((v) => !bulk.brand || v.brand === bulk.brand).map((v) => v.name))).sort().map((n) => <option key={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Giá niêm yết mới"><MoneyInput value={bulk.list_price} onChange={(v) => setBulk((p) => ({ ...p, list_price: v }))} /></Field>
            <div className="pb-3">
              <button className="btn-ok w-full" disabled={busy} onClick={capNhatGiaHangLoat}>Áp dụng</button>
            </div>
          </div>
          {(bulk.brand || bulk.name) && (() => {
            // So sanh CHINH XAC ten xe (khong dung includes de tranh Flazz khop Flazz Max)
            const kh = vehicles.filter((v) =>
              (!bulk.brand || v.brand === bulk.brand) &&
              (!bulk.name || v.name === bulk.name)
            );
            const giaHienTai = bulk.name ? [...new Set(kh.map((v) => v.list_price))] : [];
            return (
              <div className="mt-2">
                {giaHienTai.length > 0 && (
                  <div className="mb-2 p-2 rounded-lg bg-[#FDF6E3] text-[12.5px]">
                    💰 <b>Giá niêm yết hiện tại</b> của <i>{bulk.name}</i>:{" "}
                    {giaHienTai.map((g) => fmtVND(g)).join(" / ")}
                    {giaHienTai.length === 1 && bulk.list_price && Number(bulk.list_price) !== giaHienTai[0] && (
                      <span className="ml-2 text-[#A25F00]">→ sẽ đổi thành <b>{fmtVND(Number(bulk.list_price))}</b></span>
                    )}
                  </div>
                )}
                <div className="text-xs text-[#5A6572]">
                  Sẽ cập nhật <b>{kh.length}</b> mã xe{kh.length > 0 && kh.length <= 10 ? `: ${kh.map((v) => `${v.name} ${v.color}`).join(", ")}` : ""}.
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {showBulkSpecs && (
        <div className="card border-l-4 border-l-brand">
          <div className="font-extrabold mb-1">Cập nhật thông số kỹ thuật hàng loạt</div>
          <p className="text-xs text-[#8A93A0] mb-3">Bắt buộc chọn <b>Hãng</b> và <b>Tên xe (Model) chính xác</b>. Áp dụng cho mọi màu của đúng tên xe này — KHÔNG ảnh hưởng các model khác dù tên gần giống (VD: chọn "Flazz" sẽ không đổi "Flazz Max"). Chỉ điền thông số nào cần đổi, để trống ô nào thì giữ nguyên giá trị cũ của từng xe ở ô đó.</p>
          <div className="grid gap-x-3.5 gap-y-2.5 md:grid-cols-4 sm:grid-cols-2 items-end">
            <Field label="Hãng" required>
              <select className="inp" value={bulkSpecs.brand} onChange={(e) => setBulkSpecs((p) => ({ ...p, brand: e.target.value, name: "" }))}>
                <option value="">— Chọn hãng —</option>{brands.map((b) => <option key={b.name}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Tên xe (Model)" required>
              <select className="inp" value={bulkSpecs.name} onChange={(e) => {
                const ten = e.target.value;
                const mau = vehicles.find((v) => v.brand === bulkSpecs.brand && v.name === ten);
                setBulkSpecs((p) => ({ ...p, name: ten,
                  cong_suat_dong_co_w: mau?.cong_suat_dong_co_w ?? "",
                  dung_luong_pin: mau?.dung_luong_pin || "",
                  tam_hoat_dong_km: mau?.tam_hoat_dong_km ?? "",
                  toc_do_toi_da_kmh: mau?.toc_do_toi_da_kmh ?? "",
                  so_luong_pin_ac_quy: mau?.so_luong_pin_ac_quy ?? "",
                  model_pin: mau?.model_pin || "" }));
              }}>
                <option value="">— Chọn model —</option>
                {Array.from(new Set(vehicles.filter((v) => !bulkSpecs.brand || v.brand === bulkSpecs.brand).map((v) => v.name))).sort().map((n) => <option key={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Công suất động cơ (W)"><input type="number" className="inp" value={bulkSpecs.cong_suat_dong_co_w} onChange={(e) => setBulkSpecs((p) => ({ ...p, cong_suat_dong_co_w: e.target.value }))} /></Field>
            <Field label="Dung lượng pin"><input className="inp" placeholder="VD: 60V-20Ah" value={bulkSpecs.dung_luong_pin} onChange={(e) => setBulkSpecs((p) => ({ ...p, dung_luong_pin: e.target.value }))} /></Field>
            <Field label="Tầm hoạt động (km)"><input type="number" className="inp" value={bulkSpecs.tam_hoat_dong_km} onChange={(e) => setBulkSpecs((p) => ({ ...p, tam_hoat_dong_km: e.target.value }))} /></Field>
            <Field label="Tốc độ tối đa (km/h)"><input type="number" className="inp" value={bulkSpecs.toc_do_toi_da_kmh} onChange={(e) => setBulkSpecs((p) => ({ ...p, toc_do_toi_da_kmh: e.target.value }))} /></Field>
            <Field label="Số lượng pin/AQ"><input type="number" className="inp" value={bulkSpecs.so_luong_pin_ac_quy} onChange={(e) => setBulkSpecs((p) => ({ ...p, so_luong_pin_ac_quy: e.target.value }))} /></Field>
            <Field label="Model pin">
              <select className="inp" value={bulkSpecs.model_pin} onChange={(e) => setBulkSpecs((p) => ({ ...p, model_pin: e.target.value }))}>
                <option value="">— Giữ nguyên —</option>
                <option>Xe kèm pin</option>
                <option>Xe đổi pin</option>
                <option>Xe kèm AQ</option>
              </select>
            </Field>
            <div className="pb-0.5"><button className="btn-ok w-full" disabled={busy} onClick={capNhatThongSoHangLoat}>Áp dụng</button></div>
          </div>
          {bulkSpecs.brand && bulkSpecs.name && (() => {
            const kh = vehicles.filter((v) => v.brand === bulkSpecs.brand && v.name === bulkSpecs.name);
            return (
              <div className="mt-2 p-2 rounded-lg bg-[#FDF6E3] text-[12.5px]">
                Sẽ cập nhật <b>{kh.length}</b> mã xe{kh.length > 0 && kh.length <= 10 ? `: ${kh.map((v) => `${v.name} ${v.color}`).join(", ")}` : ""}.
              </div>
            );
          })()}
        </div>
      )}

      {show && (
        <div className="card">
          <div className="font-extrabold mb-3">{editId ? `Sửa thông tin xe — ${editId} (mã nội bộ giữ nguyên)` : "Thêm xe — mã tự sinh theo chuẩn HÃNG_TÊN_MÀU"}</div>
          <div className="grid gap-x-3.5 md:grid-cols-3 sm:grid-cols-2">
            <Field label="Hãng xe" required>
              <select className="inp" value={f.brand} onChange={(e) => set("brand", e.target.value)}>
                {brands.map((b) => <option key={b.name}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Tên xe" required>
              <ComboFree value={f.name} onChange={(v) => set("name", v)} options={goiYTen} placeholder="Gõ để tìm hoặc tạo mới, VD: Evo Grand" />
            </Field>
            <Field label="Màu xe" required>
              <ComboFree value={f.color} onChange={(v) => set("color", v)} options={goiYMau} placeholder="Gõ để tìm hoặc tạo mới, VD: Xanh Oliu" />
            </Field>
            <Field label="Mã hãng"><input className="inp" value={f.mfr_code} onChange={(e) => set("mfr_code", e.target.value)} /></Field>
            <Field label="Giá niêm yết"><MoneyInput value={f.list_price} onChange={(v) => set("list_price", v)} /></Field>
            <Field label="Tồn tối thiểu"><input type="number" className="inp" value={f.min_stock} onChange={(e) => set("min_stock", e.target.value)} /></Field>
          </div>
          <div className="font-bold text-xs text-[#5A6572] mt-3 mb-1.5">Thông số kỹ thuật (hiển thị cho Bot Minh Trí tra cứu)</div>
          <div className="grid gap-x-3.5 md:grid-cols-4 sm:grid-cols-2 mb-3">
            <Field label="Công suất động cơ (W)"><input type="number" className="inp" value={f.cong_suat_dong_co_w} onChange={(e) => set("cong_suat_dong_co_w", e.target.value)} /></Field>
            <Field label="Dung lượng pin"><input className="inp" placeholder="VD: 60V-20Ah" value={f.dung_luong_pin} onChange={(e) => set("dung_luong_pin", e.target.value)} /></Field>
            <Field label="Tầm hoạt động (km)"><input type="number" className="inp" value={f.tam_hoat_dong_km} onChange={(e) => set("tam_hoat_dong_km", e.target.value)} /></Field>
            <Field label="Tốc độ tối đa (km/h)"><input type="number" className="inp" value={f.toc_do_toi_da_kmh} onChange={(e) => set("toc_do_toi_da_kmh", e.target.value)} /></Field>
            <Field label="Số lượng pin/AQ"><input type="number" className="inp" value={f.so_luong_pin_ac_quy} onChange={(e) => set("so_luong_pin_ac_quy", e.target.value)} /></Field>
            <Field label="Model pin">
              <select className="inp" value={f.model_pin} onChange={(e) => set("model_pin", e.target.value)}>
                <option value="">— Chọn —</option>
                <option>Xe kèm pin</option>
                <option>Xe đổi pin</option>
                <option>Xe kèm AQ</option>
              </select>
            </Field>
          </div>
          {editId && (
            <div className="bg-[#F8FAFC] border border-[#E6EAEF] rounded-xl p-3 mb-3">
              <div className="text-xs font-bold mb-1">Đổi mã nội bộ (hiện tại: <span className="font-mono">{editId}</span>)</div>
              <div className="flex gap-1.5 flex-wrap items-center">
                <input className="inp !w-80 font-mono !text-[12.5px]" placeholder="Mã nội bộ mới…" value={newId} onChange={(e) => setNewId(e.target.value.toUpperCase())} />
                <button className="btn-ghost !text-xs !py-2" onClick={() => doiMa(editId)}>Đổi mã</button>
              </div>
              <p className="text-[10.5px] text-[#8A93A0] mt-1">Toàn bộ dữ liệu gắn mã cũ (tồn, số khung, lịch sử, đơn bán, phiếu nháp, danh sách hãng, xe khách quan tâm) tự chuyển sang mã mới trong 1 giao dịch.</p>
            </div>
          )}
          <div className="flex gap-2.5 items-center flex-wrap">
            <button className="btn-ok" disabled={busy} onClick={editId ? saveEdit : () => add(false)}>{editId ? "Lưu thay đổi" : "Lưu vào danh mục"}</button>
            {!editId && <button className="btn-primary" disabled={busy} onClick={() => add(true)}>Lưu và tạo tiếp</button>}
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
          <input className="inp !w-56" placeholder="Tìm tên xe, màu, mã… (gõ nhiều từ được)" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="inp !w-auto" value={fBrand} onChange={(e) => setFBrand(e.target.value)}>
            <option value="">Hãng: tất cả</option>{brands.map((b) => <option key={b.name}>{b.name}</option>)}
          </select>
          <select className="inp !w-auto" value={fWarn} onChange={(e) => { setFWarn(e.target.value); setPage(1); }}>
            <option value="">Cảnh báo: tất cả</option>
            <option value="het">🔴 Hết hàng</option>
            <option value="sap">🟠 Sắp hết</option>
            <option value="con">🟢 Còn hàng</option>
          </select>
        </div>
        <div className="overflow-x-auto"><table className="w-full border-collapse">
          <thead><tr><Th label="Mã nội bộ" k="id" sort={sort} /><Th label="Mã hãng" k="mfr" sort={sort} /><Th label="Hãng" k="brand" sort={sort} /><Th label="Tên xe" k="name" sort={sort} /><Th label="Màu" k="color" sort={sort} /><Th label="Giá niêm yết" k="price" sort={sort} /><Th label="Tồn min" k="min" sort={sort} /><Th label="Tổng tồn" k="qty" sort={sort} /><th className="th">Cảnh báo</th><th className="th"></th></tr></thead>
          <tbody>{pageSlice(sort.sortFn(list, { id: (v) => v.id, mfr: (v) => v.mfr_code || "", brand: (v) => v.brand, name: (v) => v.name, color: (v) => v.color, price: (v) => v.list_price, min: (v) => v.min_stock, qty: (v) => totalQty(v.id) }), page, pageSize).map((v) => {
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
        <Pager total={list.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
        <div className="text-[11.5px] text-[#8A93A0] mt-2">
          Tiêu chí cảnh báo theo tổng tồn so với <b>Tồn tối thiểu</b> của từng mã: 🔴 Hết hàng (tồn = 0) · 🟠 Sắp hết (tồn ≤ tồn tối thiểu) · 🟢 Còn hàng (tồn &gt; tồn tối thiểu). Muốn đổi ngưỡng, sửa cột <b>Tồn tối thiểu</b> ở nút ✎ Sửa của từng mã (mặc định 2).
        </div>
      </div>
      </>}

      {tab === "sokhung" && (
        <div className="card">
          <div className="flex gap-2 flex-wrap items-center mb-3">
            <div className="font-extrabold mr-auto">Xe theo số khung {units.length > 0 && <span className="text-xs font-normal text-[#8A93A0]">({units.length} xe đang tồn)</span>}</div>
            <input className="inp !w-64" placeholder="🔎 Tìm số khung hoặc tên xe…" value={skq} onChange={(e) => { setSkq(e.target.value); setUPage(1); }} />
            <select className="inp !w-auto" value={uFBrand} onChange={(e) => { setUFBrand(e.target.value); setUPage(1); }}>
              <option value="">Hãng: tất cả</option>{brands.map((b) => <option key={b.name}>{b.name}</option>)}
            </select>
            <select className="inp !w-auto" value={uFLoc} onChange={(e) => { setUFLoc(e.target.value); setUPage(1); }}>
              <option value="">Kho: tất cả</option>{locations.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
            <button className="btn-ghost !text-xs" onClick={loadUnits}>↻ Tải lại</button>
          </div>
          {uLoading ? <div className="text-sm text-[#8A93A0] py-4">Đang tải danh sách xe…</div> : (() => {
            const kw = skq.trim().toLowerCase();
            const list2f = units.filter((u) => {
              const v = vehicles.find((x) => x.id === u.vehicle_id);
              if (uFBrand && v?.brand !== uFBrand) return false;
              if (uFLoc && u.location_code !== uFLoc) return false;
              if (!kw) return true;
              return `${u.frame_number} ${u.vehicle_id} ${v ? v.name + " " + v.color : ""}`.toLowerCase().includes(kw);
            });
            const nowMs = Date.now();
            const list2 = uSort.sortFn(list2f, {
              brand: (u) => vehicles.find((x) => x.id === u.vehicle_id)?.brand || "",
              name: (u) => vehicles.find((x) => x.id === u.vehicle_id)?.name || "",
              color: (u) => vehicles.find((x) => x.id === u.vehicle_id)?.color || "",
              frame: (u) => u.frame_number,
              kho: (u) => locations.find((x) => x.code === u.location_code)?.name || u.location_code,
              von: (u) => u.cost_price || 0,
              nhap: (u) => new Date(u.imported_at).getTime(),
              ton: (u) => Math.floor((nowMs - new Date(u.imported_at)) / 86400000),
              tt: (u) => u.status,
            });
            const pg = pageSlice(list2, uPage, uPageSize);
            const today = new Date();
            return (
              <>
                <SelectionBar sel={uSel}>
                  <span className="text-[12px] font-bold text-brand px-1.5 self-center">Đã chọn {uSel.count} xe</span>
                  <button className="btn-ghost !text-xs !py-1" onClick={() => {
                    const rs = list2.filter((u) => uSel.has(u.frame_number));
                    downloadCSV(`xe_ton_chon.csv`, [["Hãng", "Tên xe", "Màu", "Số khung", "Kho", "Giá vốn", "Ngày nhập", "Trạng thái"],
                      ...rs.map((u) => { const v = vehicles.find((x) => x.id === u.vehicle_id); const l = locations.find((x) => x.code === u.location_code); return [v?.brand || "", v?.name || u.vehicle_id, v?.color || "", u.frame_number, l?.name || u.location_code, u.cost_price || "", fmtDate(u.imported_at), u.status]; })]);
                    notify(`Đã xuất ${rs.length} xe đã chọn.`);
                  }}>⬇ Xuất Excel</button>
                </SelectionBar>
                <div className="overflow-x-auto"><table className="w-full border-collapse">
                  <thead><tr><ThCheck sel={uSel} rows={pg} idOf={(u) => u.frame_number} /><Th label="Hãng" k="brand" sort={uSort} /><Th label="Tên xe" k="name" sort={uSort} /><Th label="Màu" k="color" sort={uSort} /><Th label="Số khung" k="frame" sort={uSort} /><Th label="Kho" k="kho" sort={uSort} /><Th label="Giá vốn" k="von" sort={uSort} /><Th label="Ngày nhập" k="nhap" sort={uSort} /><Th label="Ngày tồn" k="ton" sort={uSort} /><Th label="Trạng thái" k="tt" sort={uSort} /><th className="th"></th></tr></thead>
                  <tbody>{pg.map((u, i) => {
                    const v = vehicles.find((x) => x.id === u.vehicle_id);
                    const l = locations.find((x) => x.code === u.location_code);
                    const days = Math.floor((today - new Date(u.imported_at)) / 86400000);
                    return [
                      <tr key={u.frame_number} className={euFrame === u.frame_number ? "bg-[#FDF6E3]" : uSel.has(u.frame_number) ? "bg-[#EAF2FF]" : hiSk && u.frame_number.toUpperCase() === hiSk ? "bg-[#E7F6EE] ring-2 ring-[#0E7A4A]" : "hover:bg-[#F8FAFC]"}>
                        <TdCheck sel={uSel} id={u.frame_number} />
                        <td className="td text-xs">{v?.brand || "?"}</td>
                        <td className="td font-semibold text-[13px]">{v?.name || u.vehicle_id}</td>
                        <td className="td text-xs">{v?.color || ""}</td>
                        <td className="td font-mono text-[12.5px]">{u.frame_number}{u.is_placeholder && <Badge tone="amber">tạm</Badge>}</td>
                        <td className="td text-xs">{l?.name || u.location_code}</td>
                        <td className="td text-xs">{u.cost_price ? fmtVND(u.cost_price) : <span className="text-[#C6CDD6]">—</span>}</td>
                        <td className="td text-xs whitespace-nowrap">{fmtDate(u.imported_at)}</td>
                        <td className="td text-center"><span className={days >= 90 ? "text-danger font-bold" : days >= 60 ? "text-[#A25F00] font-bold" : ""}>{days}</span></td>
                        <td className="td">{u.status === "TON_KHO" ? <Badge tone="green">Tồn kho</Badge> : u.status === "GIU_CHO" ? <Badge tone="amber">🔒 Giữ chỗ</Badge> : <Badge tone="blue">Đang chuyển</Badge>}</td>
                        <td className="td">{u.status !== "DA_BAN" && <button className={`!px-2.5 !py-1 !text-xs ${euFrame === u.frame_number ? "btn-primary" : "btn-ghost"}`} onClick={() => euFrame === u.frame_number ? setEuFrame(null) : startEditUnit(u)}>{euFrame === u.frame_number ? "Đóng" : "✎ Sửa"}</button>}</td>
                      </tr>,
                      euFrame === u.frame_number && (
                        <tr key={u.frame_number + "e"}><td colSpan={11} className="td bg-[#FFFDF5]">
                          <div className="grid gap-x-4 md:grid-cols-3 sm:grid-cols-2">
                            <Field label="Số khung"><input className="inp font-mono !text-[13px]" value={eu.new_frame} onChange={(e) => setEu((p) => ({ ...p, new_frame: e.target.value.toUpperCase() }))} /></Field>
                            <Field label="Mẫu xe (gõ tìm)"><VehicleSearch vehicles={vehicles} value={eu.vehicle_id} onChange={(v) => setEu((p) => ({ ...p, vehicle_id: v }))} /></Field>
                            <Field label="Kho hiện tại (gõ tìm)"><LocSearch locations={locations} value={eu.location_code} onChange={(v) => setEu((p) => ({ ...p, location_code: v }))} /></Field>
                            <Field label="Số máy (tùy chọn)"><input className="inp font-mono !text-[13px]" value={eu.engine_number} onChange={(e) => setEu((p) => ({ ...p, engine_number: e.target.value }))} /></Field>
                            <Field label="💰 Giá vốn chiếc này (đ)"><MoneyInput value={eu.cost_price} onChange={(v) => setEu((p) => ({ ...p, cost_price: v }))} placeholder="Giá nhập thực tế" /></Field>
                            <Field label="Ghi chú"><input className="inp" value={eu.note} onChange={(e) => setEu((p) => ({ ...p, note: e.target.value }))} /></Field>
                          </div>
                          <div className="flex gap-2"><button className="btn-ok !text-xs" onClick={saveUnit}>💾 Lưu thông tin xe</button><button className="btn-ghost !text-xs" onClick={() => setEuFrame(null)}>Hủy</button></div>
                          <p className="text-[10.5px] text-[#8A93A0] mt-1.5">Đổi số khung / mẫu xe / kho của đúng chiếc này. Xe đã bán không sửa được ở đây.</p>
                        </td></tr>
                      ),
                    ];
                  })}
                  {list2.length === 0 && <tr><td className="td" colSpan={11}>{kw ? `Không có xe nào khớp "${skq}".` : "Không có xe tồn nào."}</td></tr>}
                  </tbody>
                </table></div>
                <div className="text-xs text-[#8A93A0] mt-2">Tổng: <b>{list2.length}</b> xe{kw ? " khớp tìm kiếm" : " đang tồn"}. Ngày tồn ≥60 vàng, ≥90 đỏ.</div>
                <Pager total={list2.length} page={uPage} setPage={setUPage} pageSize={uPageSize} setPageSize={setUPageSize} />
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}