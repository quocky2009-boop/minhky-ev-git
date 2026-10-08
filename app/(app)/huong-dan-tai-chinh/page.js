"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCatalog } from "@/lib/useData";

const iso = (d) => d.toLocaleDateString("sv-SE");

const NGUYEN_TAC = [
  "Mọi số liệu tiền lấy từ hệ thống (đơn bán, phiếu dịch vụ, Sổ quỹ) — không ghi tay ngoài hệ thống.",
  "Không sửa/xóa số liệu đã ghi. Muốn đổi phải đảo ngược và ghi lại kèm lý do (nút ✎ Sửa ở khoản thu của đơn — Admin/BGĐ).",
  "Phiếu chi bắt buộc có lý do chi. Phiếu chi cần duyệt chưa tính là chi cho đến khi được duyệt.",
  "Phát hiện lệch: báo Kế toán ngay, ghi rõ mã đơn/mã phiếu. Không tự tạo phiếu thu/chi để “cân” số.",
];

const QUYEN = [
  ["Phiếu thu / Phiếu chi / Sổ quỹ", "Xem; tạo phiếu theo phân quyền", "Xem, tạo, duyệt phiếu chi, hủy phiếu thủ công, chốt quỹ", "Toàn quyền"],
  ["Đối soát cuối ngày", "Xác nhận phần cửa hàng trưởng", "Xem, người thu xác nhận", "Xem"],
  ["Công nợ phải thu / phải trả", "Xem, nhắc nợ", "Xem, ghi nhận trả nợ, đặt hạn", "Xem"],
  ["Giải ngân trả góp", "Xem, xác nhận đã nhận tiền", "Xem, xác nhận đã nhận tiền", "Xem, xác nhận"],
  ["Dịch vụ đăng ký & phụ kiện ngoài", "Ghi khoản của quỹ mình quản lý", "Xác nhận nộp về công ty", "Xem toàn bộ"],
  ["Claim hãng", "Xem", "Lập hồ sơ, ghi kết quả", "Xem"],
  ["Sửa/đảo ngược khoản thu của đơn", "Không", "Có", "Có"],
];

