-- ============================================================
-- Migration 008: Thong bao Discord khi ton kho thay doi.
-- Dung pg_net (co san tren Supabase) - gui bat dong bo, khong
-- lam cham hay chan giao dich khi Discord loi.
-- Chay SAU 007, 1 lan duy nhat.
-- ============================================================

create extension if not exists pg_net;

insert into public.app_settings(key, value) values ('discord_webhook', '') on conflict do nothing;

-- Ham gui payload toi Discord (bo qua neu chua cau hinh webhook)
create or replace function public._notify_discord(p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_url text;
begin
  select value into v_url from public.app_settings where key = 'discord_webhook';
  if coalesce(v_url,'') = '' then return; end if;
  perform net.http_post(
    url := v_url,
    body := p_payload,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
exception when others then
  null;  -- khong bao gio de loi thong bao lam hong giao dich
end $$;

-- Trigger: moi dong lich su ton kho -> 1 thong bao Discord
create or replace function public._trg_txn_discord()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_vehicle text; v_from text; v_to text; v_color int; v_kho text;
begin
  select coalesce(brand||' '||name||' · '||color, new.vehicle_id) into v_vehicle
    from public.vehicles where id = new.vehicle_id;
  if new.from_location is not null then
    select name into v_from from public.locations where code = new.from_location;
  end if;
  if new.to_location is not null then
    select name into v_to from public.locations where code = new.to_location;
  end if;
  v_kho := case
    when v_from is not null and v_to is not null then v_from||' → '||v_to
    else coalesce(v_from, v_to, '—') end;
  v_color := case new.txn_type
    when 'Nhập hàng' then 1219937      -- xanh la
    when 'Bán hàng' then 1920952       -- xanh duong
    when 'Điều chuyển' then 7027896    -- tim
    when 'Điều chỉnh' then 14253568    -- cam
    else 9013641 end;                   -- xam (Kiem ke)

  perform public._notify_discord(jsonb_build_object(
    'username', 'Minh Kỳ EV',
    'embeds', jsonb_build_array(jsonb_build_object(
      'title', case when new.qty > 0 then '🟢 ' else '🔴 ' end || new.txn_type
               || ' · ' || (case when new.qty > 0 then '+' else '' end) || new.qty || ' xe',
      'color', v_color,
      'fields', jsonb_build_array(
        jsonb_build_object('name', 'Xe',            'value', coalesce(v_vehicle,'—'),                     'inline', true),
        jsonb_build_object('name', 'Kho',           'value', v_kho,                                        'inline', true),
        jsonb_build_object('name', 'Tồn trước → sau','value', new.stock_before || ' → **' || new.stock_after || '**', 'inline', true),
        jsonb_build_object('name', 'Người thực hiện','value', coalesce(nullif(new.created_by_name,''),'Hệ thống'),   'inline', true),
        jsonb_build_object('name', 'Số phiếu',      'value', coalesce(nullif(new.doc_code,''),'—'),        'inline', true),
        jsonb_build_object('name', 'Ghi chú',       'value', coalesce(nullif(new.note,''),'—'),            'inline', false)
      ),
      'timestamp', to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ))
  ));
  return null;
end $$;

drop trigger if exists trg_txn_discord on public.inventory_txns;
create trigger trg_txn_discord after insert on public.inventory_txns
for each row execute procedure public._trg_txn_discord();

-- Nut "Gui thu" trong Cai dat
create or replace function public.fn_test_discord()
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_url text;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  select value into v_url from public.app_settings where key = 'discord_webhook';
  if coalesce(v_url,'') = '' then raise exception 'THIEU_THONG_TIN: chưa lưu webhook URL'; end if;
  perform public._notify_discord(jsonb_build_object(
    'username', 'Minh Kỳ EV',
    'content', '✅ Kết nối thành công! Kênh này sẽ nhận thông báo mọi biến động tồn kho: nhập hàng, bán hàng, điều chuyển, điều chỉnh, kiểm kê. (Gửi thử bởi ' || me.name || ')'
  ));
end $$;
