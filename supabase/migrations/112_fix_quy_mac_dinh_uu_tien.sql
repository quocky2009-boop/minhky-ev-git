-- ============================================================
-- Migration 112: Sửa _quy_mac_dinh — trước đây khi 1 điểm bán CHƯA
-- có quỹ riêng (VD: HY-CH VINFAST Km40, TP-CH TAILG 322 QT chưa có
-- quỹ Ngân hàng riêng — đã xác nhận qua truy vấn thực tế), hệ thống
-- fallback về tài khoản có ID NHỎ NHẤT trong toàn hệ thống — hoàn
-- toàn ngẫu nhiên theo thứ tự tạo, có thể vô tình gán nhầm vào quỹ
-- của 1 cửa hàng KHÁC.
--
-- Thứ tự ưu tiên MỚI, có ý nghĩa rõ ràng:
--   1) Tài khoản gắn ĐÚNG điểm bán đó
--   2) Tài khoản gắn CÙNG KHU VỰC (region) với điểm bán đó
--   3) Tài khoản DÙNG CHUNG TOÀN CÔNG TY (location_code IS NULL)
--   4) (Cuối cùng, hiếm khi xảy ra) tài khoản bất kỳ còn hoạt động,
--      ID nhỏ nhất — giữ lại để KHÔNG chặn nghiệp vụ nếu công ty
--      chưa khai báo quỹ chung nào cả.
-- Chạy sau 111. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

create or replace function public._quy_mac_dinh(p_loc text, p_type text)
returns bigint language sql stable security definer set search_path = public as $$
  select a.id
  from public.cash_accounts a
  left join public.locations l on l.code = p_loc
  where a.status = 'Hoạt động' and a.type = coalesce(p_type, 'Tiền mặt')
  order by
    (a.location_code = p_loc) desc nulls last,                                    -- 1) dung diem ban
    (a.location_code in (select code from public.locations where region = l.region)) desc nulls last,  -- 2) cung khu vuc
    (a.location_code is null) desc,                                               -- 3) quy chung cong ty
    a.id                                                                          -- 4) fallback cuoi cung
  limit 1
$$;

-- ---------- Canh bao ngay cho CEO: liet ke cac diem ban con thieu quy rieng ----------
do $$
declare v_rec record; v_count int := 0;
begin
  for v_rec in
    select l.name, l.region,
      bool_or(a.type = 'Tiền mặt') as co_tm,
      bool_or(a.type = 'Ngân hàng') as co_nh
    from public.locations l
    left join public.cash_accounts a on a.location_code = l.code and a.status = 'Hoạt động'
    where l.status = 'Hoạt động'
    group by l.code, l.name, l.region
    having not bool_or(a.type = 'Tiền mặt') or not bool_or(a.type = 'Ngân hàng')
  loop
    v_count := v_count + 1;
    raise notice '⚠️ % (khu vực %) — thiếu quỹ: %', v_rec.name, v_rec.region,
      concat_ws(', ', case when not v_rec.co_tm then 'Tiền mặt' end, case when not v_rec.co_nh then 'Ngân hàng' end);
  end loop;
  if v_count > 0 then
    raise notice '➡ Khuyến nghị: vào Sổ quỹ tạo quỹ riêng cho % điểm bán trên để tránh phụ thuộc vào quỹ dự phòng.', v_count;
  end if;
end $$;
