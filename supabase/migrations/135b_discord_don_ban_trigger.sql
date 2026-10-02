-- =====================================================================
-- 135b_discord_don_ban_trigger.sql
-- Luong Discord don ban: gan vao TRIGGER tren sales_orders / sale_order_promotions
-- nen phu het moi duong (Wizard, form Ban buon, sua don, huy, tra hang, mo lai,
-- bo sung khach le cuoi, doi khuyen mai) ma khong phai sua cac ham nghiep vu lon.
--   * Tao don : constraint trigger DEFERRED (chay luc COMMIT, da co du thanh toan/ban kem);
--               gom theo lo (batch_code) -> 1 tin cho don buon nhieu xe.
--   * Sua don Wizard: fn_sua_don_ban_v2 tu gui tin co before/after, dat co
--               app.skip_don_discord de trigger khong gui trung.
-- Gui toi webhook app_settings.discord_webhook_don_ban (channel don ban, tao webhook
-- trong channel 1529504082837114990 roi dan vao Cai dat). Chua cau hinh = im lang.
-- LUU Y: cac cau lenh nay duoc ap dung tung phan qua MCP (cong cu chan cau lenh co
-- "drop trigger"/"delete from" cho xac nhan) - tren DB moi chay lan luot file nay.
-- =====================================================================

create or replace function public._don_dc_fmt(p_val text, p_fmt text)
returns text language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if p_val is null or p_val = '' then return '—'; end if;
  if p_fmt = 'm' then return public._vnd(p_val::numeric); end if;
  if p_fmt = 'v' then select concat_ws(' ', name, color) into r from public.vehicles where id = p_val; return coalesce(r, p_val); end if;
  if p_fmt = 'l' then select name into r from public.locations where code = p_val; return coalesce(r, p_val); end if;
  return p_val;
end $$;

