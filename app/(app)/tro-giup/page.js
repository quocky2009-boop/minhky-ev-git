"use client";
import { useEffect, useState } from "react";
import { useCatalog } from "@/lib/useData";

const DOCS = [
  { key: "chung", label: "Sales · Cửa hàng trưởng · Kế toán", file: "/huong-dan/huong-dan-su-dung-minh-ky-ev.html" },
  { key: "ktv", label: "Kỹ thuật viên (Dịch vụ)", file: "/huong-dan/huong-dan-ky-thuat-vien-dich-vu.html" },
];

export default function HuongDan() {
  const { profile, loading } = useCatalog();
  const [doc, setDoc] = useState("");
  useEffect(() => { if (profile && !doc) setDoc(profile.role === "TECHNICIAN" ? "ktv" : "chung"); }, [profile]);
  if (loading || !profile) return <div className="card">Đang tải…</div>;
  const cur = DOCS.find((d) => d.key === doc) || DOCS[0];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Hướng dẫn sử dụng</div>
        {DOCS.map((d) => <button key={d.key} className={`btn !px-3 !py-2 !text-xs ${cur.key === d.key ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => setDoc(d.key)}>{d.label}</button>)}
        <a className="btn-ghost !text-xs" href={cur.file} target="_blank" rel="noreferrer">↗ Mở tab mới</a>
        <a className="btn-ghost !text-xs" href={cur.file} download>⬇ Tải về</a>
      </div>
      <iframe key={cur.key} src={cur.file} title={cur.label} className="w-full rounded-xl border border-[#E3E8EF] bg-white" style={{ height: "calc(100vh - 150px)", minHeight: 480 }} />
    </div>
  );
}
