-- Revisió del circuit d'altes:
-- * crea_sollicitud_alta només accepta camins dins d'una carpeta pròpia "altes/<uuid>/" (no es pot
--   apuntar a documents d'altres vehicles cridant l'RPC directament);
-- * un vehicle Donat de baixa es pot tornar a demanar (el cicle anterior ja no bloqueja la matrícula);
-- * la resolució manual d'un enviament incert només es permet passats 2 minuts (no mentre s'envia);
-- * no es pot reclassificar un vehicle mentre s'envia el correu d'alta;
-- * cerca_estoc ja no retorna el VIN.

drop index if exists public.vehicles_assegurats_matricula_oberta;
create unique index vehicles_assegurats_matricula_oberta on public.vehicles_assegurats (matricula)
  where estat not in ('rebutjat', 'tancat', 'donat_de_baixa');

alter table public.vehicles_assegurats add column if not exists enviament_at timestamptz;

create or replace function public.cerca_estoc(p_matricula text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_estoc record;
  v_obert record;
  v_docs record;
begin
  if public.usuari_actual_id() is null then
    raise exception 'permis' using errcode = '42501';
  end if;
  select matricula, marca, model, color into v_estoc from public.estoc_vigent where matricula = p_matricula;
  if not found then
    return jsonb_build_object('a_estoc', false);
  end if;
  select l.estat, l.responsable_nom into v_obert
    from public.vehicles_llista l
    where l.matricula = p_matricula and l.estat not in ('rebutjat', 'tancat', 'donat_de_baixa')
    limit 1;
  select pc_path, ft_path into v_docs from public.vehicles_assegurats
    where matricula = p_matricula and pc_path is not null and ft_path is not null
    order by created_at desc limit 1;
  return jsonb_build_object(
    'a_estoc', true,
    'marca', v_estoc.marca, 'model', v_estoc.model, 'color', v_estoc.color,
    'estat_obert', v_obert.estat, 'responsable', v_obert.responsable_nom,
    'docs_previs', v_docs.pc_path is not null
  );
end $$;

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

  -- Fotos: exactament davant, darrere, dret, esquerre, totes a la mateixa carpeta nova.
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

  -- Documents d'una alta anterior de la mateixa matrícula si no se n'han pujat de nous.
  if v_pc is null or v_ft is null then
    select pc_path, ft_path into v_pc, v_ft from public.vehicles_assegurats
      where matricula = p_matricula and pc_path is not null and ft_path is not null
      order by created_at desc limit 1;
  end if;
  if v_pc is null or v_ft is null then
    raise exception 'documents' using errcode = 'P0001';
  end if;

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
  update public.vehicles_assegurats
    set enviament_alta = 'enviant', enviament_at = now(), cobertura = coalesce(p_cobertura, cobertura),
        franquicia = case when coalesce(p_cobertura, cobertura) = 'tot_risc' then coalesce(franquicia, 300) else null end,
        validat_per = v_usuari, validat_at = now()
    where id = p_id;
end $$;

-- Resolució manual d'un enviament incert ("Sí, ha sortit" / "No ha sortit"). Mai mentre algú
-- encara l'està enviant (2 minuts de marge, més que el temps màxim de l'acció).
create or replace function public.resol_alta(p_id uuid, p_enviat boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v record;
begin
  if public.usuari_actual_id() is null then
    raise exception 'permis' using errcode = '42501';
  end if;
  select * into v from public.vehicles_assegurats where id = p_id for update;
  if not found or not public.pot_validar(v.motiu) then
    raise exception 'permis' using errcode = '42501';
  end if;
  if v.estat <> 'sollicitat' or v.enviament_alta is distinct from 'enviant' then
    raise exception 'ja_resolt' using errcode = 'P0001';
  end if;
  if v.enviament_at > now() - interval '2 minutes' then
    raise exception 'enviant_ara' using errcode = 'P0001';
  end if;
  if p_enviat then
    update public.vehicles_assegurats set estat = 'enviat', enviament_alta = null where id = p_id;
    insert into public.vehicle_historial (vehicle_id, estat, comentari, usuari_id)
    values (p_id, 'enviat', 'Validada i enviada a la corredoria (confirmat a mà)', public.usuari_actual_id());
  else
    update public.vehicles_assegurats set enviament_alta = null, enviament_at = null, validat_per = null, validat_at = null
      where id = p_id;
  end if;
end $$;

create or replace function public.rebutja_alta(p_id uuid, p_motiu text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
  v record;
begin
  if v_usuari is null then
    raise exception 'permis' using errcode = '42501';
  end if;
  if nullif(trim(p_motiu), '') is null then
    raise exception 'motiu_rebuig' using errcode = 'P0001';
  end if;
  select * into v from public.vehicles_assegurats where id = p_id for update;
  if not found then
    raise exception 'no_trobat' using errcode = 'P0001';
  end if;
  if not public.pot_validar(v.motiu) then
    raise exception 'permis' using errcode = '42501';
  end if;
  if v.enviament_alta is not null then
    raise exception 'pendent_confirmar' using errcode = 'P0001';
  end if;
  if v.estat <> 'sollicitat' then
    raise exception 'ja_resolt' using errcode = 'P0001';
  end if;
  update public.vehicles_assegurats
    set estat = 'rebutjat', motiu_rebuig = trim(p_motiu), validat_per = v_usuari, validat_at = now()
    where id = p_id;
  insert into public.vehicle_historial (vehicle_id, estat, comentari, usuari_id)
  values (p_id, 'rebutjat', trim(p_motiu), v_usuari);
end $$;

-- No es pot reclassificar mentre s'envia el correu d'alta (canviaria qui pot confirmar-lo).
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

  select data_prevista_baixa, updated_at, enviament_alta into v_actual
  from public.vehicles_assegurats
  where id = p_id and estat not in ('rebutjat', 'tancat')
  for update;
  if not found then
    raise exception 'no_trobat' using errcode = 'P0001';
  end if;
  if v_actual.enviament_alta is not null then
    raise exception 'canviat' using errcode = 'P0001';
  end if;
  if v_actual.updated_at is distinct from p_versio then
    raise exception 'canviat' using errcode = 'P0001';
  end if;
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

-- La resolució manual va per resol_alta; descarta_alta i confirma_alta queden per a l'acció que envia.
revoke execute on function public.resol_alta(uuid, boolean) from public, anon;
grant execute on function public.resol_alta(uuid, boolean) to authenticated;
