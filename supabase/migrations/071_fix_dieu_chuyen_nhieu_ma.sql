-- ============================================================
-- Migration 071 — FIX ĐIỀU CHUYỂN NHIỀU MÃ XE + XÓA PHIẾU NHÁP
--  Bug: fn_tao_dieu_chuyen_v2 insert 1 row per vehicle_id với cùng code
--       -> duplicate key "transfer_orders_code_key"
--  Fix: gop thanh 1 row duy nhat per phieu, gom tat ca frames[] vao
--  Them: fn_xoa_dieu_chuyen (chi xoa phieu Dang chuyen chua nhan)
-- Chạy SAU 070. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

create or replace function public.fn_tao_dieu_chuyen_v2(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; v_code text; f text; u record; v_from text; v_to text;
  v_frames text[]; v_n int := 0; v_vehicle_id text;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('dieu_chuyen') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền điều chuyển'; end if;

  v_from := p->>'from_location';
  v_to   := p->>'to_location';
  if coalesce(v_from,'') = '' or coalesce(v_to,'') = '' then
    raise exception 'THIEU_THONG_TIN: chọn kho đi và kho đến';
  end if;
  if v_from = v_to then raise exception 'KHO_TRUNG: kho đi và kho đến không được trùng'; end if;

  select array_agg(x) into v_frames from jsonb_array_elements_text(coalesce(p->'frames','[]'::jsonb)) x;
  if coalesce(array_length(v_frames,1),0) = 0 then
    raise exception 'THIEU_SO_KHUNG: chưa chọn xe nào';
  end if;

  v_code := public.fn_next_code('DCH');

  -- Kiem tra va dat trang thai cho tung xe
  foreach f in array v_frames loop
    f := upper(btrim(f));
    select * into u from public.vehicle_units where frame_number = f for update;
    if u is null then raise exception 'SO_KHUNG_KHONG_CO: % không có trên hệ thống', f; end if;
    if u.location_code <> v_from then
      raise exception 'SAI_KHO: xe % đang ở kho %, không phải kho đi đã chọn', f, u.location_code;
    end if;
    if u.status <> 'TON_KHO' then
      raise exception 'XE_KHONG_SAN_SANG: xe % đang ở trạng thái %', f,
        case u.status when 'GIU_CHO' then 'giữ chỗ (có cọc)'
                      when 'DANG_CHUYEN' then 'đang chuyển'
                      when 'DA_BAN' then 'đã bán' else u.status end;
    end if;
    -- Set status va transfer_code
    update public.vehicle_units
    set status = 'DANG_CHUYEN', transfer_code = v_code, updated_at = now()
    where frame_number = f;

    -- Lay vehicle_id cua xe dau tien (dai dien cho phieu)
    if v_vehicle_id is null then v_vehicle_id := u.vehicle_id; end if;
    v_n := v_n + 1;
  end loop;

  -- FIX: chi insert MOT ROW duy nhat cho ca phieu, gom tat ca frames vao
  -- vehicle_id = xe dau tien (dai dien), quantity = tong so xe
  insert into public.transfer_orders (code, from_location, to_location, vehicle_id, quantity,
    requested_by, requested_by_name, note, frames, status)
  values (v_code, v_from, v_to, v_vehicle_id, v_n,
    me.uid, me.name, coalesce(p->>'note',''), v_frames, 'Đang chuyển');

  return jsonb_build_object('code', v_code, 'so_xe', v_n);
end $$;

-- ===================== HÀM XÓA PHIẾU ĐIỀU CHUYỂN =====================
-- Chi xoa phieu o trang thai "Dang chuyen" (chua nhan)
-- Hoan xe ve TON_KHO khi xoa
create or replace function public.fn_xoa_dieu_chuyen(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record; tr record;
begin
  select * into me from public.fn_me();
  if me.role not in ('CEO','MANAGER','ADMIN') then
    raise exception 'KHONG_CO_QUYEN: chỉ Quản lý/BGĐ được xóa phiếu điều chuyển';
  end if;
  select * into tr from public.transfer_orders where id = p_id for update;
  if tr is null then raise exception 'KHONG_TIM_THAY'; end if;
  if tr.status <> 'Đang chuyển' then
    raise exception 'TRANG_THAI_SAI: chỉ xóa được phiếu đang ở trạng thái Đang chuyển';
  end if;
  -- Hoan xe ve TON_KHO
  update public.vehicle_units
  set status = 'TON_KHO', transfer_code = '', updated_at = now()
  where transfer_code = tr.code and status = 'DANG_CHUYEN';
  -- Fallback theo frames[]
  if tr.frames is not null and array_length(tr.frames,1) > 0 then
    update public.vehicle_units
    set status = 'TON_KHO', transfer_code = '', updated_at = now()
    where frame_number = any(tr.frames) and status = 'DANG_CHUYEN';
  end if;
  -- Xoa phieu
  delete from public.transfer_orders where id = p_id;
end $$;

do $do$
begin
  raise notice 'XONG 071: fix duplicate key dieu chuyen nhieu ma xe; them fn_xoa_dieu_chuyen';
end $do$;
