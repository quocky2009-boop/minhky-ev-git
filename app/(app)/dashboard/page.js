"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCatalog } from "@/lib/useData";
import { KPI, Badge, stockBadge } from "@/components/ui";
import { fmtNum, fmtVND } from "@/lib/format";

export default function Dashboard() {
  const { supabase, vehicles, locations, profile, loading, getQty, totalQty, regionQty, regions } = useCatalog();
  const [sales, setSales] = useState([]);
  const [prevSales, setPrevSales] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [adjusts, setAdjusts] = useState([]);

  useEffect(() => {
    (async () => {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const prevFirst = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevLast = new Date(now.getFullYear(), now.getMonth(), 0);
      const [{ data: s }, { data: t }, { data: a }, { data: sp }] = await Promise.all([
        supabase.from("sales_orders").select("*").gte("sale_date", first.toISOString().slice(0, 10)),
        supabase.from("transfer_orders").select("*").eq("status", "Đang chuyển"),
        supabase.from("stock_adjustments").select("*").eq("status", "Chờ duyệt"),
        supabase.from("sales_orders").select("*")
          .gte("sale_date", prevFirst.toISOString().slice(0, 10))
          .lte("sale_date", prevLast.toISOString().slice(0, 10)),
      ]);
      setSales(s || []); setTransfers(t || []); setAdjusts(a || []); setPrevSales(sp || []);
    })();
  }, []);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  const scope = profile.role === "MANAGER" ? profile.region : null;
  const scopedLocs = scope ? locations.filter((l) => l.region === scope) : locations;
  const sum = (fn) => vehicles.reduce((s, v) => s + fn(v), 0);
  const sumAll = sum((v) => scope ? regionQty(v.id, scope) : totalQty(v.id));
  const low = vehicles.filter((v) => { const q = scope ? regionQty(v.id, scope) : totalQty(v.id); return q > 0 && q <= v.min_stock; });
  const out = vehicles.filter((v) => (scope ? regionQty(v.id, scope) : totalQty(v.id)) <= 0);
  const locRegion = (c) => locations.find((l) => l.code === c)?.region;
  const scopedSales = scope ? sales.filter((s) => locRegion(s.location_code) === scope) : sales;
  const revenue = scopedSales.reduce((s, o) => s + o.sale_price * o.quantity, 0);
  const pendingDocs = scopedSales.filter((s) => !["Đủ hồ sơ", "Đã xong đăng ký", "Không làm đăng ký"].includes(s.document_status));
  const noWarranty = scopedSales.filter((s) => s.warranty_status === "Chưa kích hoạt");
  const byModel = {};
  scopedSales.forEach((s) => { const v = vehicles.find((x) => x.id === s.vehicle_id); if (v) byModel[v.name] = (byModel[v.name] || 0) + s.quantity; });
  const top = Object.entries(byModel).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const banThang = scopedSales.reduce((s, o) => s + o.quantity, 0);
  const scopedPrev = scope ? prevSales.filter((s) => locRegion(s.location_code) === scope) : prevSales;
  const banTruoc = scopedPrev.reduce((s, o) => s + o.quantity, 0);
  const dtTruoc = scopedPrev.reduce((s, o) => s + o.sale_price * o.quantity, 0);
  const chenh = banThang - banTruoc;
  const pct = banTruoc > 0 ? Math.round((chenh / banTruoc) * 100) : null;
  const soSanh = banTruoc === 0 && banThang === 0 ? null : (
    <span className={`ml-1.5 font-bold ${chenh > 0 ? "text-[#0E7A4A]" : chenh < 0 ? "text-danger" : "text-[#8A93A0]"}`}>
      {chenh > 0 ? "▲" : chenh < 0 ? "▼" : "="} {Math.abs(chenh)} xe{pct !== null ? ` (${chenh > 0 ? "+" : ""}${pct}%)` : ""} so tháng trước
    </span>
  );
  const byLoc = scopedLocs.map((l) => ({ l, q: vehicles.reduce((s, v) => s + getQty(v.id, l.code), 0) }));
  const maxLoc = Math.max(1, ...byLoc.map((x) => x.q));

  return (
    <div className="flex flex-col gap-4">
      {scope && <div className="text-sm text-[#5A6572]">Phạm vi dữ liệu: <b>khu vực {scope}</b> (theo phân quyền)</div>}
      <div className="flex gap-3 flex-wrap">
        <KPI label="Tổng tồn" value={fmtNum(sumAll)} sub={scope ? `Khu vực ${scope}` : "Toàn hệ thống"} tone="dark" />
        {!scope && regions.filter((r) => locations.some((l) => l.region === r)).map((r) => (
          <KPI key={r} label={"Tồn " + r} value={fmtNum(sum((v) => regionQty(v.id, r)))} tone="blue" />
        ))}
        <KPI label="Bán trong tháng" value={fmtNum(banThang) + " xe"} sub={<>{fmtVND(revenue)}{soSanh}</>} tone="green" />
        <KPI label="Sắp hết hàng" value={low.length + " mã"} tone="amber" />
        <KPI label="Hết hàng" value={out.length + " mã"} tone="red" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <div className="font-extrabold mb-3">Tồn theo kho / cửa hàng</div>
          {byLoc.map(({ l, q }) => (
            <div key={l.code} className="mb-2.5">
              <div className="flex justify-between text-[13px] mb-1">
                <span>{l.name} <span className="text-[#8A93A0] text-[11px]">· {l.region}</span></span><b className="tabular-nums">{q}</b>
              </div>
              <div className="h-[7px] bg-[#EEF1F4] rounded"><div className="h-[7px] rounded" style={{ width: `${(q / maxLoc) * 100}%`, background: l.region === "Hàm Yên" ? "#129D61" : "#1D4FB8" }} /></div>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="font-extrabold mb-3">Top xe bán chạy tháng này</div>
          {top.length === 0 && <div className="text-sm text-[#8A93A0]">Chưa có đơn bán trong tháng.</div>}
          {top.map(([name, q], i) => (
            <div key={name} className="flex items-center gap-2.5 py-2 border-b border-[#EEF1F4] last:border-0">
              <span className="w-6 h-6 rounded-md bg-navy-900 text-white text-xs font-extrabold flex items-center justify-center">{i + 1}</span>
              <span className="text-sm font-semibold">{name}</span><b className="ml-auto">{q} xe</b>
            </div>
          ))}
          <div className="mt-4 pt-3 border-t border-dashed border-[#E6EAEF] flex flex-col gap-2 text-sm">
            <Alert n={transfers.length} label="phiếu điều chuyển chờ xác nhận" href="/dieu-chuyen" />
            <Alert n={adjusts.length} label="đề xuất điều chỉnh tồn chờ duyệt" href="/dieu-chinh" />
            <Alert n={pendingDocs.length} label="đơn bán chưa hoàn tất hồ sơ" href="/ban-hang" />
            <Alert n={noWarranty.length} label="xe đã bán chưa kích hoạt bảo hành" href="/ban-hang" />
          </div>
        </div>
      </div>

      {(out.length > 0 || low.length > 0) && (
        <div className="card">
          <div className="font-extrabold mb-3">Cảnh báo tồn kho</div>
          <div className="overflow-x-auto"><table className="w-full border-collapse">
            <thead><tr><th className="th">Xe</th><th className="th">Màu</th><th className="th">Tồn</th><th className="th">Tối thiểu</th><th className="th">Trạng thái</th></tr></thead>
            <tbody>{[...out, ...low].slice(0, 15).map((v) => {
              const q = scope ? regionQty(v.id, scope) : totalQty(v.id);
              return <tr key={v.id}><td className="td font-bold">{v.name}</td><td className="td">{v.color}</td><td className="td font-bold">{q}</td><td className="td">{v.min_stock}</td><td className="td">{stockBadge(q, v.min_stock)}</td></tr>;
            })}</tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}

function Alert({ n, label, href }) {
  return (
    <Link href={href} className={`flex items-center gap-2 rounded-lg px-3 py-2 ${n > 0 ? "bg-[#FDF1DF]" : "bg-[#F8FAFC]"}`}>
      <b className={n > 0 ? "text-[#A25F00]" : "text-[#8A93A0]"}>{n}</b>
      <span className="text-[#3B4552]">{label}</span><span className="ml-auto text-[#8A93A0]">→</span>
    </Link>
  );
}
