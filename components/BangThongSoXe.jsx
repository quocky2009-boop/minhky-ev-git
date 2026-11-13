"use client";
import { useState } from "react";
import { Badge, useSortable, Th } from "@/components/ui";
import { downloadXLSX, errMsg } from "@/lib/format";

// BANG THONG SO KY THUAT THEO MODEL (Danh muc xe). Luon la dang bang (ca dien thoai: keo ngang, cot Ten xe dung yen).
// Loc / tim / sap xep theo thong so; sua nhanh ngay tren dong (ap cho moi mau cua model qua fn_cap_nhat_thong_so_hang_loat).
const COT = [ // [key, nhan, don vi, kieu]
  ["loai_pin", "Loại pin", "", "text"], ["dung_luong_pin_kwh", "Pin kèm xe", " kWh", "num"], ["pin_phu_kwh", "Pin phụ", " kWh", "num"],
  ["tong", "Tổng khi lắp pin phụ", " kWh", "calc"], ["cong_suat_sac_w", "Sạc", " W", "num"], ["vi_tri_pin", "Vị trí pin", "", "text"],
  ["tam_hoat_dong_km", "Tầm hoạt động", " km", "num"], ["toc_do_toi_da_kmh", "Tốc độ tối đa", " km/h", "num"],
  ["cong_suat_dong_co_w", "CS danh định", " W", "num"], ["cong_suat_toi_da_w", "CS tối đa", " W", "num"],
];
const SUA = COT.filter((c) => c[3] !== "calc").map((c) => c[0]);
const tong = (v) => (Number(v.pin_phu_kwh) > 0 ? Math.round(((Number(v.dung_luong_pin_kwh) || 0) + Number(v.pin_phu_kwh)) * 1000) / 1000 : null);
const trong = (x) => x === null || x === undefined || x === "";

