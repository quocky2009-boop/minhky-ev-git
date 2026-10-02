-- =====================================================================
-- 135a_discord_don_ban_helpers.sql
-- Thong bao Discord CHI TIET cho don ban (Wizard + form Ban buon).
-- Gui toi webhook rieng app_settings.discord_webhook_don_ban (channel don ban);
-- KHONG co fallback sang kenh ton kho de khong lan tin. Chua cau hinh = bo qua.
-- Moi ham deu nuot loi: thong bao khong bao gio duoc lam hong giao dich.
-- =====================================================================
insert into public.app_settings(key, value) values ('discord_webhook_don_ban', '') on conflict do nothing;

create or replace function public._vnd(n numeric)
returns text language sql immutable as $$
  select case when n is null then '—'
    else replace(to_char(round(n), 'FM999,999,999,999,999'), ',', '.') || 'đ' end
$$;

create or replace function public._don_discord_send(p_embeds jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_url text;
begin
  select value into v_url from public.app_settings where key = 'discord_webhook_don_ban';
  if coalesce(v_url,'') = '' then return; end if;
  v_url := replace(v_url, 'discordapp.com', 'discord.com');
  perform net.http_post(url := v_url,
    body := jsonb_build_object('username', 'Minh Kỳ EV · Đơn bán', 'embeds', p_embeds),
    headers := jsonb_build_object('Content-Type', 'application/json'));
exception when others then
  null;
end $$;

-- Noi dung chi tiet 1 don: khach, xe, khuyen mai, bang gia, thanh toan (dang bang trong code block)
create or replace function public._don_discord_body(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare
  o record; v record; ex jsonb; s jsonb; k jsonb; pr record;
  v_hd text; v_loc text; v_items bigint; v_ck bigint; v_tong bigint; v_paid bigint;
  v_km text := ''; v_gia text := ''; v_pay text := ''; v_hinh text := 'Trả thẳng'; v_cty text;
begin
  select * into o from public.sales_orders where code = p_code;
  if o is null then return ''; end if;
  select brand, name, color into v from public.vehicles where id = o.vehicle_id;
  select name into v_loc from public.locations where code = o.location_code;
  ex := coalesce(o.extra, '{}'::jsonb);
  s := o.price_snapshot;
  v_hd := concat_ws(', ', nullif(ex->>'hd_dia_chi',''), nullif(ex->>'hd_phuong_xa',''), nullif(ex->>'hd_tinh_tp',''));
  if coalesce(v_hd,'') = '' then v_hd := coalesce(nullif(o.customer_address,''), '(chưa có)'); end if;

  select coalesce(sum(amount),0) into v_items from public.sale_items where sale_code = o.code;
  v_ck := case when o.vehicle_discount_type = 'percent'
    then round(o.sale_price * o.quantity * coalesce(o.vehicle_discount_value,0) / 100.0)
    else coalesce(o.vehicle_discount_value,0) end;
  v_tong := greatest(o.sale_price * o.quantity - v_ck + v_items - coalesce(o.discount_amount,0), 0);
  v_paid := coalesce(o.paid_amount, 0);

  -- Khuyen mai + bang gia
  if s is not null and jsonb_typeof(s) = 'object' then
    for k in select jsonb_array_elements(coalesce(s->'khuyen_mai','[]'::jsonb)) loop
      v_km := v_km || '• ' || (k->>'name') || E'\n';
      v_gia := v_gia || rpad(' - ' || left(k->>'name', 26), 31) || ': ' ||
        case when (k->>'amount')::numeric > 0 then '-' || public._vnd((k->>'amount')::numeric) else '—' end || E'\n';
    end loop;
    if v_km = '' then v_km := 'Không áp dụng' || E'\n'; end if;
    v_gia := rpad('Giá niêm yết', 31) || ': ' || public._vnd((s->>'gia_xe')::numeric) || E'\n' || v_gia ||
      rpad('Tổng ưu đãi', 31) || ': -' || public._vnd((s->>'tong_uu_dai')::numeric) || E'\n' ||
      rpad('Giá cần thanh toán', 31) || ': ' || public._vnd((s->>'gia_can_thanh_toan')::numeric) || E'\n' ||
      rpad('Tổng tiền xuất HĐ', 31) || ': ' || public._vnd(coalesce(o.invoice_total, (s->>'tong_xuat_hd')::numeric)) || E'\n';
  else
    for pr in select p.name from public.sale_order_promotions sop join public.promotions p on p.id = sop.promotion_id
              where sop.sale_code = o.code loop
      v_km := v_km || '• ' || pr.name || E'\n';
    end loop;
    if v_km = '' then v_km := 'Không áp dụng' || E'\n'; end if;
    v_gia := rpad('Giá bán', 14) || ': ' || public._vnd(o.sale_price * o.quantity) || E'\n' ||
      case when v_ck > 0 then rpad('Chiết khấu xe', 14) || ': -' || public._vnd(v_ck) || E'\n' else '' end ||
      case when v_items > 0 then rpad('Bán kèm', 14) || ': ' || public._vnd(v_items) || E'\n' else '' end ||
      case when coalesce(o.discount_amount,0) > 0 then rpad('CK tổng đơn', 14) || ': -' || public._vnd(o.discount_amount) || E'\n' else '' end ||
      rpad('Tổng đơn', 14) || ': ' || public._vnd(v_tong) || E'\n';
  end if;

  -- Thanh toan
  for pr in select method, amount, status from public.sale_payments
            where sale_code = o.code and not is_reversed order by id loop
    v_pay := v_pay || ' · ' || rpad(pr.method, 12) || ': ' || public._vnd(pr.amount) ||
      case when pr.status <> 'Đã thu' then ' (' || pr.status || ')' else '' end || E'\n';
    if pr.method = 'Trả góp' then v_hinh := 'Trả góp'; end if;
  end loop;
  v_cty := nullif(ex->>'tra_gop_cong_ty','');
  if v_hinh = 'Trả góp' then
    v_hinh := 'Trả góp' || coalesce(' qua ' || v_cty, '');
    if nullif(ex->>'tra_gop_so_tien','') is not null then
      v_pay := rpad('Số tiền trả góp', 15) || ': ' || public._vnd((ex->>'tra_gop_so_tien')::numeric) || E'\n' || v_pay;
    end if;
  end if;

  return
    '**👤 Khách hàng**' || E'\n```\n' ||
      rpad('Họ tên', 11) || ': ' || coalesce(nullif(o.customer_name,''),'—') || E'\n' ||
      rpad('Điện thoại', 11) || ': ' || coalesce(nullif(o.customer_phone,''),'—') || E'\n' ||
      rpad('Địa chỉ HĐ', 11) || ': ' || v_hd || E'\n```\n' ||
    '**🛵 Thông tin xe**' || E'\n```\n' ||
      rpad('Hãng xe', 11) || ': ' || coalesce(v.brand,'—') || E'\n' ||
      rpad('Dòng xe', 11) || ': ' || coalesce(v.name,'—') || E'\n' ||
      rpad('Màu xe', 11) || ': ' || coalesce(v.color,'—') || E'\n' ||
      rpad('Số khung', 11) || ': ' || coalesce(nullif(o.frame_number,''),'—') || E'\n' ||
      case when o.battery_option is not null then rpad('Pin', 11) || ': ' || o.battery_option || E'\n' else '' end ||
      rpad('Điểm bán', 11) || ': ' || coalesce(v_loc, o.location_code) || E'\n' ||
      rpad('NV bán', 11) || ': ' || coalesce(nullif(o.seller_name,''),'—') || E'\n```\n' ||
    '**🏷 Chương trình khuyến mại**' || E'\n```\n' || v_km || E'```\n' ||
    '**💰 Bảng giá**' || E'\n```\n' || v_gia || E'```\n' ||
    '**💳 Thanh toán**' || E'\n```\n' ||
      rpad('Hình thức', 15) || ': ' || v_hinh || E'\n' || v_pay ||
      rpad('Đã cọc trước', 15) || ': ' || public._vnd(coalesce(o.coc_applied,0)) || E'\n' ||
      rpad('Đã thu', 15) || ': ' || public._vnd(v_paid) || E'\n' ||
      rpad('Còn lại', 15) || ': ' || public._vnd(greatest(v_tong - v_paid, 0)) || E'\n```';
exception when others then
  return 'Không dựng được chi tiết đơn ' || coalesce(p_code,'');
end $$;

create or replace function public._don_discord_embed(p_code text, p_title text, p_color int, p_prefix text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'title', left(p_title, 250),
    'color', p_color,
    'description', left(coalesce(p_prefix,'') || public._don_discord_body(p_code), 4000),
    'footer', jsonb_build_object('text', 'Mã đơn ' || p_code),
    'timestamp', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end $$;
