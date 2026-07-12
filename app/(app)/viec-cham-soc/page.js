"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, Pager, pageSlice } from "@/components/ui";
import { fmtDate, errMsg } from "@/lib/format";

const todayISO = () => new Date().toLocaleDateString("sv-SE");
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE"); };
const tempTone = (t) => t === "Hot" ? "red" : t === "Warm" ? "amber" : t === "Cold" ? "blue" : "gray";

export default function ViecChamSoc() {
  const { supabase, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const [fTemp, setFTemp] = useState("");
  const [scope, setScope] = useState("due"); // due | week | all
  const [openId, setOpenId] = useState(null);
  const [cf, setCf] = useState({ content: "", result: "", next: "" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const load = async () => {
    const { data } = await supabase.from("customers").select("*")
      .not("next_care_date", "is", null)
      .order("next_care_date", { ascending: true }).limit(1000);
    setList(data || []);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  const today = todayISO();
  const week = plusDays(7);
  const overdue = list.filter((c) => c.next_care_date < today);
  const dueToday = list.filter((c) => c.next_care_date === today);
  const inWeek = list.filter((c) => c.next_care_date > today && c.next_care_date <= week);

  const scoped = list.filter((c) => {
    if (scope === "due" && c.next_care_date > today) return false;
    if (scope === "week" && c.next_care_date > week) return false;
    if (fTemp && c.temperature !== fTemp) return false;
    const t = (c.code + c.name + c.phone + (c.next_care_note || "")).toLowerCase();
    return !q || t.includes(q.toLowerCase());
  });

  const dueBadge = (d) => {
    const diff = Math.round((new Date(d) - new Date(today)) / 86400000);
    if (diff < 0) return <Badge tone="red">Quá hạn {-diff} ngày</Badge>;
    if (diff === 0) return <Badge tone="amber">Hôm nay</Badge>;
    return <Badge tone="blue">Còn {diff} ngày</Badge>;
  };

  const startLog = (c) => { setOpenId(openId === c.id ? null : c.id); setCf({ content: "", result: "", next: "" }); };

  const saveLog = async (c, clearNext) => {
    if (!clearNext && !cf.content.trim()) return notify("Nhập nội dung chăm sóc.", "err");
    const { error } = await supabase.rpc("fn_luu_cham_soc", {
      p: { customer_id: c.id, content: cf.content || "Hoàn tất việc chăm sóc theo lịch", result: cf.result, next_care_date: clearNext ? "" : cf.next, next_care_note: clearNext ? "" : (cf.content || "") },
    });
    if (error) return notify(errMsg(error), "err");
    notify(clearNext ? `Đã ghi nhận và xóa lịch hẹn của ${c.name}.` : cf.next ? `Đã ghi chăm sóc, hẹn tiếp ${fmtDate(cf.next)}.` : "Đã ghi chăm sóc (không đặt hẹn mới — việc sẽ rời khỏi danh sách).");
    setOpenId(null); load();
  };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex gap-3 flex-wrap">
        <KPI label="Quá hạn" value={overdue.length} tone={overdue.length ? "red" : "dark"} />
        <KPI label="Hôm nay" value={dueToday.length} tone="amber" />
        <KPI label="7 ngày tới" value={inWeek.length} tone="blue" />
      </div>

      <div className="card">
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <div className="font-extrabold mr-auto">Việc cần chăm sóc ({scoped.length})</div>
          <div className="flex gap-1.5">
            {[["due", "Đến hạn & quá hạn"], ["week", "Trong 7 ngày"], ["all", "Tất cả có hẹn"]].map(([k, lb]) => (
              <button key={k} className={`btn !px-3 !py-2 !text-xs ${scope === k ? "bg-navy-900 text-white" : "bg-[#EEF1F4] text-[#3B4552]"}`} onClick={() => setScope(k)}>{lb}</button>
            ))}
          </div>
          <input className="inp !w-52" placeholder="Tìm tên, SĐT, nội dung hẹn…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="inp !w-auto" value={fTemp} onChange={(e) => setFTemp(e.target.value)}>
            <option value="">Lead: tất cả</option><option>Hot</option><option>Warm</option><option>Cold</option>
          </select>
        </div>
        <div className="overflow-x-auto"><table className="w-full border-collapse">
          <thead><tr><th className="th">Hẹn ngày</th><th className="th">Tình trạng</th><th className="th">Khách hàng</th><th className="th">Lead</th><th className="th">Việc cần làm</th><th className="th">Phụ trách</th><th className="th"></th></tr></thead>
          <tbody>{pageSlice(scoped, page, pageSize).map((c) => [
            <tr key={c.id} className="hover:bg-[#F8FAFC]">
              <td className="td font-bold whitespace-nowrap">{fmtDate(c.next_care_date)}</td>
              <td className="td">{dueBadge(c.next_care_date)}</td>
              <td className="td"><b>{c.name}</b><div className="text-[11px] text-[#8A93A0]">{c.code} · <a className="text-brand font-bold" href={`tel:${c.phone}`}>{c.phone}</a></div></td>
              <td className="td">{c.temperature ? <Badge tone={tempTone(c.temperature)}>{c.temperature}</Badge> : <span className="text-[#C6CDD6]">—</span>}</td>
              <td className="td text-[13px] max-w-[220px]">{c.next_care_note || c.note || "—"}</td>
              <td className="td text-xs">{c.assigned_name || c.created_by_name}</td>
              <td className="td"><button className="btn-primary !px-2.5 !py-1.5 !text-xs" onClick={() => startLog(c)}>{openId === c.id ? "Đóng" : "✓ Ghi chăm sóc"}</button></td>
            </tr>,
            openId === c.id && (
              <tr key={c.id + "f"}><td colSpan={7} className="td bg-[#F8FAFC]">
                <div className="flex gap-1.5 flex-wrap items-end">
                  <div className="flex-1 min-w-[200px]"><label className="lbl">Nội dung đã chăm sóc</label>
                    <input className="inp !py-2" autoFocus placeholder="VD: Đã gọi, khách hẹn qua xem xe thứ 7…" value={cf.content} onChange={(e) => setCf((p) => ({ ...p, content: e.target.value }))} /></div>
                  <div className="min-w-[140px]"><label className="lbl">Kết quả</label>
                    <input className="inp !py-2" placeholder="Tùy chọn" value={cf.result} onChange={(e) => setCf((p) => ({ ...p, result: e.target.value }))} /></div>
                  <div><label className="lbl">Hẹn lần sau</label>
                    <input type="date" className="inp !py-2 !w-40" value={cf.next} onChange={(e) => setCf((p) => ({ ...p, next: e.target.value }))} /></div>
                  <div className="flex gap-1">
                    {[["+1", 1], ["+3", 3], ["+7", 7]].map(([lb, n]) => (
                      <button key={lb} className="btn-ghost !px-2 !py-2 !text-xs" onClick={() => setCf((p) => ({ ...p, next: plusDays(n) }))}>{lb}</button>
                    ))}
                  </div>
                  <button className="btn-ok !py-2 !text-xs" onClick={() => saveLog(c, false)}>Lưu</button>
                  <button className="btn-ghost !py-2 !text-xs" title="Ghi 1 dòng chăm sóc và bỏ lịch hẹn" onClick={() => saveLog(c, true)}>Xong, bỏ hẹn</button>
                </div>
              </td></tr>
            ),
          ])}
          {scoped.length === 0 && <tr><td className="td" colSpan={7}>🎉 Không có việc chăm sóc nào trong phạm vi này. Đặt lịch hẹn ở màn Khách hàng hoặc khi ghi chăm sóc.</td></tr>}
          </tbody>
        </table></div>
        <Pager total={scoped.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
        <p className="text-[11px] text-[#8A93A0] mt-2">Danh sách tự lọc theo phân quyền: sales chỉ thấy khách mình phụ trách. Ghi chăm sóc tại đây sẽ lưu vào Lịch sử chăm sóc và cập nhật lịch hẹn mới.</p>
      </div>
    </div>
  );
}
