-- ============================================================
-- Migration 024: SUA THONG TIN 1 CHIEC XE (theo so khung)
-- Cho phep Quan ly/Admin/BGD sua: so khung, mau/mau xe (doi
-- vehicle_id trong cung hang), kho hien tai — cho xe con TON.
-- Chay SAU 023, 1 lan duy nhat.
-- ============================================================

create or replace function public.fn_sua_unit(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; u record; v_frame text; v_new_frame text; v_vid text; v_loc text;
begin
  select * into me from public.fn_me();
  if me.role not in ('MANAGER','ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Quản lý/Admin/BGĐ được sửa thông tin xe'; end if;
  v_frame := upper(trim(p->>'frame_number'));
  select * into u from public.vehicle_units where frame_number = v_frame for update;
  if u is null then raise exception 'SO_KHUNG_KHONG_CO: % không có trên hệ thống', v_frame; end if;
  if u.status = 'DA_BAN' then raise exception 'XE_KHONG_SAN_SANG: xe đã bán, không sửa được'; end if;

  v_new_frame := upper(trim(coalesce(p->>'new_frame', v_frame)));
  v_vid := trim(coalesce(p->>'vehicle_id', u.vehicle_id));
  v_loc := trim(coalesce(p->>'location_code', u.location_code));

  if v_new_frame = '' then raise exception 'THIEU_SO_KHUNG'; end if;
  if v_new_frame <> v_frame and exists (select 1 from public.vehicle_units where frame_number = v_new_frame) then
    raise exception 'SO_KHUNG_TON_TAI: % đã có trên hệ thống', v_new_frame;
  end if;
  if not exists (select 1 from public.vehicles where id = v_vid) then
    raise exception 'KHONG_TIM_THAY: mã xe % không có trong danh mục', v_vid;
  end if;
  if not exists (select 1 from public.locations where code = v_loc) then
    raise exception 'KHONG_TIM_THAY: kho % không tồn tại', v_loc;
  end if;

  update public.vehicle_units set
    frame_number = v_new_frame,
    vehicle_id = v_vid,
    location_code = v_loc,
    is_placeholder = case when v_new_frame <> v_frame then false else is_placeholder end,
    engine_number = coalesce(p->>'engine_number', engine_number),
    note = coalesce(p->>'note', note),
    updated_at = now()
  where frame_number = v_frame;
end $$;
