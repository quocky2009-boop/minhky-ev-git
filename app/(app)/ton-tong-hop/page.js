"use client";
import { useState } from "react";
import Link from "next/link";
import { useCatalog } from "@/lib/useData";
import { usePerms } from "@/lib/usePerms";
import { Badge, Pager, pageSlice, pageClamp } from "@/components/ui";
import { fmtNum, fmtDate, downloadXLSX } from "@/lib/format";

const daysIn = (t) => Math.max(0, Math.floor((Date.now() - new Date(t).getTime()) / 86400000));

// Bang ma tran: dong = ma xe, cot = kho (giong sheet DM_XE cua file Excel cu)
export default function TonTongHop() {
  const { supabase, vehicles, locations, brands, loading, profile, getQty, totalQty, regionQty } = useCatalog();
  const can = usePerms(supabase, profile);
  const [q, setQ] = useState(""); const [fBrand, setFBrand] = useState("");
  const [hideZero, setHideZero] = useState(true);
  const [cell, setCell] = useState(null); // {v, scope, code, label, units}
  const [cq, setCq] = useState("");
  const [cPage, setCPage] = useState(1);
  const [cPageSize, setCPageSize] = useState(10);
  const [showExp, setShowExp] = useState(false);
  const [expBusy, setExpBusy] = useState(false);

  // scope: "loc" (1 kho) | "region" (1 khu vuc) | "all" (tong)
  const openCell = async (v, scope, code, label) => {
    setCell({ v, scope, code, label, units: null }); setCq(""); setCPage(1);
    let q = supabase.from("vehicle_units").select("*")
      .eq("vehicle_id", v.id).in("status", ["TON_KHO", "DANG_CHUYEN", "GIU_CHO"]).order("imported_at");
    if (scope === "loc") q = q.eq("location_code", code);
    else if (scope === "region") {
      const codes = locations.filter((l) => l.region === code).map((l) => l.code);
      q = q.in("location_code", codes);
    }
    const { data } = await q;
    setCell((c) => c && c.v.id === v.id ? { ...c, units: data || [] } : c);
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

  // withSales=false: "Xuat CSV kho"; true: "Xuat CSV kem doanh so" (them 30_days, Sales_avg)
  const exportCSV = async (withSales) => {
    setShowExp(false);
    let sales = {};
    if (withSales) {
      setExpBusy(true);
      const { data, error } = await supabase.rpc("fn_ban_theo_model", { p_ngay: null, p_so_ngay: 30 });
      setExpBusy(false);
      if (error) return alert("Không lấy được doanh số 30 ngày: " + (error.message || error));
      (data || []).forEach((r) => { sales[r.vehicle_id] = (Number(r.so_xe_le) || 0) + (Number(r.so_xe_buon) || 0); });
    }
    const avg = (n) => Math.round((n / 30) * 100) / 100;
    const head = ["Ma_Hang", "Ma_Xe", "Ten_Xe", "Mau", "Tong", ...regions.map((r) => "Tong " + r), ...locs.map((l) => l.name), ...(withSales ? ["30_days", "Sales_avg"] : [])];
    const body = list.map((v) => [v.mfr_code || "", v.id, v.name, v.color, totalQty(v.id), ...regions.map((r) => regionQty(v.id, r)), ...locs.map((l) => getQty(v.id, l.code)),
      ...(withSales ? [sales[v.id] || 0, avg(sales[v.id] || 0)] : [])]);
    const tot30 = withSales ? list.reduce((a, v) => a + (sales[v.id] || 0), 0) : 0;
    const rows = [head, ...body,
      ["", "TONG", "", "", grand, ...regions.map((r) => regTotal(r)), ...locs.map((l) => colTotal(l.code)), ...(withSales ? [tot30, avg(tot30)] : [])]];
    downloadXLSX(withSales ? "ton_tong_hop_kem_doanh_so.xlsx" : "ton_tong_hop.xlsx", rows, "Ton_tong_hop");
  };

  // Xuat danh sach tung xe ton theo vi tri kho, du thong tin xe + so khung (theo bo loc dang chon)
  const exportSoKhung = async () => {
    setShowExp(false); setExpBusy(true);
    const ids = new Set(list.map((v) => v.id));
    const all = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("vehicle_units").select("*")
        .in("status", ["TON_KHO", "DANG_CHUYEN", "GIU_CHO"]).order("frame_number").range(from, from + 999);
      if (error) { setExpBusy(false); return alert("Không lấy được danh sách xe tồn: " + (error.message || error)); }
      all.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    setExpBusy(false);
    const lOf = (c) => locations.find((l) => l.code === c);
    const vOf = (id) => vehicles.find((v) => v.id === id);
    const TT = { TON_KHO: "Tồn kho", GIU_CHO: "Giữ chỗ", DANG_CHUYEN: "Đang chuyển" };
    const coVon = can("gia_von_nhap");
    const ds = all.filter((u) => ids.has(u.vehicle_id)).map((u) => ({ u, v: vOf(u.vehicle_id) || {}, l: lOf(u.location_code) || {} }))
      .sort((a, b) => (a.l.region || "").localeCompare(b.l.region || "") || (a.l.name || a.u.location_code || "").localeCompare(b.l.name || b.u.location_code || "")
        || (a.v.name || "").localeCompare(b.v.name || "") || (a.v.color || "").localeCompare(b.v.color || "") || String(a.u.imported_at || "").localeCompare(String(b.u.imported_at || "")));
    if (!ds.length) return alert("Không có xe tồn nào theo bộ lọc đang chọn.");
    const head = ["STT", "Khu vực", "Kho / cửa hàng", "Mã kho", "Hãng", "Mã hãng", "Mã xe", "Tên xe", "Màu", "Loại pin", "Số khung", "Số máy", "Giá niêm yết", ...(coVon ? ["Giá vốn"] : []), "Ngày nhập", "Số ngày tồn", "Trạng thái", "Số khung tạm", "Ghi chú"];
    const body = ds.map(({ u, v, l }, i) => [i + 1, l.region || "", l.name || u.location_code, u.location_code, v.brand || "", v.mfr_code || "", u.vehicle_id, v.name || "", v.color || "", v.model_pin || "",
      u.frame_number, u.engine_number || "", Number(v.list_price) || "", ...(coVon ? [Number(u.cost_price) || ""] : []), u.imported_at ? String(u.imported_at).slice(0, 10) : "", u.imported_at ? daysIn(u.imported_at) : "",
      TT[u.status] || u.status, u.is_placeholder ? "Có" : "", u.note || ""]);
    downloadXLSX("ton_xe_theo_kho_so_khung.xlsx", [head, ...body], "Ton_theo_kho");
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
        <div className="relative">
          <button className="btn-ghost" disabled={expBusy} onClick={() => setShowExp((x) => !x)}>{expBusy ? "Đang xuất…" : "⬇ Xuất Excel ▾"}</button>
          {showExp && (
            <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-[#E3E8EF] rounded-xl shadow-lg p-1.5 min-w-[230px] flex flex-col">
              <button className="text-left text-[13px] px-3 py-2 rounded-lg hover:bg-[#F3F5F8]" onClick={() => exportCSV(false)}>Xuất Excel kho<div className="text-[11px] text-[#8A93A0]">Mã hàng + tồn từng điểm</div></button>
              <button className="text-left text-[13px] px-3 py-2 rounded-lg hover:bg-[#F3F5F8]" onClick={() => exportCSV(true)}>Xuất Excel kèm doanh số<div className="text-[11px] text-[#8A93A0]">Thêm 30_days và Sales_avg</div></button>
              <button className="text-left text-[13px] px-3 py-2 rounded-lg hover:bg-[#F3F5F8]" onClick={exportSoKhung}>Xuất danh sách xe theo kho<div className="text-[11px] text-[#8A93A0]">Từng xe: kho, thông tin xe, số khung, ngày nhập</div></button>
            </div>
          )}
        </div>
      </div>
      <div className="overflow-x-auto md:max-h-[70vh] overflow-y-auto md:border border-[#E6EAEF] rounded-xl">
        <table className="border-collapse w-full tbl-card">
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
                <td data-m="title" className="td sticky left-0 bg-white font-semibold text-[12.5px]">{v.name} <span className="text-[#8A93A0]">· {v.color}</span></td>
                <td data-m="end" className={`td text-center font-extrabold bg-[#E7EFFD] max-md:!bg-transparent ${totalQty(v.id) > 0 ? "cursor-pointer hover:underline text-brand" : "text-[#C6CDD6]"}`}
                  title={totalQty(v.id) > 0 ? `Xem toàn bộ ${totalQty(v.id)} xe ${v.name}` : ""}
                  onClick={() => totalQty(v.id) > 0 && openCell(v, "all", "", "Toàn hệ thống")}>{totalQty(v.id)}</td>
                {regions.map((r) => { const n = regionQty(v.id, r);
                  return <td key={r} data-label={`Σ ${r}`} data-m={n === 0 ? "hide" : undefined} className={`td text-center tabular-nums bg-[#F4FBF7] max-md:!bg-transparent ${n === 0 ? "text-[#C6CDD6]" : "font-bold cursor-pointer hover:underline text-brand"}`}
                    title={n > 0 ? `Xem ${n} xe ${v.name} ở khu vực ${r}` : ""}
                    onClick={() => n > 0 && openCell(v, "region", r, `Khu vực ${r}`)}>{n === 0 ? "·" : n}</td>; })}
                {locs.map((l) => {
                  const n = getQty(v.id, l.code);
                  return <td key={l.code} data-label={l.name} data-m={n === 0 ? "hide" : undefined} className={`td text-center tabular-nums ${n === 0 ? "text-[#C6CDD6]" : "font-bold text-brand cursor-pointer hover:underline"}`}
                    title={n > 0 ? `Xem ${n} xe ${v.name} tại ${l.name}` : ""}
                    onClick={() => n > 0 && openCell(v, "loc", l.code, l.name)}>{n === 0 ? "·" : n}</td>;
                })}
              </tr>
            ))}
            <tr className="bg-[#F3F5F8] font-extrabold">
              <td data-m="title" className="td sticky left-0 bg-[#F3F5F8] max-md:!bg-transparent">TỔNG</td>
              <td data-m="end" className="td text-center bg-[#E7EFFD] max-md:!bg-transparent">{grand}</td>
              {regions.map((r) => <td key={r} data-label={`Σ ${r}`} className="td text-center tabular-nums bg-[#E5F6EE] max-md:!bg-transparent">{regTotal(r)}</td>)}
              {locs.map((l) => <td key={l.code} data-label={l.name} data-m={colTotal(l.code) === 0 ? "hide" : undefined} className="td text-center tabular-nums">{colTotal(l.code)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      {cell && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-3" onClick={() => setCell(null)}>
          <div className="bg-white rounded-2xl w-[640px] max-w-full max-h-[88vh] overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <div className="font-extrabold text-base mr-auto">{cell.v.name} · {cell.v.color}</div>
              {cell.scope === "loc" && <Link href={`/kho/${cell.code}`} className="btn-ghost !px-3 !py-1.5 !text-xs">Mở trang kho →</Link>}
              <button className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => setCell(null)}>✕</button>
            </div>
            <div className="text-xs text-[#5A6572] mb-3">Phạm vi: <b>{cell.label}</b> · {cell.units ? cell.units.length + " xe" : "đang tải…"}</div>
            {!cell.units ? <div className="text-sm text-[#8A93A0] py-4">Đang tải danh sách xe…</div> : (() => {
              const kw = cq.trim().toLowerCase();
              const rows = cell.units.filter((u) => !kw || u.frame_number.toLowerCase().includes(kw));
              const showKho = cell.scope !== "loc";
              const pg = pageSlice(rows, cPage, cPageSize);
              return (
                <>
                  <input className="inp !w-full mb-2.5" placeholder="🔎 Tìm số khung trong danh sách này…" value={cq} onChange={(e) => { setCq(e.target.value); setCPage(1); }} />
                  <div className="overflow-x-auto"><table className="w-full border-collapse tbl-card">
                    <thead><tr><th className="th w-8">#</th>{showKho && <th className="th">Kho</th>}<th className="th">Số khung</th><th className="th">Ngày nhập</th><th className="th">Ngày tồn</th><th className="th">Trạng thái</th></tr></thead>
                    <tbody>{pg.map((u, i) => (
                      <tr key={u.frame_number} className="hover:bg-[#F8FAFC]">
                        <td className="td text-center text-xs text-[#8A93A0]">{(pageClamp(cPage, rows.length, cPageSize) - 1) * cPageSize + i + 1}</td>
                        {showKho && <td className="td text-xs">{locations.find((l) => l.code === u.location_code)?.name || u.location_code}</td>}
                        <td className="td font-mono text-[12px] font-bold">{u.frame_number}{u.is_placeholder && <div><Badge tone="amber">SK tạm</Badge></div>}</td>
                        <td className="td whitespace-nowrap">{fmtDate(u.imported_at)}</td>
                        <td className="td"><b className={daysIn(u.imported_at) >= 90 ? "text-danger" : daysIn(u.imported_at) >= 60 ? "text-[#A25F00]" : ""}>{daysIn(u.imported_at)}</b></td>
                        <td className="td">{u.status === "TON_KHO" ? <Badge tone="green">Tồn kho</Badge> : u.status === "GIU_CHO" ? <Badge tone="amber">🔒 Giữ chỗ</Badge> : <Badge tone="purple">Đang chuyển</Badge>}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td className="td" colSpan={showKho ? 6 : 5}>Không có số khung nào khớp "{cq}".</td></tr>}
                    </tbody>
                  </table></div>
                  {rows.length > 10 && <Pager total={rows.length} page={cPage} setPage={setCPage} pageSize={cPageSize} setPageSize={setCPageSize} />}
                </>
              );
            })()}
          </div>
        </div>
      )}
      <p className="text-[11px] text-[#8A93A0] mt-2">Bấm vào số tồn ở bất kỳ cột nào (từng kho, khu vực, hay cột TỔNG) để xem danh sách xe chi tiết, có tìm kiếm số khung. Số liệu gồm cả xe đang điều chuyển (vẫn tính ở kho đi cho đến khi bên nhận xác nhận). Xoay ngang điện thoại để xem dễ hơn.</p>
    </div>
  );
}
