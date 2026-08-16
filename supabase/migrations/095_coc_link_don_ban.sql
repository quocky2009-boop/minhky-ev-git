-- ============================================================
-- Migration 095: Bổ sung liên kết sang Đơn bán cho phiếu Cọc đã
-- chuyển thành đơn (status DA_BAN).
--
-- Thay vì sửa tay 5 hàm khác nhau đang set "deposits.status='DA_BAN'"
-- (fn_ban_hang_v2 qua nhiều bản vá, fn_sua_don_ban) — rủi ro cao vì dễ
-- copy sai 1 hàm dài — dùng 1 TRIGGER chung trên vehicle_units: bất kỳ
-- khi nào 1 xe chuyển sang status='DA_BAN' kèm sale_code, tự động điền
-- sale_code vào đúng phiếu cọc (deposits) cùng số khung đang ở DA_BAN.
-- Cách này áp dụng được cho MỌI luồng bán hàng hiện tại lẫn sau này,
-- không cần sửa lại khi thêm luồng bán mới.
-- Chạy sau 094. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

alter table public.deposits add column if not exists sale_code text references public.sales_orders(code);

create or replace function public._trg_deposits_link_sale() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'DA_BAN' and new.sale_code is not null then
    update public.deposits
    set sale_code = new.sale_code
    where frame_number = new.frame_number and status = 'DA_BAN' and sale_code is null;
  end if;
  return new;
end $$;

drop trigger if exists trg_deposits_link_sale on public.vehicle_units;
create trigger trg_deposits_link_sale after update on public.vehicle_units
for each row when (new.status = 'DA_BAN' and new.sale_code is not null)
execute procedure public._trg_deposits_link_sale();

-- Backfill du lieu cu: gan sale_code cho cac phieu coc DA_BAN tu truoc
-- (nhung don da ban ma so khung van con tra cuu duoc qua vehicle_units.sale_code)
update public.deposits d set sale_code = u.sale_code
from public.vehicle_units u
where u.frame_number = d.frame_number and u.status = 'DA_BAN' and u.sale_code is not null
  and d.status = 'DA_BAN' and d.sale_code is null;
