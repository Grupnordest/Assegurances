-- Revisió de l'enviament a Proassa:
-- * els enviaments en mode de proves no compten com a base de les altes i baixes;
-- * es desa a qui s'ha enviat;
-- * en reservar, es comprova que la base (últim enviament real) no ha canviat;
-- * "No ha sortit" sobre un enviament ja resolt dona error;
-- * les llistes addicionals es poden buidar.

alter table public.flota_enviaments add column if not exists proves boolean not null default false;
alter table public.flota_enviaments add column if not exists destinataris text;

drop function if exists public.prepara_enviament_flota(jsonb, text[], text[], text, timestamptz);

create or replace function public.prepara_enviament_flota(
  p_base uuid, p_vehicles jsonb, p_altes text[], p_baixes text[], p_nom_fitxer text,
  p_data_estoc timestamptz, p_proves boolean, p_destinataris text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
  v_base uuid;
  v_id uuid;
begin
  if v_usuari is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('flota_enviaments'));
  if exists (select 1 from public.flota_enviaments where estat = 'enviant') then
    raise exception 'pendent_confirmar' using errcode = 'P0001';
  end if;
  select id into v_base from public.flota_enviaments
    where estat = 'enviat' and not proves order by created_at desc limit 1;
  if v_base is distinct from p_base then
    raise exception 'base_canviada' using errcode = 'P0001';
  end if;
  insert into public.flota_enviaments
    (origen, vehicles, num_vehicles, altes, baixes, nom_fitxer, data_estoc, enviat_per, proves, destinataris)
  values ('eina', p_vehicles, jsonb_array_length(p_vehicles), coalesce(p_altes, '{}'), coalesce(p_baixes, '{}'),
          left(p_nom_fitxer, 200), p_data_estoc, v_usuari, coalesce(p_proves, false), left(p_destinataris, 500))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.descarta_enviament_flota(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.usuari_actual_id() is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  update public.flota_enviaments set estat = 'fallit' where id = p_id and estat = 'enviant';
  if not found and not exists (select 1 from public.flota_enviaments where id = p_id and estat = 'fallit') then
    raise exception 'ja_resolt' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.esborra_llista_flota(p_categoria text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.usuari_actual_id() is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  delete from public.flota_llistes where categoria = p_categoria;
end $$;

revoke execute on function public.prepara_enviament_flota(uuid, jsonb, text[], text[], text, timestamptz, boolean, text) from public, anon;
revoke execute on function public.esborra_llista_flota(text) from public, anon;
grant execute on function public.prepara_enviament_flota(uuid, jsonb, text[], text[], text, timestamptz, boolean, text) to authenticated;
grant execute on function public.esborra_llista_flota(text) to authenticated;