// href = module liên quan (bấm để mở nhanh)
const HD = {
  MANAGER: {
    title: "Cửa hàng trưởng",
    blocks: [
      { key: "ngay", title: "Hằng ngày (trước 17h)", steps: [
        ["Phiếu thu: chọn nút Hôm nay, lọc Quỹ của cửa hàng mình. Xem dòng “Theo bộ lọc” để biết tổng thu và số phiếu.", "/phieu-thu"],
        ["Đơn bán: lọc Cửa hàng của mình + hôm nay. Đối chiếu số đơn, tổng tiền với tổng thu. Đơn còn thiếu tiền (nút 💵) thì thu thêm hoặc ghi hạn thanh toán.", "/don-ban"],
        ["Phiếu chi: mọi phiếu trong ngày phải có lý do chi; phiếu “⏳ Chờ duyệt” thì nhắc người có quyền duyệt.", "/phieu-chi"],
        ["Đếm tiền mặt thực tế trong két, so với số dư quỹ tiền mặt ở Sổ quỹ → tab Quỹ tiền.", "/thu-chi"],
        ["Đối soát cuối ngày: chọn khu vực + ngày → “Tính số liệu ngày” → nhập tiền mặt thực tế và biên bản → xác nhận phần cửa hàng trưởng. Cần đủ 2 người xác nhận (người thu + cửa hàng trưởng) mới chốt.", "/doi-soat"],
      ]},
      { key: "tuan", title: "Hằng tuần (thứ Hai)", steps: [
        ["Công nợ phải thu: lọc Điểm bán của mình, Tuổi nợ > 30 ngày; nhắc nợ từng đơn (ghi kênh và kết quả).", "/cong-no/phai-thu"],
        ["Giải ngân trả góp: bật “Chỉ khoản quá hạn”. Đã nhận tiền thì xác nhận ngay; chưa nhận thì liên hệ công ty tài chính.", "/giai-ngan"],
        ["Dịch vụ đăng ký & phụ kiện ngoài: kiểm tra các khoản thu hộ trong tuần đã ghi đủ.", "/dich-vu-ngoai"],
      ]},
      { key: "thang", title: "Cuối tháng", steps: [
        ["Dịch vụ ngoài: lập khoản nộp về công ty cho Kế toán xác nhận.", "/dich-vu-ngoai"],
        ["Rà lại khoản trả góp và công nợ của cửa hàng còn tồn, đề xuất hướng xử lý.", "/cong-no/phai-thu"],
      ]},
    ],
  },
  ADMIN: {
    title: "Kế toán",
    blocks: [
      { key: "ngay", title: "Hằng ngày", steps: [
        ["Sổ quỹ: chọn Hôm nay, xem khung Đầu kỳ + Thu − Chi = Cuối kỳ và bảng từng quỹ. So số dư Ngân hàng với sao kê (dùng lọc “Số tiền từ–đến”).", "/thu-chi"],
        ["Phiếu chi: duyệt (✓) hoặc từ chối (✗, bắt buộc lý do) các phiếu chờ duyệt — lọc “Chờ duyệt”.", "/phieu-chi"],
        ["Đối soát cuối ngày → mục “🔎 Đối chiếu Đơn bán ↔ Sổ quỹ”: chọn Hôm nay → “Quét chênh lệch”. Danh sách trống (✓) là khớp.", "/doi-soat"],
        ["Đơn lệch: “Thiếu phiếu thu” → kiểm tra tiền đã về quỹ chưa, ghi nhận khoản thu đúng đơn. “Phiếu thừa” → tìm đơn tương ứng, đảo ngược khoản thu sai.", "/doi-soat"],
        ["Giải ngân trả góp: tiền về từ công ty tài chính → bấm “✓ Đã nhận tiền”, chọn tài khoản ngân hàng nhận. Hệ thống tự ghi phiếu thu.", "/giai-ngan"],
        ["Kiểm tra báo cáo Discord thu chi 17h00 khớp với Sổ quỹ.", "/thu-chi"],
      ]},
      { key: "tuan", title: "Hằng tuần", steps: [
        ["Công nợ phải thu: tuổi nợ > 30 ngày — gửi danh sách cho cửa hàng trưởng, cập nhật hạn thanh toán và ghi chú nợ.", "/cong-no/phai-thu"],
        ["Công nợ phải trả (NCC): lọc “Đến hạn trong 7 ngày” và “Quá hạn”, lập kế hoạch chi.", "/cong-no/phai-tra"],
        ["Claim hãng: cập nhật kết quả hãng duyệt/từ chối cho hồ sơ còn mở.", "/claim-hang"],
      ]},
      { key: "thang", title: "Cuối tháng", steps: [
        ["Chốt quỹ từng tài khoản (Sổ quỹ → Quỹ tiền → Chốt quỹ): nhập số dư thực tế; nếu lệch phải ghi nguyên nhân.", "/thu-chi"],
        ["Quét “Đối chiếu Đơn bán ↔ Sổ quỹ” cả tháng (nút Tháng này / Tháng trước); xử lý hết đơn lệch trước khi khóa sổ.", "/doi-soat"],
        ["Xác nhận khoản nộp dịch vụ ngoài; đối trừ Claim hãng với công nợ hãng.", "/dich-vu-ngoai"],
        ["Xuất Excel (đúng danh sách đang lọc) các sổ chính để lưu trữ.", "/thu-chi"],
      ]},
    ],
  },
  CEO: {
    title: "Ban giám đốc",
    blocks: [
      { key: "ngay", title: "Hằng ngày", steps: [
        ["Đọc báo cáo Discord thu chi 17h00 (theo khu vực và tổng) và báo cáo tồn kho 17h30.", "/thu-chi"],
        ["Duyệt phiếu chi lớn; duyệt chiết khấu thêm trên đơn bán.", "/phieu-chi"],
      ]},
      { key: "tuan", title: "Hằng tuần", steps: [
        ["Công nợ phải thu quá hạn > 30 ngày.", "/cong-no/phai-thu"],
        ["Giải ngân trả góp quá hạn.", "/giai-ngan"],
        ["Đơn lệch trong mục Đối chiếu Đơn bán ↔ Sổ quỹ; quyết định hướng xử lý Kế toán báo cáo.", "/doi-soat"],
      ]},
    ],
  },
};

