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
    coHoi: [], congNo: [], pendingChi: [], dv: [], coc: [], tasks: [], quy: [], lo: [],
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
      const [s, t, a, sp, ch, cn, pc, dv, coc, tasks, quy, lo] = await Promise.all([
        supabase.from("sales_orders").select("*").gte("sale_date", first).then(r => r.data || []),
        supabase.from("transfer_orders").select("*").eq("status", "Đang chuyển").then(r => r.data || []),
        supabase.from("stock_adjustments").select("*").eq("status", "Chờ duyệt").then(r => r.data || []),
        supabase.from("sales_orders").select("*").gte("sale_date", prevFirst).lte("sale_date", prevLast).then(r => r.data || []),
        supabase.from("v_co_hoi").select("*").not("stage","in","(Đã bán,Mất khách)").then(r => r.data || []),
        supabase.from("v_cong_no_phai_thu").select("*").then(r => r.data || []),
        supabase.from("cash_txns").select("*").eq("direction","Chi").eq("approval_status","pending").then(r => r.data || []),
        supabase.from("v_lsc").select("id,code,status,ktv_id,ktv_name,vehicle_desc,plate,customer_name,location_name,cam_ket_hoan_thanh,du_kien_giao_xe,uu_tien,tong_khach_tra,da_thu").in("status", ["BAO_GIA", "PHAT_HANH"]).then(r => r.data || []),
        supabase.from("deposits").select("id,code,customer_name,customer_phone,amount,hold_until,vehicle_id,created_by").eq("status", "DANG_GIU").then(r => r.data || []),
        supabase.from("v_task_list").select("id,code,title,due_at,status,is_overdue,priority").eq("assignee_id", profile.id).is("deleted_at", null).not("status", "in", "(completed,cancelled,failed)").order("due_at").limit(50).then(r => r.data || []),
        ["CEO", "ADMIN"].includes(profile.role) ? supabase.from("v_quy_so_du").select("id,name,type,so_du,status,nhom").eq("status", "Hoạt động").then(r => r.data || []) : Promise.resolve([]),
        ["CEO", "ADMIN", "MANAGER"].includes(profile.role) ? supabase.from("v_don_buon").select("id,code,customer_name,con_phai_tra,sl_dat,sl_giao,trang_thai").neq("trang_thai", "Đã hủy").then(r => r.data || []) : Promise.resolve([]),
      ]);
      setData({ sales: s, prevSales: sp, transfers: t, adjusts: a, coHoi: ch, congNo: cn, pendingChi: pc, dv, coc, tasks, quy, lo });
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
  const ngayNua = (d) => Math.round((new Date(d) - new Date(today)) / 864e5);
  const viecGap = data.tasks.filter((t) => t.is_overdue || (t.due_at && String(t.due_at).slice(0, 10) <= today));
  const TacVu = ({ items }) => (
    <div className="flex gap-2 flex-wrap">{items.map(([href, label, cls]) => <Link key={href} href={href} className={`${cls || "btn-ghost"} !text-xs`}>{label}</Link>)}</div>
  );
  const ViecCuaToi = () => data.tasks.length === 0 ? null : (
    <div className={`card ${viecGap.length ? "border-l-4 border-l-danger" : ""}`}>
      <div className="flex items-center gap-2 mb-2"><div className="font-extrabold mr-auto">✅ Việc của tôi ({data.tasks.length}){viecGap.length > 0 && <span className="text-danger"> · {viecGap.length} việc đến hạn / quá hạn</span>}</div><Link href="/cong-viec" className="btn-ghost !text-xs">Xem →</Link></div>
      <div className="flex flex-col gap-1.5">
        {[...viecGap, ...data.tasks.filter((t) => !viecGap.includes(t))].slice(0, 5).map((t) => (
          <Link key={t.id} href="/cong-viec" className={`flex items-center gap-2 text-[13px] p-2 rounded-lg ${t.is_overdue ? "bg-[#FFF6F6]" : "bg-[#F8FAFC]"}`}>
            <div className="flex-1 font-semibold truncate">{t.title}</div>
            <div className={`text-[12px] ${t.is_overdue ? "text-danger font-bold" : "text-[#8A93A0]"}`}>{t.due_at ? fmtDate(t.due_at) : "không hạn"}</div>
          </Link>))}
      </div>
    </div>);

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
        <TacVu items={[["/don-ban", "Đơn bán"], ["/ban-buon", "Đơn bán buôn"], ["/tra-cuu", "Tồn kho xe"], ["/phieu-thu", "Thu – Chi"], ["/doi-soat", "Đối soát cuối ngày"], ["/dich-vu/lenh-sua-chua", "Lệnh sửa chữa"]]} />

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

        {/* QUY TIEN */}
        {data.quy.length > 0 && (() => {
          const kd = data.quy.filter((q) => !q.nhom || q.nhom === "KINH_DOANH");
          const tm = kd.filter((q) => q.type === "Tiền mặt").reduce((a, q) => a + Number(q.so_du || 0), 0);
          const nh = kd.filter((q) => q.type === "Ngân hàng").reduce((a, q) => a + Number(q.so_du || 0), 0);
          return (
            <div className="card">
              <div className="flex items-center gap-2 mb-2"><div className="font-extrabold mr-auto">💵 Số dư quỹ</div><Link href="/thu-chi" className="btn-ghost !text-xs">Sổ quỹ →</Link></div>
              <div className="flex gap-3 flex-wrap">
                <KPI label="Tiền mặt" value={fmtVND(tm)} tone="green" />
                <KPI label="Ngân hàng" value={fmtVND(nh)} tone="blue" />
                <KPI label="Tổng" value={fmtVND(tm + nh)} tone="dark" sub={`${kd.length} quỹ / tài khoản`} />
              </div>
            </div>);
        })()}

        <ViecCuaToi />

        {/* CHO DUYET */}
        {(data.pendingChi.length > 0 || data.adjusts.length > 0 || data.transfers.length > 0 || data.dv.length > 0 || data.lo.some((l) => l.con_phai_tra > 0 || l.sl_giao < l.sl_dat)) && (
          <div className="card border-l-4 border-l-brand">
            <div className="font-extrabold mb-2">🔔 Chờ xử lý</div>
            <div className="flex gap-3 flex-wrap">
              {data.pendingChi.length > 0 && <Link href="/phieu-chi" className="btn-ghost !text-xs"><KPI label="Phiếu chi chờ duyệt" value={data.pendingChi.length} tone="amber" /></Link>}
              {data.adjusts.length > 0 && <Link href="/dieu-chinh" className="btn-ghost !text-xs"><KPI label="Điều chỉnh tồn chờ duyệt" value={data.adjusts.length} tone="amber" /></Link>}
              {data.transfers.length > 0 && <Link href="/dieu-chuyen" className="btn-ghost !text-xs"><KPI label="Đang điều chuyển" value={data.transfers.length} tone="amber" /></Link>}
              {data.dv.length > 0 && <Link href="/dich-vu/lenh-sua-chua" className="btn-ghost !text-xs"><KPI label="Lệnh sửa chữa đang mở" value={data.dv.length} tone="blue" /></Link>}
              {data.lo.some((l) => l.sl_giao < l.sl_dat) && <Link href="/ban-buon" className="btn-ghost !text-xs"><KPI label="Đơn bán buôn chờ giao" value={data.lo.filter((l) => l.sl_giao < l.sl_dat).length} tone="amber" /></Link>}
              {data.lo.some((l) => l.con_phai_tra > 0) && <Link href="/ban-buon" className="btn-ghost !text-xs"><KPI label="Bán buôn còn phải thu" value={fmtVND(data.lo.reduce((a, l) => a + Math.max(Number(l.con_phai_tra) || 0, 0), 0))} tone="red" /></Link>}
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
    const myCoc = data.coc.filter((c) => c.created_by === profile.id).sort((a, b) => String(a.hold_until).localeCompare(String(b.hold_until)));
    const cocGap = myCoc.filter((c) => c.hold_until && ngayNua(c.hold_until) <= 3);
    const myChuaHD = myDon.filter((o) => o.invoice_status !== "Đã xuất HĐ");

    return (
      <div className="flex flex-col gap-4">
        <div className="font-extrabold text-lg">Chào {profile.name} 👋</div>
        <TacVu items={[["/ban-hang/wizard", "+ Tạo đơn bán", "btn-primary"], ["/dat-coc", "Đặt cọc / giữ xe"], ["/co-hoi", "Cơ hội"], ["/tra-cuu", "Tra cứu tồn"], ["/khach-hang", "Khách hàng"]]} />

        {/* COC SAP HET HAN */}
        {cocGap.length > 0 && (
          <div className="card border-l-4 border-l-amber-400">
            <div className="flex items-center gap-2 mb-2"><div className="font-extrabold mr-auto">⏳ Cọc sắp hết hạn giữ xe ({cocGap.length})</div><Link href="/dat-coc" className="btn-ghost !text-xs">Xem →</Link></div>
            <div className="flex flex-col gap-1.5">
              {cocGap.slice(0, 5).map((c) => { const n = ngayNua(c.hold_until); return (
                <div key={c.id} className="flex items-center gap-2 text-[13px] p-2 rounded-lg bg-[#FFF8E5]">
                  <div className="flex-1 font-semibold">{c.customer_name} <span className="font-normal text-[#8A93A0]">· {c.customer_phone}</span></div>
                  <div className="font-bold">{fmtVND(c.amount)}</div>
                  <Badge tone={n < 0 ? "red" : "amber"}>{n < 0 ? `quá hạn ${-n} ngày` : n === 0 ? "hết hạn hôm nay" : `còn ${n} ngày`}</Badge>
                </div>); })}
            </div>
          </div>
        )}

        <ViecCuaToi />

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
            <KPI label="Cọc đang giữ" value={myCoc.length} tone="amber" />
            <KPI label="Đơn chờ xuất HĐ" value={myChuaHD.length} tone={myChuaHD.length > 0 ? "amber" : "dark"} />
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
    const cuaToi = data.dv.filter((t) => t.ktv_id === profile.id);
    const chuaGiao = data.dv.filter((t) => !t.ktv_id);
    const treHan = (t) => { const h = t.cam_ket_hoan_thanh || t.du_kien_giao_xe; return h && String(h).slice(0, 10) < today; };
    const Dong = ({ t }) => (
      <Link href={`/dich-vu/lenh-sua-chua/${t.id}`} className={`flex items-center gap-2 p-2 rounded-lg border text-[13px] ${treHan(t) ? "border-[#F5B5BB] bg-[#FFF6F6]" : "border-[#E3E8EF]"}`}>
        <div className="flex-1 min-w-0"><div className="font-semibold">{t.code} {t.uu_tien && <span className="text-danger">· ƯU TIÊN</span>}</div>
          <div className="text-[11px] text-[#8A93A0] truncate">{[t.plate, t.vehicle_desc, t.customer_name].filter(Boolean).join(" · ") || "—"}</div></div>
        {treHan(t) && <span className="text-[11px] font-bold text-danger">trễ hẹn</span>}
        <Badge tone={t.status === "BAO_GIA" ? "amber" : "blue"}>{t.status === "BAO_GIA" ? "Báo giá" : "Đang sửa"}</Badge>
      </Link>);
    return (
      <div className="flex flex-col gap-4">
        <div className="font-extrabold text-lg">Chào {profile.name} 👋 — Lệnh sửa chữa của tôi</div>
        <TacVu items={[["/dich-vu/lenh-sua-chua", "+ Tiếp nhận xe / Lệnh sửa chữa", "btn-primary"], ["/phu-tung", "Kho phụ tùng"], ["/dich-vu/ho-so-xe", "Hồ sơ xe"], ["/cong-viec", "Việc của tôi"]]} />
        <div className="flex gap-3 flex-wrap">
          <KPI label="Lệnh của tôi đang mở" value={cuaToi.length} tone="blue" />
          <KPI label="Trễ hẹn" value={cuaToi.filter(treHan).length} tone={cuaToi.some(treHan) ? "red" : "dark"} />
          <KPI label="Chưa có KTV nhận" value={chuaGiao.length} tone={chuaGiao.length ? "amber" : "dark"} />
        </div>
        <ViecCuaToi />
        <div className="card">
          <div className="flex items-center gap-2 mb-2"><div className="font-extrabold mr-auto">Lệnh được giao cho tôi ({cuaToi.length})</div><Link href="/dich-vu/lenh-sua-chua" className="btn-ghost !text-xs">Xem tất cả →</Link></div>
          <div className="flex flex-col gap-1.5">
            {cuaToi.slice(0, 10).map((t) => <Dong key={t.id} t={t} />)}
            {cuaToi.length === 0 && <div className="text-[13px] text-[#8A93A0]">Chưa có lệnh nào được giao cho bạn.</div>}
          </div>
        </div>
        {chuaGiao.length > 0 && (
          <div className="card">
            <div className="font-extrabold mb-2">Lệnh chưa có KTV ({chuaGiao.length})</div>
            <div className="flex flex-col gap-1.5">{chuaGiao.slice(0, 5).map((t) => <Dong key={t.id} t={t} />)}</div>
          </div>)}
      </div>
    );
  }

  // Fallback
  return <div className="card">Xin chào {profile.name}. Vai trò {profile.role} chưa có dashboard riêng.</div>;
}
