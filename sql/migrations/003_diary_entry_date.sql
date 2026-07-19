-- 日记按自然日归档：一用户一日最多一条，支撑连续书写 + 按日回顾

alter table public.diaries
  add column if not exists entry_date date;

update public.diaries
set entry_date = (created_at at time zone 'utc')::date
where entry_date is null;

-- 同一天多条：合并正文到最小 id，删除其余
with merged as (
  select
    user_id,
    entry_date,
    min(id) as keep_id,
    string_agg(
      nullif(trim(
        case
          when coalesce(nullif(trim(title), ''), '') <> ''
            then title || E'\n' || content
          else content
        end
      ), ''),
      E'\n\n——\n\n'
      order by id
    ) as merged_content
  from public.diaries
  where entry_date is not null
  group by user_id, entry_date
)
update public.diaries d
set
  content = coalesce(m.merged_content, d.content),
  title = coalesce(to_char(d.entry_date, 'YYYY-MM-DD'), d.title)
from merged m
where d.id = m.keep_id;

delete from public.diaries d
using (
  select user_id, entry_date, min(id) as keep_id
  from public.diaries
  where entry_date is not null
  group by user_id, entry_date
) k
where d.user_id = k.user_id
  and d.entry_date = k.entry_date
  and d.id <> k.keep_id;

alter table public.diaries
  alter column entry_date set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'uq_diaries_user_entry_date'
  ) then
    alter table public.diaries
      add constraint uq_diaries_user_entry_date unique (user_id, entry_date);
  end if;
end $$;

create index if not exists diaries_user_entry_date_idx
  on public.diaries (user_id, entry_date desc);

create or replace function public.match_diaries(
  p_user_id uuid,
  query_embedding vector(2048),
  match_count int default 2
)
returns table (
  id bigint,
  title text,
  content text,
  updated_at timestamptz,
  entry_date date
)
language sql
stable
as $$
  select d.id, d.title, d.content, d.updated_at, d.entry_date
  from public.diaries d
  where d.user_id = p_user_id
    and d.embedding is not null
  order by d.embedding <-> query_embedding
  limit greatest(0, least(match_count, 10));
$$;
