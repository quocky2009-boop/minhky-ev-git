-- =====================================================================
-- 132_khuyen_mai_co_gia_tri_va_bang_gia.sql
-- Giai doan 1/2 cua nang cap "Tao don ban 4 buoc + Bang gia".
-- CHI THEM MOI (additive): khong doi hanh vi don cu, khong sua view/ham tai chinh.
--   (1) promotions: them gia tri uu dai (tien / %), loai uu dai, co so tinh %, thu tu, co khong cong don
--   (2) sale_order_promotions: luu SNAPSHOT so tien da ap tai thoi diem tao don
--   (3) sales_orders: promo_amount (tien KM tru vao gia thanh toan), invoice_total, price_snapshot
--   (4) fn_luu_khuyen_mai: nhan them cac truong moi (giu nguyen battery_options hien co)
--   (5) fn_tinh_bang_gia(p jsonb): TINH BANG GIA o server (nguon su that duy nhat) - chi doc
--
-- QUYET DINH NGHIEP VU DA CHOT VOI ANH KY:
--   * 3 loai uu dai:
--       GIAM_GIA          -> tru ca "Gia can thanh toan" lan "Tong tien xuat HD"
--       QUY_DOI_TIEN_MAT  -> chi tru "Gia can thanh toan", HD giu nguyen
--       HO_TRO_SAU_BAN    -> khong tru tien (qua tang / dich vu)
--   * Thu tu ap dung: theo promotions.apply_order tang dan (nho = ap truoc), hoa thi theo id.
--   * % co 2 co so: 'list' (nhan gia niem yet) | 'after_other' (nhan gia niem yet da tru
--     cac KM tru tien DUNG TRUOC no theo apply_order).
--   * no_stack = true: CT nay chi duoc chon MOT MINH (chon kem CT khac -> bao loi).
--
-- AN TOAN: moi cot moi deu co default; CT cu mac dinh value=0 -> ap 0 dong, khong anh huong gi
-- cho den khi Admin/CEO nhap gia tri. Chu ky fn_luu_khuyen_mai(jsonb) KHONG doi -> khong
-- can DROP FUNCTION. fn_tinh_bang_gia la ham MOI.
-- Chay lai nhieu lan van an toan.
--
-- (Doi so tu 128 -> 132 vi 128/129/130/131 da dung cho cac migration khac trong du an.
-- Noi dung logic giu nguyen 100% so voi file goc.)
-- =====================================================================

