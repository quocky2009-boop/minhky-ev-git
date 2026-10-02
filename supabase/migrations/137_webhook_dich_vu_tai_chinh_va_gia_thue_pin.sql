-- =====================================================================
-- 137 (da ap dung len DB qua MCP)
-- 1) vehicles.list_price_thue_pin: gia niem yet "Thue pin" cho xe model_pin = 'Xe doi pin'
--    (list_price = gia "Kem pin"). fn_set_gia_thue_pin(p_id, p_gia) - quyen sua_danh_muc.
-- 2) Webhook rieng cho Dich vu / Tai chinh:
--      app_settings.discord_webhook_dichvu (moi), discord_webhook_thuchi (co san)
--      _notify_discord_kenh(p_kenh 'dich_vu'|'tai_chinh', payload) - KHONG fallback sang kenh chung.
--    Cac ham fn_dv_eod_chot/giao_xe/hoan_tat/tao_phieu/thu_tien da doi sang kenh 'dich_vu';
--    fn_dao_nguoc_khoan_thu/fn_doi_soat_chot/fn_bao_cao_quy_now sang 'tai_chinh'
--    (thay public._notify_discord( bang public._notify_discord_kenh('<kenh>', ).
--    fn_test_discord_dichvu(): gui thu kenh Dich vu.
-- =====================================================================
alter table public.vehicles add column if not exists list_price_thue_pin bigint;

create or replace function public.fn_set_gia_thue_pin(p_id text, p_gia bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('sua_danh_muc') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền sửa danh mục xe'; end if;
  update public.vehicles set list_price_thue_pin = nullif(p_gia, 0) where id = p_id;
end $$;

insert into public.app_settings(key, value) values ('discord_webhook_dichvu', '') on conflict do nothing;

create or replace function public._notify_discord_kenh(p_kenh text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_url text;
begin
  select value into v_url from public.app_settings
  where key = case p_kenh when 'dich_vu' then 'discord_webhook_dichvu' when 'tai_chinh' then 'discord_webhook_thuchi' else 'discord_webhook' end;
  if coalesce(v_url,'') = '' then return; end if;
  perform net.http_post(url := replace(v_url, 'discordapp.com', 'discord.com'), body := p_payload,
    headers := '{"Content-Type": "application/json"}'::jsonb);
exception when others then
  null;
end $$;

create or replace function public.fn_test_discord_dichvu()
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_url text;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  select value into v_url from public.app_settings where key = 'discord_webhook_dichvu';
  if coalesce(v_url,'') = '' then raise exception 'THIEU_THONG_TIN: chưa lưu webhook kênh Dịch vụ'; end if;
  perform public._notify_discord_kenh('dich_vu', jsonb_build_object('username', 'Minh Kỳ EV · Dịch vụ',
    'content', '✅ Kết nối thành công! Kênh này sẽ nhận thông báo module Dịch vụ: tiếp nhận, thu tiền, hoàn tất, giao xe, chốt công nợ cuối ngày. (Gửi thử bởi ' || me.name || ')'));
end $$;
