"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast } from "@/components/ui";
import { fmtVND, fmtDate, fmtTime, errMsg } from "@/lib/format";

export default function NhapChiTiet() {
  const { doc } = useParams();
  const router = useRouter();
  const docCode = decodeURIComponent(doc);
  const { supabase, vehicles, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [txns, setTxns] = useState([]);
  const [units, setUnits] = useState([]);
  const [busy, setBusy] = useState(true);

  const load = async () => {
    setBusy(true);
    const [{ data: t }, { data: u }] = await Promise.all([
      supabase.from("inventory_txns").select("*").eq("doc_code", docCode).eq("txn_type", "Nhập hàng").order("id"),
      supabase.from("vehicle_units").select("*").eq("import_doc", docCode).limit(1000),
    ]);
    setTxns(t || []); setUnits(u || []);
    setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading, docCode]);

  if (loading || busy) return <div className="card">Đang tải đơn nhập…</div>;
  if (txns.length === 0) return (
    <div className="card">
      <div className="text-[#8A93A0]">Không tìm thấy đơn nhập <b>{docCode}</b>.</div>
      <button className="btn-ghost !text-xs mt-2" onClick={() => router.back()}>← Quay lại</button>
    </div>
  );

  const vName = (id) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.brand} ${v.name} ${v.color}` : id; };
  const locName = (c) => locations.find((l) => l.code === c)?.name || c || "—";
  const parseSup = (note) => { const m = (note || "").match(/NCC:\s*([^·|]+)/); return m ? m[1].trim() : ""; };

  const t0 = txns[0];
  const loc = t0.to_location;
  const supplier = parseSup(t0.note);
  const soXe = txns.reduce((s, t) => s + (t.qty || 0), 0);
  const soMa = txns.length;
  const tongVon = units.reduce((s, u) => s + (u.cost_price || 0), 0);

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Toast toast={toast} />

      {/* HEADER */}
      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-ghost !text-xs" onClick={() => router.back()}>← Quay lại danh sách đơn nhập</button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xl font-extrabold">{docCode}</span>
        <Badge tone="green">Đã nhập kho</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* NHÀ CUNG CẤP */}
          <div className="card">
            <div className="font-extrabold mb-2">Thông tin nhà cung cấp</div>
            <div className="text-[15px] font-bold text-brand">{supplier || "— Không rõ NCC —"}</div>
          </div>

          {/* HÀNG HÓA */}
          <div className="card">
            <div className="font-extrabold mb-3">Thông tin hàng hóa</div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead><tr className="text-[11.5px] text-[#8A93A0] uppercase border-b border-[#E3E8EF]">
                  <th className="text-left py-2 pl-2">Tên sản phẩm</th>
                  <th className="text-right py-2">Số lượng</th>
                  <th className="text-right py-2">Giá vốn/xe</th>
                  <th className="text-right py-2 pr-2">Thành tiền</th>
                </tr></thead>
                <tbody>
                  {txns.map((t) => {
                    const us = units.filter((u) => u.vehicle_id === t.vehicle_id);
                    const gia = us[0]?.cost_price || 0;
                    return (
                      <tr key={t.id} className="border-b border-dashed border-[#F0F2F5] align-top">
                        <td className="py-2.5 pl-2">
                          <div className="font-semibold">{vName(t.vehicle_id)}</div>
                          {us.length > 0 && (
                            <div className="flex gap-1 flex-wrap mt-1">
                              {us.map((u) => (
                                <span key={u.frame_number} className="inline-flex items-center gap-1 bg-[#F3F5F8] rounded px-1.5 py-0.5 text-[10.5px] font-mono">
                                  {u.frame_number}
                                  {u.status !== "TON_KHO" && <span className="text-[9px] text-[#8A93A0]">·{u.status === "DA_BAN" ? "đã bán" : u.status === "DANG_CHUYEN" ? "đang chuyển" : u.status}</span>}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 text-right">{t.qty}</td>
                        <td className="py-2.5 text-right">{gia > 0 ? fmtVND(gia) : "—"}</td>
                        <td className="py-2.5 pr-2 text-right font-bold">{fmtVND(gia * t.qty)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="text-[13px]"><td colSpan={3} className="py-1.5 pl-2 text-[#5A6572]">Tổng số xe</td><td className="py-1.5 pr-2 text-right font-bold">{soXe} chiếc</td></tr>
                  <tr className="font-extrabold text-[14px] bg-[#EAF2FF]"><td colSpan={3} className="py-2 pl-2">Tổng giá vốn lô hàng</td><td className="py-2 pr-2 text-right text-brand">{fmtVND(tongVon)}</td></tr>
                </tfoot>
              </table>
            </div>
            {tongVon === 0 && <div className="text-[11.5px] text-[#A25F00] mt-2">⚠ Lô này chưa khai giá vốn — báo cáo lãi gộp sẽ thiếu số liệu.</div>}
          </div>
        </div>

        {/* CỘT PHẢI */}
        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="font-extrabold mb-3">Thông tin đơn nhập</div>
            <div className="flex flex-col gap-1.5 text-[13px]">
              {[
                ["Mã phiếu", docCode],
                ["Nhập vào kho", locName(loc)],
                ["Người nhập", t0.created_by_name],
                ["Ngày nhập", fmtTime(t0.created_at)],
                ["Số mã xe", `${soMa}`],
                ["Tổng số xe", `${soXe} chiếc`],
                supplier && ["Nhà cung cấp", supplier],
              ].filter(Boolean).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-[#8A93A0] w-28 shrink-0">{k}</span>
                  <span className="font-semibold">{v}</span>
                </div>
              ))}
            </div>
          </div>
          {t0.note && parseSup(t0.note) !== t0.note && (
            <div className="card">
              <div className="font-extrabold mb-1">Ghi chú</div>
              <div className="text-[13px]">{t0.note.replace(/NCC:\s*[^·|]+[·|]?/, "").trim() || t0.note}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
