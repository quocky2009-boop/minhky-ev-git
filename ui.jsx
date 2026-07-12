"use client";
import { useState } from "react";
import { useCatalog } from "@/lib/useData";
import { fmtNum } from "@/lib/format";

// Bang ma tran: dong = ma xe, cot = kho (giong sheet DM_XE cua file Excel cu)
export default function TonTongHop() {
  const { vehicles, locations, brands, loading, getQty, totalQty, regionQty } = useCatalog();
  const [q, setQ] = useState(""); const [fBrand, setFBrand] = useState("");
  const [hideZero, setHideZero] = useState(true);

  if (loading) return <div className="card">Đang tải dữ liệu…</div>;
  const locs = locations.filter((l) => l.status === "Hoạt động" || vehicles.some((v) => getQty(v.id, l.code) > 0));
  const list = vehicles.filter((v) => {
    if (fBrand && v.brand !== fBrand) return false;
    if (hideZero && totalQty(v.id) === 0) return false;
    const t = (v.id + v.name + v.color).toLowerCase();
    return !q || t.includes(q.toLowerCase());
  });
  const colTotal = (code) => list.reduce((s, v) => s + getQty(v.id, code), 0);
  const grand = list.reduce((s, v) => s + totalQty(v.id), 0);
  const regions = [...new Set(locs.map((l) => l.region))];
  const regTotal = (rg) => list.reduce((s, v) => s + regionQty(v.id, rg), 0);

  const exportCSV = () => {
    const rows = [["Ma_Xe","Ten_Xe","Mau", ...regions.map((r) => "Tong "+r), ...locs.map((l) => l.name), "Tong"],
      ...list.map((v) => [v.id, v.name, v.color, ...regions.map((r) => regionQty(v.id, r)), ...locs.map((l) => getQty(v.id, l.code)), totalQty(v.id)]),
      ["TONG", "", "", ...regions.map((r) => regTotal(r)), ...locs.map((l) => colTotal(l.code)), grand]];
    const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${String(c ?? "")}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "ton_tong_hop.csv"; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="card">
      <div className="flex gap-2 flex-wrap items-center mb-3">
        <div className="font-extrabold mr-auto">Bảng tồn tổng hợp — {list.length} mã xe · {fmtNum(grand)} xe</div>
        <input className="inp !w-52" placeholder="Tìm xe…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inp !w-auto" value={fBrand} onChange={(e) => setFBrand(e.target.value)}>
          <option value="">Hãng: tất cả</option>{brands.map((b) => <option key={b.name}>{b.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} /> Ẩn xe hết tồn</label>
        <button className="btn-ghost" onClick={exportCSV}>⬇ Xuất CSV</button>
      </div>
      <div className="overflow-x-auto max-h-[70vh] overflow-y-auto border border-[#E6EAEF] rounded-xl">
        <table className="border-collapse w-full">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#F3F5F8]">
              <th className="th sticky left-0 bg-[#F3F5F8] z-20 min-w-[190px]">Xe</th>
              {regions.map((r) => <th key={r} className="th text-center bg-[#E5F6EE]">Σ {r}</th>)}
              {locs.map((l) => <th key={l.code} className="th text-center !px-2" title={l.name}>{l.name.replace(/(Quang Trung|Trường Chinh|Song Hào)/, (m) => m.split(" ").map(w=>w[0]).join(""))}</th>)}
              <th className="th text-center bg-[#E7EFFD]">Tổng</th>
            </tr>
          </thead>
          <tbody>
            {list.map((v) => (
              <tr key={v.id} className="hover:bg-[#F8FAFC]">
                <td className="td sticky left-0 bg-white font-semibold text-[12.5px]">{v.name} <span className="text-[#8A93A0]">· {v.color}</span></td>
                {regions.map((r) => { const n = regionQty(v.id, r);
                  return <td key={r} className={`td text-center tabular-nums bg-[#F4FBF7] ${n === 0 ? "text-[#C6CDD6]" : "font-bold"}`}>{n === 0 ? "·" : n}</td>; })}
                {locs.map((l) => {
                  const n = getQty(v.id, l.code);
                  return <td key={l.code} className={`td text-center tabular-nums ${n === 0 ? "text-[#C6CDD6]" : "font-bold"}`}>{n === 0 ? "·" : n}</td>;
                })}
                <td className="td text-center font-extrabold bg-[#F5F9FF]">{totalQty(v.id)}</td>
              </tr>
            ))}
            <tr className="bg-[#F3F5F8] font-extrabold">
              <td className="td sticky left-0 bg-[#F3F5F8]">TỔNG</td>
              {regions.map((r) => <td key={r} className="td text-center tabular-nums bg-[#E5F6EE]">{regTotal(r)}</td>)}
              {locs.map((l) => <td key={l.code} className="td text-center tabular-nums">{colTotal(l.code)}</td>)}
              <td className="td text-center bg-[#E7EFFD]">{grand}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-[#8A93A0] mt-2">Số liệu gồm cả xe đang điều chuyển (vẫn tính ở kho đi cho đến khi bên nhận xác nhận). Xoay ngang điện thoại để xem dễ hơn.</p>
    </div>
  );
}
