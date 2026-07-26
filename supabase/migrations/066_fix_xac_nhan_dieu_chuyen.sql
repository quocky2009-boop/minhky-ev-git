-- ============================================================
-- Migration 066 — FIX ĐIỀU CHUYỂN: xe không đổi kho sau khi xác nhận nhận
--  Root cause: fn_tao_dieu_chuyen_v2 set vehicle_units.status = 'DANG_CHUYEN'
--  nhưng KHÔNG set transfer_code. fn_xac_nhan_dieu_chuyen tìm theo
--  transfer_code = tr.code → không khớp → xe không cập nhật kho/trạng thái.
--  Fix:
--   1) fn_tao_dieu_chuyen_v2: thêm transfer_code = v_code khi update xe.
--   2) fn_xac_nhan_dieu_chuyen: tìm theo CẢ 2 cách (frames[] từ transfer_orders
--      VÀ transfer_code) để xử lý cả phiếu cũ đã tạo nhưng chưa nhận.
-- Chạy SAU 065. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ===================== 1) fn_tao: set transfer_code khi tao phieu =====================
create or replace function public.fn_tao_dieu_chuyen_v2(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; v_code text; f text; u record; v_from text; v_to text;
  v_frames text[]; v_n int := 0; v_ma text[] := '{}'; v_xe text;
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

    -- FIX: set ca status VA transfer_code de fn_xac_nhan tim duoc
    update public.vehicle_units
    set status = 'DANG_CHUYEN', transfer_code = v_code, updated_at = now()
    where frame_number = f;

    if not (u.vehicle_id = any(v_ma)) then v_ma := array_append(v_ma, u.vehicle_id); end if;
    v_n := v_n + 1;
  end loop;

  foreach v_xe in array v_ma loop
    insert into public.transfer_orders (code, from_location, to_location, vehicle_id, quantity,
      requested_by, requested_by_name, note, frames)
    select v_code, v_from, v_to, v_xe,
      (select count(*) from unnest(v_frames) x
       where (select vehicle_id from public.vehicle_units where frame_number = upper(btrim(x))) = v_xe),
      me.uid, me.name, coalesce(p->>'note',''),
      (select array_agg(upper(btrim(x))) from unnest(v_frames) x
       where (select vehicle_id from public.vehicle_units where frame_number = upper(btrim(x))) = v_xe);
  end loop;

  return jsonb_build_object('code', v_code, 'so_xe', v_n, 'so_ma', array_length(v_ma,1));
end $$;

-- ===================== 2) fn_xac_nhan: tim theo frames[] VA transfer_code =====================
create or replace function public.fn_xac_nhan_dieu_chuyen(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record; tr record; v_bf int; v_bt int; n int;
begin
  select * into me from public.fn_me();
  if me.role not in ('MANAGER','ADMIN','CEO') then
    raise exception 'KHONG_CO_QUYEN: chỉ Quản lý/Admin/BGĐ xác nhận nhận xe';
  end if;
  select * into tr from public.transfer_orders where id = p_id for update;
  if tr.status <> 'Đang chuyển' then
    raise exception 'TRANG_THAI_SAI: phiếu không ở trạng thái Đang chuyển';
  end if;

  v_bf := public._count_at(tr.vehicle_id, tr.from_location);
  v_bt := public._count_at(tr.vehicle_id, tr.to_location);

  -- Cap nhat xe: tim theo frames[] (uu tien) hoac transfer_code (phieu cu)
  if tr.frames is not null and array_length(tr.frames, 1) > 0 then
    update public.vehicle_units
    set location_code = tr.to_location, status = 'TON_KHO', transfer_code = '', updated_at = now()
    where frame_number = any(tr.frames)
      and status = 'DANG_CHUYEN';
  else
    -- Fallback cho phieu cu khong co frames[]
    update public.vehicle_units
    set location_code = tr.to_location, status = 'TON_KHO', transfer_code = '', updated_at = now()
    where transfer_code = tr.code and status = 'DANG_CHUYEN';
  end if;

  get diagnostics n = row_count;

  if n = 0 then
    -- Van con the tim theo vehicle_id + from_location neu frames khong match
    update public.vehicle_units
    set location_code = tr.to_location, status = 'TON_KHO', transfer_code = '', updated_at = now()
    where vehicle_id = tr.vehicle_id
      and location_code = tr.from_location
      and status = 'DANG_CHUYEN'
      and (transfer_code = tr.code or transfer_code = '');
    get diagnostics n = row_count;
  end if;

  perform public._log_txn('Điều chuyển', tr.vehicle_id, tr.from_location, null, -n, v_bf, v_bf - n,
    tr.code, 'Chuyển đến '||tr.to_location, me.uid, me.name);
  perform public._log_txn('Điều chuyển', tr.vehicle_id, null, tr.to_location, n, v_bt, v_bt + n,
    tr.code, 'Nhận từ '||tr.from_location, me.uid, me.name);

  update public.transfer_orders
  set status = 'Đã nhận', confirmed_by = me.uid, confirmed_by_name = me.name, confirmed_at = now()
  where id = p_id;
end $$;

do $do$
begin
  raise notice 'XONG 066: fix dieu chuyen — set transfer_code khi tao; xac nhan tim theo frames[]';
end $do$;

-- ===================== KIỂM TRA & VÁ XE BỊ KẸT (chạy thủ công nếu cần) =====================
-- Xem xe nào đang bị kẹt DANG_CHUYEN không khớp phiếu nào:
-- select u.frame_number, u.vehicle_id, u.location_code, u.transfer_code
-- from public.vehicle_units u
-- where u.status = 'DANG_CHUYEN';

-- Nếu có phiếu "Đang chuyển" chưa xác nhận, thử gọi lại fn_xac_nhan_dieu_chuyen(id):
-- select id, code, status, vehicle_id, from_location, to_location, frames
-- from public.transfer_orders where status = 'Đang chuyển';