const CHU_KY = [
  ["Đối soát cuối ngày", "Đối soát cuối ngày → Tính số liệu ngày", "Hằng ngày, trước 17h", "Người thu + Cửa hàng trưởng"],
  ["Đếm tiền mặt két", "So với Quỹ tiền mặt trong Sổ quỹ", "Hằng ngày", "Cửa hàng trưởng"],
  ["Duyệt phiếu chi", "Phiếu chi → lọc Chờ duyệt", "Hằng ngày", "Kế toán / BGĐ"],
  ["Đối chiếu số dư ngân hàng với sao kê", "Sổ quỹ + lọc số tiền", "Hằng ngày", "Kế toán"],
  ["Quét Đơn bán ↔ Sổ quỹ", "Đối soát → Quét chênh lệch", "Hằng ngày (hôm nay); hằng tháng (cả tháng)", "Kế toán"],
  ["Nhắc công nợ phải thu > 30 ngày", "Công nợ phải thu → Tuổi nợ", "Hằng tuần", "Cửa hàng trưởng"],
  ["Khoản trả góp quá hạn", "Giải ngân → Chỉ quá hạn", "Hằng tuần", "Cửa hàng trưởng / Kế toán"],
  ["Công nợ NCC đến hạn", "Công nợ phải trả → Đến hạn 7 ngày", "Hằng tuần", "Kế toán"],
  ["Chốt quỹ thực tế", "Sổ quỹ → Quỹ tiền → Chốt quỹ", "Hằng tháng (tiền mặt: hằng tuần nếu số dư lớn)", "Kế toán"],
  ["Nộp dịch vụ ngoài / Claim hãng", "Hai module tương ứng", "Hằng tháng", "Cửa hàng trưởng, Kế toán"],
];

const KHI_LECH = [
  "Ghi lại mã đơn / mã phiếu, số tiền, ngày.",
  "Mở chứng từ gốc (bấm mã trong cột “Chứng từ gốc”) để xem lịch sử thu/hoàn.",
  "Kế toán xử lý: bổ sung khoản thu còn thiếu, hoặc đảo ngược khoản sai (có lý do). Không tạo phiếu tay để cân số.",
  "Lệch chưa giải thích được sau 1 ngày làm việc: báo BGĐ.",
];

