-- Incidències (PRD FR-17): Administració resol des de la safata els Avisos en excepció.
-- * resol_avis i respon_baixa_avis accepten un Avís en 'excepcio' si qui respon és Administració;
-- * tanca_excepcio_avis tanca un Avís en excepció amb un comentari (sense baixa ni canvis al vehicle);
-- * resums_incidencies garanteix un sol correu resum per dia.

alter table public.avisos add column if not exists comentari_tancament text;
-- Resolt per Administració des d'una excepció: si la baixa falla, l'Avís torna a 'excepcio' (no a 'pendent').
alter table public.avisos add column if not exists era_excepcio boolean not null default false;

-- Administració activa (per a les funcions que només crida el servidor amb l'usuari explícit).
create or replace function public.usuari_es_admin(p_usuari uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.usuari_rols r join public.usuaris u on u.id = r.usuari_id
    where u.id = p_usuari and u.actiu and r.rol = 'administracio'
  )
$$;

create or replace function public.resol_avis(p_avis uuid, p_usuari uuid, p_resposta text, p_data date)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  a record;
  v_estat public.estat_vehicle;
begin
  select * into a from public.avisos where id = p_avis for update;
  if not found
     or not (a.estat = 'pendent' or (a.estat = 'excepcio' and public.usuari_es_admin(p_usuari))) then
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
    set estat = 'resolt', resposta = p_resposta, resposta_data = p_data, resolt_per = p_usuari, resolt_at = now(),
        era_excepcio = (a.estat = 'excepcio')
    where id = p_avis;
  update public.avisos set estat = 'cancelat'
    where vehicle_id = a.vehicle_id and estat in ('pendent', 'excepcio') and id <> p_avis;
  return a.vehicle_id;
end $$;

create or replace function public.respon_baixa_avis(
  p_avis uuid, p_usuari uuid, p_data date, p_extorn numeric, p_polissa text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  a record;
  v_estat public.estat_vehicle;
  v_baixa uuid;
begin
  select * into a from public.avisos where id = p_avis for update;
  if not found
     or not (a.estat = 'pendent' or (a.estat = 'excepcio' and public.usuari_es_admin(p_usuari))) then
    raise exception 'avis_resolt' using errcode = 'P0001';
  end if;
  if p_data is null or p_data < public.avui_madrid() then
    raise exception 'data_passada' using errcode = 'P0001';
  end if;
  select estat into v_estat from public.vehicles_assegurats where id = a.vehicle_id for update;
  if v_estat <> 'assegurat'
     or exists (select 1 from public.baixes where vehicle_id = a.vehicle_id
                and estat in ('pendent_polissa', 'enviant', 'enviada', 'anullant')) then
    raise exception 'ja_baixa' using errcode = 'P0001';
  end if;
  insert into public.baixes (vehicle_id, data_baixa, justificant_tipus, justificant_path, extorn_esperat, estat, creat_per)
  values (a.vehicle_id, p_data, 'polissa', p_polissa, p_extorn,
          case when p_polissa is null then 'pendent_polissa' else 'enviant' end, p_usuari)
  returning id into v_baixa;
  update public.avisos
    set estat = 'resolt', resposta = 'baixa', resposta_data = p_data, resolt_per = p_usuari, resolt_at = now(), baixa_id = v_baixa,
        era_excepcio = (a.estat = 'excepcio')
    where id = p_avis;
  update public.avisos set estat = 'cancelat'
    where vehicle_id = a.vehicle_id and estat in ('pendent', 'excepcio') and id <> p_avis;
  return v_baixa;
end $$;

-- Tanca un Avís en excepció amb un comentari d'Administració. No toca el vehicle.
create or replace function public.tanca_excepcio_avis(p_avis uuid, p_usuari uuid, p_comentari text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.usuari_es_admin(p_usuari) then
    raise exception 'permis' using errcode = '42501';
  end if;
  if p_comentari is null or length(btrim(p_comentari)) = 0 then
    raise exception 'comentari' using errcode = 'P0001';
  end if;
  update public.avisos
    set estat = 'resolt', comentari_tancament = left(btrim(p_comentari), 1000), resolt_per = p_usuari, resolt_at = now()
    where id = p_avis and estat = 'excepcio';
  if not found then
    raise exception 'avis_resolt' using errcode = 'P0001';
  end if;
end $$;

-- El correu de baixa ha fallat segur: la baixa queda fallida i l'Avís torna on era ('pendent' o 'excepcio').
create or replace function public.falla_baixa_avis(p_baixa uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.baixes set estat = 'fallida' where id = p_baixa and estat = 'enviant';
  update public.avisos
    set estat = case when era_excepcio then 'excepcio' else 'pendent' end,
        resposta = null, resposta_data = null, resolt_per = null, resolt_at = null, baixa_id = null, era_excepcio = false
    where baixa_id = p_baixa and estat = 'resolt'
      and not exists (select 1 from public.avisos x where x.vehicle_id = avisos.vehicle_id and x.estat in ('pendent', 'excepcio'));
end $$;

-- Un sol resum diari: la revisió reclama el dia abans d'enviar-lo.
create table if not exists public.resums_incidencies (
  dia date primary key,
  enviat_at timestamptz not null default now()
);
alter table public.resums_incidencies enable row level security;

revoke execute on function public.usuari_es_admin(uuid) from public, anon, authenticated;
revoke execute on function public.tanca_excepcio_avis(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.resol_avis(uuid, uuid, text, date) from public, anon, authenticated;
revoke execute on function public.respon_baixa_avis(uuid, uuid, date, numeric, text) from public, anon, authenticated;
grant execute on function public.usuari_es_admin(uuid) to service_role;
grant execute on function public.tanca_excepcio_avis(uuid, uuid, text) to service_role;
grant execute on function public.resol_avis(uuid, uuid, text, date) to service_role;
grant execute on function public.respon_baixa_avis(uuid, uuid, date, numeric, text) to service_role;
revoke execute on function public.falla_baixa_avis(uuid) from public, anon, authenticated;
grant execute on function public.falla_baixa_avis(uuid) to service_role;
