-- ============================================================
-- Migration 030 — MARKETING & KPI: HAM NGHIEP VU + VIEW TINH KPI
-- Moi thay doi trang thai deu qua ham security definer o day
-- (RLS khong mo update cot status) -> khong the gia mao tu client.
-- Chay SAU 029. Chay lai duoc nhieu lan.
-- ============================================================

-- ===================== HELPER =====================

-- pgcrypto: can cho digest() khi bam hash URL
create extension if not exists pgcrypto;

-- fn_me() goc chi tra (uid, role, name) va DANG DUOC ~30 ham khac dung.
-- KHONG dung "drop ... cascade" (se xoa het cac ham do!). Thay vao do
-- tao ham RIENG cho module nay -> khong dung cham gi den kho.
create or replace function public.fn_me_mkt()
returns table (uid uuid, role text, name text, region text)
language sql security definer set search_path = public stable as $$
  select id, role, name, region from public.profiles where id = auth.uid();
$$;


-- Chuan hoa URL (bam sat spec muc XI) — dung chung server-side
create or replace function public._mkt_normalize_url(p_url text)
returns text language plpgsql immutable as $$
declare u text; v_host text; v_path text; v_query text; v_parts text[]; v_keep text[] := '{}'; kv text;
  v_drop text[] := array['utm_source','utm_medium','utm_campaign','utm_content','utm_term',
                         'fbclid','gclid','mc_cid','mc_eid','mibextid','igshid','si','feature'];
begin
  u := btrim(coalesce(p_url,''));
  if u = '' then return null; end if;
  -- 2. them https:// neu thieu giao thuc
  if u !~* '^https?://' then u := 'https://' || u; end if;
  -- 5. bo fragment
  u := split_part(u, '#', 1);
  -- tach host / path / query
  v_host := lower(split_part(split_part(regexp_replace(u, '^https?://', '', 'i'), '?', 1), '/', 1));
  v_path := substring(split_part(regexp_replace(u, '^https?://', '', 'i'), '?', 1) from position('/' in split_part(regexp_replace(u, '^https?://', '', 'i'), '?', 1) || '/'));
  v_query := split_part(u, '?', 2);
  -- 3. host thuong + bo www.
  v_host := regexp_replace(v_host, '^www\.', '');
  -- 4. bo dau / thua cuoi
  v_path := regexp_replace(coalesce(v_path,''), '/+$', '');
  -- 6+7. bo tracking param, sap xep phan con lai
  if coalesce(v_query,'') <> '' then
    v_parts := string_to_array(v_query, '&');
    foreach kv in array v_parts loop
      if kv <> '' and not (lower(split_part(kv, '=', 1)) = any(v_drop)) then
        v_keep := array_append(v_keep, kv);
      end if;
    end loop;
    select array_agg(x order by x) into v_keep from unnest(v_keep) x;
  end if;
  return 'https://' || v_host || v_path ||
         case when coalesce(array_length(v_keep,1),0) > 0 then '?' || array_to_string(v_keep, '&') else '' end;
end $$;

create or replace function public._mkt_hash(p_url text)
returns text language sql immutable as $$
  select case when coalesce(p_url,'') = '' then null
              else encode(digest(p_url, 'sha256'), 'hex') end
$$;

