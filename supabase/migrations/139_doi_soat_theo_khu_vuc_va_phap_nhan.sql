-- 139 (da ap dung len DB qua MCP)
-- 1) Doi soat cuoi ngay THEO KHU VUC: khoa 'KV:<ten khu vuc>' tong hop moi diem thuoc khu vuc
--    (locations.region); luu o dong cua diem co code nho nhat trong khu vuc + cot khu_vuc.
--    Ham: _ds_resolve(key), fn_doi_soat_tinh(p_loc, p_date), fn_doi_soat_chot(...) (xem pg_get_functiondef).
--    SUA LOI "lech chuyen khoan": tai khoan ngan hang khong gan diem (location_code null) nen truoc day
--    MOI diem deu bi cong TOAN BO chuyen khoan trong ngay cua ca cong ty. Nay gan khoan thu cho diem theo
--    chung tu (ref_doc BH-/COC-/ma phieu DV -> dia diem don/coc/phieu), quy tien mat theo diem cua quy.
--    lech = chung tu thu trong ngay (sale_payments da thu khong tinh tra gop + thu DV + coc + thu khac)
--           - so quy (tien mat + chuyen khoan). Doanh thu ban xe dung _tong_don (da tru chiet khau xe).
-- 2) fn_gan_phap_nhan_hang(p_brand, p_company): gan phap nhan phu trach cho hang xe (CEO/ADMIN).
alter table public.doi_soat_ngay add column if not exists khu_vuc text;

create or replace function public.fn_gan_phap_nhan_hang(p_brand text, p_company bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được gán pháp nhân cho hãng xe'; end if;
  if not exists (select 1 from public.brands where name = p_brand) then raise exception 'KHONG_TIM_THAY: hãng % không tồn tại', p_brand; end if;
  update public.brands set company_id = p_company where name = p_brand;
end $$;

create or replace function public._ds_resolve(p_key text)
returns table(rep text, locs text[], label text)
language plpgsql stable security definer set search_path = public as $$
declare v_region text;
begin
  if p_key like 'KV:%' then
    v_region := substring(p_key from 4);
    select min(l.code), array_agg(l.code), v_region into rep, locs, label
    from public.locations l where l.region = v_region and l.status <> 'Đã xóa';
    if rep is null then raise exception 'KHONG_TIM_THAY: khu vực % chưa có điểm nào', v_region; end if;
  else
    rep := p_key; locs := array[p_key];
    select name into label from public.locations where code = p_key;
    label := coalesce(label, p_key);
  end if;
  return next;
end $$;
-- fn_doi_soat_tinh / fn_doi_soat_chot: ban moi dung _ds_resolve (aggregate theo rs.locs, luu o rs.rep).
