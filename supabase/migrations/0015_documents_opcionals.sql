-- El PC i la FT ja no són obligatoris per demanar l'alta (els sol·licitants sovint no els tenen):
-- Administració els afegeix a "Pendents de validar" i l'alta no es pot enviar a la corredoria sense.

create or replace function public.crea_sollicitud_alta(
  p_matricula text, p_motiu public.motiu_vehicle, p_data_alta date, p_centre smallint,
  p_cobertura public.cobertura_vehicle, p_fotos jsonb, p_pc text, p_ft text,
  p_data_prevista date, p_comentari text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
  v_estoc record;
  v_pc text := p_pc;
  v_ft text := p_ft;
  v_carpeta text;
  v_prev record;
  v_id uuid;
begin
  if v_usuari is null then
    raise exception 'permis' using errcode = '42501';
  end if;
  if p_motiu is null or p_cobertura is null or p_centre is null then
    raise exception 'dades' using errcode = 'P0001';
  end if;
  if p_data_alta is null or p_data_alta < public.avui_madrid() then
    raise exception 'data_passada' using errcode = 'P0001';
  end if;
  if p_data_prevista is not null and p_data_prevista < p_data_alta then
    raise exception 'data_prevista' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_fotos) is distinct from 'array' or jsonb_array_length(p_fotos) <> 4 then
    raise exception 'fotos' using errcode = 'P0001';
  end if;
  v_carpeta := substring(p_fotos ->> 0 from '^(altes/[0-9a-f-]{36})/');
  if v_carpeta is null
     or p_fotos ->> 0 !~ ('^' || v_carpeta || '/davant\.(jpg|png)$')
     or p_fotos ->> 1 !~ ('^' || v_carpeta || '/darrere\.(jpg|png)$')
     or p_fotos ->> 2 !~ ('^' || v_carpeta || '/dret\.(jpg|png)$')
     or p_fotos ->> 3 !~ ('^' || v_carpeta || '/esquerre\.(jpg|png)$')
     or (p_pc is not null and p_pc !~ ('^' || v_carpeta || '/pc\.(jpg|png|pdf)$'))
     or (p_ft is not null and p_ft !~ ('^' || v_carpeta || '/ft\.(jpg|png|pdf)$'))
     or exists (select 1 from public.vehicles_assegurats where fotos ->> 0 like v_carpeta || '/%') then
    raise exception 'fotos' using errcode = 'P0001';
  end if;

  select matricula, vin, marca, model, color into v_estoc from public.estoc_vigent where matricula = p_matricula;
  if not found then
    raise exception 'fora_estoc' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('alta:' || p_matricula));
  if exists (select 1 from public.vehicles_assegurats
             where matricula = p_matricula and estat not in ('rebutjat', 'tancat', 'donat_de_baixa')) then
    raise exception 'ja_assegurat' using errcode = 'P0001';
  end if;

  -- El que no s'hagi pujat es reaprofita d'una alta anterior, si n'hi ha; si no, queda pendent.
  select pc_path, ft_path into v_prev from public.vehicles_assegurats
    where matricula = p_matricula and (pc_path is not null or ft_path is not null)
    order by created_at desc limit 1;
  v_pc := coalesce(v_pc, v_prev.pc_path);
  v_ft := coalesce(v_ft, v_prev.ft_path);

  insert into public.vehicles_assegurats (
    matricula, estat, motiu, responsable_id, centre_id, cobertura, franquicia, data_alta,
    marca_model, vin, color, data_prevista_baixa, origen, sollicitant_id, comentari, fotos, pc_path, ft_path
  ) values (
    p_matricula, 'sollicitat', p_motiu, case when p_motiu = 'vs' then null else v_usuari end, p_centre,
    p_cobertura, case when p_cobertura = 'tot_risc' then 300 else null end, p_data_alta,
    nullif(trim(concat_ws(' ', v_estoc.marca, v_estoc.model)), ''), v_estoc.vin, v_estoc.color,
    p_data_prevista, 'sollicitud', v_usuari, nullif(trim(p_comentari), ''), p_fotos, v_pc, v_ft
  ) returning id into v_id;

  insert into public.vehicle_historial (vehicle_id, estat, comentari, usuari_id)
  values (v_id, 'sollicitat', 'Sol·licitud d''alta', v_usuari);
  return v_id;
end $$;

-- Administració afegeix (o substitueix) el PC i/o la FT d'una sol·licitud pendent. Els fitxers van
-- a la mateixa carpeta que les fotos de la sol·licitud.
create or replace function public.afegeix_documents_alta(p_id uuid, p_pc text, p_ft text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_carpeta text;
begin
  if public.usuari_actual_id() is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  select * into v from public.vehicles_assegurats where id = p_id for update;
  if not found then
    raise exception 'no_trobat' using errcode = 'P0001';
  end if;
  if v.estat <> 'sollicitat' or v.enviament_alta is not null then
    raise exception 'ja_resolt' using errcode = 'P0001';
  end if;
  v_carpeta := substring(v.fotos ->> 0 from '^(altes/[0-9a-f-]{36})/');
  if v_carpeta is null
     or (p_pc is not null and p_pc !~ ('^' || v_carpeta || '/pc-[0-9a-f-]{36}\.(jpg|png|pdf)$'))
     or (p_ft is not null and p_ft !~ ('^' || v_carpeta || '/ft-[0-9a-f-]{36}\.(jpg|png|pdf)$')) then
    raise exception 'documents' using errcode = 'P0001';
  end if;
  update public.vehicles_assegurats
    set pc_path = coalesce(p_pc, pc_path), ft_path = coalesce(p_ft, ft_path)
    where id = p_id;
end $$;

-- Sense PC i FT no es pot reservar l'enviament a la corredoria.
create or replace function public.prepara_validacio_alta(p_id uuid, p_cobertura public.cobertura_vehicle) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
  v record;
begin
  if v_usuari is null then
    raise exception 'permis' using errcode = '42501';
  end if;
  select * into v from public.vehicles_assegurats where id = p_id for update;
  if not found then
    raise exception 'no_trobat' using errcode = 'P0001';
  end if;
  if not public.pot_validar(v.motiu) then
    raise exception 'permis' using errcode = '42501';
  end if;
  if v.enviament_alta = 'enviant' then
    raise exception 'pendent_confirmar' using errcode = 'P0001';
  end if;
  if v.estat <> 'sollicitat' then
    raise exception 'ja_resolt' using errcode = 'P0001';
  end if;
  if v.pc_path is null or v.ft_path is null then
    raise exception 'falten_documents' using errcode = 'P0001';
  end if;
  update public.vehicles_assegurats
    set enviament_alta = 'enviant', enviament_at = now(), cobertura = coalesce(p_cobertura, cobertura),
        franquicia = case when coalesce(p_cobertura, cobertura) = 'tot_risc' then coalesce(franquicia, 300) else null end,
        validat_per = v_usuari, validat_at = now()
    where id = p_id;
end $$;

revoke execute on function public.afegeix_documents_alta(uuid, text, text) from public, anon;
grant execute on function public.afegeix_documents_alta(uuid, text, text) to authenticated;
