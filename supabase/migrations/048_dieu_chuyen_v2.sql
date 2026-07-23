-- ============================================================
-- Migration 048 — ĐIỀU CHUYỂN V2: nhiều mã xe trong 1 phiếu
-- Ham cu chi chuyen duoc 1 ma xe/phieu. Ban moi: gom nhieu xe
-- (nhieu ma khac nhau) tu 1 kho sang 1 kho, tim/quet so khung.
-- Chay SAU 047. Chay lai nhieu lan van an toan.
-- ============================================================

-- Bo sung cot luu danh sach so khung (bang goc chua co)
alter table public.transfer_orders add column if not exists frames text[] default '{}';

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

    -- Danh dau dang chuyen, giu nguyen kho cho toi khi ben nhan xac nhan
    update public.vehicle_units set status = 'DANG_CHUYEN', updated_at = now()
    where frame_number = f;

    if not (u.vehicle_id = any(v_ma)) then v_ma := array_append(v_ma, u.vehicle_id); end if;
    v_n := v_n + 1;
  end loop;

  -- Moi ma xe 1 dong phieu (giu tuong thich bang transfer_orders hien co)
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

  perform public._notify_discord(jsonb_build_object('content',
    concat('🔄 **Điều chuyển ', v_code, '** · ', v_n, ' xe (', array_length(v_ma,1), ' mã)', E'\n',
      '📤 Từ: ', v_from, '  →  📥 Đến: ', v_to, E'\n',
      case when coalesce(p->>'note','') <> '' then concat('📝 ', p->>'note', E'\n') else '' end,
      '👤 ', me.name, ' · chờ bên nhận xác nhận')));

  return jsonb_build_object('code', v_code, 'so_xe', v_n, 'so_ma', array_length(v_ma,1));
end $$;
