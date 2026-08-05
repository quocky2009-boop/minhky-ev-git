"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, VehicleSearch } from "@/components/ui";
import { fmtTime, errMsg } from "@/lib/format";

const STATUS_TONE = { "Chưa nhập": "amber", "Nhập một phần": "blue", "Hoàn thành": "green", "Đã hủy": "dark" };

export default function DatHangNhapChiTiet() {
  const { id } = useParams();
  const router = useRouter();
  const { supabase, vehicles, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [po, setPo] = useState(null);
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(true);
  const [suaMode, setSuaMode] = useState(false);
  const [suaLines, setSuaLines] = useState([]);
  const [huyBusy, setHuyBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    const [{ data: o }, { data: ln }] = await Promise.all([
      supabase.from("purchase_orders").select("*").eq("id", id).single(),
      supabase.from("purchase_order_lines").select("*").eq("po_id", id).order("id"),
    ]);
    setPo(o || null); setLines(ln || []);
    setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading, id]);

  if (loading || busy) return <div className="card">Đang tải…</div>;
  if (!po) return (
    <div className="card">
      <div className="text-[#8A93A0]">Không tìm thấy đơn đặt hàng.</div>
      <button className="btn-ghost !text-xs mt-2" onClick={() => router.back()}>← Quay lại</button>
    </div>
  );

  const vName = (vid) => { const v = vehicles.find((x) => x.id === vid); return v ? `${v.brand} ${v.name} ${v.color}` : vid; };
  const locName = (c) => locations.find((l) => l.code === c)?.name || c;
  const soLuongDat = lines.reduce((s, l) => s + l.qty_ordered, 0);
  const soLuongNhan = lines.reduce((s, l) => s + l.qty_received, 0);

  const moSua = () => {
    setSuaLines(lines.map((l) => ({ id: l.id, vehicle_id: l.vehicle_id, qty_ordered: l.qty_ordered, qty_received: l.qty_received })));
    setSuaMode(true);
  };

  const luuSua = async () => {
    const { error } = await supabase.rpc("fn_sua_don_dat_hang", { p: {
      id: po.id, supplier: po.supplier, ngay_du_kien: po.ngay_du_kien, note: po.note,
      lines: suaLines.map((l) => ({ id: l.id, qty_ordered: Number(l.qty_ordered) })),
    } });
    if (error) return notify(errMsg(error), "err");
    notify("Đã cập nhật đơn đặt hàng."); setSuaMode(false); load();
  };

  const huyDon = async () => {
    if (!confirm(`Hủy đơn đặt hàng ${po.code}? Không thể hoàn tác.`)) return;
    setHuyBusy(true);
    const { error } = await supabase.rpc("fn_huy_don_dat_hang", { p_id: po.id });
    setHuyBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã hủy đơn đặt hàng."); load();
  };

  const nhapHang = () => {
    router.push(`/nhap-hang?po_id=${po.id}`);
  };

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-ghost !text-xs" onClick={() => router.back()}>← Quay lại danh sách đơn đặt hàng</button>
        <div className="ml-auto flex gap-2">
          {po.status === "Chưa nhập" && (
            <button className="btn-ghost !text-xs !text-danger" disabled={huyBusy} onClick={huyDon}>{huyBusy ? "Đang hủy…" : "Hủy"}</button>
          )}
          {po.status !== "Hoàn thành" && po.status !== "Đã hủy" && (
            <button className="btn-ghost !text-xs" onClick={moSua}>Sửa đơn</button>
          )}
          {po.status !== "Hoàn thành" && po.status !== "Đã hủy" && (
            <button className="btn-primary !text-xs" onClick={nhapHang}>Nhập hàng</button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xl font-extrabold">{po.code}</span>
        <span className="text-[13px] text-[#8A93A0]">{fmtTime(po.created_at)}</span>
        <Badge tone={STATUS_TONE[po.status]}>{po.status}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className="card">
            <div className="font-extrabold mb-2">Thông tin nhà cung cấp</div>
            <div className="text-[15px] font-bold text-brand">{po.supplier || "— Không rõ NCC —"}</div>
          </div>

          <div className="card">
            <div className="font-extrabold mb-3">Thông tin sản phẩm</div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead><tr className="text-[11.5px] text-[#8A93A0] uppercase border-b border-[#E3E8EF]">
                  <th className="text-left py-2 pl-2">Model xe + màu</th>
                  <th className="text-right py-2">SL đặt</th>
                  <th className="text-right py-2">SL đã nhận</th>
                  <th className="text-right py-2 pr-2">Còn thiếu</th>
                </tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-b border-dashed border-[#F0F2F5]">
                      <td className="py-2.5 pl-2 font-semibold">{vName(l.vehicle_id)}</td>
                      <td className="py-2.5 text-right">{l.qty_ordered}</td>
                      <td className="py-2.5 text-right">{l.qty_received}</td>
                      <td className="py-2.5 pr-2 text-right font-bold">
                        {l.qty_ordered - l.qty_received > 0 ? <span className="text-[#A25F00]">{l.qty_ordered - l.qty_received}</span> : <Badge tone="green">Đủ</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="text-[13px]"><td className="py-1.5 pl-2 text-[#5A6572]">Tổng</td><td className="py-1.5 text-right font-bold">{soLuongDat}</td><td className="py-1.5 text-right font-bold">{soLuongNhan}</td><td className="py-1.5 pr-2"></td></tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="font-extrabold mb-3">Thông tin đơn đặt hàng</div>
            <div className="flex flex-col gap-1.5 text-[13px]">
              {[
                ["Mã đơn", po.code],
                ["Chi nhánh", locName(po.location_code)],
                ["Nhân viên tạo", po.created_by_name],
                ["Ngày tạo", fmtTime(po.created_at)],
                po.ngay_du_kien && ["Ngày nhập dự kiến", po.ngay_du_kien],
              ].filter(Boolean).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-[#8A93A0] w-32 shrink-0">{k}</span>
                  <span className="font-semibold">{v}</span>
                </div>
              ))}
            </div>
          </div>
          {po.note && (
            <div className="card">
              <div className="font-extrabold mb-1">Ghi chú</div>
              <div className="text-[13px]">{po.note}</div>
            </div>
          )}
        </div>
      </div>

      {/* MODAL SỬA ĐƠN */}
      {suaMode && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3" onClick={() => setSuaMode(false)}>
          <div className="bg-white rounded-2xl w-[460px] max-w-full p-4" onClick={(e) => e.stopPropagation()}>
            <div className="font-extrabold mb-1">Sửa đơn đặt hàng {po.code}</div>
            <div className="text-[12px] text-[#8A93A0] mb-3">Chỉ được sửa tăng SL đặt hoặc giữ nguyên (không được thấp hơn SL đã nhận).</div>
            <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
              {suaLines.map((l, i) => (
                <div key={l.id} className="flex items-center gap-2">
                  <span className="flex-1 text-[13px]">{vName(l.vehicle_id)} <span className="text-[11px] text-[#8A93A0]">(đã nhận {l.qty_received})</span></span>
                  <input type="number" min={l.qty_received} className="inp !w-24" value={l.qty_ordered}
                    onChange={(e) => setSuaLines((p) => p.map((x, j) => j === i ? { ...x, qty_ordered: e.target.value } : x))} />
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <button className="btn-ghost !text-xs flex-1" onClick={() => setSuaMode(false)}>Hủy</button>
              <button className="btn-primary !text-xs flex-1" onClick={luuSua}>Lưu</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
