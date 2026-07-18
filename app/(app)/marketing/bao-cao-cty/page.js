"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, useSortable, Th } from "@/components/ui";
import { downloadCSV } from "@/lib/format";

export default function BaoCaoCty() {
  const { supabase, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [rows, setRows] = useState([]);
  const [tds, setTds] = useState([]);
  const [busy, setBusy] = useState(true);
  const sort = useSortable();

  const toanCty = profile && ["ADMIN", "CEO"].includes(profile.role);

  const load = async () => {
    setBusy(true);
    const [{ data: kpi }, { data: td }] = await Promise.all([
      supabase.from("v_mkt_kpi_progress").select("*"),
      supabase.from("test_drives").select("id,region,status,result_status,customer_need_level,excluded_from_kpi,customer_id,test_drive_date"),
    ]);
    setRows(kpi || []); setTds(td || []); setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  // Gom theo nhan vien (chi xem duoc khu vuc minh neu la MANAGER — RLS da loc san)
  const byUser = {};
  rows.forEach((r) => {
    const k = r.user_id;
    byUser[k] = byUser[k] || { name: r.user_name, region: r.region, bai: null, video: null, laithu: null, dat: 0, tong: 0 };
    if (r.kpi_type === "social_post") byUser[k].bai = r;
    else if (r.kpi_type === "short_video") byUser[k].video = r;
    else if (r.kpi_type === "test_drive") byUser[k].laithu = r;
    byUser[k].tong++; if (r.da_duyet >= r.target_quantity) byUser[k].dat++;
  });
  const users = Object.values(byUser);
  const sortedUsers = sort.sortFn(users, {
    name: (u) => u.name, region: (u) => u.region || "",
    ty_le: (u) => u.tong ? u.dat / u.tong : 0,
  });

  // Thong ke lai thu
  const tdApproved = tds.filter((t) => t.status === "approved" && !t.excluded_from_kpi);
  const tdStats = {
    tong: tds.length, approved: tdApproved.length,
    cho: tds.filter((t) => t.status === "submitted").length,
    khach: new Set(tdApproved.map((t) => t.customer_id)).size,
    hot: tds.filter((t) => t.customer_need_level === "hot").length,
    coc: tds.filter((t) => t.result_status === "deposit").length,
    mua: tds.filter((t) => t.result_status === "purchased").length,
  };

  const fmtBox = (r) => r ? `${r.da_duyet}/${r.target_quantity}` : "—";

  const exportCSV = () => {
    downloadCSV(`marketing_kpi_${new Date().toISOString().slice(0, 10)}.csv`,
      [["Nhân viên", "Khu vực", "Bài viết", "Video", "Lái thử", "Số KPI đạt", "Tổng KPI", "Tỷ lệ %"],
       ...sortedUsers.map((u) => [u.name, u.region || "", fmtBox(u.bai), fmtBox(u.video), fmtBox(u.laithu), u.dat, u.tong, u.tong ? Math.round(u.dat / u.tong * 100) : 0])]);
    notify(`Đã xuất ${sortedUsers.length} nhân viên.`);
  };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">{toanCty ? "Báo cáo toàn công ty" : "Báo cáo cửa hàng"}</div>
        <Link href="/marketing/duyet" className="btn-ghost !text-xs">← Duyệt báo cáo</Link>
        <button className="btn-ghost !text-xs" onClick={exportCSV}>⬇ CSV</button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <KPI label="Lượt lái thử" value={tdStats.tong} tone="dark" />
        <KPI label="Khách duy nhất (đã duyệt)" value={tdStats.khach} tone="green" />
        <KPI label="Lái thử chờ duyệt" value={tdStats.cho} tone="amber" />
        <KPI label="Khách nóng" value={tdStats.hot} tone="red" />
        <KPI label="Đã đặt cọc" value={tdStats.coc} tone="blue" />
        <KPI label="Đã mua xe" value={tdStats.mua} tone="green" />
      </div>

      <div className="card">
        <div className="font-extrabold mb-2">Xếp hạng nhân viên ({sortedUsers.length})</div>
        {busy ? <div className="text-sm text-[#8A93A0]">Đang tải…</div> : sortedUsers.length === 0 ? (
          <div className="text-sm text-[#8A93A0]">Chưa có dữ liệu KPI. KPI hiển thị khi nhân viên được giao và có kỳ đang chạy.</div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full border-collapse">
            <thead><tr>
              <th className="th w-8">#</th><Th label="Nhân viên" k="name" sort={sort} /><Th label="Khu vực" k="region" sort={sort} />
              <th className="th text-center">Bài viết</th><th className="th text-center">Video</th><th className="th text-center">Lái thử</th>
              <Th label="Tỷ lệ đạt" k="ty_le" sort={sort} />
            </tr></thead>
            <tbody>{sortedUsers.map((u, i) => {
              const tl = u.tong ? Math.round(u.dat / u.tong * 100) : 0;
              return (
                <tr key={i} className="hover:bg-[#F8FAFC]">
                  <td className="td text-center text-xs text-[#8A93A0]">{i + 1}</td>
                  <td className="td font-semibold">{u.name}</td>
                  <td className="td text-xs">{u.region || "—"}</td>
                  <td className="td text-center">{fmtBox(u.bai)}</td>
                  <td className="td text-center">{fmtBox(u.video)}</td>
                  <td className="td text-center">{fmtBox(u.laithu)}</td>
                  <td className="td"><Badge tone={tl >= 100 ? "green" : tl >= 50 ? "amber" : "red"}>{u.dat}/{u.tong} · {tl}%</Badge></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        <p className="text-[11px] text-[#8A93A0] mt-2">Tiến độ chỉ tính báo cáo/lượt lái thử đã được duyệt (approved). {toanCty ? "Xem toàn bộ khu vực." : "Chỉ hiển thị nhân viên thuộc khu vực bạn quản lý."}</p>
      </div>
    </div>
  );
}