create or replace function public._mkt_log(p_entity text, p_id text, p_action text, p_old jsonb, p_new jsonb, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me_mkt();
  insert into public.mkt_audit_logs (entity_type, entity_id, action, old_data, new_data, note, acted_by, acted_by_name)
  values (p_entity, p_id, p_action, p_old, p_new, coalesce(p_note,''), me.uid, me.name);
end $$;

-- Ky KPI hien tai (C6: tuan Thu2 -> CN)
create or replace function public._mkt_period(p_period text, p_ref date default current_date)
returns table (ky_start date, ky_end date) language sql immutable as $$
  select case p_period
    when 'daily'   then p_ref
    when 'weekly'  then (date_trunc('week', p_ref)::date)
    when 'monthly' then (date_trunc('month', p_ref)::date)
    else p_ref end,
  case p_period
    when 'daily'   then p_ref
    when 'weekly'  then (date_trunc('week', p_ref)::date + 6)
    when 'monthly' then ((date_trunc('month', p_ref) + interval '1 month - 1 day')::date)
    else p_ref end
$$;

-- ===================== 1) BAO CAO: GUI / SUA =====================
create or replace function public.fn_mkt_luu_bao_cao(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_id bigint; v_code text; v_url text; v_norm text; v_hash text;
  v_req record; v_camp record; v_gui boolean; v_dup record; v_status text;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('mkt_bao_cao') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền gửi báo cáo marketing'; end if;

  v_gui := coalesce((p->>'gui')::boolean, false);   -- true = gửi duyệt, false = lưu nháp
  v_id := nullif(p->>'id','')::bigint;
  v_url := nullif(btrim(coalesce(p->>'content_url','')), '');
  v_norm := public._mkt_normalize_url(v_url);
  v_hash := public._mkt_hash(v_norm);

  -- Kiem tra dau muc chien dich (neu co)
  if (p->>'source_type') = 'campaign' then
    select * into v_req from public.mkt_campaign_requirements where id = (p->>'campaign_requirement_id')::bigint;
    if v_req is null then raise exception 'KHONG_TIM_THAY: đầu mục chiến dịch không tồn tại'; end if;
    select * into v_camp from public.mkt_campaigns where id = v_req.campaign_id;
    if v_camp.status <> 'active' then raise exception 'TRANG_THAI_SAI: chiến dịch chưa phát hành hoặc đã kết thúc'; end if;
    if v_gui then
      if v_req.link_required and v_url is null then
        raise exception 'THIEU_THONG_TIN: đầu mục này bắt buộc có link';
      end if;
      if v_req.evidence_required and jsonb_array_length(coalesce(p->'photos','[]'::jsonb)) = 0 then
        raise exception 'THIEU_THONG_TIN: đầu mục này bắt buộc có ảnh chứng minh';
      end if;
      -- Ngay dang phai trong thoi gian chien dich (BGD co quyen ngoai le)
      if (p->>'published_at') is not null
         and ((p->>'published_at')::date < v_camp.start_at or (p->>'published_at')::date > v_camp.end_at)
         and not public.fn_co_quyen('mkt_ngoai_le') then
        raise exception 'NGOAI_THOI_GIAN: ngày đăng phải trong khoảng % → %', v_camp.start_at, v_camp.end_at;
      end if;
    end if;
  end if;

  if v_gui and v_url is null and jsonb_array_length(coalesce(p->'photos','[]'::jsonb)) = 0 then
    raise exception 'THIEU_THONG_TIN: phải có link hoặc ít nhất 1 ảnh chứng minh';
  end if;

  -- CHONG TRUNG LINK (kiem tra som de bao loi de hieu; unique index van la chot chan cuoi)
  if v_hash is not null then
    select s.code, s.user_name into v_dup from public.mkt_submissions s
    where s.normalized_url_hash = v_hash and s.status not in ('rejected','cancelled')
      and s.duplicate_override = false and (v_id is null or s.id <> v_id) limit 1;
    if v_dup.code is not null then
      raise exception 'LINK_TRUNG: Link này đã được sử dụng trong một báo cáo khác (% — %) và không thể tiếp tục tính KPI.', v_dup.code, v_dup.user_name;
    end if;
  end if;

  v_status := case when v_gui then 'submitted' else 'draft' end;

  if v_id is null then
    v_code := public.fn_gen_code('BC');
    insert into public.mkt_submissions (
      code, source_type, kpi_template_id, campaign_id, campaign_requirement_id,
      user_id, user_name, region, platform, content_type, content_url, normalized_url, normalized_url_hash,
      photos, published_at, note, status, submitted_at)
    values (
      v_code, p->>'source_type', nullif(p->>'kpi_template_id','')::bigint,
      nullif(p->>'campaign_id','')::bigint, nullif(p->>'campaign_requirement_id','')::bigint,
      me.uid, me.name, me.region, coalesce(p->>'platform','Khác'), p->>'content_type',
      coalesce(v_url,''), coalesce(v_norm,''), v_hash,
      coalesce(p->'photos','[]'::jsonb), nullif(p->>'published_at','')::date, coalesce(p->>'note',''),
      v_status, case when v_gui then now() else null end);
    perform public._mkt_log('submission', v_code, case when v_gui then 'submit' else 'create_draft' end, null, p, '');
  else
    -- Chi sua duoc phieu cua minh khi draft/needs_revision
    if not exists (select 1 from public.mkt_submissions where id = v_id and user_id = me.uid and status in ('draft','needs_revision')) then
      raise exception 'KHONG_CO_QUYEN: chỉ sửa được báo cáo của mình khi đang ở trạng thái Nháp hoặc Cần bổ sung';
    end if;
    update public.mkt_submissions set
      platform = coalesce(p->>'platform', platform),
      content_url = coalesce(v_url,''), normalized_url = coalesce(v_norm,''), normalized_url_hash = v_hash,
      photos = coalesce(p->'photos', photos),
      published_at = nullif(p->>'published_at','')::date,
      note = coalesce(p->>'note', note),
      status = v_status, submitted_at = case when v_gui then now() else submitted_at end
    where id = v_id
    returning code into v_code;
    perform public._mkt_log('submission', v_code, case when v_gui then 'resubmit' else 'save_draft' end, null, p, '');
  end if;

  return v_code;
end $$;

-- ===================== 2) BAO CAO: DUYET =====================
create or replace function public.fn_mkt_duyet_bao_cao(p_id bigint, p_action text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; s record; v_new text;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('mkt_duyet') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền duyệt báo cáo'; end if;
  select * into s from public.mkt_submissions where id = p_id for update;
  if s is null then raise exception 'KHONG_TIM_THAY'; end if;

  -- MANAGER chi duyet nhan vien trong khu vuc minh
  if me.role = 'MANAGER' and me.region is not null and coalesce(s.region,'') <> me.region then
    raise exception 'KHONG_CO_QUYEN: báo cáo này không thuộc khu vực bạn quản lý';
  end if;
  if s.user_id = me.uid and me.role not in ('ADMIN','CEO') then
    raise exception 'KHONG_CO_QUYEN: không được tự duyệt báo cáo của chính mình';
  end if;

  v_new := case p_action
    when 'approve' then 'approved'
    when 'revise'  then 'needs_revision'
    when 'reject'  then 'rejected'
    when 'recall'  then 'submitted'      -- thu hoi duyet
    else null end;
  if v_new is null then raise exception 'THAM_SO_SAI: action phải là approve/revise/reject/recall'; end if;

  if p_action in ('revise','reject','recall') and coalesce(btrim(p_note),'') = '' then
    raise exception 'THIEU_THONG_TIN: bắt buộc nhập lý do khi %',
      case p_action when 'revise' then 'yêu cầu bổ sung' when 'reject' then 'từ chối' else 'thu hồi duyệt' end;
  end if;
  if p_action = 'recall' then
    if s.status <> 'approved' then raise exception 'TRANG_THAI_SAI: chỉ thu hồi được phiếu đã duyệt'; end if;
    if not public.fn_co_quyen('mkt_xem_toan_cty') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được thu hồi duyệt'; end if;
  elsif s.status not in ('submitted','needs_revision','approved') then
    raise exception 'TRANG_THAI_SAI: phiếu đang ở trạng thái % không duyệt được', s.status;
  end if;

  update public.mkt_submissions set
    status = v_new, reviewed_by = me.uid, reviewed_by_name = me.name, reviewed_at = now(),
    review_note = coalesce(p_note, '')
  where id = p_id;

  perform public._mkt_log('submission', s.code, p_action,
    jsonb_build_object('status', s.status), jsonb_build_object('status', v_new), p_note);

  -- Thu hoi duyet lam mat dieu kien -> go xac nhan hoan thanh cua CHT
  if p_action <> 'approve' and s.campaign_id is not null then
    update public.mkt_campaign_targets
      set manager_confirmed_by = null, manager_confirmed_at = null,
          manager_note = trim(both ' | ' from coalesce(manager_note,'') || ' | Tự gỡ xác nhận do phiếu ' || s.code || ' đổi trạng thái')
    where campaign_id = s.campaign_id and user_id = s.user_id and manager_confirmed_at is not null;
  end if;
end $$;

-- BGD cho phep ngoai le link trung
create or replace function public.fn_mkt_cho_phep_trung(p_id bigint, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; s record;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('mkt_ngoai_le') then raise exception 'KHONG_CO_QUYEN: chỉ BGĐ được cho phép ngoại lệ link trùng'; end if;
  if coalesce(btrim(p_ly_do),'') = '' then raise exception 'THIEU_THONG_TIN: bắt buộc nhập lý do'; end if;
  select * into s from public.mkt_submissions where id = p_id for update;
  if s is null then raise exception 'KHONG_TIM_THAY'; end if;
  update public.mkt_submissions set duplicate_override = true, duplicate_override_by = me.uid,
    duplicate_override_at = now(), duplicate_override_reason = p_ly_do where id = p_id;
  perform public._mkt_log('submission', s.code, 'duplicate_override', null, jsonb_build_object('reason', p_ly_do), p_ly_do);
end $$;

-- ===================== 3) LAI THU =====================
create or replace function public.fn_mkt_luu_lai_thu(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_id bigint; v_code text; v_cus record; v_phone text; v_gui boolean;
  v_sus boolean := false; v_note text := ''; v_n int;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('mkt_lai_thu') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền nhập lái thử'; end if;

  v_gui := coalesce((p->>'gui')::boolean, false);
  v_id := nullif(p->>'id','')::bigint;

  select * into v_cus from public.customers where id = (p->>'customer_id')::bigint;
  if v_cus is null then raise exception 'THIEU_THONG_TIN: phải chọn hoặc tạo khách hàng trước'; end if;
  v_phone := v_cus.phone_digits;
  if coalesce(v_phone,'') = '' then raise exception 'THIEU_THONG_TIN: khách hàng chưa có số điện thoại hợp lệ'; end if;

  if v_gui then
    if (p->>'interested_vehicle_id') is null or (p->>'test_drive_vehicle_id') is null then
      raise exception 'THIEU_THONG_TIN: phải chọn dòng xe quan tâm và dòng xe đã lái thử';
    end if;
  end if;

  -- Canh bao nghi ngo (cho nhap, danh dau de CHT xem xet)
  select count(*) into v_n from public.test_drives t
  where t.normalized_phone = v_phone and t.employee_id <> me.uid
    and t.status in ('submitted','approved') and (v_id is null or t.id <> v_id);
  if v_n > 0 then v_sus := true; v_note := v_note || 'SĐT này đã được nhân viên khác nhập ' || v_n || ' lượt. '; end if;

  select count(*) into v_n from public.test_drives t
  where t.normalized_phone = v_phone and t.status in ('submitted','approved')
    and t.test_drive_date = (coalesce(nullif(p->>'test_drive_at','')::timestamptz, now()) at time zone 'Asia/Ho_Chi_Minh')::date
    and (v_id is null or t.id <> v_id);
  if v_n > 0 then v_note := v_note || 'Khách đã có ' || v_n || ' lượt lái thử khác trong cùng ngày. '; end if;

  if v_id is null then
    v_code := public.fn_gen_code('TD');
    insert into public.test_drives (
      code, customer_id, customer_name_snapshot, customer_phone_snapshot, normalized_phone,
      region, employee_id, employee_name, campaign_id, kpi_template_id,
      interested_vehicle_id, test_drive_vehicle_id, actual_frame_number,
      test_drive_at, duration_minutes, customer_need_level, result_status,
      customer_feedback, employee_note, photos, status, is_suspicious, suspicious_note, submitted_at)
    values (
      v_code, v_cus.id, v_cus.name, v_cus.phone, v_phone,
      me.region, me.uid, me.name, nullif(p->>'campaign_id','')::bigint, nullif(p->>'kpi_template_id','')::bigint,
      nullif(p->>'interested_vehicle_id',''), nullif(p->>'test_drive_vehicle_id',''), nullif(p->>'actual_frame_number',''),
      coalesce(nullif(p->>'test_drive_at','')::timestamptz, now()), nullif(p->>'duration_minutes','')::int,
      coalesce(p->>'customer_need_level','warm'), coalesce(p->>'result_status','undecided'),
      coalesce(p->>'customer_feedback',''), coalesce(p->>'employee_note',''), coalesce(p->'photos','[]'::jsonb),
      case when v_gui then 'submitted' else 'draft' end, v_sus, v_note,
      case when v_gui then now() else null end);
    perform public._mkt_log('test_drive', v_code, case when v_gui then 'submit' else 'create_draft' end, null, p, v_note);
  else
    if not exists (select 1 from public.test_drives where id = v_id and employee_id = me.uid and status in ('draft','needs_revision')) then
      raise exception 'KHONG_CO_QUYEN: chỉ sửa được lượt lái thử của mình khi Nháp hoặc Cần bổ sung';
    end if;
    update public.test_drives set
      customer_id = v_cus.id, customer_name_snapshot = v_cus.name, customer_phone_snapshot = v_cus.phone,
      normalized_phone = v_phone, campaign_id = nullif(p->>'campaign_id','')::bigint,
      interested_vehicle_id = nullif(p->>'interested_vehicle_id',''),
      test_drive_vehicle_id = nullif(p->>'test_drive_vehicle_id',''),
      actual_frame_number = nullif(p->>'actual_frame_number',''),
      test_drive_at = coalesce(nullif(p->>'test_drive_at','')::timestamptz, test_drive_at),
      duration_minutes = nullif(p->>'duration_minutes','')::int,
      customer_need_level = coalesce(p->>'customer_need_level', customer_need_level),
      result_status = coalesce(p->>'result_status', result_status),
      customer_feedback = coalesce(p->>'customer_feedback', customer_feedback),
      employee_note = coalesce(p->>'employee_note', employee_note),
      photos = coalesce(p->'photos', photos),
      is_suspicious = v_sus, suspicious_note = v_note,
      status = case when v_gui then 'submitted' else 'draft' end,
      submitted_at = case when v_gui then now() else submitted_at end
    where id = v_id returning code into v_code;
    perform public._mkt_log('test_drive', v_code, case when v_gui then 'resubmit' else 'save_draft' end, null, p, v_note);
  end if;
  return v_code;
end $$;

create or replace function public.fn_mkt_duyet_lai_thu(p_id bigint, p_action text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; t record; v_new text;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('mkt_duyet') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền duyệt lái thử'; end if;
  select * into t from public.test_drives where id = p_id for update;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  if me.role = 'MANAGER' and me.region is not null and coalesce(t.region,'') <> me.region then
    raise exception 'KHONG_CO_QUYEN: lượt lái thử này không thuộc khu vực bạn quản lý';
  end if;
  if t.employee_id = me.uid and me.role not in ('ADMIN','CEO') then
    raise exception 'KHONG_CO_QUYEN: không được tự duyệt lượt lái thử của chính mình';
  end if;

  v_new := case p_action when 'approve' then 'approved' when 'revise' then 'needs_revision'
                         when 'reject' then 'rejected' when 'recall' then 'submitted' else null end;
  if v_new is null then raise exception 'THAM_SO_SAI'; end if;
  if p_action in ('revise','reject','recall') and coalesce(btrim(p_note),'') = '' then
    raise exception 'THIEU_THONG_TIN: bắt buộc nhập lý do';
  end if;
  if p_action = 'recall' and not public.fn_co_quyen('mkt_xem_toan_cty') then
    raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được thu hồi xác nhận';
  end if;

  update public.test_drives set status = v_new, reviewed_by = me.uid, reviewed_by_name = me.name,
    reviewed_at = now(), review_note = coalesce(p_note,'') where id = p_id;
  perform public._mkt_log('test_drive', t.code, p_action,
    jsonb_build_object('status', t.status), jsonb_build_object('status', v_new), p_note);
exception when unique_violation then
  raise exception 'TRUNG_LAI_THU: đã có lượt lái thử được duyệt trùng SĐT + ngày + nhân viên + dòng xe. Kiểm tra lại trước khi duyệt.';
end $$;

-- BGD loai luot lai thu khoi KPI
create or replace function public.fn_mkt_loai_khoi_kpi(p_id bigint, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; t record;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('mkt_ngoai_le') then raise exception 'KHONG_CO_QUYEN: chỉ BGĐ được loại lượt lái thử khỏi KPI'; end if;
  if coalesce(btrim(p_ly_do),'') = '' then raise exception 'THIEU_THONG_TIN: bắt buộc nhập lý do'; end if;
  select * into t from public.test_drives where id = p_id for update;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  update public.test_drives set excluded_from_kpi = not excluded_from_kpi,
    exclusion_reason = p_ly_do, excluded_by = me.uid, excluded_at = now() where id = p_id;
  perform public._mkt_log('test_drive', t.code,
    case when t.excluded_from_kpi then 'include_kpi' else 'exclude_kpi' end, null, null, p_ly_do);
end $$;

-- ===================== 4) CHIEN DICH =====================
create or replace function public.fn_mkt_luu_chien_dich(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_id bigint; v_code text; r jsonb;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('mkt_chien_dich') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền tạo/sửa chiến dịch'; end if;
  v_id := nullif(p->>'id','')::bigint;

  if v_id is null then
    v_code := public.fn_gen_code('CD');
    insert into public.mkt_campaigns (code, name, description, instructions, sample_content_url, document_url,
      media_folder_url, start_at, end_at, priority, status, created_by, created_by_name,
      published_at)
    values (v_code, p->>'name', coalesce(p->>'description',''), coalesce(p->>'instructions',''),
      coalesce(p->>'sample_content_url',''), coalesce(p->>'document_url',''), coalesce(p->>'media_folder_url',''),
      (p->>'start_at')::date, (p->>'end_at')::date, coalesce(p->>'priority','Bình thường'),
      coalesce(p->>'status','draft'), me.uid, me.name,
      case when coalesce(p->>'status','draft') = 'active' then now() else null end)
    returning id, code into v_id, v_code;
  else
    update public.mkt_campaigns set name = p->>'name', description = coalesce(p->>'description',''),
      instructions = coalesce(p->>'instructions',''), sample_content_url = coalesce(p->>'sample_content_url',''),
      document_url = coalesce(p->>'document_url',''), media_folder_url = coalesce(p->>'media_folder_url',''),
      start_at = (p->>'start_at')::date, end_at = (p->>'end_at')::date,
      priority = coalesce(p->>'priority', priority),
      status = coalesce(p->>'status', status),
      published_at = case when coalesce(p->>'status','') = 'active' and published_at is null then now() else published_at end
    where id = v_id and status in ('draft','scheduled','active') returning code into v_code;
    if v_code is null then raise exception 'TRANG_THAI_SAI: chiến dịch đã kết thúc/hủy, không sửa được'; end if;
  end if;

  -- Dau muc: ghi de toan bo (form gui len danh sach day du)
  if p ? 'requirements' then
    delete from public.mkt_campaign_requirements where campaign_id = v_id;
    for r in select jsonb_array_elements(p->'requirements') loop
      insert into public.mkt_campaign_requirements (campaign_id, title, description, content_type, target_quantity,
        platforms, link_required, evidence_allowed, evidence_required, approval_required, acceptance_criteria, sort_order)
      values (v_id, r->>'title', coalesce(r->>'description',''), r->>'content_type',
        coalesce((r->>'target_quantity')::int, 1), coalesce(r->'platforms','[]'::jsonb),
        coalesce((r->>'link_required')::boolean, true), coalesce((r->>'evidence_allowed')::boolean, true),
        coalesce((r->>'evidence_required')::boolean, false), coalesce((r->>'approval_required')::boolean, true),
        coalesce(r->>'acceptance_criteria',''), coalesce((r->>'sort_order')::int, 0));
    end loop;
  end if;

  -- Doi tuong: ghi de toan bo, giu lai du lieu mien/xac nhan cua nguoi cu
  if p ? 'targets' then
    delete from public.mkt_campaign_targets t where t.campaign_id = v_id
      and not exists (select 1 from jsonb_array_elements(p->'targets') x where (x->>'user_id')::uuid = t.user_id);
    for r in select jsonb_array_elements(p->'targets') loop
      insert into public.mkt_campaign_targets (campaign_id, user_id, region, participation_type)
      select v_id, (r->>'user_id')::uuid, pr.region, coalesce(r->>'participation_type','required')
      from public.profiles pr where pr.id = (r->>'user_id')::uuid
      on conflict (campaign_id, user_id) do update set participation_type = excluded.participation_type;
    end loop;
  end if;

  perform public._mkt_log('campaign', v_code, case when (p->>'id') is null then 'create' else 'update' end, null, p, '');
  return v_code;
end $$;

-- Doi trang thai chien dich (phat hanh / dong / huy)
create or replace function public.fn_mkt_trang_thai_chien_dich(p_id bigint, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; c record;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('mkt_chien_dich') then raise exception 'KHONG_CO_QUYEN'; end if;
  select * into c from public.mkt_campaigns where id = p_id for update;
  if c is null then raise exception 'KHONG_TIM_THAY'; end if;
  if p_status not in ('draft','scheduled','active','ended','completed','cancelled') then raise exception 'THAM_SO_SAI'; end if;
  if p_status in ('cancelled','completed') and not public.fn_co_quyen('mkt_xem_toan_cty') then
    raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được đóng hoặc hủy chiến dịch';
  end if;
  update public.mkt_campaigns set status = p_status,
    published_at = case when p_status = 'active' and published_at is null then now() else published_at end,
    completed_at = case when p_status in ('completed','cancelled') then now() else completed_at end,
    completed_by = case when p_status in ('completed','cancelled') then me.uid else completed_by end
  where id = p_id;
  perform public._mkt_log('campaign', c.code, 'status_' || p_status,
    jsonb_build_object('status', c.status), jsonb_build_object('status', p_status), p_note);
end $$;

-- Mien KPI cho nhan vien
create or replace function public.fn_mkt_mien_kpi(p_campaign_id bigint, p_user_id uuid, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('mkt_duyet') then raise exception 'KHONG_CO_QUYEN'; end if;
  if p_user_id = me.uid then raise exception 'KHONG_CO_QUYEN: không được tự miễn KPI cho chính mình'; end if;
  if coalesce(btrim(p_ly_do),'') = '' then raise exception 'THIEU_THONG_TIN: bắt buộc nhập lý do miễn'; end if;
  update public.mkt_campaign_targets set participation_type = 'exempted',
    exempted_by = me.uid, exempted_at = now(), exemption_reason = p_ly_do
  where campaign_id = p_campaign_id and user_id = p_user_id;
  if not found then raise exception 'KHONG_TIM_THAY: nhân viên không thuộc chiến dịch này'; end if;
  perform public._mkt_log('campaign_target', p_campaign_id::text || '/' || p_user_id::text, 'exempt', null, null, p_ly_do);
end $$;

-- CHT xac nhan nhan vien hoan thanh chien dich (chi khi da du approved)
create or replace function public.fn_mkt_xac_nhan_hoan_thanh(p_campaign_id bigint, p_user_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; t record; v_thieu int;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('mkt_duyet') then raise exception 'KHONG_CO_QUYEN'; end if;
  select * into t from public.mkt_campaign_targets where campaign_id = p_campaign_id and user_id = p_user_id for update;
  if t is null then raise exception 'KHONG_TIM_THAY: nhân viên không thuộc chiến dịch này'; end if;
  if me.role = 'MANAGER' and me.region is not null and coalesce(t.region,'') <> me.region then
    raise exception 'KHONG_CO_QUYEN: nhân viên này không thuộc khu vực bạn quản lý';
  end if;
  if t.participation_type = 'exempted' then raise exception 'TRANG_THAI_SAI: nhân viên đang được miễn KPI'; end if;

  -- Kiem tra: moi dau mục bat buoc duyet deu phai du approved
  select count(*) into v_thieu from public.mkt_campaign_requirements r
  where r.campaign_id = p_campaign_id
    and (select count(*) from public.mkt_submissions s
         where s.campaign_requirement_id = r.id and s.user_id = p_user_id and s.status = 'approved') < r.target_quantity;
  if v_thieu > 0 then
    raise exception 'CHUA_DU_DIEU_KIEN: còn % đầu mục chưa đủ số lượng báo cáo được duyệt', v_thieu;
  end if;

  update public.mkt_campaign_targets set manager_confirmed_by = me.uid, manager_confirmed_at = now(),
    manager_note = coalesce(p_note,'') where campaign_id = p_campaign_id and user_id = p_user_id;
  perform public._mkt_log('campaign_target', p_campaign_id::text || '/' || p_user_id::text, 'confirm_complete', null, null, p_note);
end $$;

-- CHT xac nhan CUA HANG (khu vuc) hoan thanh
create or replace function public.fn_mkt_xac_nhan_cua_hang(p_campaign_id bigint, p_region text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_thieu int;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('mkt_duyet') then raise exception 'KHONG_CO_QUYEN'; end if;
  if me.role = 'MANAGER' and me.region is not null and p_region <> me.region then
    raise exception 'KHONG_CO_QUYEN: không phải khu vực bạn quản lý';
  end if;
  select count(*) into v_thieu from public.mkt_campaign_targets t
  where t.campaign_id = p_campaign_id and t.region = p_region
    and t.participation_type = 'required' and t.manager_confirmed_at is null;
  if v_thieu > 0 then raise exception 'CHUA_DU_DIEU_KIEN: còn % nhân viên bắt buộc chưa được xác nhận hoàn thành', v_thieu; end if;
  insert into public.mkt_branch_progress (campaign_id, region, confirmed_by, confirmed_at, note)
  values (p_campaign_id, p_region, me.uid, now(), coalesce(p_note,''))
  on conflict (campaign_id, region) do update set confirmed_by = me.uid, confirmed_at = now(), note = coalesce(p_note,'');
  perform public._mkt_log('branch_progress', p_campaign_id::text || '/' || p_region, 'confirm_branch', null, null, p_note);
end $$;

-- ===================== 5) KPI DINH KY: LUU / XOA =====================
create or replace function public.fn_mkt_luu_kpi(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_id bigint; v_code text;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('mkt_kpi_dinh_ky') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền cấu hình KPI định kỳ'; end if;
  v_id := nullif(p->>'id','')::bigint;
  if v_id is null then
    insert into public.mkt_kpi_templates (code, name, description, kpi_type, target_quantity, period_type,
      counting_method, effective_from, effective_to, require_approval, weight, status, created_by, created_by_name)
    values (upper(p->>'code'), p->>'name', coalesce(p->>'description',''), p->>'kpi_type',
      (p->>'target_quantity')::int, coalesce(p->>'period_type','weekly'),
      coalesce(p->>'counting_method','submissions'), coalesce(nullif(p->>'effective_from','')::date, current_date),
      nullif(p->>'effective_to','')::date, coalesce((p->>'require_approval')::boolean, true),
      nullif(p->>'weight','')::numeric, coalesce(p->>'status','Hoạt động'), me.uid, me.name)
    returning code into v_code;
  else
    update public.mkt_kpi_templates set name = p->>'name', description = coalesce(p->>'description',''),
      kpi_type = p->>'kpi_type', target_quantity = (p->>'target_quantity')::int,
      period_type = coalesce(p->>'period_type', period_type), counting_method = coalesce(p->>'counting_method', counting_method),
      effective_from = coalesce(nullif(p->>'effective_from','')::date, effective_from),
      effective_to = nullif(p->>'effective_to','')::date,
      require_approval = coalesce((p->>'require_approval')::boolean, require_approval),
      weight = nullif(p->>'weight','')::numeric, status = coalesce(p->>'status', status)
    where id = v_id returning code into v_code;
  end if;
  perform public._mkt_log('kpi_template', v_code, case when (p->>'id') is null then 'create' else 'update' end, null, p, '');
  return v_code;
end $$;

-- Giao KPI cho doi tuong
create or replace function public.fn_mkt_giao_kpi(p_kpi_id bigint, p_region text, p_role text, p_user uuid, p_type text)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('mkt_kpi_dinh_ky') then raise exception 'KHONG_CO_QUYEN'; end if;
  insert into public.mkt_kpi_assignments (kpi_template_id, region, role_code, user_id, participation_type, assigned_by)
  values (p_kpi_id, nullif(p_region,''), nullif(p_role,''), p_user, coalesce(p_type,'required'), me.uid);
  perform public._mkt_log('kpi_assignment', p_kpi_id::text, 'assign', null,
    jsonb_build_object('region', p_region, 'role', p_role, 'user', p_user, 'type', p_type), '');
end $$;

create or replace function public.fn_mkt_xoa_giao_kpi(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_co_quyen('mkt_kpi_dinh_ky') then raise exception 'KHONG_CO_QUYEN'; end if;
  delete from public.mkt_kpi_assignments where id = p_id;
  perform public._mkt_log('kpi_assignment', p_id::text, 'unassign', null, null, '');
end $$;

-- ===================== 6) VIEW TINH KPI (nguon su that duy nhat) =====================
-- Tien do KPI dinh ky theo tung nhan vien x KPI x ky hien tai.
-- Chi approved moi tinh (spec muc X). Lai thu dem theo counting_method.
create or replace view public.v_mkt_kpi_progress as
with nguoi_kpi as (
  select distinct pr.id as user_id, pr.name as user_name, pr.region, pr.role,
         t.id as kpi_id, t.code as kpi_code, t.name as kpi_name, t.kpi_type,
         t.target_quantity, t.period_type, t.counting_method,
         coalesce(a.participation_type, 'required') as participation_type
  from public.mkt_kpi_templates t
  join public.mkt_kpi_assignments a on a.kpi_template_id = t.id
  join public.profiles pr on (a.user_id is null or a.user_id = pr.id)
                         and (a.role_code is null or a.role_code = pr.role)
                         and (a.region is null or a.region = pr.region)
  where t.status = 'Hoạt động' and pr.status = 'Hoạt động'
    and t.effective_from <= current_date
    and (t.effective_to is null or t.effective_to >= current_date)
), ky as (
  select n.*, p.ky_start, p.ky_end
  from nguoi_kpi n, lateral public._mkt_period(n.period_type) p
)
select k.user_id, k.user_name, k.region, k.role, k.kpi_id, k.kpi_code, k.kpi_name,
       k.kpi_type, k.target_quantity, k.period_type, k.counting_method, k.participation_type,
       k.ky_start, k.ky_end,
       -- Bao cao marketing (bai viet / video / custom)
       case when k.kpi_type = 'test_drive' then
         (select count(*) from public.test_drives td where td.employee_id = k.user_id
            and td.kpi_template_id is not distinct from k.kpi_id
            and td.test_drive_date between k.ky_start and k.ky_end
            and td.status <> 'draft')
       else
         (select count(*) from public.mkt_submissions s where s.user_id = k.user_id
            and s.kpi_template_id = k.kpi_id and s.status <> 'draft'
            and coalesce(s.published_at, s.submitted_at::date) between k.ky_start and k.ky_end)
       end as da_nop,
       case when k.kpi_type = 'test_drive' then
         case when k.counting_method = 'unique_customers' then
           (select count(distinct td.customer_id) from public.test_drives td where td.employee_id = k.user_id
              and td.test_drive_date between k.ky_start and k.ky_end
              and td.status = 'approved' and td.excluded_from_kpi = false)
         else
           (select count(*) from public.test_drives td where td.employee_id = k.user_id
              and td.test_drive_date between k.ky_start and k.ky_end
              and td.status = 'approved' and td.excluded_from_kpi = false)
         end
       else
         (select count(*) from public.mkt_submissions s where s.user_id = k.user_id
            and s.kpi_template_id = k.kpi_id and s.status = 'approved'
            and coalesce(s.published_at, s.submitted_at::date) between k.ky_start and k.ky_end)
       end as da_duyet,
       case when k.kpi_type = 'test_drive' then
         (select count(*) from public.test_drives td where td.employee_id = k.user_id
            and td.test_drive_date between k.ky_start and k.ky_end and td.status = 'submitted')
       else
         (select count(*) from public.mkt_submissions s where s.user_id = k.user_id
            and s.kpi_template_id = k.kpi_id and s.status = 'submitted'
            and coalesce(s.published_at, s.submitted_at::date) between k.ky_start and k.ky_end)
       end as cho_duyet,
       case when k.kpi_type = 'test_drive' then
         (select count(*) from public.test_drives td where td.employee_id = k.user_id
            and td.test_drive_date between k.ky_start and k.ky_end and td.status = 'needs_revision')
       else
         (select count(*) from public.mkt_submissions s where s.user_id = k.user_id
            and s.kpi_template_id = k.kpi_id and s.status = 'needs_revision'
            and coalesce(s.published_at, s.submitted_at::date) between k.ky_start and k.ky_end)
       end as can_bo_sung,
       case when k.kpi_type = 'test_drive' then
         (select count(*) from public.test_drives td where td.employee_id = k.user_id
            and td.test_drive_date between k.ky_start and k.ky_end
            and (td.status = 'rejected' or td.excluded_from_kpi = true))
       else
         (select count(*) from public.mkt_submissions s where s.user_id = k.user_id
            and s.kpi_template_id = k.kpi_id and s.status = 'rejected'
            and coalesce(s.published_at, s.submitted_at::date) between k.ky_start and k.ky_end)
       end as khong_hop_le
from ky k;

-- Tien do tung nhan vien trong tung chien dich
create or replace view public.v_mkt_campaign_progress as
select
  t.campaign_id, c.code as campaign_code, c.name as campaign_name, c.start_at, c.end_at, c.status as campaign_status,
  t.user_id, pr.name as user_name, t.region, t.participation_type,
  t.manager_confirmed_at, t.manager_confirmed_by, t.exemption_reason,
  (select count(*) from public.mkt_submissions s where s.campaign_id = t.campaign_id and s.user_id = t.user_id and s.status <> 'draft') as da_nop,
  (select count(*) from public.mkt_submissions s where s.campaign_id = t.campaign_id and s.user_id = t.user_id and s.status = 'approved') as da_duyet,
  (select count(*) from public.mkt_submissions s where s.campaign_id = t.campaign_id and s.user_id = t.user_id and s.status = 'submitted') as cho_duyet,
  (select coalesce(sum(r.target_quantity), 0) from public.mkt_campaign_requirements r where r.campaign_id = t.campaign_id) as tong_muc_tieu,
  -- Du dieu kien = moi dau muc deu du approved
  (select count(*) = 0 from public.mkt_campaign_requirements r
     where r.campaign_id = t.campaign_id
       and (select count(*) from public.mkt_submissions s
            where s.campaign_requirement_id = r.id and s.user_id = t.user_id and s.status = 'approved') < r.target_quantity
  ) as du_dieu_kien
from public.mkt_campaign_targets t
join public.mkt_campaigns c on c.id = t.campaign_id
join public.profiles pr on pr.id = t.user_id;
