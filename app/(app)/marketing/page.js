"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI } from "@/components/ui";
import { KPI_TYPE_LABEL } from "@/lib/marketing";

export default function MarketingHome() {
  const { supabase, profile, loading } = useCatalog();
  const { toast } = useToast();
  const [rows, setRows] = useState([]);
  const [camps, setCamps] = useState([]);
  const [busy, setBusy] = useState(true);

  const load = async () => {
    if (!profile) return;
    setBusy(true);
    const [{ data: kpi }, { data: cp }] = await Promise.all([
      supabase.from("v_mkt_kpi_progress").select("*").eq("user_id", profile.id),
      supabase.from("mkt_campaigns").select("*").eq("status", "active").order("end_at"),
    ]);
    setRows(kpi || []); setCamps(cp || []); setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading, profile]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  const pct = (r) => Math.min(100, Math.round((r.da_duyet / Math.max(1, r.target_quantity)) * 100));
  const done = (r) => r.da_duyet >= r.target_quantity;
  const conThieu = (r) => Math.max(0, r.target_quantity - r.da_duyet);

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />

      <div className="flex gap-2 items-center flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Xin chào, {profile.name} 👋</div>
        <Link href="/marketing/bao-cao" className="btn-primary !text-sm">✎ Báo cáo ngay</Link>
        <Link href="/marketing/lai-thu" className="btn-ok !text-sm">🛵 Thêm khách lái thử</Link>
      </div>

      {busy ? <div className="card">Đang tải KPI…</div> : rows.length === 0 ? (
        <div className="card text-sm text-[#5A6572]">Hiện chưa có KPI nào được giao cho bạn. Khi Ban giám đốc giao KPI định kỳ hoặc chiến dịch, chúng sẽ hiện ở đây.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <div key={r.kpi_id} className="card !p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="font-bold mr-auto">{r.kpi_name}</div>
                <Badge tone={r.kpi_type === "test_drive" ? "blue" : "purple"}>{KPI_TYPE_LABEL[r.kpi_type] || r.kpi_type}</Badge>
                {done(r) ? <Badge tone="green">✓ Đạt</Badge> : <Badge tone="amber">Chưa đạt</Badge>}
              </div>
              <div className="text-[11px] text-[#8A93A0] mb-2">
                Kỳ: {r.period_type === "weekly" ? "tuần này" : r.period_type === "monthly" ? "tháng này" : r.period_type} · {r.ky_start} → {r.ky_end}
                {r.participation_type === "exempted" && " · Được miễn"}
              </div>
              <div className="h-2.5 rounded-full bg-[#EEF1F4] overflow-hidden mb-1">
                <div className={`h-full rounded-full ${done(r) ? "bg-[#0E7A4A]" : "bg-[#1f6feb]"}`} style={{ width: pct(r) + "%" }} />
              </div>
              <div className="text-sm font-bold mb-2">Tiến độ chính thức: {r.da_duyet}/{r.target_quantity} <span className="text-[#8A93A0] font-normal">(chỉ tính đã duyệt)</span></div>
              <div className="grid grid-cols-4 gap-1.5 text-center text-[11px]">
                <div className="bg-[#F3F5F8] rounded-lg py-1.5"><div className="font-bold text-[15px]">{r.da_nop}</div>Đã nộp</div>
                <div className="bg-[#E7F6EE] rounded-lg py-1.5"><div className="font-bold text-[15px] text-[#0E7A4A]">{r.da_duyet}</div>Đã duyệt</div>
                <div className="bg-[#FFF6E5] rounded-lg py-1.5"><div className="font-bold text-[15px] text-[#A25F00]">{r.cho_duyet}</div>Chờ duyệt</div>
                <div className="bg-[#FDEEEE] rounded-lg py-1.5"><div className="font-bold text-[15px] text-danger">{conThieu(r)}</div>Còn thiếu</div>
              </div>
              {(r.can_bo_sung > 0 || r.khong_hop_le > 0) && (
                <div className="text-[11px] text-[#8A93A0] mt-2">
                  {r.can_bo_sung > 0 && <span className="text-[#6D28D9] font-semibold">Cần bổ sung: {r.can_bo_sung}. </span>}
                  {r.khong_hop_le > 0 && <span className="text-danger font-semibold">Không hợp lệ: {r.khong_hop_le}.</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="font-extrabold mb-2">Chiến dịch đang chạy ({camps.length})</div>
        {camps.length === 0 ? <div className="text-sm text-[#8A93A0]">Không có chiến dịch nào đang chạy.</div> : (
          <div className="flex flex-col gap-2">
            {camps.map((c) => {
              const conLai = Math.ceil((new Date(c.end_at) - new Date()) / 86400000);
              return (
                <Link key={c.id} href={`/marketing/chien-dich?id=${c.id}`} className="flex items-center gap-2 p-2.5 rounded-xl border border-[#E3E8EF] hover:bg-[#F8FAFC]">
                  <div className="mr-auto">
                    <div className="font-semibold text-sm">{c.name}</div>
                    <div className="text-[11px] text-[#8A93A0]">{c.code} · {c.start_at} → {c.end_at}</div>
                  </div>
                  {c.priority === "Khẩn" && <Badge tone="red">Khẩn</Badge>}
                  <Badge tone={conLai < 0 ? "red" : conLai <= 1 ? "amber" : "blue"}>{conLai < 0 ? "Quá hạn" : conLai === 0 ? "Hạn hôm nay" : `Còn ${conLai} ngày`}</Badge>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
