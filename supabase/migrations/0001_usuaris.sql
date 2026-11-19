-- Base d'usuaris, rols i centres (PRD §5.1, FR-1 i FR-2)

create type public.rol_usuari as enum ('sollicitant', 'validador', 'cap_postvenda', 'administracio');

create table public.centres (
  id smallint primary key,
  nom text not null unique
);

insert into public.centres (id, nom) values
  (1, 'Palafrugell'),
  (2, 'Olot'),
  (3, 'Sant Feliu de Guíxols'),
  (4, 'La Bisbal d''Empordà'),
  (5, 'Blanes'),
  (6, 'Palamós'),
  (7, 'Santa Coloma de Farners'),
  (8, 'Besalú');

create table public.usuaris (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and email like '%@grupnordest.com'),
  nom text not null check (length(trim(nom)) > 0),
  -- Nul·lable només per al primer administrador (creat a l'inici de sessió); l'app l'exigeix.
  centre_id smallint references public.centres (id),
  actiu boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.usuari_rols (
  usuari_id uuid not null references public.usuaris (id) on delete cascade,
  rol public.rol_usuari not null,
  primary key (usuari_id, rol)
);

create or replace function public.toca_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger usuaris_updated_at before update on public.usuaris
  for each row execute function public.toca_updated_at();

-- Correu de la sessió, només si ve del proveïdor Microsoft (Azure).
create or replace function public.email_sessio() returns text
language sql stable as $$
  select case
    when auth.jwt() -> 'app_metadata' ->> 'provider' = 'azure' then lower(auth.jwt() ->> 'email')
  end
$$;

-- Usuari actiu que correspon a la sessió
create or replace function public.usuari_actual_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.usuaris where email = public.email_sessio() and actiu
$$;

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.usuari_rols r
    join public.usuaris u on u.id = r.usuari_id
    where u.email = public.email_sessio()
      and u.actiu
      and r.rol = 'administracio'
  )
$$;

-- Regla: ha de quedar com a mínim un administrador actiu.
-- Es comprova a la base de dades (no només a l'app) i en sèrie (bloqueig de transacció).
create or replace function public.comprova_ultim_admin() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  afectat uuid;
  era_admin boolean;
begin
  if tg_table_name = 'usuaris' then
    afectat := old.id;
    era_admin := old.actiu and exists (
      select 1 from public.usuari_rols where usuari_id = old.id and rol = 'administracio');
  else
    afectat := old.usuari_id;
    era_admin := old.rol = 'administracio' and exists (
      select 1 from public.usuaris where id = old.usuari_id and actiu);
  end if;

  if era_admin then
    perform pg_advisory_xact_lock(hashtext('ultim_admin'));
    if not exists (
      select 1 from public.usuari_rols r join public.usuaris u on u.id = r.usuari_id
      where r.rol = 'administracio' and u.actiu
    ) then
      raise exception 'ultim_admin' using errcode = 'P0001', hint = 'Ha de quedar com a mínim un administrador';
    end if;
  end if;
  return null;
end $$;

create trigger usuaris_ultim_admin after update of actiu or delete on public.usuaris
  for each row execute function public.comprova_ultim_admin();
create trigger usuari_rols_ultim_admin after update or delete on public.usuari_rols
  for each row execute function public.comprova_ultim_admin();

-- Alta o edició d'un usuari amb els seus rols, en una sola transacció.
-- security invoker: s'hi apliquen les polítiques RLS de qui crida.
create or replace function public.desa_usuari(
  p_id uuid, p_nom text, p_email text, p_centre_id smallint, p_rols public.rol_usuari[]
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := p_id;
begin
  if p_rols is null or cardinality(p_rols) = 0 then
    raise exception 'sense_rols' using errcode = 'P0001';
  end if;

  if v_id is null then
    insert into public.usuaris (nom, email, centre_id) values (p_nom, p_email, p_centre_id)
    returning id into v_id;
  else
    update public.usuaris set nom = p_nom, email = p_email, centre_id = p_centre_id where id = v_id;
    if not found then
      raise exception 'no_trobat' using errcode = 'P0001';
    end if;
  end if;

  -- Primer s'afegeixen els rols i després es treuen els sobrants: un admin que s'edita
  -- a si mateix no perd el permís (RLS) a mig camí.
  insert into public.usuari_rols (usuari_id, rol)
    select v_id, r from unnest(p_rols) as r
    on conflict do nothing;
  delete from public.usuari_rols where usuari_id = v_id and rol <> all (p_rols);

  return v_id;
end $$;

-- Primer administrador (ADMIN_EMAILS). Només el pot cridar el servidor amb la clau de servei.
-- Idempotent: també repara un usuari creat sense rols.
create or replace function public.crea_admin_inicial(p_email text, p_nom text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into public.usuaris (email, nom) values (lower(p_email), p_nom)
    on conflict (email) do nothing;
  select id into v_id from public.usuaris where email = lower(p_email);
  if not exists (select 1 from public.usuari_rols where usuari_id = v_id) then
    insert into public.usuari_rols (usuari_id, rol) values (v_id, 'administracio')
      on conflict do nothing;
  end if;
end $$;

revoke execute on function public.crea_admin_inicial(text, text) from public, anon, authenticated;
grant execute on function public.crea_admin_inicial(text, text) to service_role;

alter table public.centres enable row level security;
alter table public.usuaris enable row level security;
alter table public.usuari_rols enable row level security;

-- Lectura: qualsevol usuari actiu
create policy centres_lectura on public.centres for select to authenticated
  using (public.usuari_actual_id() is not null);
create policy usuaris_lectura on public.usuaris for select to authenticated
  using (public.usuari_actual_id() is not null);
create policy usuari_rols_lectura on public.usuari_rols for select to authenticated
  using (public.usuari_actual_id() is not null);

-- Escriptura: només Administració. Els usuaris no s'esborren, es desactiven.
create policy usuaris_alta on public.usuaris for insert to authenticated
  with check (public.es_admin());
create policy usuaris_edicio on public.usuaris for update to authenticated
  using (public.es_admin()) with check (public.es_admin());
create policy usuari_rols_alta on public.usuari_rols for insert to authenticated
  with check (public.es_admin());
create policy usuari_rols_baixa on public.usuari_rols for delete to authenticated
  using (public.es_admin());
