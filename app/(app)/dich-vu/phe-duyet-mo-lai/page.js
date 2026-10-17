"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast } from "@/components/ui";
import { fmtTime, fmtVND, errMsg } from "@/lib/format";
import { LSC_STATUS } from "@/lib/lsc";

export default function PheDuyetMoLai() {
  const { supabase, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [rows, setRows] = useState([]);
  const [ros, setRos] = useState({});
  const [tab, setTab] = useState("cho");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("repair_order_reopen").select("*").order("req_at", { ascending: false }).limit(300);
    setRows(data || []);
    const ids = [...new Set((data || []).map((x) => x.ro_id))];
    if (ids.length) {
      const { data: rs } = await supabase.from("v_lsc").select("id,code,status,plate,customer_name,tong_khach_tra,da_thu").in("id", ids);
      const m = {}; (rs || []).forEach((x) => { m[x.id] = x; }); setRos(m);
    }
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải…</div>;
  const laDuyet = ["CEO", "MANAGER"].includes(profile.role);
  const list = rows.filter((x) => (tab === "cho" ? x.status === "CHO" : x.status !== "CHO"));
  const xuLy = async (x, action) => {
    let note = "";
    if (action === "tu_choi") { note = prompt("Lý do từ chối:") || ""; if (!note.trim()) return; }
    setBusy(true);
    const { error } = await supabase.rpc("fn_lsc_duyet_mo_lai", { p_req: x.id, p_action: action, p_note: note });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(action === "duyet" ? "Đã duyệt — lệnh được mở lại." : "Đã từ chối."); load();
  };
  const nCho = rows.filter((x) => x.status === "CHO").length;

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Phê duyệt mở lại Lệnh sửa chữa</div>
        {[["cho", `Chờ duyệt (${nCho})`], ["da", "Đã xử lý"]].map(([k, v]) => <button key={k} className={`btn !px-3 !py-2 !text-xs ${tab === k ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => setTab(k)}>{v}</button>)}
      </div>
      {!laDuyet && <div className="rounded-xl bg-[#FDF1DF] text-[#A25F00] text-[13px] px-3 py-2">Chỉ Ban giám đốc / Cửa hàng trưởng duyệt được. Bạn xem được trạng thái yêu cầu.</div>}
      <div className="card">
        <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
          <thead><tr><th className="th">Lệnh</th><th className="th">Xe / Khách</th><th className="th">Trạng thái lệnh</th><th className="th">Lý do xin mở lại</th><th className="th">Người xin</th><th className="th">{tab === "cho" ? "Thao tác" : "Kết quả"}</th></tr></thead>
          <tbody>{list.map((x) => { const r = ros[x.ro_id]; return (
            <tr key={x.id} className="hover:bg-[#F8FAFC]">
              <td data-label="Lệnh" className="td font-bold"><Link href={`/dich-vu/lenh-sua-chua/${x.ro_id}`} className="text-brand hover:underline">{r?.code || x.ro_id}</Link></td>
              <td data-label="Xe / Khách" className="td text-[13px]">{r?.plate || "—"}<div className="text-[11px] text-[#8A93A0]">{r?.customer_name}</div></td>
              <td data-label="Trạng thái" className="td">{r && <Badge tone={LSC_STATUS[r.status]?.tone}>{LSC_STATUS[r.status]?.label}</Badge>}<div className="text-[11px] text-[#8A93A0] mt-0.5">đã thu {fmtVND(r?.da_thu || 0)} / {fmtVND(r?.tong_khach_tra || 0)}</div></td>
              <td data-label="Lý do" className="td text-[13px] max-w-[260px]">{x.ly_do}</td>
              <td data-label="Người xin" className="td text-xs">{x.req_by_name}<div className="text-[#8A93A0]">{fmtTime(x.req_at)}</div></td>
              <td data-label="Thao tác" className="td">{tab === "cho"
                ? (laDuyet ? <div className="flex gap-1.5"><button className="btn-ok !px-2.5 !py-1 !text-xs" disabled={busy} onClick={() => xuLy(x, "duyet")}>Duyệt</button><button className="btn-ghost !px-2.5 !py-1 !text-xs hover:!text-danger" disabled={busy} onClick={() => xuLy(x, "tu_choi")}>Từ chối</button></div> : <Badge tone="amber">Chờ duyệt</Badge>)
                : <><Badge tone={x.status === "DUYET" ? "green" : "red"}>{x.status === "DUYET" ? "Đã duyệt" : "Từ chối"}</Badge><div className="text-[11px] text-[#8A93A0]">{x.dec_by_name} · {x.dec_at ? fmtTime(x.dec_at) : ""}{x.dec_note ? ` · ${x.dec_note}` : ""}</div></>}</td>
            </tr>); })}
            {list.length === 0 && <tr><td className="td" colSpan={6}>{tab === "cho" ? "Không có yêu cầu nào đang chờ duyệt." : "Chưa có yêu cầu nào được xử lý."}</td></tr>}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