create or replace function public._don_discord_diff(p_old jsonb, p_new jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare t text := ''; k record; a text; b text;
begin
  for k in select * from (values
    ('customer_name','Họ tên','t'), ('customer_phone','Điện thoại','t'), ('customer_address','Địa chỉ KH','t'),
    ('vehicle_id','Dòng xe','v'), ('frame_number','Số khung','t'), ('location_code','Điểm bán','l'),
    ('sale_price','Giá bán','m'), ('vehicle_discount_value','Chiết khấu xe','m'), ('discount_amount','CK tổng đơn','m'),
    ('promo_amount','Tổng ưu đãi','m'), ('invoice_total','Tổng xuất HĐ','m'),
    ('battery_option','Pin','t'), ('seller_name','NV bán','t'), ('sale_date','Ngày bán','t')
  ) as x(key, label, fmt) loop
    a := p_old->>k.key; b := p_new->>k.key;
    if a is distinct from b then
      t := t || rpad(k.label, 14) || ': ' || public._don_dc_fmt(a, k.fmt) || ' → ' || public._don_dc_fmt(b, k.fmt) || E'\n';
    end if;
  end loop;

  a := concat_ws(', ', nullif(p_old#>>'{extra,hd_dia_chi}',''), nullif(p_old#>>'{extra,hd_phuong_xa}',''), nullif(p_old#>>'{extra,hd_tinh_tp}',''));
  b := concat_ws(', ', nullif(p_new#>>'{extra,hd_dia_chi}',''), nullif(p_new#>>'{extra,hd_phuong_xa}',''), nullif(p_new#>>'{extra,hd_tinh_tp}',''));
  if a is distinct from b then t := t || rpad('Địa chỉ HĐ', 14) || ': ' || coalesce(nullif(a,''),'—') || ' → ' || coalesce(nullif(b,''),'—') || E'\n'; end if;

  select string_agg(x->>'name', ', ') into a from jsonb_array_elements(coalesce(p_old#>'{price_snapshot,khuyen_mai}','[]'::jsonb)) x;
  select string_agg(x->>'name', ', ') into b from jsonb_array_elements(coalesce(p_new#>'{price_snapshot,khuyen_mai}','[]'::jsonb)) x;
  if a is distinct from b then t := t || rpad('Khuyến mại', 14) || ': ' || coalesce(a,'(không)') || ' → ' || coalesce(b,'(không)') || E'\n'; end if;

  a := p_old#>>'{price_snapshot,gia_can_thanh_toan}'; b := p_new#>>'{price_snapshot,gia_can_thanh_toan}';
  if a is distinct from b then t := t || rpad('Giá cần TT', 14) || ': ' || public._don_dc_fmt(a,'m') || ' → ' || public._don_dc_fmt(b,'m') || E'\n'; end if;
  return t;
end $$;

create or replace function public._don_discord_tao_embeds(p_codes text[], p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; o record; r record; lst text := ''; v_pay text := ''; v_tong bigint := 0; v_coc bigint := 0; v_paid bigint := 0;
  v_gia bigint; v_ck bigint; v_hd text; v_hinh text := 'Trả thẳng'; v_batch text; v_cty text; ex jsonb;
begin
  n := coalesce(array_length(p_codes, 1), 0);
  if n = 0 then return '[]'::jsonb; end if;
  if n = 1 then
    return jsonb_build_array(public._don_discord_embed(p_codes[1], '🟢 TẠO ĐƠN BÁN · ' || p_codes[1], 3066993,
      '**Người tạo:** ' || coalesce(p_actor, '—') || E'\n'));
  end if;

  select * into o from public.sales_orders where code = p_codes[1];
  ex := coalesce(o.extra, '{}'::jsonb);
  v_batch := ex->>'batch_code';
  for r in select s.code, s.frame_number, s.sale_price, s.vehicle_discount_type, s.vehicle_discount_value,
             s.coc_applied, s.paid_amount, v.name, v.color, v.brand
           from public.sales_orders s join public.vehicles v on v.id = s.vehicle_id
           where s.code = any(p_codes) order by s.code loop
    v_ck := case when r.vehicle_discount_type = 'percent' then round(r.sale_price * coalesce(r.vehicle_discount_value,0) / 100.0)
                 else coalesce(r.vehicle_discount_value,0) end;
    v_gia := greatest(r.sale_price - v_ck, 0);
    v_tong := v_tong + v_gia; v_coc := v_coc + coalesce(r.coc_applied,0); v_paid := v_paid + coalesce(r.paid_amount,0);
    lst := lst || r.code || E'\n   ' || r.brand || ' ' || r.name || ' · ' || r.color || E'\n   SK ' || r.frame_number || ' · ' || public._vnd(v_gia) || E'\n';
  end loop;
  for r in select method, amount, status from public.sale_payments where sale_code = any(p_codes) and not is_reversed order by id loop
    v_pay := v_pay || ' · ' || rpad(r.method, 12) || ': ' || public._vnd(r.amount) ||
      case when r.status <> 'Đã thu' then ' (' || r.status || ')' else '' end || E'\n';
    if r.method = 'Trả góp' then v_hinh := 'Trả góp'; end if;
  end loop;
  v_cty := nullif(ex->>'tra_gop_cong_ty','');
  if v_hinh = 'Trả góp' then v_hinh := 'Trả góp' || coalesce(' qua ' || v_cty, ''); end if;
  v_hd := coalesce(nullif(o.customer_address,''), '(chưa có)');

  return jsonb_build_array(jsonb_build_object(
    'title', '🟢 TẠO ĐƠN BÁN BUÔN · ' || n || ' xe',
    'color', 3066993,
    'description', left(
      '**Người tạo:** ' || coalesce(p_actor,'—') || E'\n' ||
      '**👤 Khách hàng**' || E'\n```\n' ||
        rpad('Họ tên', 11) || ': ' || coalesce(nullif(o.customer_name,''),'—') || E'\n' ||
        rpad('Điện thoại', 11) || ': ' || coalesce(nullif(o.customer_phone,''),'—') || E'\n' ||
        rpad('Địa chỉ', 11) || ': ' || v_hd || E'\n```\n' ||
      '**🛵 Danh sách xe / đơn (' || n || ')**' || E'\n```\n' || lst || E'```\n' ||
      '**💰 Tổng & thanh toán**' || E'\n```\n' ||
        rpad('Tổng tiền xe', 15) || ': ' || public._vnd(v_tong) || E'\n' ||
        rpad('Hình thức', 15) || ': ' || v_hinh || E'\n' || v_pay ||
        rpad('Đã cọc trước', 15) || ': ' || public._vnd(v_coc) || E'\n' ||
        rpad('Đã thu', 15) || ': ' || public._vnd(v_paid) || E'\n' ||
        rpad('Còn lại', 15) || ': ' || public._vnd(greatest(v_tong - v_paid, 0)) || E'\n```\n' ||
      '_Mỗi xe là 1 đơn riêng — quản lý bổ sung thông tin khách lẻ cuối cho từng đơn._', 4000),
    'footer', jsonb_build_object('text', 'Lô ' || coalesce(v_batch, '—') || ' · ' || p_codes[1] || ' …'),
    'timestamp', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
exception when others then
  return '[]'::jsonb;
end $$;

create or replace function public._trg_don_discord_tao()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_codes text[]; v_batch text; v_actor text;
begin
  v_batch := new.extra->>'batch_code';
  if v_batch is not null then
    select array_agg(code order by code) into v_codes from public.sales_orders where extra->>'batch_code' = v_batch;
    if new.code <> v_codes[1] then return null; end if;
  else
    v_codes := array[new.code];
  end if;
  select name into v_actor from public.fn_me_mkt();
  perform public._don_discord_send(public._don_discord_tao_embeds(v_codes, v_actor));
  return null;
exception when others then
  return null;
end $$;

create constraint trigger trg_don_discord_tao after insert on public.sales_orders
deferrable initially deferred for each row execute function public._trg_don_discord_tao();

create or replace function public._trg_don_discord_sua()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_actor text; v_diff text; v_pre text;
begin
  if current_setting('app.skip_don_discord', true) = '1' then return null; end if;
  if old.created_at = now() then return null; end if;
  select name into v_actor from public.fn_me_mkt();
  v_actor := coalesce(v_actor, 'Hệ thống');

  if new.status is distinct from old.status then
    if new.status = 'Đã hủy' then
      perform public._don_discord_send(jsonb_build_array(public._don_discord_embed(new.code, '🔴 HỦY ĐƠN BÁN · ' || new.code, 15158332,
        '**Lý do:** ' || coalesce(nullif(new.cancel_reason,''),'—') || E'\n**Người hủy:** ' || v_actor || E'\n')));
    elsif new.status = 'Đã trả hàng' then
      perform public._don_discord_send(jsonb_build_array(public._don_discord_embed(new.code, '↩️ HOÀN / TRẢ HÀNG · ' || new.code, 15105570,
        '**Lý do:** ' || coalesce(nullif(new.cancel_reason,''),'—') || E'\n**Người duyệt:** ' || v_actor || E'\n')));
    elsif old.status = 'Đã hủy' then
      perform public._don_discord_send(jsonb_build_array(public._don_discord_embed(new.code, '🔓 MỞ LẠI ĐƠN BÁN · ' || new.code, 3447003,
        '**Người mở lại:** ' || v_actor || E'\n')));
    end if;
    return null;
  end if;

  if new.end_customer_at is distinct from old.end_customer_at and new.end_customer_at is not null then
    v_pre := '**Người cập nhật:** ' || v_actor || E'\n**👥 Khách lẻ cuối (bổ sung)**' || E'\n```\n' ||
      rpad('Họ tên', 12) || ': ' || coalesce(nullif(new.end_customer_name,''),'—') || E'\n' ||
      rpad('Điện thoại', 12) || ': ' || coalesce(nullif(new.end_customer_phone,''),'—') || E'\n' ||
      rpad('Email', 12) || ': ' || coalesce(nullif(new.end_customer_email,''),'—') || E'\n' ||
      rpad('Địa chỉ', 12) || ': ' || coalesce(nullif(new.end_customer_address,''),'—') || E'\n' ||
      rpad('Loại KH', 12) || ': ' || coalesce(nullif(new.end_customer_type,''),'—') || E'\n' ||
      rpad('Số tiền HĐ', 12) || ': ' || public._vnd(new.end_customer_invoice_amount) || E'\n' ||
      rpad('Pin', 12) || ': ' || coalesce(nullif(new.end_customer_battery_option,''),'—') || E'\n```\n**Đơn gốc (khách buôn)**' || E'\n';
    perform public._don_discord_send(jsonb_build_array(public._don_discord_embed(new.code, '👥 BỔ SUNG KHÁCH LẺ CUỐI · ' || new.code, 10181046, v_pre)));
    return null;
  end if;

  v_diff := public._don_discord_diff(to_jsonb(old), to_jsonb(new));
  if v_diff <> '' then
    perform public._don_discord_send(jsonb_build_array(public._don_discord_embed(new.code, '✏️ SỬA ĐƠN BÁN · ' || new.code, 16098851,
      '**Người sửa:** ' || v_actor || E'\n**Thay đổi**\n```\n' || v_diff || E'```\n')));
  end if;
  return null;
exception when others then
  return null;
end $$;

create trigger trg_don_discord_sua after update on public.sales_orders
for each row when (old.* is distinct from new.*) execute function public._trg_don_discord_sua();

create or replace function public._trg_km_don_discord_them()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_actor text;
begin
  if current_setting('app.skip_don_discord', true) = '1' then return null; end if;
  select name into v_actor from public.fn_me_mkt();
  for r in select nt.sale_code, string_agg(p.name, ', ') as ten
           from nt join public.promotions p on p.id = nt.promotion_id
           where nt.kind is null group by nt.sale_code loop
    perform public._don_discord_send(jsonb_build_array(public._don_discord_embed(r.sale_code, '🏷 ĐỔI KHUYẾN MẠI · ' || r.sale_code, 10181046,
      '**Người thực hiện:** ' || coalesce(v_actor,'—') || E'\n**Thêm chương trình:** ' || r.ten || E'\n')));
  end loop;
  return null;
exception when others then
  return null;
end $$;

create trigger trg_km_don_discord_them after insert on public.sale_order_promotions
referencing new table as nt for each statement execute function public._trg_km_don_discord_them();

create or replace function public._trg_km_don_discord_bo()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_actor text;
begin
  if current_setting('app.skip_don_discord', true) = '1' then return null; end if;
  select name into v_actor from public.fn_me_mkt();
  for r in select ot.sale_code, string_agg(p.name, ', ') as ten
           from ot join public.promotions p on p.id = ot.promotion_id
           where ot.kind is null group by ot.sale_code loop
    perform public._don_discord_send(jsonb_build_array(public._don_discord_embed(r.sale_code, '🏷 ĐỔI KHUYẾN MẠI · ' || r.sale_code, 10181046,
      '**Người thực hiện:** ' || coalesce(v_actor,'—') || E'\n**Bỏ chương trình:** ' || r.ten || E'\n')));
  end loop;
  return null;
exception when others then
  return null;
end $$;

create trigger trg_km_don_discord_bo after delete on public.sale_order_promotions
referencing old table as ot for each statement execute function public._trg_km_don_discord_bo();

-- Sua don Wizard: ban co gui Discord (before/after) — thay ban 134
create or replace function public.fn_sua_don_ban_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r jsonb; v_code text; v_snap jsonb; v_ids bigint[]; v_old jsonb; v_new jsonb; v_diff text; v_actor text; v_thu text := ''; pm jsonb;
begin
  v_snap := p->'frames'->0->'price_snapshot';
  if v_snap is null or jsonb_typeof(v_snap) <> 'object' then
    raise exception 'THIEU_THONG_TIN: thiếu Bảng giá (price_snapshot) — hãy bấm Làm mới Bảng giá';
  end if;

  select to_jsonb(o) into v_old from public.sales_orders o where o.id = (p->>'id')::bigint;
  perform set_config('app.skip_don_discord', '1', true);

  r := public.fn_sua_don_ban(p);
  v_code := r->>'code';

  update public.sales_orders set
    promo_amount = coalesce((p->'frames'->0->>'promo_amount')::bigint, 0),
    invoice_total = nullif(p->'frames'->0->>'invoice_total','')::bigint,
    price_snapshot = v_snap
  where code = v_code;

  select coalesce(array_agg((x->>'id')::bigint), '{}') into v_ids
  from jsonb_array_elements(coalesce(v_snap->'khuyen_mai','[]'::jsonb)) x;
  perform public.fn_gan_khuyen_mai_don(v_code, v_ids);

  update public.sale_order_promotions sop set
    kind = x->>'kind', value_type = x->>'value_type',
    value = nullif(x->>'value','')::numeric, amount_applied = coalesce((x->>'amount')::bigint, 0)
  from jsonb_array_elements(coalesce(v_snap->'khuyen_mai','[]'::jsonb)) x
  where sop.sale_code = v_code and sop.promotion_id = (x->>'id')::bigint;

  begin
    select to_jsonb(o) into v_new from public.sales_orders o where o.code = v_code;
    v_diff := public._don_discord_diff(v_old, v_new);
    select name into v_actor from public.fn_me_mkt();
    for pm in select jsonb_array_elements(coalesce(p->'new_payments','[]'::jsonb)) loop
      if coalesce((pm->>'amount')::bigint, 0) > 0 then
        v_thu := v_thu || rpad('Thu thêm', 14) || ': ' || coalesce(pm->>'method','') || ' ' || public._vnd((pm->>'amount')::numeric) || E'\n';
      end if;
    end loop;
    perform public._don_discord_send(jsonb_build_array(public._don_discord_embed(v_code, '✏️ SỬA ĐƠN BÁN · ' || v_code, 16098851,
      '**Người sửa:** ' || coalesce(v_actor,'—') ||
      case when coalesce(trim(p->>'ly_do'),'') <> '' then E'\n**Lý do:** ' || trim(p->>'ly_do') else '' end ||
      E'\n**Thay đổi**\n```\n' || case when v_diff || v_thu = '' then E'(không đổi thông tin chính)\n' else v_diff || v_thu end || E'```\n')));
  exception when others then
    null;
  end;

  return r;
end $function$;

create or replace function public.fn_test_discord_don_ban()
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_url text; v_code text;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  select value into v_url from public.app_settings where key = 'discord_webhook_don_ban';
  if coalesce(v_url,'') = '' then raise exception 'THIEU_THONG_TIN: chưa lưu webhook kênh Đơn bán'; end if;
  select code into v_code from public.sales_orders order by id desc limit 1;
  perform public._don_discord_send(jsonb_build_array(public._don_discord_embed(coalesce(v_code,'—'), '✅ GỬI THỬ · Kênh thông báo Đơn bán', 3066993,
    '**Kết nối thành công!** Kênh này sẽ nhận: tạo đơn, sửa đơn, hủy đơn, hoàn/trả hàng, đổi khuyến mại, bổ sung khách lẻ cuối (Wizard và Bán buôn). Gửi thử bởi ' || me.name || E'. Bên dưới là mẫu chi tiết đơn gần nhất:\n\n')));
end $$;
