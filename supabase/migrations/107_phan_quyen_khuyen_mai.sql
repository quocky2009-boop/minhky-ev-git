-- ============================================================
-- Migration 107: Tách quyền "Sửa tag chương trình khuyến mại" ra
-- riêng (không dùng chung 'xuat_ban' nữa) — để CEO chủ động quyết
-- định Cửa hàng trưởng/Sales nào được thêm/xóa tag khuyến mại trên
-- đơn đã tạo (kể cả đơn đã xuất HĐ) qua trang Phân quyền.
--
-- ⚠️ THAY ĐỔI HÀNH VI: mặc định fn_co_quyen() trả false cho quyền
-- MỚI chưa cấu hình — nghĩa là ngay sau khi chạy migration này, CHỈ
-- CEO sửa được tag cho tới khi anh vào /phan-quyen bật quyền
-- "sua_khuyen_mai_don" cho MANAGER/SALES (nếu muốn họ tiếp tục làm
-- được việc này như trước).
-- Chạy sau 098. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

create or replace function public.fn_gan_khuyen_mai_don(p_sale_code text, p_promotion_ids bigint[])
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('sua_khuyen_mai_don') then
    raise exception 'KHONG_CO_QUYEN: bạn không có quyền sửa tag chương trình khuyến mại';
  end if;
  if not exists (select 1 from public.sales_orders where code = p_sale_code) then
    raise exception 'KHONG_TIM_THAY: đơn bán không tồn tại';
  end if;

  delete from public.sale_order_promotions
  where sale_code = p_sale_code and not (promotion_id = any(coalesce(p_promotion_ids, '{}')));

  insert into public.sale_order_promotions (sale_code, promotion_id, created_by, created_by_name)
  select p_sale_code, pid, me.uid, me.name
  from unnest(coalesce(p_promotion_ids, '{}')) pid
  on conflict (sale_code, promotion_id) do nothing;
end $$;
