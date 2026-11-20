-- Vehicles assegurats a la Pòlissa Tot risc i càrrega inicial (PRD FR-7, FR-21)

create type public.motiu_vehicle as enum ('vs', 'prova', 'client', 'demo');
create type public.estat_vehicle as enum (
  'sollicitat', 'rebutjat', 'enviat', 'assegurat', 'baixa_enviada', 'donat_de_baixa', 'tancat'
);
create type public.cobertura_vehicle as enum ('tot_risc', 'tercers');

create table public.vehicles_assegurats (
  id uuid primary key default gen_random_uuid(),
  matricula text not null check (matricula ~ '^[A-Z0-9]{4,10}$'),
  polissa text,
  estat public.estat_vehicle not null,
  motiu public.motiu_vehicle,
  -- Només per a Prova/Client/DEMO. Per als VS el Responsable és el Cap de postvenda actiu.
  responsable_id uuid references public.usuaris (id),
  centre_id smallint references public.centres (id),
  cobertura public.cobertura_vehicle not null default 'tot_risc',
  franquicia numeric(8, 2) check (franquicia >= 0),
  data_alta date,
  data_venciment date,
  prima_neta numeric(10, 2),
  prima_total numeric(10, 2),
  marca_model text,
  vin text,
  color text,
  data_prevista_baixa date,
  nota text,
  origen text not null check (origen in ('carrega_inicial', 'sollicitud')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (motiu is distinct from 'vs' or responsable_id is null)
);

-- Una matrícula només pot tenir un cicle obert alhora.
create unique index vehicles_assegurats_matricula_oberta on public.vehicles_assegurats (matricula)
  where estat not in ('rebutjat', 'tancat');

create trigger vehicles_assegurats_updated_at before update on public.vehicles_assegurats
  for each row execute function public.toca_updated_at();

-- Historial d'Estats (FR-7): data i autor de cada canvi.
create table public.vehicle_historial (
  id bigint generated always as identity primary key,
  vehicle_id uuid not null references public.vehicles_assegurats (id) on delete cascade,
  estat public.estat_vehicle not null,
  comentari text,
  usuari_id uuid references public.usuaris (id),
  created_at timestamptz not null default now()
);

create index vehicle_historial_vehicle on public.vehicle_historial (vehicle_id, created_at);

-- Llista per a Administració: Responsable resolt i "pendent de classificar".
create view public.vehicles_llista with (security_invoker = true) as
  select
    v.*,
    c.nom as centre_nom,
    case when v.motiu = 'vs' then cap.id else r.id end as responsable_efectiu_id,
    case when v.motiu = 'vs' then cap.nom else r.nom end as responsable_nom,
    (v.motiu is null
      or (v.motiu = 'vs' and cap.id is null)
      or (v.motiu <> 'vs' and (r.id is null or not r.actiu))) as pendent
  from public.vehicles_assegurats v
  left join public.centres c on c.id = v.centre_id
  left join public.usuaris r on r.id = v.responsable_id
  left join lateral (
    select u.id, u.nom
    from public.usuaris u
    join public.usuari_rols ur on ur.usuari_id = u.id and ur.rol = 'cap_postvenda'
    where u.actiu
    order by u.nom
    limit 1
  ) cap on true;

-- Registre de la càrrega inicial: es conserva el resultat (files descartades) per consultar-lo després.
create table public.carregues_flota (
  id uuid primary key default gen_random_uuid(),
  num_vehicles integer not null,
  descartades jsonb not null default '[]'::jsonb,
  carregat_per uuid not null references public.usuaris (id),
  created_at timestamptz not null default now()
);

-- Càrrega inicial des del Llistat de flota. Una sola vegada, tot o res.
create or replace function public.carrega_inicial_flota(p_vehicles jsonb, p_descartades jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
  v_num integer;
begin
  if v_usuari is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  if coalesce(jsonb_array_length(p_vehicles), 0) = 0 then
    raise exception 'sense_vehicles' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('carrega_inicial_flota'));
  if exists (select 1 from public.vehicles_assegurats) or exists (select 1 from public.carregues_flota) then
    raise exception 'ja_carregat' using errcode = 'P0001';
  end if;
  -- Una càrrega inicial només crea vehicles Assegurats o Enviats a la corredoria.
  if exists (
    select 1 from jsonb_to_recordset(p_vehicles) as r(estat text)
    where r.estat is null or r.estat not in ('assegurat', 'enviat')
  ) then
    raise exception 'estat_invalid' using errcode = 'P0001';
  end if;

  with x as (
    select * from jsonb_to_recordset(p_vehicles) as r(
      matricula text, polissa text, estat public.estat_vehicle, cobertura public.cobertura_vehicle,
      franquicia numeric, data_alta date, data_venciment date, prima_neta numeric, prima_total numeric,
      marca_model text, nota text
    )
  ),
  ins as (
    insert into public.vehicles_assegurats (
      matricula, polissa, estat, cobertura, franquicia, data_alta, data_venciment,
      prima_neta, prima_total, marca_model, vin, color, nota, origen
    )
    select
      x.matricula, x.polissa, x.estat, x.cobertura, x.franquicia, x.data_alta, x.data_venciment,
      x.prima_neta, x.prima_total,
      coalesce(x.marca_model, nullif(trim(concat_ws(' ', e.marca, e.model)), '')),
      e.vin, e.color, x.nota, 'carrega_inicial'
    from x
    left join public.estoc_vigent e on e.matricula = x.matricula
    returning id, estat
  )
  insert into public.vehicle_historial (vehicle_id, estat, comentari, usuari_id)
  select id, estat, 'Càrrega inicial', v_usuari from ins;

  get diagnostics v_num = row_count;

  insert into public.carregues_flota (num_vehicles, descartades, carregat_per)
  values (v_num, coalesce(p_descartades, '[]'::jsonb), v_usuari);

  return v_num;
end $$;

-- Classificació d'un vehicle (UJ-5): Motiu, Responsable, Centre i Data prevista de baixa.
-- p_versio = updated_at que l'usuari tenia a la pantalla: si algú ha desat abans, no es trepitja.
create or replace function public.classifica_vehicle(
  p_id uuid, p_motiu public.motiu_vehicle, p_responsable uuid, p_centre smallint,
  p_data_prevista_baixa date, p_versio timestamptz
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actual record;
begin
  if public.usuari_actual_id() is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  if p_motiu is distinct from 'vs' and p_responsable is not null
     and not exists (select 1 from public.usuaris where id = p_responsable and actiu) then
    raise exception 'responsable' using errcode = 'P0001';
  end if;

  select data_prevista_baixa, updated_at into v_actual
  from public.vehicles_assegurats
  where id = p_id and estat not in ('rebutjat', 'tancat')
  for update;
  if not found then
    raise exception 'no_trobat' using errcode = 'P0001';
  end if;
  if v_actual.updated_at is distinct from p_versio then
    raise exception 'canviat' using errcode = 'P0001';
  end if;
  -- Una data ja passada que no es toca no impedeix desar la resta de camps.
  if p_data_prevista_baixa is distinct from v_actual.data_prevista_baixa
     and p_data_prevista_baixa < (now() at time zone 'Europe/Madrid')::date then
    raise exception 'data_passada' using errcode = 'P0001';
  end if;

  update public.vehicles_assegurats
  set motiu = p_motiu,
      responsable_id = case when p_motiu = 'vs' then null else p_responsable end,
      centre_id = p_centre,
      data_prevista_baixa = p_data_prevista_baixa
  where id = p_id;
end $$;

revoke execute on function public.carrega_inicial_flota(jsonb, jsonb) from public, anon;
grant execute on function public.carrega_inicial_flota(jsonb, jsonb) to authenticated;
revoke execute on function public.classifica_vehicle(uuid, public.motiu_vehicle, uuid, smallint, date, timestamptz) from public, anon;
grant execute on function public.classifica_vehicle(uuid, public.motiu_vehicle, uuid, smallint, date, timestamptz) to authenticated;

alter table public.vehicles_assegurats enable row level security;
alter table public.vehicle_historial enable row level security;
alter table public.carregues_flota enable row level security;

-- De moment, només Administració. Escriptura només per les funcions.
create policy vehicles_assegurats_lectura on public.vehicles_assegurats for select to authenticated
  using (public.es_admin());
create policy vehicle_historial_lectura on public.vehicle_historial for select to authenticated
  using (public.es_admin());
create policy carregues_flota_lectura on public.carregues_flota for select to authenticated
  using (public.es_admin());
