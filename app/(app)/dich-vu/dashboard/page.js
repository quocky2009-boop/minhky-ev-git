"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCatalog } from "@/lib/useData";
import { KPI, Badge } from "@/components/ui";
import { fmtVND, fmtDate } from "@/lib/format";

const iso = (d) => d.toLocaleDateString("sv-SE");

export default function DichVuDashboard() {
  const { supabase, locations, profile, loading } = useCatalog();
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(true);
  const scope = profile?.role === "MANAGER" ? profile.region : null;

  useEffect(() => {
    if (!profile) return;
    (async () => {
      setBusy(true);
      const { data } = await supabase.from("v_dv_dashboard").select("*").order("created_at", { ascending: false }).limit(2000);
      setRows(data || []);
      setBusy(false);
    })();
  }, [profile]);

  if (loading || !profile) return <div className="card">Đang tải…</div>;
  const locName = (c) => locations.find(l => l.code === c)?.name || c || "—";
  const locRegion = (c) => locations.find(l => l.code === c)?.region;

  const scoped = scope ? rows.filter(r => locRegion(r.location_code) === scope) : rows;
  const now = new Date();
  const first = iso(new Date(now.getFullYear(), now.getMonth(), 1));
  const thangNay = scoped.filter(r => iso(new Date(r.created_at)) >= first);
  const doanhThuThang = thangNay.filter(r => r.status !== "HUY").reduce((s, r) => s + r.tong_tien, 0);
  const dangXuLy = scoped.filter(r => !["DA_GIAO","HUY"].includes(r.status));
  const quaHan = scoped.filter(r => r.qua_han);
  const choXacNhan = scoped.filter(r => r.status === "CHO_DUYET_GIA");
  const choThanhToan = scoped.filter(r => r.status === "CHO_THANH_TOAN");

  const byKTV = {};
  thangNay.filter(r => r.status !== "HUY" && r.ktv_name).forEach(r => {
    byKTV[r.ktv_name] = (byKTV[r.ktv_name] || 0) + 1;
  });
  const topKTV = Object.entries(byKTV).sort((a,b) => b[1]-a[1]).slice(0, 5);

  return (
    <div className="flex flex-col gap-4">
      <div className="font-extrabold text-lg">Dashboard Dịch vụ {scope ? `— Khu vực ${scope}` : ""}</div>

      <div className="flex gap-3 flex-wrap">
        <KPI label="Doanh thu tháng này" value={fmtVND(doanhThuThang)} tone="blue" />
        <KPI label="Phiếu tháng này" value={thangNay.length} tone="dark" />
        <KPI label="Đang xử lý" value={dangXuLy.length} tone="amber" />
        <KPI label="Quá hạn (>3 ngày)" value={quaHan.length} tone={quaHan.length ? "red" : "green"} />
      </div>

      <div className="flex gap-3 flex-wrap">
        <KPI label="Chờ duyệt giá" value={choXacNhan.length} tone={choXacNhan.length ? "amber" : "dark"} />
        <KPI label="Chờ thanh toán" value={choThanhToan.length} tone={choThanhToan.length ? "amber" : "dark"} />
      </div>

      {/* PHIẾU QUÁ HẠN */}
      {quaHan.length > 0 && (
        <div className="card border-l-4 border-l-danger">
          <div className="font-extrabold mb-2 text-danger">⚠ Phiếu quá hạn xử lý</div>
          <div className="flex flex-col gap-1.5">
            {quaHan.slice(0, 10).map(r => (
              <Link key={r.id} href={`/dich-vu?code=${r.code}`} className="flex items-center gap-2 p-2 rounded-lg bg-[#FFF6F6] text-[13px] hover:bg-[#FDEDED]">
                <b className="text-brand">{r.code}</b>
                <span className="text-[#8A93A0]">{locName(r.location_code)}</span>
                <span className="ml-auto text-[11px] text-danger">Tiếp nhận {fmtDate(r.created_at)}</span>
                <Badge tone="red">{r.status}</Badge>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* TOP KTV */}
      {topKTV.length > 0 && (
        <div className="card">
          <div className="font-extrabold mb-3">🔧 KTV xử lý nhiều phiếu nhất tháng này</div>
          <div className="flex flex-col gap-2">
            {topKTV.map(([name, cnt], i) => (
              <div key={name} className="flex items-center gap-2">
                <span className="text-[#8A93A0] w-5 text-right">{i+1}.</span>
                <div className="flex-1 font-semibold text-[13px]">{name}</div>
                <span className="font-bold text-brand">{cnt} phiếu</span>
                <div className="w-24 h-2 rounded-full bg-[#EEF1F4] overflow-hidden">
                  <div className="h-full bg-brand" style={{ width: `${Math.round(cnt/topKTV[0][1]*100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Link href="/dich-vu/bao-duong" className="btn-ghost !text-xs w-fit">📅 Xem lịch nhắc bảo dưỡng →</Link>
    </div>
  );
}
