"use client";
import { useState } from "react";
import Link from "next/link";
import { useCatalog } from "@/lib/useData";
import { Badge } from "@/components/ui";
import { fmtNum, fmtDate } from "@/lib/format";

const daysIn = (t) => Math.max(0, Math.floor((Date.now() - new Date(t).getTime()) / 86400000));

// Bang ma tran: dong = ma xe, cot = kho (giong sheet DM_XE cua file Excel cu)
export default function TonTongHop() {
  const { supabase, vehicles, locations, brands, loading, getQty, totalQty, regionQty } = useCatalog();
  const [q, setQ] = useState(""); const [fBrand, setFBrand] = useState("");
  const [hideZero, setHideZero] = useState(true);
  const [cell, setCell] = useState(null); // {v, l, units}

  const openCell = async (v, l) => {
    setCell({ v, l, units: null });
    const { data } = await supabase.from("vehicle_units").select("*")
      .eq("vehicle_id", v.id).eq("location_code", l.code).in("status", ["TON_KHO", "DANG_CHUYEN"])
      .order("imported_at");
    setCell({ v, l, units: data || [] });
  };

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
    const rows = [["Ma_Xe","Ten_Xe","Mau","Tong", ...regions.map((r) => "Tong "+r), ...locs.map((l) => l.name)],
      ...list.map((v) => [v.id, v.name, v.color, totalQty(v.id), ...regions.map((r) => regionQty(v.id, r)), ...locs.map((l) => getQty(v.id, l.code))]),
      ["TONG", "", "", grand, ...regions.map((r) => regTotal(r)), ...locs.map((l) => colTotal(l.code))]];
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
              <th className="th text-center bg-[#E7EFFD]">TỔNG</th>
              {regions.map((r) => <th key={r} className="th text-center bg-[#E5F6EE]">Σ {r}</th>)}
              {locs.map((l) => <th key={l.code} className="th text-center !px-2" title={l.name}>{l.name.replace(/(Quang Trung|Trường Chinh|Song Hào)/, (m) => m.split(" ").map(w=>w[0]).join(""))}</th>)}
            </tr>
          </thead>
          <tbody>
            {list.map((v) => (
              <tr key={v.id} className="hover:bg-[#F8FAFC]">
                <td className="td sticky left-0 bg-white font-semibold text-[12.5px]">{v.name} <span className="text-[#8A93A0]">· {v.color}</span></td>
                <td className="td text-center font-extrabold bg-[#E7EFFD]">{totalQty(v.id)}</td>
                {regions.map((r) => { const n = regionQty(v.id, r);
                  return <td key={r} className={`td text-center tabular-nums bg-[#F4FBF7] ${n === 0 ? "text-[#C6CDD6]" : "font-bold"}`}>{n === 0 ? "·" : n}</td>; })}
                {locs.map((l) => {
                  const n = getQty(v.id, l.code);
                  return <td key={l.code} className={`td text-center tabular-nums ${n === 0 ? "text-[#C6CDD6]" : "font-bold text-brand cursor-pointer hover:underline"}`}
                    title={n > 0 ? `Xem ${n} xe ${v.name} tại ${l.name}` : ""}
                    onClick={() => n > 0 && openCell(v, l)}>{n === 0 ? "·" : n}</td>;
                })}
              </tr>
            ))}
            <tr className="bg-[#F3F5F8] font-extrabold">
              <td className="td sticky left-0 bg-[#F3F5F8]">TỔNG</td>
              <td className="td text-center bg-[#E7EFFD]">{grand}</td>
              {regions.map((r) => <td key={r} className="td text-center tabular-nums bg-[#E5F6EE]">{regTotal(r)}</td>)}
              {locs.map((l) => <td key={l.code} className="td text-center tabular-nums">{colTotal(l.code)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      {cell && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-3" onClick={() => setCell(null)}>
          <div className="bg-white rounded-2xl w-[540px] max-w-full max-h-[85vh] overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <div className="font-extrabold text-base mr-auto">{cell.v.name} · {cell.v.color}</div>
              <Link href={`/kho/${cell.l.code}`} className="btn-ghost !px-3 !py-1.5 !text-xs">Mở trang kho →</Link>
              <button className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => setCell(null)}>✕</button>
            </div>
            <div className="text-xs text-[#5A6572] mb-3">Tại: <b>{cell.l.name}</b> · {cell.units ? cell.units.length + " xe" : "đang tải…"}</div>
            {cell.units && (
              <table className="w-full border-collapse">
                <thead><tr><th className="th">Số khung</th><th className="th">Ngày nhập</th><th className="th">Ngày tồn</th><th className="th">Trạng thái</th></tr></thead>
                <tbody>{cell.units.map((u) => (
                  <tr key={u.frame_number}>
                    <td className="td font-mono text-[12px] font-bold">{u.frame_number}{u.is_placeholder && <div><Badge tone="amber">SK tạm</Badge></div>}</td>
                    <td className="td">{fmtDate(u.imported_at)}</td>
                    <td className="td"><b className={daysIn(u.imported_at) >= 90 ? "text-danger" : daysIn(u.imported_at) >= 60 ? "text-[#A25F00]" : ""}>{daysIn(u.imported_at)}</b></td>
                    <td className="td">{u.status === "TON_KHO" ? <Badge tone="green">Tồn kho</Badge> : <Badge tone="purple">Đang chuyển</Badge>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      )}
      <p className="text-[11px] text-[#8A93A0] mt-2">Bấm vào số tồn bất kỳ để xem danh sách xe chi tiết. Số liệu gồm cả xe đang điều chuyển (vẫn tính ở kho đi cho đến khi bên nhận xác nhận). Xoay ngang điện thoại để xem dễ hơn.</p>
    </div>
  );
}