export default function BangThongSoXe({ vehicles, brands, supabase, notify, refresh, canEdit }) {
  const [q, setQ] = useState("");
  const [fBrand, setFBrand] = useState("");
  const [fPin, setFPin] = useState("");
  const [fThieu, setFThieu] = useState(false);
  const [tamMin, setTamMin] = useState("");
  const [tocMin, setTocMin] = useState("");
  const [ed, setEd] = useState(null); // { key, brand, name, ...gia tri dang sua }
  const [busy, setBusy] = useState(false);
  const sort = useSortable();

  // Moi model 1 dong (lay ma xe dau tien lam dai dien — thong so nhap theo model)
  const ms = [...new Map(vehicles.map((v) => [v.brand + "|" + v.name, v])).values()].map((v) => ({ ...v, key: v.brand + "|" + v.name, tong: tong(v) }));
  const thieu = (v) => ["loai_pin", "dung_luong_pin_kwh", "cong_suat_sac_w", "vi_tri_pin", "tam_hoat_dong_km", "toc_do_toi_da_kmh", "cong_suat_dong_co_w", "cong_suat_toi_da_w"].some((k) => trong(v[k]));
  const kw = q.trim().toLowerCase();
  const loc = ms.filter((v) => (!fBrand || v.brand === fBrand) && (!fPin || (fPin === "∅" ? !v.model_pin : v.model_pin === fPin)) && (!fThieu || thieu(v))
    && (tamMin === "" || Number(v.tam_hoat_dong_km) >= Number(tamMin)) && (tocMin === "" || Number(v.toc_do_toi_da_kmh) >= Number(tocMin))
    && (!kw || `${v.brand} ${v.name} ${v.model_pin || ""} ${v.loai_pin || ""} ${v.vi_tri_pin || ""} ${v.dung_luong_pin || ""}`.toLowerCase().includes(kw)));
  const lay = { ten: (v) => v.name, hang: (v) => v.brand, mp: (v) => v.model_pin || "" };
  COT.forEach(([k, , , kieu]) => { lay[k] = (v) => (kieu === "text" ? v[k] || "" : trong(v[k]) ? -1 : Number(v[k])); });
  const ds = sort.sortKey ? sort.sortFn(loc, lay) : [...loc].sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name));
  const dangLoc = q || fBrand || fPin || fThieu || tamMin !== "" || tocMin !== "";

  const moSua = (v) => { const o = { key: v.key, brand: v.brand, name: v.name, model_pin: v.model_pin || "" }; SUA.forEach((k) => { o[k] = v[k] ?? ""; }); setEd(o); };
  const luu = async () => {
    const p = { brand: ed.brand, name: ed.name, model_pin: ed.model_pin || null };
    SUA.forEach((k) => { const kieu = COT.find((c) => c[0] === k)[3]; p[k] = ed[k] === "" ? null : kieu === "num" ? Number(ed[k]) : String(ed[k]).trim(); });
    if (SUA.every((k) => p[k] === null) && !p.model_pin) return notify("Nhập ít nhất 1 thông số.", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_cap_nhat_thong_so_hang_loat", { p });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã cập nhật thông số ${ed.name} cho ${data?.so_ma_cap_nhat || 0} mã xe (mọi màu).`); setEd(null); refresh && refresh();
  };
  const xuat = () => downloadXLSX("thong_so_ky_thuat_xe.xlsx", [
    ["Hãng", "Tên xe", "Model pin", "Loại pin", "Dung lượng pin kèm xe (kWh)", "Pin phụ tùy chọn (kWh)", "Tổng dung lượng khi lắp pin phụ (kWh)", "Công suất sạc (W)", "Vị trí pin", "Tầm hoạt động (km)", "Tốc độ tối đa (km/h)", "Công suất động cơ danh định (W)", "Công suất động cơ tối đa (W)", "Số lượng pin/AQ", "Dung lượng pin (ghi chú)"],
    ...ds.map((v) => [v.brand, v.name, v.model_pin || "", v.loai_pin || "", v.dung_luong_pin_kwh ?? "", v.pin_phu_kwh ?? "", v.tong ?? "", v.cong_suat_sac_w ?? "", v.vi_tri_pin || "", v.tam_hoat_dong_km ?? "", v.toc_do_toi_da_kmh ?? "", v.cong_suat_dong_co_w ?? "", v.cong_suat_toi_da_w ?? "", v.so_luong_pin_ac_quy ?? "", v.dung_luong_pin || ""])], "Thong_so");
  const hien = (v, [k, , dv, kieu]) => (trong(v[k]) ? <span className="text-[#C6CDD6]">—</span> : kieu === "text" ? v[k] : `${Number(v[k]).toLocaleString("vi-VN")}${dv}`);

  return (
    <div className="card">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <div className="font-extrabold mr-auto">Bảng thông số kỹ thuật theo model ({ds.length}{ds.length !== ms.length ? `/${ms.length}` : ""})</div>
        <button className="btn-ghost !text-xs" onClick={xuat}>⬇ Xuất Excel</button>
      </div>
      <div className="flex gap-2 flex-wrap items-center mb-2.5">
        <input className="inp !w-56 max-md:!w-full" placeholder="Tìm tên xe, loại pin, vị trí pin…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inp !w-auto" value={fBrand} onChange={(e) => setFBrand(e.target.value)}><option value="">Hãng: tất cả</option>{(brands || []).map((b) => <option key={b.name}>{b.name}</option>)}</select>
        <select className="inp !w-auto" value={fPin} onChange={(e) => setFPin(e.target.value)}><option value="">Model pin: tất cả</option><option>Xe kèm pin</option><option>Xe đổi pin</option><option>Xe kèm AQ</option><option value="∅">(chưa chọn)</option></select>
        <input type="number" className="inp !w-32" placeholder="Tầm ≥ … km" value={tamMin} onChange={(e) => setTamMin(e.target.value)} title="Chỉ hiện xe có tầm hoạt động từ số km này trở lên" />
        <input type="number" className="inp !w-36" placeholder="Tốc độ ≥ … km/h" value={tocMin} onChange={(e) => setTocMin(e.target.value)} title="Chỉ hiện xe có tốc độ tối đa từ số này trở lên" />
        <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer"><input type="checkbox" className="w-4 h-4" checked={fThieu} onChange={(e) => setFThieu(e.target.checked)} />Chỉ xe còn thiếu thông số ({ms.filter(thieu).length})</label>
        {dangLoc ? <button className="btn-ghost !text-xs" onClick={() => { setQ(""); setFBrand(""); setFPin(""); setFThieu(false); setTamMin(""); setTocMin(""); }}>✕ Bỏ lọc</button> : null}
      </div>
      <div className="overflow-x-auto max-h-[70vh] overflow-y-auto border border-[#E6EAEF] rounded-xl">
        <table className="border-collapse w-full text-[12.5px] whitespace-nowrap">
          <thead className="sticky top-0 z-10"><tr className="bg-[#F3F5F8]">
            <Th label="Tên xe" k="ten" sort={sort} className="sticky left-0 bg-[#F3F5F8] z-20" /><Th label="Hãng" k="hang" sort={sort} /><Th label="Model pin" k="mp" sort={sort} />
            {COT.map(([k, nhan, , kieu]) => <Th key={k} label={nhan} k={k} sort={sort} className={kieu === "text" ? "" : "text-right"} />)}
            {canEdit && <th className="th"></th>}
          </tr></thead>
          <tbody>
            {ds.map((v) => (ed && ed.key === v.key ? (
              <tr key={v.key} className="bg-[#FFFCF0]">
                <td className="td sticky left-0 bg-[#FFFCF0] font-semibold">{v.name}</td><td className="td text-xs text-[#5A6572]">{v.brand}</td>
                <td className="td"><select className="inp !py-1 !text-xs !w-28" value={ed.model_pin} onChange={(e) => setEd({ ...ed, model_pin: e.target.value })}><option value="">—</option><option>Xe kèm pin</option><option>Xe đổi pin</option><option>Xe kèm AQ</option></select></td>
                {COT.map(([k, , , kieu]) => (
                  <td key={k} className={`td ${kieu === "text" ? "" : "text-right"}`}>
                    {kieu === "calc" ? <span className="text-[#8A93A0]">{tong(ed) ?? "—"}</span>
                      : <input type={kieu === "num" ? "number" : "text"} step="any" className={`inp !py-1 !text-xs ${kieu === "num" ? "!w-20 text-right" : k === "vi_tri_pin" ? "!w-48" : "!w-20"}`} value={ed[k]} onChange={(e) => setEd({ ...ed, [k]: e.target.value })} />}
                  </td>))}
                <td className="td"><div className="flex gap-1"><button className="btn-ok !px-2 !py-1 !text-xs" disabled={busy} onClick={luu}>{busy ? "…" : "Lưu"}</button><button className="btn-ghost !px-2 !py-1 !text-xs" disabled={busy} onClick={() => setEd(null)}>Hủy</button></div></td>
              </tr>
            ) : (
              <tr key={v.key} className="hover:bg-[#F8FAFC]">
                <td className="td sticky left-0 bg-white font-semibold">{v.name}</td><td className="td text-xs text-[#5A6572]">{v.brand}</td>
                <td className="td">{v.model_pin ? <Badge tone={v.model_pin === "Xe đổi pin" ? "amber" : "blue"}>{v.model_pin}</Badge> : <span className="text-[#C6CDD6]">—</span>}</td>
                {COT.map((c) => <td key={c[0]} className={`td ${c[3] === "text" ? "" : "text-right tabular-nums"}`}>{hien(v, c)}</td>)}
                {canEdit && <td className="td"><button className="btn-ghost !px-2 !py-1 !text-xs" title="Sửa nhanh thông số của model này (áp cho mọi màu)" onClick={() => moSua(v)}>✎ Sửa</button></td>}
              </tr>)))}
            {ds.length === 0 && <tr><td className="td" colSpan={COT.length + 4}>Không có model nào khớp bộ lọc.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-[#8A93A0] mt-1.5">Bấm tiêu đề cột để sắp xếp. Thông số nhập theo model, áp cho mọi màu.{canEdit ? " Sửa nhanh: ô để trống sẽ giữ nguyên giá trị cũ (muốn xóa hẳn một thông số thì dùng ✎ Sửa ở từng mã xe)." : ""}</div>
    </div>
  );
}
