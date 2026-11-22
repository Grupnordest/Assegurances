-- Avisos (PRD FR-13, FR-14, FR-15, FR-16, FR-32). La revisió diària i les respostes des del correu
-- s'executen al servidor amb la clau de servei: les funcions d'aquí són només per a service_role.

create table public.avisos (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles_assegurats (id) on delete cascade,
  tipus text not null check (tipus in ('set_dies', 'data_prevista', 'vs_12m', 'demo_4m')),
  -- Clau d'idempotència: el mateix Avís no es crea dues vegades (p. ex. 'data_prevista:2026-11-28').
  clau text not null,
  nivell smallint not null default 0 check (nivell in (0, 1)),
  estat text not null default 'pendent' check (estat in ('pendent', 'resolt', 'cancelat', 'excepcio')),
  resposta text check (resposta in ('baixa', 'mante', 'mante_fins')),
  resposta_data date,
  resolt_per uuid references public.usuaris (id),
  resolt_at timestamptz,
  enviat_at timestamptz not null default now(),
  escalat_at timestamptz,
  created_at timestamptz not null default now(),
  unique (vehicle_id, clau)
);
-- Un sol Avís obert per vehicle.
create unique index avisos_un_pendent on public.avisos (vehicle_id) where estat = 'pendent';
create index avisos_estat on public.avisos (estat, enviat_at);

-- Enllaços personals dels correus: només se'n desa el hash. Un per destinatari i nivell.
create table public.avis_enllacos (
  id uuid primary key default gen_random_uuid(),
  avis_id uuid not null references public.avisos (id) on delete cascade,
  usuari_id uuid not null references public.usuaris (id),
  testimoni_hash text not null unique,
  caduca timestamptz not null,
  created_at timestamptz not null default now()
);
create index avis_enllacos_usuari on public.avis_enllacos (usuari_id);

-- Baixa demanada des d'un Avís d'un vehicle sense pòlissa: espera que Administració la pugi.
alter table public.baixes drop constraint baixes_estat_check;
alter table public.baixes add constraint baixes_estat_check
  check (estat in ('pendent_polissa', 'enviant', 'enviada', 'anullant', 'anullada', 'fallida'));
drop index if exists public.baixes_una_en_curs;
create unique index baixes_una_en_curs on public.baixes (vehicle_id)
  where estat in ('pendent_polissa', 'enviant', 'enviada', 'anullant');

-- Resol un Avís (i cancel·la els altres pendents del vehicle). 'mante_fins' fixa la Data prevista de baixa.
create or replace function public.resol_avis(p_avis uuid, p_usuari uuid, p_resposta text, p_data date)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  a record;
  v_estat public.estat_vehicle;
begin
  select * into a from public.avisos where id = p_avis for update;
  if not found or a.estat <> 'pendent' then
    raise exception 'avis_resolt' using errcode = 'P0001';
  end if;
  if p_resposta not in ('baixa', 'mante', 'mante_fins') then
    raise exception 'resposta' using errcode = 'P0001';
  end if;
  if p_resposta = 'mante_fins' then
    if p_data is null or p_data <= public.avui_madrid() then
      raise exception 'data_passada' using errcode = 'P0001';
    end if;
    select estat into v_estat from public.vehicles_assegurats where id = a.vehicle_id for update;
    update public.vehicles_assegurats set data_prevista_baixa = p_data where id = a.vehicle_id;
    insert into public.vehicle_historial (vehicle_id, estat, comentari, usuari_id)
    values (a.vehicle_id, v_estat, 'Es manté fins al ' || to_char(p_data, 'DD/MM/YYYY') || ' (resposta a un avís)', p_usuari);
  end if;
  update public.avisos
    set estat = 'resolt', resposta = p_resposta, resposta_data = p_data, resolt_per = p_usuari, resolt_at = now()
    where id = p_avis;
  update public.avisos set estat = 'cancelat'
    where vehicle_id = a.vehicle_id and estat = 'pendent' and id <> p_avis;
  return a.vehicle_id;
end $$;

