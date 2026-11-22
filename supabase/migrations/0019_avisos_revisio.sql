-- Revisió dels Avisos:
-- * respondre "baixa" és atòmic: es bloqueja l'Avís, es crea la baixa i es resol en una sola transacció;
-- * si el correu de baixa falla, l'Avís es reobre (no es perd la petició);
-- * un Avís cancel·lat o resolt amb una baixa que no ha prosperat no bloqueja Avisos futurs;
-- * una baixa pendent de pòlissa no s'envia mai amb data passada i es pot anul·lar;
-- * els destinataris només veuen el vehicle mentre l'Avís està pendent.

alter table public.avisos add column if not exists baixa_id uuid references public.baixes (id);

alter table public.avisos drop constraint if exists avisos_vehicle_id_clau_key;
create unique index if not exists avisos_clau_vigent on public.avisos (vehicle_id, clau)
  where estat <> 'cancelat' and resposta is distinct from 'baixa';

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
  if not found or a.estat <> 'pendent' then
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
    set estat = 'resolt', resposta = 'baixa', resposta_data = p_data, resolt_per = p_usuari, resolt_at = now(), baixa_id = v_baixa
    where id = p_avis;
  update public.avisos set estat = 'cancelat'
    where vehicle_id = a.vehicle_id and estat = 'pendent' and id <> p_avis;
  return v_baixa;
end $$;

-- El correu de baixa ha fallat segur: la baixa queda fallida i l'Avís torna a estar pendent.
create or replace function public.falla_baixa_avis(p_baixa uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.baixes set estat = 'fallida' where id = p_baixa and estat = 'enviant';
  update public.avisos
    set estat = 'pendent', resposta = null, resposta_data = null, resolt_per = null, resolt_at = null, baixa_id = null
    where baixa_id = p_baixa and estat = 'resolt'
      and not exists (select 1 from public.avisos x where x.vehicle_id = avisos.vehicle_id and x.estat = 'pendent');
end $$;

-- Amb data passada, la baixa pendent s'envia amb data d'avui (ara retorna la data final).
drop function if exists public.activa_baixa_pendent(uuid, text);
create or replace function public.activa_baixa_pendent(p_baixa uuid, p_polissa text) returns date
language plpgsql security definer set search_path = public as $$
declare
  v_data date;
begin
  if public.usuari_actual_id() is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  update public.baixes
    set estat = 'enviant', justificant_path = p_polissa, data_baixa = greatest(data_baixa, public.avui_madrid())
    where id = p_baixa and estat = 'pendent_polissa'
    returning data_baixa into v_data;
  if not found then
    raise exception 'estat_baixa' using errcode = 'P0001';
  end if;
  return v_data;
end $$;

create or replace function public.cancela_baixa_pendent(p_baixa uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.usuari_actual_id() is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  update public.baixes set estat = 'anullada', anullada_at = now(), anullada_per = public.usuari_actual_id()
    where id = p_baixa and estat = 'pendent_polissa';
  if not found then
    raise exception 'estat_baixa' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.te_avis_del_vehicle(p_vehicle uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.avisos a join public.avis_enllacos e on e.avis_id = a.id
    where a.vehicle_id = p_vehicle and a.estat = 'pendent' and e.usuari_id = public.usuari_actual_id()
  )
$$;

drop function if exists public.prepara_baixa_avis(uuid, date, numeric, uuid, text);
revoke execute on function public.respon_baixa_avis(uuid, uuid, date, numeric, text) from public, anon, authenticated;
revoke execute on function public.falla_baixa_avis(uuid) from public, anon, authenticated;
grant execute on function public.respon_baixa_avis(uuid, uuid, date, numeric, text) to service_role;
grant execute on function public.falla_baixa_avis(uuid) to service_role;
revoke execute on function public.activa_baixa_pendent(uuid, text) from public, anon;
grant execute on function public.activa_baixa_pendent(uuid, text) to authenticated;
revoke execute on function public.cancela_baixa_pendent(uuid) from public, anon;
grant execute on function public.cancela_baixa_pendent(uuid) to authenticated;