-- ---------- (1) promotions ----------
alter table public.promotions
  add column if not exists kind          text    not null default 'GIAM_GIA',
  add column if not exists value_type    text    not null default 'amount',
  add column if not exists value         numeric not null default 0,
  add column if not exists percent_base  text    not null default 'list',
  add column if not exists apply_order   int     not null default 100,
  add column if not exists no_stack      boolean not null default false;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'promotions_kind_chk') then
    alter table public.promotions add constraint promotions_kind_chk
      check (kind in ('GIAM_GIA','QUY_DOI_TIEN_MAT','HO_TRO_SAU_BAN'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'promotions_value_type_chk') then
    alter table public.promotions add constraint promotions_value_type_chk
      check (value_type in ('amount','percent'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'promotions_percent_base_chk') then
    alter table public.promotions add constraint promotions_percent_base_chk
      check (percent_base in ('list','after_other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'promotions_value_chk') then
    alter table public.promotions add constraint promotions_value_chk
      check (value >= 0 and (value_type <> 'percent' or value <= 100));
  end if;
end $$;

-- ---------- (2) sale_order_promotions: snapshot ----------
alter table public.sale_order_promotions
  add column if not exists kind           text,
  add column if not exists amount_applied bigint not null default 0,
  add column if not exists value_type     text,
  add column if not exists value          numeric;

-- ---------- (3) sales_orders ----------
-- promo_amount : tong tien KM tru vao gia thanh toan (GIAM_GIA + QUY_DOI_TIEN_MAT)
-- invoice_total: tong tien xuat hoa don (chi tru GIAM_GIA); null = don cu
-- price_snapshot: nguyen bang gia luc tao don (de doi chieu, khong tinh lai)
alter table public.sales_orders
  add column if not exists promo_amount   bigint not null default 0,
  add column if not exists invoice_total  bigint,
  add column if not exists price_snapshot jsonb;

-- ---------- (4) fn_luu_khuyen_mai: them truong moi (giu battery_options) ----------
create or replace function public.fn_luu_khuyen_mai(p jsonb)
 returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare me record; v_id bigint; v_code text;
  v_kind text; v_vt text; v_val numeric; v_base text; v_ord int; v_ns boolean;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được quản lý chương trình khuyến mại'; end if;
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'THIEU_THONG_TIN: nhập tên chương trình'; end if;
  if coalesce(trim(p->>'brand'),'') = '' then raise exception 'THIEU_THONG_TIN: chọn hãng áp dụng'; end if;
  if nullif(p->>'start_date','') is null or nullif(p->>'end_date','') is null then
    raise exception 'THIEU_THONG_TIN: nhập đủ thời hạn chương trình';
  end if;

  v_kind := coalesce(nullif(p->>'kind',''), 'GIAM_GIA');
  v_vt   := coalesce(nullif(p->>'value_type',''), 'amount');
  v_val  := coalesce(nullif(p->>'value','')::numeric, 0);
  v_base := coalesce(nullif(p->>'percent_base',''), 'list');
  v_ord  := coalesce(nullif(p->>'apply_order','')::int, 100);
  v_ns   := coalesce((p->>'no_stack')::boolean, false);
  if v_kind not in ('GIAM_GIA','QUY_DOI_TIEN_MAT','HO_TRO_SAU_BAN') then
    raise exception 'THIEU_THONG_TIN: loại ưu đãi không hợp lệ';
  end if;
  if v_vt not in ('amount','percent') then raise exception 'THIEU_THONG_TIN: kiểu giá trị không hợp lệ'; end if;
  if v_base not in ('list','after_other') then raise exception 'THIEU_THONG_TIN: cơ sở tính %% không hợp lệ'; end if;
  if v_val < 0 or (v_vt = 'percent' and v_val > 100) then
    raise exception 'THIEU_THONG_TIN: giá trị ưu đãi không hợp lệ (số tiền >= 0; phần trăm 0-100)';
  end if;

  v_id := nullif(p->>'id','')::bigint;
  if v_id is null then
    v_code := nullif(trim(p->>'code'),'');
    if v_code is null then v_code := public.fn_gen_code('KM'); end if;
    insert into public.promotions (code, name, brand, vehicle_names, start_date, end_date, note, status, battery_options,
      kind, value_type, value, percent_base, apply_order, no_stack, created_by, created_by_name)
    values (v_code, trim(p->>'name'), trim(p->>'brand'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'vehicle_names','[]'::jsonb)) x), '{}'),
      (p->>'start_date')::date, (p->>'end_date')::date, coalesce(p->>'note',''),
      coalesce(nullif(p->>'status',''), 'Đang áp dụng'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'battery_options','[]'::jsonb)) x), '{}'),
      v_kind, v_vt, v_val, v_base, v_ord, v_ns, me.uid, me.name)
    returning id into v_id;
  else
    update public.promotions set
      name = trim(p->>'name'), brand = trim(p->>'brand'),
      vehicle_names = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'vehicle_names','[]'::jsonb)) x), '{}'),
      start_date = (p->>'start_date')::date, end_date = (p->>'end_date')::date,
      note = coalesce(p->>'note',''), status = coalesce(nullif(p->>'status',''), status),
      battery_options = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'battery_options','[]'::jsonb)) x), '{}'),
      kind = v_kind, value_type = v_vt, value = v_val, percent_base = v_base, apply_order = v_ord, no_stack = v_ns,
      updated_at = now()
    where id = v_id;
    if not found then raise exception 'KHONG_TIM_THAY: chương trình không tồn tại'; end if;
  end if;
  return v_id;
end $function$;

