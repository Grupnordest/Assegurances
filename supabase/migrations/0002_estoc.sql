-- Estoc de vehicles a nom de l'empresa (PRD §5.2, FR-3)
-- Cada pujada és una càrrega; l'Estoc vigent és l'última.

create table public.estoc_carregues (
  id uuid primary key default gen_random_uuid(),
  data_estoc timestamptz not null,
  fitxer text not null,
  num_vehicles integer not null check (num_vehicles > 0),
  descartats integer not null default 0 check (descartats >= 0),
  carregat_per uuid not null references public.usuaris (id),
  created_at timestamptz not null default now()
);

create index estoc_carregues_recents on public.estoc_carregues (created_at desc, id desc);

create table public.estoc_vehicles (
  carrega_id uuid not null references public.estoc_carregues (id) on delete cascade,
  matricula text not null check (matricula ~ '^[A-Z0-9]{4,10}$'),
  vin text,
  marca text,
  model text,
  color text,
  dies_estoc integer,
  primary key (carrega_id, matricula)
);

-- Vehicles de l'última càrrega
create view public.estoc_vigent with (security_invoker = true) as
  select v.*
  from public.estoc_vehicles v
  where v.carrega_id = (
    select c.id from public.estoc_carregues c order by c.created_at desc, c.id desc limit 1
  );

-- Desa una càrrega sencera en una sola transacció (o tot o res). És l'única via
-- d'escriptura: no hi ha polítiques d'INSERT directe a les taules.
-- p_data_estoc és l'hora local de l'Excel (Europe/Madrid); null = ara.
create or replace function public.carrega_estoc(
  p_data_estoc timestamp, p_fitxer text, p_descartats integer, p_vehicles jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
  v_num integer := coalesce(jsonb_array_length(p_vehicles), 0);
  v_id uuid;
begin
  if v_usuari is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  if v_num = 0 then
    raise exception 'sense_vehicles' using errcode = 'P0001';
  end if;

  -- Càrregues en sèrie: la que acaba l'última és la vigent (created_at = hora real, no la d'inici).
  perform pg_advisory_xact_lock(hashtext('carrega_estoc'));

  insert into public.estoc_carregues (data_estoc, fitxer, num_vehicles, descartats, carregat_per, created_at)
  values (
    coalesce(p_data_estoc at time zone 'Europe/Madrid', now()),
    left(p_fitxer, 200), v_num, coalesce(p_descartats, 0), v_usuari, clock_timestamp()
  )
  returning id into v_id;

  insert into public.estoc_vehicles (carrega_id, matricula, vin, marca, model, color, dies_estoc)
  select v_id, x.matricula, x.vin, x.marca, x.model, x.color, x.dies_estoc
  from jsonb_to_recordset(p_vehicles)
    as x(matricula text, vin text, marca text, model text, color text, dies_estoc integer);

  return v_id;
end $$;

alter table public.estoc_carregues enable row level security;
alter table public.estoc_vehicles enable row level security;

revoke execute on function public.carrega_estoc(timestamp, text, integer, jsonb) from public, anon;
grant execute on function public.carrega_estoc(timestamp, text, integer, jsonb) to authenticated;

-- Lectura: de moment, només Administració (el cercador per als sol·licitants arribarà amb FR-5).
-- Escriptura: només a través de carrega_estoc().
create policy estoc_carregues_lectura on public.estoc_carregues for select to authenticated
  using (public.es_admin());
create policy estoc_vehicles_lectura on public.estoc_vehicles for select to authenticated
  using (public.es_admin());
