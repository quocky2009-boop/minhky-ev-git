"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, Pager, pageSlice } from "@/components/ui";
import { fmtDate, fmtTime, downloadCSV } from "@/lib/format";

const today = () => new Date().toLocaleDateString("sv-SE");
const tempTone = (t) => t === "Hot" ? "red" : t === "Warm" ? "amber" : t === "Cold" ? "blue" : "gray";

export default function LichSuChamSoc() {
  const { supabase, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [logs, setLogs] = useState([]);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(today().slice(0, 8) + "01");
  const [to, setTo] = useState(today());
  const [fTemp, setFTemp] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const load = async () => {
    const { data } = await supabase.from("customer_care_logs")
      .select("*, customers(code, name, phone, temperature, status)")
      .gte("care_date", from).lte("care_date", to)
      .order("care_date", { ascending: false }).limit(1000);
    setLogs(data || []);
  };
  useEffect(() => { if (!loading) load(); }, [loading, from, to]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  const list = logs.filter((l) => {
    const cust = l.customers;
    if (fTemp && cust?.temperature !== fTemp) return false;
    const t = ((cust?.name || "") + (cust?.phone || "") + (cust?.code || "")).toLowerCase();
    return !q || t.includes(q.toLowerCase());
  });

  const exportCSV = () => {
    downloadCSV(`lich_su_cham_soc_${from}_den_${to}.csv`,
      [["Ngay_Cham_Soc","Ma_KH","Khach_Hang","SDT","Lead","Noi_Dung","Ket_Qua","Nguoi_Ghi","Ngay_Nhap_He_Thong"],
       ...list.map((l) => [l.care_date, l.customers?.code || "", l.customers?.name || "", l.customers?.phone || "",
         l.customers?.temperature || "", l.content, l.result, l.created_by_name, l.created_at])]);
  };

  return (
    <div className="card">
      <Toast toast={toast} />
      <div className="flex gap-2 flex-wrap items-center mb-3">
        <div className="font-extrabold mr-auto">Lịch sử chăm sóc khách hàng ({list.length})</div>
        <input className="inp !w-56" placeholder="Tìm tên, SĐT, mã KH…" value={q} onChange={(e) => setQ(e.target.value)} />
        <input type="date" className="inp !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="inp !w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
        <select className="inp !w-auto" value={fTemp} onChange={(e) => setFTemp(e.target.value)}>
          <option value="">Lead: tất cả</option><option>Hot</option><option>Warm</option><option>Cold</option>
        </select>
        <button className="btn-ghost !text-xs" onClick={exportCSV}>⬇ Xuất CSV</button>
      </div>
      <div className="overflow-x-auto"><table className="w-full border-collapse">
        <thead><tr><th className="th">Ngày chăm sóc</th><th className="th">Khách hàng</th><th className="th">Lead</th><th className="th">Nội dung</th><th className="th">Kết quả</th><th className="th">Người ghi</th><th className="th">Ngày nhập hệ thống</th></tr></thead>
        <tbody>{pageSlice(list, page, pageSize).map((l) => {
          const backdated = new Date(l.created_at).toISOString().slice(0, 10) !== l.care_date;
          return (
            <tr key={l.id}>
              <td className="td font-bold">{fmtDate(l.care_date)}</td>
              <td className="td">{l.customers ? <><b>{l.customers.name}</b><div className="text-[11px] text-[#8A93A0]">{l.customers.code} · {l.customers.phone}</div></> : "—"}</td>
              <td className="td">{l.customers?.temperature ? <Badge tone={tempTone(l.customers.temperature)}>{l.customers.temperature}</Badge> : <span className="text-[#C6CDD6]">—</span>}</td>
              <td className="td text-[13px]">{l.content}</td>
              <td className="td text-[13px]">{l.result || "—"}</td>
              <td className="td">{l.created_by_name}</td>
              <td className={`td text-[11px] italic ${backdated ? "text-[#A25F00] font-semibold" : "text-[#8A93A0]"}`}>{fmtTime(l.created_at)}{backdated ? " ⚠" : ""}</td>
            </tr>
          );
        })}
        {list.length === 0 && <tr><td className="td" colSpan={7}>Không có dữ liệu trong phạm vi đã chọn.</td></tr>}
        </tbody>
      </table></div>
      <Pager total={list.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
      <p className="text-[11px] text-[#8A93A0] mt-2">Cột cuối là thời điểm dữ liệu thực sự được nhập vào hệ thống — dùng để đối chiếu với "Ngày chăm sóc" do sales chọn, phát hiện trường hợp nhập lùi ngày (⚠).</p>
    </div>
  );
}
