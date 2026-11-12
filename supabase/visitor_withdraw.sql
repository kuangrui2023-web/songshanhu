-- Receipt-scoped, recoverable visitor withdrawal. No records are purged.
begin;
alter table public.inquiries add column if not exists visitor_withdrawn_at timestamptz;

create or replace function public.withdraw_site_inquiry(p_id uuid,p_receipt uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.inquiries;
begin
 if p_id is null or p_receipt is null then raise exception '缺少留言回执，无法撤回'; end if;
 select * into r from public.inquiries where id=p_id and receipt=p_receipt for update;
 if not found then raise exception '未找到对应留言，请保留内容并联系招商顾问'; end if;
 if r.visitor_withdrawn_at is null then
  update public.inquiries set visitor_withdrawn_at=now(),deleted_at=coalesce(deleted_at,now()),status='closed'
  where id=r.id returning * into r;
 end if;
 return jsonb_build_object('id',r.id,'withdrawn',true,'withdrawn_at',r.visitor_withdrawn_at);
end; $$;
revoke all on function public.withdraw_site_inquiry(uuid,uuid) from public;
grant execute on function public.withdraw_site_inquiry(uuid,uuid) to anon,authenticated;

create or replace function public.read_site_reply(p_receipt uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select case when visitor_withdrawn_at is not null then jsonb_build_object('withdrawn',true)
 else jsonb_build_object('status',status,'reply',reply,'replied_at',replied_at) end
 from public.inquiries where receipt=p_receipt and (deleted_at is null or visitor_withdrawn_at is not null);
$$;
revoke all on function public.read_site_reply(uuid) from public;
grant execute on function public.read_site_reply(uuid) to anon,authenticated;

-- Preserve withdrawal when staff open a stale tab or try to restore a row.
create or replace function public.manage_site_inquiry(p_id uuid,p_status text,p_reply text,p_archived boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare r public.inquiries;
begin
 if not public.is_site_admin() or not exists(select 1 from public.inquiries q where q.id=p_id and
  (public.can_manage_all_parks() or exists(select 1 from public.listings l where l.id=q.listing_id and public.can_manage_park(l.park)))) then raise exception '无权处理这条留言'; end if;
 select * into r from public.inquiries where id=p_id for update;
 if r.visitor_withdrawn_at is not null then raise exception '访客已撤回这条留言，请刷新列表，以新提交的留言为准'; end if;
 if p_status not in ('pending','replied','closed') or length(coalesce(p_reply,''))>4000 then raise exception '留言状态或回复内容不正确'; end if;
 if p_status='replied' and length(trim(coalesce(p_reply,'')))=0 then raise exception '请填写回复内容'; end if;
 update public.inquiries set status=p_status,reply=coalesce(p_reply,''),replied_at=case when length(trim(coalesce(p_reply,'')))>0 then now() else null end,
 deleted_at=case when p_archived then now() else null end where id=p_id;
end; $$;
revoke all on function public.manage_site_inquiry(uuid,text,text,boolean) from public;
grant execute on function public.manage_site_inquiry(uuid,text,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
