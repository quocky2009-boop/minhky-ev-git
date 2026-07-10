-- ============================================================
-- Migration 007: Xoa kho (ton = 0), khu vuc tuy chinh.
-- Chay SAU 006, 1 lan duy nhat.
-- ============================================================

-- 1) Bo rang buoc cung ve khu vuc -> khu vuc quan ly trong Cai dat
alter table public.locations drop constraint if exists locations_region_check;
alter table public.profiles drop constraint if exists profiles_region_check;

-- Danh sach khu vuc (chinh trong Cai dat)
insert into public.app_settings(key, value) values ('regions', 'Thành phố
Hàm Yên') on conflict do nothing;

-- 2) Xoa kho: chi khi khong con xe ton / dang chuyen tai kho
-- Neu kho da co lich su giao dich -> chuyen trang thai "Đã xóa" (an khoi he thong,
-- giu nguyen lich su); neu chua co lich su gi -> xoa han.
create or replace function public.fn_xoa_kho(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_units int; v_refs int;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được xóa kho'; end if;
  select count(*) into v_units from public.vehicle_units
    where location_code = p_code and status in ('TON_KHO','DANG_CHUYEN');
  if v_units > 0 then
    raise exception 'TON_KHONG_DU: kho còn % xe (tồn/đang chuyển). Điều chuyển hết xe đi trước khi xóa.', v_units;
  end if;
  select (select count(*) from public.inventory_txns where from_location = p_code or to_location = p_code)
       + (select count(*) from public.sales_orders where location_code = p_code)
       + (select count(*) from public.transfer_orders where from_location = p_code or to_location = p_code)
       + (select count(*) from public.stock_adjustments where location_code = p_code)
       + (select count(*) from public.vehicle_units where location_code = p_code)
    into v_refs;
  if v_refs = 0 then
    delete from public.inventory where location_code = p_code;
    delete from public.locations where code = p_code;
    return 'DA_XOA_HAN';
  else
    delete from public.inventory where location_code = p_code;
    update public.locations set status = 'Đã xóa' where code = p_code;
    return 'DA_AN';  -- giu lai de lich su cu van doc duoc ten kho
  end if;
end $$;