export default function HuongDanTaiChinh() {
  const { profile, loading } = useCatalog();
  const [role, setRole] = useState("");
  const [done, setDone] = useState({});
  const today = iso(new Date());
  const storeKey = (r) => `hd_tc_done:${r}:${today}`;

  useEffect(() => { if (profile && !role) setRole(HD[profile.role] ? profile.role : "MANAGER"); }, [profile]);
  useEffect(() => {
    if (!role) return;
    try { setDone(JSON.parse(localStorage.getItem(storeKey(role)) || "{}")); } catch { setDone({}); }
  }, [role]);

  if (loading || !profile) return <div className="card">Đang tải…</div>;
  if (!["CEO", "MANAGER", "ADMIN"].includes(profile.role)) return <div className="card">Hướng dẫn này dành cho BGĐ / Quản lý / Kế toán.</div>;

  const g = HD[role] || HD.MANAGER;
  const toggle = (id) => setDone((d) => {
    const n = { ...d, [id]: !d[id] };
    try { localStorage.setItem(storeKey(role), JSON.stringify(n)); } catch {}
    return n;
  });
  const ngay = g.blocks.find((b) => b.key === "ngay");
  const soXong = ngay ? ngay.steps.filter((_, i) => done[`ngay-${i}`]).length : 0;

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <div>
        <div className="font-extrabold text-lg">Hướng dẫn kiểm tra & rà soát số liệu tài chính</div>
        <div className="text-[12.5px] text-[#5A6572]">Theo từng vai trò: các bước thực hiện và chu kỳ kiểm tra. Bấm vào bước để mở đúng module.</div>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {[["MANAGER", "Cửa hàng trưởng"], ["ADMIN", "Kế toán"], ["CEO", "Ban giám đốc"]].map(([k, v]) => (
          <button key={k} className={`btn !px-3 !py-2 !text-xs ${role === k ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => setRole(k)}>{v}</button>
        ))}
      </div>

      <div className="card">
        <div className="font-extrabold mb-1.5">Nguyên tắc chung</div>
        <ul className="list-disc pl-5 text-[13px] flex flex-col gap-1">{NGUYEN_TAC.map((t) => <li key={t}>{t}</li>)}</ul>
      </div>

      {g.blocks.map((b) => (
        <div className="card" key={b.key}>
          <div className="flex items-center gap-2 mb-2">
            <div className="font-extrabold">{g.title} — {b.title}</div>
            {b.key === "ngay" && <span className="ml-auto text-[11.5px] font-semibold text-[#5A6572]">Hôm nay: {soXong}/{b.steps.length} bước</span>}
          </div>
          <ol className="flex flex-col gap-2">
            {b.steps.map(([t, href], i) => {
              const id = `${b.key}-${i}`;
              return (
                <li key={id} className="flex gap-2 items-start text-[13px]">
                  {b.key === "ngay" ? <input type="checkbox" className="w-4 h-4 mt-0.5 shrink-0" checked={!!done[id]} onChange={() => toggle(id)} /> : <span className="w-4 shrink-0 text-center font-bold text-brand">{i + 1}</span>}
                  <span className={done[id] ? "line-through text-[#8A93A0]" : ""}>{t}</span>
                  {href && <Link href={href} className="ml-auto shrink-0 text-xs font-semibold text-brand hover:underline whitespace-nowrap">Mở ›</Link>}
                </li>
              );
            })}
          </ol>
          {b.key === "ngay" && <div className="text-[11px] text-[#8A93A0] mt-2">Tích hoàn thành chỉ lưu trên trình duyệt của bạn, tự làm mới mỗi ngày.</div>}
        </div>
      ))}

      <div className="card">
        <div className="font-extrabold mb-2">Ai được làm gì (mặc định)</div>
        <div className="tbl-scroll"><table className="w-full border-collapse text-[12.5px]">
          <thead><tr><th className="th">Module</th><th className="th">Cửa hàng trưởng</th><th className="th">Kế toán</th><th className="th">BGĐ</th></tr></thead>
          <tbody>{QUYEN.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i} className={`td ${i === 0 ? "font-semibold" : ""}`}>{c}</td>)}</tr>)}</tbody>
        </table></div>
        <div className="text-[11px] text-[#8A93A0] mt-1.5">Quyền chi tiết do BGĐ cấu hình ở Phân quyền. Menu nào không thấy nghĩa là chưa được cấp quyền.</div>
      </div>

      <div className="card">
        <div className="font-extrabold mb-2">Chu kỳ kiểm tra (đề xuất — BGĐ điều chỉnh theo thực tế)</div>
        <div className="tbl-scroll"><table className="w-full border-collapse text-[12.5px]">
          <thead><tr><th className="th">Công việc</th><th className="th">Cách làm</th><th className="th">Chu kỳ</th><th className="th">Người làm</th></tr></thead>
          <tbody>{CHU_KY.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i} className={`td ${i === 0 ? "font-semibold" : ""}`}>{c}</td>)}</tr>)}</tbody>
        </table></div>
      </div>

      <div className="card">
        <div className="font-extrabold mb-1.5">Khi phát hiện số liệu lệch</div>
        <ol className="list-decimal pl-5 text-[13px] flex flex-col gap-1">{KHI_LECH.map((t) => <li key={t}>{t}</li>)}</ol>
      </div>
    </div>
  );
}
