-- Baixa real (PRD FR-9, FR-11, FR-23 i anul·lació): Relació de Flota VO, baixes i pas a Donat de baixa.

-- Documents (relacions d'AXA i justificants): bucket privat. Sense polítiques: només la clau de servei hi accedeix.
insert into storage.buckets (id, name, public) values ('documents', 'documents', false)
  on conflict (id) do nothing;

-- Data d'avui a Madrid.
create or replace function public.avui_madrid() returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'Europe/Madrid')::date
$$;

-- Relacions de Flota VO (PDF d'AXA). La vigent és l'última pujada.
create table public.relacions_flota_vo (
  id uuid primary key default gen_random_uuid(),
  data_relacio date not null,
  fitxer text not null,
  nom_fitxer text not null,
  matricules text[] not null check (cardinality(matricules) > 0),
  carregat_per uuid not null references public.usuaris (id),
  created_at timestamptz not null default clock_timestamp()
);

create view public.relacio_flota_vigent with (security_invoker = true) as
  select * from public.relacions_flota_vo order by created_at desc, id desc limit 1;

create or replace function public.registra_relacio(
  p_data date, p_fitxer text, p_nom_fitxer text, p_matricules text[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
  v_id uuid;
begin
  if v_usuari is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  insert into public.relacions_flota_vo (data_relacio, fitxer, nom_fitxer, matricules, carregat_per)
  values (p_data, p_fitxer, left(p_nom_fitxer, 200), p_matricules, v_usuari)
  returning id into v_id;
  return v_id;
end $$;

-- Baixes. Cicle: enviant → enviada (→ anullant → anullada) | fallida.
create table public.baixes (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles_assegurats (id) on delete cascade,
  data_baixa date not null,
  justificant_tipus text not null check (justificant_tipus in ('relacio', 'nou_titular')),
  justificant_path text,
  extorn_esperat numeric(10, 2),
  estat text not null default 'enviant' check (estat in ('enviant', 'enviada', 'anullant', 'anullada', 'fallida')),
  creat_per uuid not null references public.usuaris (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  enviada_at timestamptz,
  anullada_at timestamptz,
  anullada_per uuid references public.usuaris (id)
);

-- Una sola baixa en curs per vehicle.
create unique index baixes_una_en_curs on public.baixes (vehicle_id)
  where estat in ('enviant', 'enviada', 'anullant');

create trigger baixes_updated_at before update on public.baixes
  for each row execute function public.toca_updated_at();

-- Fase 1: reserva la baixa abans d'enviar el correu (un segon clic ja no passa).
create or replace function public.prepara_baixa(
  p_vehicle uuid, p_data date, p_tipus text, p_extorn numeric
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
  v_estat public.estat_vehicle;
  v_id uuid;
begin
  if v_usuari is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  if p_data is null or p_data < public.avui_madrid() then
    raise exception 'data_passada' using errcode = 'P0001';
  end if;

  select estat into v_estat from public.vehicles_assegurats where id = p_vehicle for update;
  if not found then
    raise exception 'no_trobat' using errcode = 'P0001';
  end if;

  -- Una reserva abandonada (el procés es va tallar a mig enviament) no bloqueja per sempre.
  update public.baixes set estat = 'fallida'
    where vehicle_id = p_vehicle and estat = 'enviant' and updated_at < now() - interval '10 minutes';

  if exists (select 1 from public.baixes where vehicle_id = p_vehicle and estat in ('enviant', 'enviada', 'anullant'))
     or v_estat in ('baixa_enviada', 'donat_de_baixa') then
    raise exception 'ja_baixa' using errcode = 'P0001';
  end if;
  if v_estat <> 'assegurat' then
    raise exception 'estat_baixa' using errcode = 'P0001';
  end if;

  insert into public.baixes (vehicle_id, data_baixa, justificant_tipus, extorn_esperat, creat_per)
  values (p_vehicle, p_data, p_tipus, p_extorn, v_usuari)
  returning id into v_id;
  return v_id;
end $$;

-- Fase 2a: el correu ha sortit. Idempotent.
create or replace function public.confirma_baixa(p_baixa uuid, p_justificant text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
  b record;
begin
  if v_usuari is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  select * into b from public.baixes where id = p_baixa for update;
  if not found then
    raise exception 'no_trobat' using errcode = 'P0001';
  end if;
  if b.estat = 'enviada' then
    return;
  end if;
  -- També des de 'fallida': si la reserva havia caducat però el correu ha sortit, mana el correu.
  if b.estat not in ('enviant', 'fallida') then
    raise exception 'estat_baixa' using errcode = 'P0001';
  end if;

  update public.baixes
    set estat = 'enviada', justificant_path = p_justificant, enviada_at = now()
    where id = p_baixa;
  update public.vehicles_assegurats set estat = 'baixa_enviada' where id = b.vehicle_id;
  insert into public.vehicle_historial (vehicle_id, estat, comentari, usuari_id)
  values (b.vehicle_id, 'baixa_enviada', 'Baixa amb data ' || to_char(b.data_baixa, 'DD/MM/YYYY'), v_usuari);
end $$;

-- Fase 2b: el correu no ha sortit.
create or replace function public.descarta_baixa(p_baixa uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.usuari_actual_id() is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  update public.baixes set estat = 'fallida' where id = p_baixa and estat = 'enviant';
end $$;

-- Anul·lació, també en dues fases. Només abans del dia de la baixa.
create or replace function public.comenca_anullacio(p_vehicle uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  b record;
begin
  if public.usuari_actual_id() is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  perform 1 from public.vehicles_assegurats where id = p_vehicle for update;

  update public.baixes set estat = 'enviada'
    where vehicle_id = p_vehicle and estat = 'anullant' and updated_at < now() - interval '10 minutes';

  select * into b from public.baixes where vehicle_id = p_vehicle and estat in ('enviant', 'enviada', 'anullant');
  if not found or b.estat <> 'enviada' then
    raise exception 'sense_baixa' using errcode = 'P0001';
  end if;
  if public.avui_madrid() >= b.data_baixa then
    raise exception 'massa_tard' using errcode = 'P0001';
  end if;

  update public.baixes set estat = 'anullant' where id = b.id;
  return b.id;
end $$;

create or replace function public.anula_baixa(p_baixa uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
  b record;
begin
  if v_usuari is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  select * into b from public.baixes where id = p_baixa for update;
  if not found then
    raise exception 'no_trobat' using errcode = 'P0001';
  end if;
  if b.estat = 'anullada' then
    return;
  end if;
  if b.estat <> 'anullant' then
    raise exception 'sense_baixa' using errcode = 'P0001';
  end if;

  update public.baixes set estat = 'anullada', anullada_at = now(), anullada_per = v_usuari where id = p_baixa;
  update public.vehicles_assegurats set estat = 'assegurat' where id = b.vehicle_id;
  insert into public.vehicle_historial (vehicle_id, estat, comentari, usuari_id)
  values (b.vehicle_id, 'assegurat', 'Baixa del ' || to_char(b.data_baixa, 'DD/MM/YYYY') || ' anul·lada', v_usuari);
end $$;

create or replace function public.reverteix_anullacio(p_baixa uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.usuari_actual_id() is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  update public.baixes set estat = 'enviada' where id = p_baixa and estat = 'anullant';
end $$;

-- Arriba la data de baixa → Donat de baixa (tasca programada; sense usuari).
create or replace function public.marca_donats_de_baixa() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_num integer;
begin
  with canviats as (
    update public.vehicles_assegurats v
      set estat = 'donat_de_baixa'
      from public.baixes b
      where b.vehicle_id = v.id and b.estat = 'enviada'
        and v.estat = 'baixa_enviada' and b.data_baixa <= public.avui_madrid()
      returning v.id
  )
  insert into public.vehicle_historial (vehicle_id, estat, comentari)
  select id, 'donat_de_baixa', 'Arriba la data de baixa' from canviats;
  get diagnostics v_num = row_count;
  return v_num;
end $$;

revoke execute on function public.marca_donats_de_baixa() from public, anon, authenticated;
revoke execute on function public.avui_madrid() from public, anon;
grant execute on function public.avui_madrid() to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'registra_relacio(date, text, text, text[])',
    'prepara_baixa(uuid, date, text, numeric)',
    'confirma_baixa(uuid, text)',
    'descarta_baixa(uuid)',
    'comenca_anullacio(uuid)',
    'anula_baixa(uuid)',
    'reverteix_anullacio(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

alter table public.relacions_flota_vo enable row level security;
alter table public.baixes enable row level security;

create policy relacions_flota_vo_lectura on public.relacions_flota_vo for select to authenticated
  using (public.es_admin());
create policy baixes_lectura on public.baixes for select to authenticated
  using (public.es_admin());

-- Cada hora (la funció fa servir la data de Madrid, així que és indiferent l'hora UTC).
create extension if not exists pg_cron;
select cron.schedule('marca-donats-de-baixa', '5 * * * *', 'select public.marca_donats_de_baixa()');
