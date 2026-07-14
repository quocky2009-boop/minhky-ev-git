-- ============================================================
-- Migration 023: BAN BUON - tao nhieu don cung 1 khach 1 luot
-- Moi so khung -> 1 don (giu nguyen kien truc hien tai), cung
-- khach hang, cung ghi chu lo, moi xe co gia rieng.
-- Chay SAU 022, 1 lan duy nhat.
-- ============================================================

create or replace function public.fn_ban_buon(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; line jsonb; v_codes text[] := '{}'; v_lo text; v_cust bigint;
        v_frame text; v_vid text; v_loc text; v_gia bigint; u record; v_list bigint;
        v_code text; v_before int; v_paid bigint; v_ok int := 0;
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if coalesce(p->>'customer_name','') = '' or coalesce(p->>'customer_phone','') = '' then
    raise exception 'THIEU_THONG_TIN: cần tên và SĐT khách hàng';
  end if;
  if jsonb_array_length(coalesce(p->'lines','[]'::jsonb)) = 0 then
    raise exception 'THIEU_THONG_TIN: chưa có xe nào trong đơn buôn';
  end if;

  v_lo := public.fn_gen_code('LB');   -- ma lo buon de gom nhom
  v_cust := public._upsert_customer_from_sale(p->>'customer_name', p->>'customer_phone', p->>'customer_cccd',
    p->>'customer_address', coalesce(p->>'customer_type','Khách buôn'), coalesce(p->>'customer_source','Khách buôn'), me.uid, me.name);

  for line in select jsonb_array_elements(p->'lines') loop
    v_frame := upper(trim(line->>'frame_number'));
    select * into u from public.vehicle_units where frame_number = v_frame for update;
    if u is null then raise exception 'SO_KHUNG_KHONG_CO: % không có trên hệ thống', v_frame; end if;
    if u.status <> 'TON_KHO' then raise exception 'XE_KHONG_SAN_SANG: xe % đang ở trạng thái %', v_frame, u.status; end if;
    v_vid := u.vehicle_id; v_loc := u.location_code;
    v_gia := coalesce((line->>'sale_price')::bigint, 0);
    v_paid := coalesce((line->>'paid_amount')::bigint, 0);
    select list_price into v_list from public.vehicles where id = v_vid;
    v_before := public._count_at(v_vid, v_loc);
    v_code := public.fn_gen_code('BH');

    update public.vehicle_units set status='DA_BAN', sale_code=v_code, updated_at=now() where frame_number = v_frame;
    perform public._log_txn('Bán hàng', v_vid, v_loc, null, -1, v_before, v_before - 1,
      v_code, 'Đơn buôn '||v_lo||' · KH '||(p->>'customer_name')||' · SK: '||v_frame, me.uid, me.name);

    insert into public.sales_orders (code, location_code, vehicle_id, quantity, frame_number,
      customer_name, customer_phone, customer_cccd, customer_address, customer_type, customer_source,
      list_price, sale_price, paid_amount, payment_method, seller_id, seller_name, document_status, note, customer_id)
    values (v_code, v_loc, v_vid, 1, v_frame,
      p->>'customer_name', p->>'customer_phone', coalesce(p->>'customer_cccd',''), coalesce(p->>'customer_address',''),
      coalesce(p->>'customer_type','Khách buôn'), coalesce(p->>'customer_source','Khách buôn'),
      coalesce(v_list,0), v_gia, v_paid, coalesce(p->>'payment_method','Chuyển khoản'),
      me.uid, me.name, coalesce(p->>'document_status','Đang làm đăng ký'),
      'Đơn buôn '||v_lo||coalesce(nullif(' · '||(p->>'note'),' · '),''), v_cust);

    v_codes := array_append(v_codes, v_code);
    v_ok := v_ok + 1;
  end loop;

  return jsonb_build_object('lo', v_lo, 'count', v_ok, 'codes', to_jsonb(v_codes));
end $$;