-- ---------- (5) fn_tinh_bang_gia: nguon su that cua "Bang gia" ----------
-- INPUT p:
--   gia_xe         bigint  (bat buoc) gia niem yet
--   promotion_ids  bigint[] (mang JSON) cac CT duoc tick
--   so_tien_coc    bigint  (tuy chon) so tien KH da dat coc
--   ngay_lay_gia   date    (tuy chon, mac dinh hom nay) - CT phai con han vao ngay nay
--   vehicle_name   text    (tuy chon) kiem tra CT co ap dung cho model nay khong
--   battery_option text    (tuy chon) kiem tra theo hinh thuc kinh doanh pin
-- OUTPUT: jsonb {gia_xe, khuyen_mai:[{id,code,name,kind,amount,...}], tong_giam_hoa_don,
--   tong_quy_doi, tong_uu_dai, gia_can_thanh_toan, tong_xuat_hd, so_tien_coc, con_lai}
create or replace function public.fn_tinh_bang_gia(p jsonb)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare me record; v_gia bigint; v_coc bigint; v_ngay date; v_vname text; v_bat text;
  r record; v_ids bigint[]; v_n int; v_ded_all bigint := 0; v_ded_hd bigint := 0;
  v_base bigint; v_amt bigint; v_room bigint; v_out jsonb := '[]'::jsonb;
  v_giam bigint := 0; v_qd bigint := 0; v_ht int := 0;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;

  v_gia := coalesce(nullif(p->>'gia_xe','')::bigint, 0);
  if v_gia <= 0 then raise exception 'THIEU_THONG_TIN: chưa có giá xe niêm yết'; end if;
  v_coc  := greatest(coalesce(nullif(p->>'so_tien_coc','')::bigint, 0), 0);
  v_ngay := coalesce(nullif(p->>'ngay_lay_gia','')::date, current_date);
  v_vname := nullif(p->>'vehicle_name','');
  v_bat   := nullif(p->>'battery_option','');

  select array_agg(distinct x::bigint) into v_ids
  from jsonb_array_elements_text(coalesce(p->'promotion_ids','[]'::jsonb)) x;
  v_ids := coalesce(v_ids, '{}');
  v_n := coalesce(array_length(v_ids,1), 0);

  if v_n <> (select count(*) from public.promotions where id = any(v_ids)) then
    raise exception 'KHONG_TIM_THAY: có chương trình khuyến mại không tồn tại';
  end if;

  -- Kiem tra han / trang thai / model / pin / khong cong don
  for r in select * from public.promotions where id = any(v_ids) loop
    if r.status <> 'Đang áp dụng' or v_ngay < r.start_date or v_ngay > r.end_date then
      raise exception 'KM_HET_HAN: chương trình "%" không còn áp dụng vào ngày %', r.name, v_ngay;
    end if;
    if v_vname is not null and coalesce(array_length(r.vehicle_names,1),0) > 0
       and not (v_vname = any(r.vehicle_names)) then
      raise exception 'KM_SAI_MODEL: chương trình "%" không áp dụng cho xe %', r.name, v_vname;
    end if;
    if v_bat is not null and coalesce(array_length(r.battery_options,1),0) > 0
       and not (v_bat = any(r.battery_options)) then
      raise exception 'KM_SAI_PIN: chương trình "%" không áp dụng cho hình thức pin %', r.name, v_bat;
    end if;
    if r.no_stack and v_n > 1 then
      raise exception 'KM_KHONG_CONG_DON: chương trình "%" không được dùng chung với chương trình khác', r.name;
    end if;
  end loop;

  -- Ap dung theo thu tu uu tien cau hinh
  for r in select * from public.promotions where id = any(v_ids) order by apply_order, id loop
    v_amt := 0;
    if r.kind <> 'HO_TRO_SAU_BAN' then
      v_base := case when r.value_type = 'percent' and r.percent_base = 'after_other'
                     then v_gia - v_ded_all else v_gia end;
      v_amt := case when r.value_type = 'percent' then round(greatest(v_base,0) * r.value / 100.0)::bigint
                    else r.value::bigint end;
      v_room := greatest(v_gia - v_ded_all, 0);       -- khong cho am tien
      v_amt := least(v_amt, v_room);
      v_ded_all := v_ded_all + v_amt;
      if r.kind = 'GIAM_GIA' then v_ded_hd := v_ded_hd + v_amt; v_giam := v_giam + v_amt;
      else v_qd := v_qd + v_amt; end if;
    else
      v_ht := v_ht + 1;
    end if;
    v_out := v_out || jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name, 'kind', r.kind,
      'value_type', r.value_type, 'value', r.value, 'percent_base', r.percent_base,
      'apply_order', r.apply_order, 'amount', v_amt);
  end loop;

  return jsonb_build_object(
    'gia_xe', v_gia,
    'khuyen_mai', v_out,
    'tong_giam_hoa_don', v_giam,
    'tong_quy_doi', v_qd,
    'tong_uu_dai', v_ded_all,
    'so_ho_tro_sau_ban', v_ht,
    'gia_can_thanh_toan', v_gia - v_ded_all,
    'tong_xuat_hd', v_gia - v_ded_hd,
    'so_tien_coc', v_coc,
    'con_lai', greatest(v_gia - v_ded_all - v_coc, 0));
end $function$;

-- ---------- Goi y backfill gia tri cho CT cu (CHI DOC, anh duyet roi moi chay UPDATE) ----------
-- Ten CT cu co ghi san gia tri (vi du "-25%", "-2tr", "-600k"). Cau lenh duoi chi DE XUAT:
--   select id, code, name,
--     case when name ~* '-\s*\d+(\.\d+)?\s*%' then 'percent'
--          when name ~* '-\s*\d+(\.\d+)?\s*(tr|k)\b' then 'amount' end as goi_y_kieu,
--     (regexp_match(name, '-\s*(\d+(?:\.\d+)?)\s*(%|tr|k)\M', 'i')) as goi_y_so_va_don_vi
--   from public.promotions where status = 'Đang áp dụng' order by id;
-- Sau do Admin nhap/duyet tung CT qua man hinh Khuyen mai (khong tu dong UPDATE hang loat).

-- ---------- XAC MINH (chi doc) ----------
-- select oid::regprocedure from pg_proc where proname in ('fn_luu_khuyen_mai','fn_tinh_bang_gia');  -- moi ham dung 1 dong
-- select fn_tinh_bang_gia('{"gia_xe":12000000,"promotion_ids":[]}'::jsonb);  -- phai ra gia_can_thanh_toan = tong_xuat_hd = 12000000