-- Baixa des d'un Avís (autor = qui respon). Amb pòlissa → 'enviant' (s'envia el correu); sense → 'pendent_polissa'.
create or replace function public.prepara_baixa_avis(
  p_vehicle uuid, p_data date, p_extorn numeric, p_usuari uuid, p_polissa text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_estat public.estat_vehicle;
  v_id uuid;
begin
  if p_data is null or p_data < public.avui_madrid() then
    raise exception 'data_passada' using errcode = 'P0001';
  end if;
  select estat into v_estat from public.vehicles_assegurats where id = p_vehicle for update;
  if not found then
    raise exception 'no_trobat' using errcode = 'P0001';
  end if;
  if v_estat <> 'assegurat'
     or exists (select 1 from public.baixes where vehicle_id = p_vehicle
                and estat in ('pendent_polissa', 'enviant', 'enviada', 'anullant')) then
    raise exception 'ja_baixa' using errcode = 'P0001';
  end if;
  insert into public.baixes (vehicle_id, data_baixa, justificant_tipus, justificant_path, extorn_esperat, estat, creat_per)
  values (p_vehicle, p_data, 'polissa', p_polissa, p_extorn,
          case when p_polissa is null then 'pendent_polissa' else 'enviant' end, p_usuari)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.confirma_baixa_avis(p_baixa uuid, p_usuari uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  b record;
begin
  select * into b from public.baixes where id = p_baixa for update;
  if not found or b.estat <> 'enviant' then
    raise exception 'estat_baixa' using errcode = 'P0001';
  end if;
  update public.baixes set estat = 'enviada', enviada_at = now() where id = p_baixa;
  update public.vehicles_assegurats set estat = 'baixa_enviada' where id = b.vehicle_id;
  insert into public.vehicle_historial (vehicle_id, estat, comentari, usuari_id)
  values (b.vehicle_id, 'baixa_enviada', 'Baixa amb data ' || to_char(b.data_baixa, 'DD/MM/YYYY') || ' (resposta a un avís)', p_usuari);
end $$;

create or replace function public.descarta_baixa_avis(p_baixa uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.baixes set estat = 'fallida' where id = p_baixa and estat = 'enviant';
end $$;

-- Administració: una baixa pendent de pòlissa passa a 'enviant' un cop desada la pòlissa del vehicle.
create or replace function public.activa_baixa_pendent(p_baixa uuid, p_polissa text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.usuari_actual_id() is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  update public.baixes set estat = 'enviant', justificant_path = p_polissa
    where id = p_baixa and estat = 'pendent_polissa';
  if not found then
    raise exception 'estat_baixa' using errcode = 'P0001';
  end if;
end $$;

alter table public.avisos enable row level security;
alter table public.avis_enllacos enable row level security;
create policy avisos_lectura on public.avisos for select to authenticated using (
  public.es_admin()
  or exists (select 1 from public.avis_enllacos e where e.avis_id = avisos.id and e.usuari_id = public.usuari_actual_id())
);
-- Cadascú veu els seus enllaços (només el hash; el testimoni no es desa enlloc).
create policy avis_enllacos_lectura on public.avis_enllacos for select to authenticated
  using (usuari_id = public.usuari_actual_id() or public.es_admin());
grant select on public.avisos, public.avis_enllacos to authenticated;

revoke execute on function public.resol_avis(uuid, uuid, text, date) from public, anon, authenticated;
revoke execute on function public.prepara_baixa_avis(uuid, date, numeric, uuid, text) from public, anon, authenticated;
revoke execute on function public.confirma_baixa_avis(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.descarta_baixa_avis(uuid) from public, anon, authenticated;
grant execute on function public.resol_avis(uuid, uuid, text, date) to service_role;
grant execute on function public.prepara_baixa_avis(uuid, date, numeric, uuid, text) to service_role;
grant execute on function public.confirma_baixa_avis(uuid, uuid) to service_role;
grant execute on function public.descarta_baixa_avis(uuid) to service_role;
revoke execute on function public.activa_baixa_pendent(uuid, text) from public, anon;
grant execute on function public.activa_baixa_pendent(uuid, text) to authenticated;
