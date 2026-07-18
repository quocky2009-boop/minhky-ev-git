-- ============================================================
-- Migration 028:
-- A) ANH DINH KEM DON BAN: bucket cong khai 'don-ban' + cot
--    photos + fn_gan_anh_don (gui anh sang Discord dang embed)
-- B) XOA DON BAN (chi BGD): hoan xe ve ton kho + ghi lich su
--    + xoa ban kem/yeu cau sua gia + xoa don. Luu vet day du.
-- Chay SAU 027, 1 lan duy nhat.
-- ============================================================

-- ---------- A) ANH DON BAN ----------
insert into storage.buckets (id, name, public)
values ('don-ban', 'don-ban', true)
on conflict (id) do update set public = true;

drop policy if exists "upload_don_ban" on storage.objects;
create policy "upload_don_ban" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'don-ban');

drop policy if exists "read_don_ban" on storage.objects;
create policy "read_don_ban" on storage.objects
  for select to public
  using (bucket_id = 'don-ban');

drop policy if exists "delete_don_ban" on storage.objects;
create policy "delete_don_ban" on storage.objects
  for delete to authenticated
  using (bucket_id = 'don-ban');

alter table public.sales_orders add column if not exists photos jsonb not null default '[]'::jsonb;

-- Gan danh sach anh vao don + bao Discord kem anh
create or replace function public.fn_gan_anh_don(p_code text, p_photos jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record; v_embeds jsonb := '[]'::jsonb; r jsonb; v_n int := 0; v_xe text;
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  select * into o from public.sales_orders where code = p_code for update;
  if o is null then raise exception 'KHONG_TIM_THAY: đơn % không tồn tại', p_code; end if;
  if me.role = 'SALES' and o.seller_id <> me.uid then
    raise exception 'KHONG_CO_QUYEN: chỉ được gắn ảnh vào đơn của mình';
  end if;

  update public.sales_orders set photos = coalesce(p_photos, '[]'::jsonb) where code = p_code;

  -- Discord: toi da 4 anh dang embed
  for r in select jsonb_array_elements(coalesce(p_photos,'[]'::jsonb)) loop
    exit when v_n >= 4;
    v_embeds := v_embeds || jsonb_build_object('image', jsonb_build_object('url', r->>'url'));
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    select coalesce(brand||' '||name||' '||color, o.vehicle_id) into v_xe from public.vehicles where id = o.vehicle_id;
    perform public._notify_discord(jsonb_build_object(
      'content', '📷 **Ảnh đính kèm đơn '||p_code||'** · '||coalesce(v_xe,'')||' · SK '||o.frame_number||' · KH '||o.customer_name||' · '||me.name||
                 case when jsonb_array_length(p_photos) > 4 then ' ('||jsonb_array_length(p_photos)||' ảnh, hiển thị 4)' else '' end,
      'embeds', v_embeds
    ));
  end if;
end $$;

-- ---------- B) XOA DON (chi BGD) ----------
create or replace function public.fn_xoa_don(p_id bigint, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record; u record; v_before int; v_xe text;
begin
  select * into me from public.fn_me();
  if me.role <> 'CEO' then raise exception 'KHONG_CO_QUYEN: chỉ Ban giám đốc được xóa đơn bán'; end if;
  if coalesce(trim(p_ly_do),'') = '' then raise exception 'THIEU_THONG_TIN: phải nhập lý do xóa đơn'; end if;
  select * into o from public.sales_orders where id = p_id for update;
  if o is null then raise exception 'KHONG_TIM_THAY: đơn không tồn tại'; end if;

  -- Hoan xe ve ton kho (neu chiec nay van dang gan voi don nay)
  select * into u from public.vehicle_units where frame_number = o.frame_number for update;
  if u is not null and u.sale_code = o.code and u.status = 'DA_BAN' then
    v_before := public._count_at(o.vehicle_id, u.location_code);
    update public.vehicle_units set status = 'TON_KHO', sale_code = null, updated_at = now()
    where frame_number = o.frame_number;
    perform public._log_txn('Hủy đơn bán', o.vehicle_id, null, u.location_code, 1, v_before, v_before + 1,
      o.code, 'BGĐ '||me.name||' xóa đơn '||o.code||' — lý do: '||trim(p_ly_do)||' · xe '||o.frame_number||' hoàn về kho', me.uid, me.name);
  else
    perform public._log_txn('Hủy đơn bán', o.vehicle_id, null, null, 0, 0, 0,
      o.code, 'BGĐ '||me.name||' xóa đơn '||o.code||' — lý do: '||trim(p_ly_do)||' · xe '||o.frame_number||' KHÔNG hoàn kho (đã bán lại/không còn)', me.uid, me.name);
  end if;

  delete from public.sale_adjust_requests where sale_code = o.code;
  delete from public.sale_items where sale_code = o.code;
  delete from public.sales_orders where id = p_id;
end $$;
