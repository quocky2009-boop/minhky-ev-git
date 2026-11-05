"use client";
import { useState } from "react";
import { errMsg } from "@/lib/format";

// Quan ly nhom: loai "PT" (phu tung, app_settings.dv_nhom_phu_tung) hoac "HH" (hang hoa, app_settings.hh_nhom_hang_hoa)
export const MAC_DINH = { PT: "Pin & Ắc quy\nSăm lốp\nPhanh\nĐiện & Sạc\nNhựa & Dàn áo\nKhác", HH: "Phụ kiện\nPhụ tùng\nQuà tặng\nVật tư\nKhác" };
export const dsNhom = (settings, loai) => String((settings || {})[loai === "PT" ? "dv_nhom_phu_tung" : "hh_nhom_hang_hoa"] || MAC_DINH[loai]).split(/\n+/).map((x) => x.trim()).filter(Boolean);

export default function NhomHang({ loai, supabase, settings, items = [], notify, onDone, onClose }) {
  const [ds, setDs] = useState(dsNhom(settings, loai));
  const [moi, setMoi] = useState("");
  const [sua, setSua] = useState(null); // { ten, ten_moi }
  const [xoa, setXoa] = useState(null); // { ten, chuyen_sang }
  const [busy, setBusy] = useState(false);
  const dem = (g) => items.filter((x) => x.group_name === g).length;
  const ten = loai === "PT" ? "phụ tùng" : "hàng hóa";

  const goi = async (p, msg) => {
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_nhom_hang", { p: { loai, ...p } });
    setBusy(false);
    if (error) { notify(errMsg(error), "err"); return false; }
    setDs(data.ds || []); notify(msg + (data.so_ma ? ` (${data.so_ma} mã đã cập nhật)` : "")); onDone && onDone(); return true;
  };
  const doiCho = (i, d) => { const n = [...ds]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; goi({ action: "sap_xep", ds: n }, "Đã đổi thứ tự."); };

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-start justify-center p-3 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl w-[560px] max-w-full p-4 my-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center mb-2"><div className="font-extrabold text-base">Quản lý nhóm {ten}</div><button className="ml-auto text-[#8A93A0] text-lg" onClick={onClose}>✕</button></div>
        <p className="text-[12px] text-[#5A6572] mb-3">Đổi tên nhóm sẽ cập nhật luôn các mã {ten} đang thuộc nhóm đó. Xóa nhóm đang có mã thì phải chọn nhóm để chuyển các mã sang.</p>
        <div className="flex gap-2 mb-3">
          <input className="inp" placeholder="Tên nhóm mới…" value={moi} onChange={(e) => setMoi(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && moi.trim()) goi({ action: "them", ten: moi.trim() }, `Đã thêm nhóm “${moi.trim()}”.`).then((ok) => ok && setMoi("")); }} />
          <button className="btn-primary !text-xs whitespace-nowrap" disabled={busy || !moi.trim()} onClick={() => goi({ action: "them", ten: moi.trim() }, `Đã thêm nhóm “${moi.trim()}”.`).then((ok) => ok && setMoi(""))}>+ Thêm nhóm</button>
        </div>
        <div className="border border-[#E3E8EF] rounded-xl divide-y divide-[#EEF1F4]">
          {ds.map((g, i) => (
            <div key={g} className="px-3 py-2 text-[13px]">
              {sua?.ten === g ? (
                <div className="flex gap-2 items-center">
                  <input className="inp !py-1 !text-xs" autoFocus value={sua.ten_moi} onChange={(e) => setSua({ ...sua, ten_moi: e.target.value })} />
                  <button className="btn-ok !px-2 !py-1 !text-xs" disabled={busy || !sua.ten_moi.trim()} onClick={() => goi({ action: "sua", ten: g, ten_moi: sua.ten_moi.trim() }, "Đã đổi tên nhóm.").then((ok) => ok && setSua(null))}>Lưu</button>
                  <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => setSua(null)}>Hủy</button>
                </div>
              ) : xoa?.ten === g ? (
                <div className="flex gap-2 items-center flex-wrap">
                  <span>Xóa <b>{g}</b>{dem(g) ? <> — {dem(g)} mã chuyển sang</> : "?"}</span>
                  {dem(g) > 0 && <select className="inp !w-auto !py-1 !text-xs" value={xoa.chuyen_sang} onChange={(e) => setXoa({ ...xoa, chuyen_sang: e.target.value })}><option value="">— Chọn nhóm —</option>{ds.filter((x) => x !== g).map((x) => <option key={x}>{x}</option>)}</select>}
                  <button className="btn !px-2 !py-1 !text-xs bg-danger text-white" disabled={busy || (dem(g) > 0 && !xoa.chuyen_sang)} onClick={() => goi({ action: "xoa", ten: g, chuyen_sang: xoa.chuyen_sang }, `Đã xóa nhóm “${g}”.`).then((ok) => ok && setXoa(null))}>Xóa</button>
                  <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => setXoa(null)}>Hủy</button>
                </div>
              ) : (
                <div className="flex gap-2 items-center">
                  <span className="mr-auto font-semibold">{g} <span className="text-[11px] font-normal text-[#8A93A0]">· {dem(g)} mã</span></span>
                  <button className="text-[#8A93A0] px-1" title="Lên" disabled={busy || i === 0} onClick={() => doiCho(i, -1)}>▲</button>
                  <button className="text-[#8A93A0] px-1" title="Xuống" disabled={busy || i === ds.length - 1} onClick={() => doiCho(i, 1)}>▼</button>
                  <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => { setXoa(null); setSua({ ten: g, ten_moi: g }); }}>✎ Sửa</button>
                  <button className="btn-ghost !px-2 !py-1 !text-xs !text-danger" onClick={() => { setSua(null); setXoa({ ten: g, chuyen_sang: "" }); }}>Xóa</button>
                </div>)}
            </div>))}
          {ds.length === 0 && <div className="px-3 py-3 text-[12.5px] text-[#8A93A0]">Chưa có nhóm nào.</div>}
        </div>
        {items.some((x) => x.group_name && !ds.includes(x.group_name)) && (
          <div className="text-[11.5px] text-[#A25F00] mt-2">Có mã đang dùng nhóm không có trong danh sách: {[...new Set(items.filter((x) => x.group_name && !ds.includes(x.group_name)).map((x) => x.group_name))].join(", ")} — bấm “+ Thêm nhóm” đúng tên đó để quản lý.</div>)}
      </div>
    </div>
  );
}
