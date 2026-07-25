"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI } from "@/components/ui";
import { TASK_CLOSED } from "@/lib/task";

// Bat dau tuan (Thu 2) va thang, theo gio VN — dung de gom "hoan thanh theo tuan/thang"
function startOfWeek(d) {
  const x = new Date(d); const dow = (x.getDay() + 6) % 7; // 0 = T2
  x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - dow); return x;
}
function startOfMonth(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(1); return x; }
function weekLabel(d) { const s = startOfWeek(d); return `Tuần ${s.getDate()}/${s.getMonth() + 1}`; }
function monthLabel(d) { const x = new Date(d); return `Th.${x.getMonth() + 1}/${x.getFullYear()}`; }

export default function DashboardCongViec() {
  const { supabase, locations, profile, loading } = useCatalog();
  const { toast } = useToast();
  const [rows, setRows] = useState([]);
  const [series, setSeries] = useState([]);
  const [busy, setBusy] = useState(true);

  const load = async () => {
    setBusy(true);
    const [{ data: t }, { data: s }] = await Promise.all([
      supabase.from("v_task_list").select("*").limit(3000),
      supabase.from("task_recurrence_series").select("*").eq("is_active", true).order("title"),
    ]);
    setRows(t || []); setSeries(s || []); setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  if (!["CEO", "MANAGER", "ADMIN"].includes(profile.role)) return <div className="card">Bạn không có quyền xem trang này.</div>;

  // CHT chi thay so lieu khu vuc minh — giong quy uoc cac trang khac trong module
  const data = profile.role === "MANAGER" && profile.region ? rows.filter((t) => t.region === profile.region) : rows;

  const dangMo = data.filter((t) => !TASK_CLOSED.includes(t.status));
  const sapDenHan = dangMo.filter((t) => !t.is_overdue && new Date(t.due_at) - new Date() <= 24 * 3600000);
  const quaHan = data.filter((t) => t.is_overdue);
  const choDuyet = data.filter((t) => t.status === "pending_review");
  const hoanThanh = data.filter((t) => t.status === "completed");
  const dungHan = hoanThanh.filter((t) => t.gui_dung_han);
  const tlHoanThanhDungHan = hoanThanh.length ? Math.round((dungHan.length / hoanThanh.length) * 100) : 0;
  const khongDat = data.filter((t) => t.status === "failed");
  const traLai = data.filter((t) => t.revision_count > 0);
  const tlTraLai = data.filter((t) => t.status !== "cancelled").length
    ? Math.round((traLai.length / data.filter((t) => t.status !== "cancelled").length) * 100) : 0;
  const tlKhongDat = data.filter((t) => t.status !== "cancelled").length
    ? Math.round((khongDat.length / data.filter((t) => t.status !== "cancelled").length) * 100) : 0;

  // Nhan vien qua han nhieu nhat
  const theoNv = {};
  data.forEach((t) => {
    const k = t.assignee_id; if (!k) return;
    theoNv[k] = theoNv[k] || { ten: t.assignee_name, qua_han: 0, dang_mo: 0 };
    if (t.is_overdue) theoNv[k].qua_han++;
    if (!TASK_CLOSED.includes(t.status)) theoNv[k].dang_mo++;
  });
  const topQuaHan = Object.values(theoNv).filter((n) => n.qua_han > 0).sort((a, b) => b.qua_han - a.qua_han).slice(0, 5);

  // Cua hang ty le hoan thanh thap nhat
  const theoDiem = {};
  data.forEach((t) => {
    const k = t.location_code || "—"; if (t.status === "cancelled") return;
    theoDiem[k] = theoDiem[k] || { tong: 0, xong: 0 };
    theoDiem[k].tong++; if (t.status === "completed") theoDiem[k].xong++;
  });
  const tenDiem = (code) => locations.find((l) => l.code === code)?.name || code;
  const diemThap = Object.entries(theoDiem)
    .map(([code, v]) => ({ code, ten: tenDiem(code), tong: v.tong, ty_le: v.tong ? Math.round((v.xong / v.tong) * 100) : 0 }))
    .filter((x) => x.tong >= 3)
    .sort((a, b) => a.ty_le - b.ty_le).slice(0, 5);

  // Hoan thanh theo tuan (8 tuan gan nhat) va theo thang (6 thang gan nhat)
  const theoTuan = {}, theoThang = {};
  hoanThanh.forEach((t) => {
    if (!t.completed_at) return;
    const wl = weekLabel(t.completed_at), ml = monthLabel(t.completed_at);
    theoTuan[wl] = (theoTuan[wl] || 0) + 1; theoThang[ml] = (theoThang[ml] || 0) + 1;
  });
  const tuanGanDay = Array.from({ length: 8 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (7 - i) * 7); return weekLabel(d); });
  const thangGanDay = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setMonth(d.getMonth() - (5 - i)); return monthLabel(d); });
  const maxTuan = Math.max(1, ...tuanGanDay.map((k) => theoTuan[k] || 0));
  const maxThang = Math.max(1, ...thangGanDay.map((k) => theoThang[k] || 0));

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Dashboard công việc{profile.role === "MANAGER" && profile.region ? ` — ${profile.region}` : ""}</div>
        <Link href="/cong-viec/doi-nhom" className="btn-ghost !text-xs">Việc đội nhóm →</Link>
        <Link href="/cong-viec/quan-tri" className="btn-ghost !text-xs">Mẫu & Lặp lại →</Link>
        <button className="btn-ghost !text-xs" onClick={load} disabled={busy}>↻ Làm mới</button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <KPI label="Đang mở" value={dangMo.length} tone="blue" />
        <KPI label="Sắp đến hạn (24h)" value={sapDenHan.length} tone={sapDenHan.length ? "amber" : "dark"} />
        <KPI label="Quá hạn" value={quaHan.length} tone={quaHan.length ? "red" : "green"} />
        <KPI label="Chờ duyệt" value={choDuyet.length} tone={choDuyet.length ? "amber" : "dark"} />
        <KPI label="Hoàn thành đúng hạn" value={`${tlHoanThanhDungHan}%`} tone={tlHoanThanhDungHan >= 80 ? "green" : tlHoanThanhDungHan >= 50 ? "amber" : "red"} sub={`${dungHan.length}/${hoanThanh.length} việc`} />
        <KPI label="Tỷ lệ trả lại bổ sung" value={`${tlTraLai}%`} tone={tlTraLai <= 15 ? "green" : tlTraLai <= 30 ? "amber" : "red"} />
        <KPI label="Tỷ lệ Không đạt" value={`${tlKhongDat}%`} tone={tlKhongDat === 0 ? "green" : tlKhongDat <= 5 ? "amber" : "red"} sub={`${khongDat.length} việc`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="font-extrabold mb-3">Nhân viên có nhiều việc quá hạn nhất</div>
          {topQuaHan.length === 0 && <div className="text-sm text-[#8A93A0]">Không có ai đang quá hạn. 🎉</div>}
          <div className="flex flex-col gap-2">
            {topQuaHan.map((n, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-5 text-xs font-bold text-[#8A93A0]">{i + 1}</span>
                <span className="flex-1 text-[13.5px] font-semibold">{n.ten}</span>
                <span className="text-[11px] text-[#8A93A0]">{n.dang_mo} đang mở</span>
                <Badge tone="red">{n.qua_han} quá hạn</Badge>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="font-extrabold mb-3">Cửa hàng có tỷ lệ hoàn thành thấp nhất</div>
          {diemThap.length === 0 && <div className="text-sm text-[#8A93A0]">Chưa đủ dữ liệu (cần ≥3 việc/điểm).</div>}
          <div className="flex flex-col gap-2">
            {diemThap.map((x, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-5 text-xs font-bold text-[#8A93A0]">{i + 1}</span>
                <span className="flex-1 text-[13.5px] font-semibold">{x.ten}</span>
                <span className="text-[11px] text-[#8A93A0]">{x.tong} việc</span>
                <Badge tone={x.ty_le >= 50 ? "amber" : "red"}>{x.ty_le}%</Badge>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="font-extrabold mb-3">Nhiệm vụ hoàn thành theo tuần (8 tuần gần nhất)</div>
          <div className="flex items-end gap-2 h-32">
            {tuanGanDay.map((k) => (
              <div key={k} className="flex-1 flex flex-col items-center gap-1" title={`${k}: ${theoTuan[k] || 0} việc`}>
                <div className="w-full rounded-t-md bg-[#1f6feb]" style={{ height: `${Math.max(4, ((theoTuan[k] || 0) / maxTuan) * 100)}%` }} />
                <span className="text-[9.5px] text-[#8A93A0] whitespace-nowrap">{k.replace("Tuần ", "")}</span>
                <span className="text-[10.5px] font-bold">{theoTuan[k] || 0}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="font-extrabold mb-3">Nhiệm vụ hoàn thành theo tháng (6 tháng gần nhất)</div>
          <div className="flex items-end gap-2 h-32">
            {thangGanDay.map((k) => (
              <div key={k} className="flex-1 flex flex-col items-center gap-1" title={`${k}: ${theoThang[k] || 0} việc`}>
                <div className="w-full rounded-t-md bg-[#0E7A4A]" style={{ height: `${Math.max(4, ((theoThang[k] || 0) / maxThang) * 100)}%` }} />
                <span className="text-[9.5px] text-[#8A93A0] whitespace-nowrap">{k}</span>
                <span className="text-[10.5px] font-bold">{theoThang[k] || 0}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <div className="font-extrabold mr-auto">Nhiệm vụ lặp lại đang chạy ({series.length})</div>
          <Link href="/cong-viec/quan-tri" className="btn-ghost !text-xs">Quản lý →</Link>
        </div>
        {series.length === 0 && <div className="text-sm text-[#8A93A0]">Chưa có nhiệm vụ lặp lại nào.</div>}
        <div className="flex flex-col gap-1.5">
          {series.map((s) => (
            <div key={s.id} className="flex items-center gap-2 p-2 rounded-lg border border-[#E3E8EF] text-[13px]">
              <span className="flex-1 font-semibold">{s.title}</span>
              <Badge tone="blue">{{
                daily: "Hằng ngày", weekly: "Hằng tuần", monthly: "Hằng tháng",
                weekday_set: "Theo thứ", month_end: "Cuối tháng",
              }[s.rule_type] || s.rule_type}</Badge>
              <span className="text-[11px] text-[#8A93A0]">hạn {s.due_time} · lần cuối sinh: {s.last_run_date || "chưa chạy"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
