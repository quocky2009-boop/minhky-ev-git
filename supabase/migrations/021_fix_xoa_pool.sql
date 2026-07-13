-- ============================================================
-- Migration 021: FIX nut "Xoa toan bo danh sach cho"
-- Loi: Supabase bat safeupdate -> chan DELETE khong co WHERE.
-- Sua: them WHERE hop le (van xoa dung toan bo danh sach cho).
-- Chay SAU 020, 1 lan duy nhat.
-- ============================================================

create or replace function public.fn_xoa_pool()
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  delete from public.frame_pool where frame_number is not null;
  delete from public.pool_batches where id is not null;
end $$;
