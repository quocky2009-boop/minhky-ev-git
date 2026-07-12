"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCatalog } from "@/lib/useData";
import { stockBadge, StockBattery, Pager, pageSlice } from "@/components/ui";
import { fmtNum, fmtVND } from "@/lib/format";

export default function TraCuu() {
  const router = useRouter();
  const { vehicles, locations, loading, getQty, totalQty, regionQty } = useCatalog();
  const [q, setQ] = useState(""); const [brand, setBrand] = useState(""); const [model, setModel] = useState("");
  const [color, setColor] = useState(""); const [region, setRegion] = useState(""); const [open, setOpen] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  if (loading) return <div className="card">Đang tải dữ liệu…</div>;
  const brands = [...new Set(vehicles.map((v) => v.brand))];
  const models = [...new Set(vehicles.filter((v) => !brand || v.brand === brand).map((v) => v.name))];
  const colors = [...new Set(vehicles.map((v) => v.color))].sort();
  const list = vehicles.filter((v) => {
    const text = (v.id + v.name + v.color + (v.mfr_code || "")).toLowerCase();
    if (q && !text.includes(q.toLowerCase())) return false;
    if (brand && v.brand !== brand) return false;
    if (model && v.name !== model) return false;
    if (color && v.color !== color) return false;
    if (region && regionQty(v.id, region) <= 0) return false;
    return true;
  });

  return (
    <div>
      <div className="card mb-3">
        <input className="inp !py-3 !text-[15px]" placeholder="Tìm nhanh: tên xe, mã xe, màu…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex gap-2 mt-2.5 flex-wrap">
          <select className="inp !w-auto flex-1 min-w-[110px]" value={brand} onChange={(e) => { setBrand(e.target.value); setModel(""); }}>
            <option value="">Hãng: tất cả</option>{brands.map((b) => <option key={b}>{b}</option>)}
          </select>
          <select className="inp !w-auto flex-1 min-w-[130px]" value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">Mẫu: tất cả</option>{models.map((m) => <option key={m}>{m}</option>)}
          </select>
          <select className="inp !w-auto flex-1 min-w-[110px]" value={color} onChange={(e) => setColor(e.target.value)}>
            <option value="">Màu: tất cả</option>{colors.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className="inp !w-auto flex-1 min-w-[120px]" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">Khu vực: tất cả</option><option>Thành phố</option><option>Hàm Yên</option>
          </select>
        </div>
      </div>
      <div className="text-[13px] text-[#5A6572] mb-2.5">{list.length} mã xe · Tổng tồn hiển thị: <b>{fmtNum(list.reduce((s, v) => s + totalQty(v.id), 0))}</b> xe</div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(290px,1fr))" }}>
        {pageSlice(list, page, pageSize).map((v) => {
          const tot = totalQty(v.id), tp = regionQty(v.id, "Thành phố"), hy = regionQty(v.id, "Hàm Yên");
          const isOpen = open === v.id;
          return (
            <div key={v.id} className="card !p-3.5">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <div className="text-[15px] font-extrabold">{v.name} <span className="font-semibold text-[#5A6572]">· {v.color}</span></div>
                  <div className="text-[11px] text-[#8A93A0] mt-0.5">{v.id}</div>
                </div>
                {stockBadge(tot, v.min_stock)}
              </div>
              <div className="flex items-center gap-2.5 my-2">
                <StockBattery qty={tot} min={v.min_stock} />
                <b className="text-xl tabular-nums">{tot}</b>
                <span className="text-xs text-[#5A6572]">TP: <b>{tp}</b> · HY: <b>{hy}</b></span>
                <span className="ml-auto text-[13px] font-bold text-brand">{fmtVND(v.list_price)}</span>
              </div>
              {isOpen && (
                <div className="bg-[#F8FAFC] rounded-lg px-3 py-2 my-2 text-[13px]">
                  {locations.filter((l) => getQty(v.id, l.code) > 0).map((l) => (
                    <div key={l.code} className="flex justify-between py-0.5"><span>{l.name}</span><b>{getQty(v.id, l.code)}</b></div>
                  ))}
                  {tot === 0 && <div className="text-[#8A93A0]">Không có tồn tại kho nào.</div>}
                </div>
              )}
              <div className="flex gap-1.5 mt-2 flex-wrap">
                <button className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => setOpen(isOpen ? null : v.id)}>{isOpen ? "Thu gọn" : "Tồn từng kho"}</button>
                <button className="btn-primary !px-3 !py-1.5 !text-xs" onClick={() => router.push(`/ban-hang?xe=${encodeURIComponent(v.id)}`)}>Tạo đơn bán</button>
                <button className="btn !px-3 !py-1.5 !text-xs bg-[#E7EFFD] text-brand" onClick={() => router.push(`/dieu-chuyen?xe=${encodeURIComponent(v.id)}`)}>Điều chuyển</button>
              </div>
            </div>
          );
        })}
      </div>
      {list.length === 0 && <div className="card text-center text-[#8A93A0]">Không tìm thấy xe phù hợp. Thử đổi từ khóa hoặc bỏ bớt bộ lọc.</div>}
      <Pager total={list.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
    </div>
  );
}
