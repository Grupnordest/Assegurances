-- Revisió de la baixa real: un enviament incert no caduca sol (evita correus duplicats a la Corredoria).
-- Les reserves en 'enviant' o 'anullant' només es resolen a mà ("Sí, ha sortit" / "No ha sortit").

create or replace function public.prepara_baixa(
  p_vehicle uuid, p_data date, p_tipus text, p_extorn numeric
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
  v_estat public.estat_vehicle;
  v_en_curs text;
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

  select estat into v_en_curs from public.baixes
    where vehicle_id = p_vehicle and estat in ('enviant', 'enviada', 'anullant');
  if v_en_curs in ('enviant', 'anullant') then
    raise exception 'pendent_confirmar' using errcode = 'P0001';
  end if;
  if v_en_curs = 'enviada' or v_estat in ('baixa_enviada', 'donat_de_baixa') then
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

-- Només des de 'enviant' i amb el vehicle encara Assegurat. Idempotent si ja és 'enviada'.
create or replace function public.confirma_baixa(p_baixa uuid, p_justificant text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
  b record;
  v_estat public.estat_vehicle;
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
  if b.estat <> 'enviant' then
    raise exception 'estat_baixa' using errcode = 'P0001';
  end if;
  select estat into v_estat from public.vehicles_assegurats where id = b.vehicle_id for update;
  if v_estat <> 'assegurat' then
    raise exception 'estat_baixa' using errcode = 'P0001';
  end if;

  update public.baixes
    set estat = 'enviada', justificant_path = coalesce(p_justificant, justificant_path), enviada_at = now()
    where id = p_baixa;
  update public.vehicles_assegurats set estat = 'baixa_enviada' where id = b.vehicle_id;
  insert into public.vehicle_historial (vehicle_id, estat, comentari, usuari_id)
  values (b.vehicle_id, 'baixa_enviada', 'Baixa amb data ' || to_char(b.data_baixa, 'DD/MM/YYYY'), v_usuari);
end $$;

-- Desa el justificant abans d'enviar, perquè "Sí, ha sortit" el conservi.
create or replace function public.desa_justificant(p_baixa uuid, p_justificant text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.usuari_actual_id() is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  update public.baixes set justificant_path = p_justificant where id = p_baixa and estat = 'enviant';
end $$;

create or replace function public.comenca_anullacio(p_vehicle uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  b record;
begin
  if public.usuari_actual_id() is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  perform 1 from public.vehicles_assegurats where id = p_vehicle for update;

  select * into b from public.baixes where vehicle_id = p_vehicle and estat in ('enviant', 'enviada', 'anullant');
  if found and b.estat in ('enviant', 'anullant') then
    raise exception 'pendent_confirmar' using errcode = 'P0001';
  end if;
  if not found then
    raise exception 'sense_baixa' using errcode = 'P0001';
  end if;
  if public.avui_madrid() >= b.data_baixa then
    raise exception 'massa_tard' using errcode = 'P0001';
  end if;

  update public.baixes set estat = 'anullant' where id = b.id;
  return b.id;
end $$;

-- La vigent és la relació amb la data d'AXA més recent (no la darrera pujada).
create or replace view public.relacio_flota_vigent with (security_invoker = true) as
  select * from public.relacions_flota_vo order by data_relacio desc, created_at desc, id desc limit 1;

revoke execute on function public.desa_justificant(uuid, text) from public, anon;
grant execute on function public.desa_justificant(uuid, text) to authenticated;
grant select on public.relacio_flota_vigent to authenticated;
