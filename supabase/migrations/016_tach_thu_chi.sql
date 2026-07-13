-- ============================================================
-- Migration 016: TACH PHAN TIEN KHOI APP KHO (dung app thu-chi rieng)
-- 1) Don ban: KHONG bat buoc khai thanh toan, KHONG tu sinh phieu thu.
--    Giu nguyen: so khung, khach hang tu dong, BAN KEM (phu kien/DV/BH).
-- 2) Duyet dieu chinh don: chi doi gia + luu vet, KHONG sinh phieu bu.
-- 3) Tat cron bao cao quy 21h.
-- Du lieu cu (phieu thu, quy, thanh toan da ghi) GIU NGUYEN de tra cuu.
-- Chay SAU 015, 1 lan duy nhat.
-- ============================================================

-- 1) BAN HANG: bo khoi thanh toan, giu ban kem
create or replace function public.fn_ban_hang(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_code text; v_list bigint; f text; u record; n int; v_before int;
        v_frames text[]; v_cust bigint; it jsonb;
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  select array_agg(x) into v_frames from jsonb_array_elements_text(coalesce(p->'frames','[]'::jsonb)) x;
  n := coalesce(array_length(v_frames,1),0);
  if n = 0 then raise exception 'THIEU_SO_KHUNG: chọn ít nhất 1 xe theo số khung'; end if;
  if coalesce(p->>'customer_name','') = '' or coalesce(p->>'customer_phone','') = '' then
    raise exception 'THIEU_THONG_TIN: cần tên và SĐT khách hàng';
  end if;
  v_before := public._count_at(p->>'vehicle_id', p->>'location_code');
  v_code := public.fn_gen_code('BH');
  foreach f in array v_frames loop
    select * into u from public.vehicle_units where frame_number = f for update;
    if u is null then raise exception 'SO_KHUNG_KHONG_CO: % không có trên hệ thống', f; end if;
    if u.status <> 'TON_KHO' then raise exception 'XE_KHONG_SAN_SANG: xe % đang ở trạng thái %', f, u.status; end if;
    if u.location_code <> p->>'location_code' or u.vehicle_id <> p->>'vehicle_id' then
      raise exception 'SAI_KHO_HOAC_XE: xe % không thuộc kho/mã xe đã chọn', f;
    end if;
    update public.vehicle_units set status='DA_BAN', sale_code=v_code, updated_at=now() where frame_number = f;
  end loop;
  perform public._log_txn('Bán hàng', p->>'vehicle_id', p->>'location_code', null, -n, v_before, v_before - n,
    v_code, 'KH '||(p->>'customer_name')||' · SK: '||array_to_string(v_frames,', '), me.uid, me.name);
  select list_price into v_list from public.vehicles where id = p->>'vehicle_id';
  v_cust := public._upsert_customer_from_sale(p->>'customer_name', p->>'customer_phone', p->>'customer_cccd',
    p->>'customer_address', p->>'customer_type', p->>'customer_source', me.uid, me.name);
  insert into public.sales_orders (code, location_code, vehicle_id, quantity, frame_number,
    customer_name, customer_phone, customer_cccd, customer_address, customer_type, customer_source,
    list_price, sale_price, payment_method, seller_id, seller_name, document_status, note, extra, customer_id)
  values (v_code, p->>'location_code', p->>'vehicle_id', n, array_to_string(v_frames,', '),
    p->>'customer_name', p->>'customer_phone', coalesce(p->>'customer_cccd',''), coalesce(p->>'customer_address',''),
    coalesce(p->>'customer_type','Khách lẻ'), coalesce(p->>'customer_source','Khách vãng lai'),
    coalesce(v_list,0), coalesce((p->>'sale_price')::bigint, v_list, 0),
    coalesce(p->>'payment_method','Chuyển khoản'), me.uid, me.name,
    coalesce(p->>'document_status','Đang làm đăng ký'), coalesce(p->>'note',''),
    coalesce(p->'extra','{}'::jsonb), v_cust);
  -- Dong ban kem (phu kien / DV dang ky / bao hiem) - GIU
  for it in select jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) loop
    if coalesce(trim(it->>'name'),'') <> '' and coalesce((it->>'unit_price')::bigint,0) >= 0 then
      insert into public.sale_items (sale_code, item_type, name, qty, unit_price, amount)
      values (v_code, coalesce(nullif(it->>'item_type',''),'PHU_KIEN'), trim(it->>'name'),
              greatest(coalesce((it->>'qty')::int,1),1), coalesce((it->>'unit_price')::bigint,0),
              greatest(coalesce((it->>'qty')::int,1),1) * coalesce((it->>'unit_price')::bigint,0));
    end if;
  end loop;
  return v_code;
end $$;

-- 2) DUYET DIEU CHINH DON: chi doi gia + luu vet, khong dinh den quy
create or replace function public.fn_duyet_sua_don(p_id bigint, p_approve boolean, p_account bigint default null, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare me record; rq record;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được duyệt điều chỉnh đơn'; end if;
  select * into rq from public.sale_adjust_requests where id = p_id for update;
  if rq is null then raise exception 'KHONG_TIM_THAY'; end if;
  if rq.status <> 'Chờ duyệt' then raise exception 'TRANG_THAI_SAI'; end if;
  if not p_approve then
    update public.sale_adjust_requests set status='Từ chối', approved_by=me.uid, approved_by_name=me.name,
      approved_at=now(), approve_note=coalesce(p_note,'') where id = p_id;
    return;
  end if;
  update public.sales_orders set
    sale_price = rq.new_price,
    note = trim(both ' | ' from coalesce(nullif(note,''),'') || ' | ' ||
      'Đã điều chỉnh giá '||rq.old_price||' → '||rq.new_price||' ('||rq.code||')')
  where code = rq.sale_code;
  update public.sale_adjust_requests set status='Đã duyệt', approved_by=me.uid, approved_by_name=me.name,
    approved_at=now(), approve_note=coalesce(p_note,'') where id = p_id;
end $$;

-- 3) TAT CRON BAO CAO QUY 21H
do $$ begin
  perform cron.unschedule('bao-cao-quy-21h');
exception when others then null; end $$;
