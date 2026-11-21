-- Enviament de l'Estoc a Proassa (Pòlissa Flota VO, PRD FR-27).
-- Llista enviada = Estoc vigent ∪ llistes addicionals (immobilitzats, campers). Les altes i baixes
-- es calculen contra l'últim enviament confirmat ('enviat').

-- Llistes addicionals: una per categoria; pujar-ne una de nova la substitueix.
create table public.flota_llistes (
  categoria text primary key check (categoria in ('immobilitzats', 'campers')),
  nom_fitxer text not null,
  vehicles jsonb not null check (jsonb_typeof(vehicles) = 'array' and jsonb_array_length(vehicles) > 0),
  carregat_per uuid not null references public.usuaris (id),
  updated_at timestamptz not null default now()
);

-- Enviaments. Cicle: enviant → enviat | fallit. Un 'enviant' sense resoldre és un enviament incert.
create table public.flota_enviaments (
  id uuid primary key default gen_random_uuid(),
  origen text not null check (origen in ('inicial', 'eina')),
  estat text not null default 'enviant' check (estat in ('enviant', 'enviat', 'fallit')),
  -- [{matricula, marca, tipo}] tal com s'ha enviat
  vehicles jsonb not null check (jsonb_typeof(vehicles) = 'array'),
  num_vehicles integer not null,
  altes text[] not null default '{}',
  baixes text[] not null default '{}',
  nom_fitxer text,
  data_estoc timestamptz,
  enviat_per uuid not null references public.usuaris (id),
  created_at timestamptz not null default clock_timestamp(),
  enviat_at timestamptz
);

create unique index flota_enviaments_un_en_curs on public.flota_enviaments ((true)) where estat = 'enviant';
create index flota_enviaments_recents on public.flota_enviaments (created_at desc);

create or replace function public.desa_llista_flota(p_categoria text, p_nom_fitxer text, p_vehicles jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
begin
  if v_usuari is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  insert into public.flota_llistes (categoria, nom_fitxer, vehicles, carregat_per, updated_at)
  values (p_categoria, left(p_nom_fitxer, 200), p_vehicles, v_usuari, now())
  on conflict (categoria) do update
    set nom_fitxer = excluded.nom_fitxer, vehicles = excluded.vehicles,
        carregat_per = excluded.carregat_per, updated_at = excluded.updated_at;
end $$;

-- Punt de partida: l'últim Excel enviat a mà. Només si encara no hi ha cap enviament.
create or replace function public.registra_enviament_inicial(p_nom_fitxer text, p_vehicles jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
  v_id uuid;
begin
  if v_usuari is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('flota_enviaments'));
  if exists (select 1 from public.flota_enviaments) then
    raise exception 'ja_inicial' using errcode = 'P0001';
  end if;
  insert into public.flota_enviaments (origen, estat, vehicles, num_vehicles, nom_fitxer, enviat_per, enviat_at)
  values ('inicial', 'enviat', p_vehicles, jsonb_array_length(p_vehicles), left(p_nom_fitxer, 200), v_usuari, now())
  returning id into v_id;
  return v_id;
end $$;

-- Reserva un enviament abans d'enviar el correu.
create or replace function public.prepara_enviament_flota(
  p_vehicles jsonb, p_altes text[], p_baixes text[], p_nom_fitxer text, p_data_estoc timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
  v_id uuid;
begin
  if v_usuari is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('flota_enviaments'));
  if exists (select 1 from public.flota_enviaments where estat = 'enviant') then
    raise exception 'pendent_confirmar' using errcode = 'P0001';
  end if;
  insert into public.flota_enviaments
    (origen, vehicles, num_vehicles, altes, baixes, nom_fitxer, data_estoc, enviat_per)
  values ('eina', p_vehicles, jsonb_array_length(p_vehicles), coalesce(p_altes, '{}'), coalesce(p_baixes, '{}'),
          left(p_nom_fitxer, 200), p_data_estoc, v_usuari)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.confirma_enviament_flota(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.usuari_actual_id() is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  update public.flota_enviaments set estat = 'enviat', enviat_at = now() where id = p_id and estat = 'enviant';
  if not found and not exists (select 1 from public.flota_enviaments where id = p_id and estat = 'enviat') then
    raise exception 'no_trobat' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.descarta_enviament_flota(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.usuari_actual_id() is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  update public.flota_enviaments set estat = 'fallit' where id = p_id and estat = 'enviant';
end $$;

alter table public.flota_llistes enable row level security;
alter table public.flota_enviaments enable row level security;
create policy flota_llistes_lectura on public.flota_llistes for select to authenticated using (public.es_admin());
create policy flota_enviaments_lectura on public.flota_enviaments for select to authenticated using (public.es_admin());

grant select on public.flota_llistes, public.flota_enviaments to authenticated;

revoke execute on function public.desa_llista_flota(text, text, jsonb) from public, anon;
revoke execute on function public.registra_enviament_inicial(text, jsonb) from public, anon;
revoke execute on function public.prepara_enviament_flota(jsonb, text[], text[], text, timestamptz) from public, anon;
revoke execute on function public.confirma_enviament_flota(uuid) from public, anon;
revoke execute on function public.descarta_enviament_flota(uuid) from public, anon;
grant execute on function public.desa_llista_flota(text, text, jsonb) to authenticated;
grant execute on function public.registra_enviament_inicial(text, jsonb) to authenticated;
grant execute on function public.prepara_enviament_flota(jsonb, text[], text[], text, timestamptz) to authenticated;
grant execute on function public.confirma_enviament_flota(uuid) to authenticated;
grant execute on function public.descarta_enviament_flota(uuid) to authenticated;
