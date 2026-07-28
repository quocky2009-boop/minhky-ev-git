"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCatalog } from "@/lib/useData";
import { KPI, Badge, stockBadge } from "@/components/ui";
import { fmtNum, fmtVND, fmtDate } from "@/lib/format";

const iso = (d) => d.toLocaleDateString("sv-SE");

export default function Dashboard() {
  const { supabase, vehicles, locations, profile, loading, getQty, totalQty, regionQty } = useCatalog();
  const [data, setData] = useState({
    sales: [], prevSales: [], transfers: [], adjusts: [],
    coHoi: [], congNo: [], pendingChi: [], dv: [],
  });
  const scope = profile?.role === "MANAGER" ? profile.region : null;
  const today = iso(new Date());

  useEffect(() => {
    if (!profile) return;
    (async () => {
      const now = new Date();
      const first = iso(new Date(now.getFullYear(), now.getMonth(), 1));
      const prevFirst = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      const prevLast = iso(new Date(now.getFullYear(), now.getMonth(), 0));
      const [s, t, a, sp, ch, cn, pc, dv] = await Promise.all([
        supabase.from("sales_orders").select("*").gte("sale_date", first).then(r => r.data || []),
        supabase.from("transfer_orders").select("*").eq("status", "Đang chuyển").then(r => r.data || []),
        supabase.from("stock_adjustments").select("*").eq("status", "Chờ duyệt").then(r => r.data || []),
        supabase.from("sales_orders").select("*").gte("sale_date", prevFirst).lte("sale_date", prevLast).then(r => r.data || []),
        supabase.from("v_co_hoi").select("*").not("stage","in","(Đã bán,Mất khách)").then(r => r.data || []),
        supabase.from("v_cong_no_phai_thu").select("*").then(r => r.data || []),
        supabase.from("cash_txns").select("*").eq("direction","Chi").eq("approval_status","pending").then(r => r.data || []),
        supabase.from("dv_tickets").select("*").not("status","in","(DA_GIAO,HUY)").then(r => r.data || []),
      ]);
      setData({ sales: s, prevSales: sp, transfers: t, adjusts: a, coHoi: ch, congNo: cn, pendingChi: pc, dv });
    })();
  }, [profile]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  const locRegion = (c) => locations.find((l) => l.code === c)?.region;
  const scopedSales = scope ? data.sales.filter(s => locRegion(s.location_code) === scope) : data.sales;
  const scopedPrev = scope ? data.prevSales.filter(s => locRegion(s.location_code) === scope) : data.prevSales;
  const banThang = scopedSales.reduce((s, o) => s + o.quantity, 0);
  const revenue = scopedSales.filter(o => !["Đã hủy","Đã trả hàng"].includes(o.status)).reduce((s, o) => s + Math.max(o.sale_price * o.quantity - (o.discount_amount || 0), 0), 0);
  const banTruoc = scopedPrev.reduce((s, o) => s + o.quantity, 0);
  const chenh = banThang - banTruoc;
  const pct = banTruoc > 0 ? Math.round((chenh / banTruoc) * 100) : null;
  const soSanh = <span className={`font-bold ${chenh > 0 ? "text-[#0E7A4A]" : chenh < 0 ? "text-danger" : "text-[#8A93A0]"}`}>
    {chenh > 0 ? "▲" : chenh < 0 ? "▼" : "="} {Math.abs(chenh)} xe{pct !== null ? ` (${chenh > 0 ? "+" : ""}${pct}%)` : ""} vs tháng trước
  </span>;
  const sumAll = vehicles.reduce((s, v) => s + (scope ? regionQty(v.id, scope) : totalQty(v.id)), 0);
  const congNoQH = data.congNo.filter(r => r.nhom_qua_han !== "Chưa đến hạn");
  const tongNo = data.congNo.reduce((s, r) => s + r.con_no, 0);
  const coHoiNong = data.coHoi.filter(r => r.heat === "Nóng");
  const goiHomNay = data.coHoi.filter(r => r.next_call_date === today);
  const donChuaHD = scopedSales.filter(o => o.invoice_status !== "Đã xuất HĐ" && !["Đã hủy","Đã trả hàng"].includes(o.status));
  const donConNo = data.congNo;

  // ===== CEO / MANAGER / ADMIN =====
  if (["CEO", "MANAGER", "ADMIN"].includes(profile.role)) {
    const byModel = {};
    scopedSales.filter(o => !["Đã hủy","Đã trả hàng"].includes(o.status)).forEach(s => {
      const v = vehicles.find(x => x.id === s.vehicle_id);
      if (v) byModel[v.name] = (byModel[v.name] || 0) + s.quantity;
    });
    const top = Object.entries(byModel).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return (
      <div className="flex flex-col gap-4">
        <div className="font-extrabold text-lg">Dashboard {profile.role === "MANAGER" ? `— Khu vực ${scope}` : "Ban giám đốc"}</div>

        {/* DOANH SO THANG */}
        <div className="card">
          <div className="flex items-center gap-2 mb-3"><div className="font-extrabold mr-auto">📊 Doanh số tháng này</div><span className="text-[12px] text-[#8A93A0]">{new Date().toLocaleDateString("vi-VN",{month:"long",year:"numeric"})}</span></div>
          <div className="flex gap-3 flex-wrap">
            <KPI label="Xe bán được" value={fmtNum(banThang) + " xe"} sub={soSanh} tone="green" />
            <KPI label="Doanh số" value={fmtVND(revenue)} tone="blue" />
            <KPI label="Chờ xuất HĐ" value={donChuaHD.length + " đơn"} tone={donChuaHD.length > 0 ? "amber" : "dark"} />
            <KPI label="Tổng tồn kho" value={fmtNum(sumAll) + " xe"} tone="dark" />
          </div>
        </div>

        {/* CANH BAO */}
        <div className="grid gap-3 md:grid-cols-2">
          {/* Cong no */}
          <div className="card border-l-4 border-l-danger">
            <div className="flex items-center gap-2 mb-2"><div className="font-extrabold mr-auto">⚠ Công nợ phải thu</div><Link href="/cong-no/phai-thu" className="btn-ghost !text-xs">Xem →</Link></div>
            <div className="flex gap-3 flex-wrap">
              <KPI label="Tổng nợ" value={fmtVND(tongNo)} tone="red" />
              <KPI label="Quá hạn" value={fmtVND(congNoQH.reduce((s,r)=>s+r.con_no,0))} tone={congNoQH.length > 0 ? "red" : "dark"} />
              <KPI label="Số khách" value={new Set(data.congNo.map(r=>r.customer_id)).size} tone="amber" />
            </div>
          </div>

          {/* Co hoi */}
          <div className="card border-l-4 border-l-amber-400">
            <div className="flex items-center gap-2 mb-2"><div className="font-extrabold mr-auto">🎯 Cơ hội bán hàng</div><Link href="/co-hoi" className="btn-ghost !text-xs">Xem →</Link></div>
            <div className="flex gap-3 flex-wrap">
              <KPI label="Đang theo dõi" value={data.coHoi.length} tone="blue" />
              <KPI label="🔥 Nóng" value={coHoiNong.length} tone={coHoiNong.length > 0 ? "red" : "dark"} />
              <KPI label="📞 Gọi hôm nay" value={goiHomNay.length} tone={goiHomNay.length > 0 ? "amber" : "dark"} />
            </div>
          </div>
        </div>

        {/* CHO DUYET */}
        {(data.pendingChi.length > 0 || data.adjusts.length > 0 || data.transfers.length > 0) && (
          <div className="card border-l-4 border-l-brand">
            <div className="font-extrabold mb-2">🔔 Chờ xử lý</div>
            <div className="flex gap-3 flex-wrap">
              {data.pendingChi.length > 0 && <Link href="/phieu-chi" className="btn-ghost !text-xs"><KPI label="Phiếu chi chờ duyệt" value={data.pendingChi.length} tone="amber" /></Link>}
              {data.adjusts.length > 0 && <Link href="/dieu-chinh" className="btn-ghost !text-xs"><KPI label="Điều chỉnh tồn chờ duyệt" value={data.adjusts.length} tone="amber" /></Link>}
              {data.transfers.length > 0 && <Link href="/dieu-chuyen" className="btn-ghost !text-xs"><KPI label="Đang điều chuyển" value={data.transfers.length} tone="amber" /></Link>}
            </div>
          </div>
        )}

        {/* TOP MO HINH */}
        {top.length > 0 && (
          <div className="card">
            <div className="font-extrabold mb-3">🏆 Top mô hình bán chạy tháng này</div>
            <div className="flex flex-col gap-2">
              {top.map(([name, qty], i) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="text-[#8A93A0] w-5 text-right">{i+1}.</span>
                  <div className="flex-1 font-semibold text-[13px]">{name}</div>
                  <span className="font-bold text-brand">{qty} xe</span>
                  <div className="w-24 h-2 rounded-full bg-[#EEF1F4] overflow-hidden">
                    <div className="h-full bg-brand" style={{ width: `${Math.round(qty / top[0][1] * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ===== SALES =====
  if (profile.role === "SALES") {
    const myCoHoi = data.coHoi.filter(r => r.assigned_to === profile.id);
    const myGoiHomNay = myCoHoi.filter(r => r.next_call_date === today);
    const myNong = myCoHoi.filter(r => r.heat === "Nóng");
    const myDon = data.sales.filter(o => o.seller_id === profile.id && !["Đã hủy","Đã trả hàng"].includes(o.status));
    const myCongNo = data.congNo.filter(r => r.seller_id === profile.id);
    const myRevenue = myDon.reduce((s,o) => s + Math.max(o.sale_price * o.quantity - (o.discount_amount||0),0), 0);

    return (
      <div className="flex flex-col gap-4">
        <div className="font-extrabold text-lg">Chào {profile.name} 👋</div>

        {/* GOI NGAY */}
        {myGoiHomNay.length > 0 && (
          <div className="card border-l-4 border-l-danger">
            <div className="flex items-center gap-2 mb-2"><div className="font-extrabold text-danger mr-auto">📞 Cần gọi hôm nay ({myGoiHomNay.length})</div><Link href="/co-hoi" className="btn-primary !text-xs">Xem →</Link></div>
            <div className="flex flex-col gap-1.5">
              {myGoiHomNay.slice(0,5).map(r => (
                <div key={r.id} className="flex items-center gap-2 text-[13px] p-2 rounded-lg bg-[#FFF6F6]">
                  <div className="flex-1 font-semibold">{r.customer_name}</div>
                  <div className="text-[#8A93A0]">{r.customer_phone}</div>
                  <Badge tone={r.heat === "Nóng" ? "red" : "amber"}>{r.heat}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* KPI SALES */}
        <div className="card">
          <div className="font-extrabold mb-3">📈 KPI tháng của tôi</div>
          <div className="flex gap-3 flex-wrap">
            <KPI label="Đơn đã bán" value={myDon.length + " đơn"} tone="green" />
            <KPI label="Doanh số" value={fmtVND(myRevenue)} tone="blue" />
            <KPI label="Cơ hội đang theo" value={myCoHoi.length} tone="dark" />
            <KPI label="🔥 Khách nóng" value={myNong.length} tone={myNong.length > 0 ? "red" : "dark"} />
          </div>
        </div>

        {/* CONG NO CUA TOI */}
        {myCongNo.length > 0 && (
          <div className="card border-l-4 border-l-amber-400">
            <div className="flex items-center gap-2 mb-2"><div className="font-extrabold mr-auto">💰 Khách còn nợ của tôi</div><Link href="/cong-no/phai-thu" className="btn-ghost !text-xs">Xem →</Link></div>
            <div className="flex flex-col gap-1.5">
              {myCongNo.slice(0,5).map(r => (
                <div key={r.id} className="flex items-center gap-2 text-[13px] p-2 rounded-lg bg-[#FFF8E5]">
                  <div className="flex-1 font-semibold">{r.customer_name}</div>
                  <div className="font-bold text-danger">{fmtVND(r.con_no)}</div>
                  <Badge tone={r.nhom_qua_han !== "Chưa đến hạn" ? "red" : "green"}>{r.nhom_qua_han}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ===== TECHNICIAN =====
  if (profile.role === "TECHNICIAN") {
    const myDV = data.dv.filter(t => t.assigned_to === profile.id || !t.assigned_to);
    return (
      <div className="flex flex-col gap-4">
        <div className="font-extrabold text-lg">Chào {profile.name} 👋 — Phiếu dịch vụ hôm nay</div>
        <div className="flex gap-3 flex-wrap">
          <KPI label="Phiếu đang xử lý" value={myDV.length} tone="blue" />
          <KPI label="Phiếu quá hạn" value={myDV.filter(t => t.due_date && t.due_date < today).length} tone="red" />
        </div>
        {myDV.length > 0 && (
          <div className="card">
            <div className="font-extrabold mb-2">Phiếu được giao</div>
            <div className="flex flex-col gap-1.5">
              {myDV.slice(0,10).map(t => (
                <div key={t.id} className="flex items-center gap-2 p-2 rounded-lg border border-[#E3E8EF] text-[13px]">
                  <div className="flex-1"><div className="font-semibold">{t.code}</div><div className="text-[10.5px] text-[#8A93A0]">{t.vehicle_desc || "—"}</div></div>
                  <Badge tone={t.status === "CHO_XU_LY" ? "amber" : "blue"}>{t.status}</Badge>
                </div>
              ))}
            </div>
            <Link href="/dich-vu" className="btn-ghost !text-xs mt-2 block text-center">Xem tất cả →</Link>
          </div>
        )}
      </div>
    );
  }

  // Fallback
  return <div className="card">Xin chào {profile.name}. Vai trò {profile.role} chưa có dashboard riêng.</div>;
}
