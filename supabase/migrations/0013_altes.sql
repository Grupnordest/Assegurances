-- Circuit d'altes de Tot risc (PRD FR-5, FR-6, FR-7, FR-8).
-- Sol·licitat → (Rebutjat) | Enviat a la corredoria → Assegurat. El correu d'alta va en dues fases:
-- enviament_alta = 'enviant' mentre s'envia; si queda així, és un enviament incert a resoldre a mà.

alter table public.vehicles_assegurats
  add column if not exists sollicitant_id uuid references public.usuaris (id),
  add column if not exists validat_per uuid references public.usuaris (id),
  add column if not exists validat_at timestamptz,
  add column if not exists motiu_rebuig text,
  add column if not exists comentari text,
  -- [davant, darrere, dret, esquerre]: camins al bucket privat "documents"
  add column if not exists fotos jsonb,
  add column if not exists pc_path text,
  add column if not exists ft_path text,
  add column if not exists enviament_alta text check (enviament_alta in ('enviant'));

create or replace function public.te_rol(p_rol public.rol_usuari) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.usuari_rols r join public.usuaris u on u.id = r.usuari_id
    where u.email = public.email_sessio() and u.actiu and r.rol = p_rol
  )
$$;

-- Qui pot validar una sol·licitud segons el Motiu (matriu de permisos del PRD).
create or replace function public.pot_validar(p_motiu public.motiu_vehicle) returns boolean
language sql stable security definer set search_path = public as $$
  select public.es_admin()
    or (p_motiu = 'vs' and public.te_rol('cap_postvenda'))
    or (p_motiu is distinct from 'vs' and public.te_rol('validador'))
$$;

-- Cerca exacta a l'Estoc vigent per a qualsevol usuari actiu, amb l'estat del cicle obert
-- i els documents (PC/FT) d'una alta anterior de la mateixa matrícula, si n'hi ha.
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
  select matricula, vin, marca, model, color into v_estoc from public.estoc_vigent where matricula = p_matricula;
  if not found then
    return jsonb_build_object('a_estoc', false);
  end if;
  select l.estat, l.responsable_nom into v_obert
    from public.vehicles_llista l
    where l.matricula = p_matricula and l.estat not in ('rebutjat', 'tancat')
    limit 1;
  select pc_path, ft_path into v_docs from public.vehicles_assegurats
    where matricula = p_matricula and pc_path is not null and ft_path is not null
    order by created_at desc limit 1;
  return jsonb_build_object(
    'a_estoc', true,
    'vin', v_estoc.vin, 'marca', v_estoc.marca, 'model', v_estoc.model, 'color', v_estoc.color,
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

  select matricula, vin, marca, model, color into v_estoc from public.estoc_vigent where matricula = p_matricula;
  if not found then
    raise exception 'fora_estoc' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('alta:' || p_matricula));
  if exists (select 1 from public.vehicles_assegurats where matricula = p_matricula and estat not in ('rebutjat', 'tancat')) then
    raise exception 'ja_assegurat' using errcode = 'P0001';
  end if;

  -- Documents d'una alta anterior si no se n'han pujat de nous.
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

-- Reserva la validació abans d'enviar el correu d'alta. El Validador pot canviar la Cobertura.
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
    set enviament_alta = 'enviant', cobertura = coalesce(p_cobertura, cobertura),
        franquicia = case when coalesce(p_cobertura, cobertura) = 'tot_risc' then coalesce(franquicia, 300) else null end,
        validat_per = v_usuari, validat_at = now()
    where id = p_id;
end $$;

create or replace function public.confirma_alta(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v record;
begin
  if public.usuari_actual_id() is null then
    raise exception 'permis' using errcode = '42501';
  end if;
  select * into v from public.vehicles_assegurats where id = p_id for update;
  if not found then
    raise exception 'no_trobat' using errcode = 'P0001';
  end if;
  if not public.pot_validar(v.motiu) then
    raise exception 'permis' using errcode = '42501';
  end if;
  if v.estat = 'enviat' and v.enviament_alta is null then
    return;
  end if;
  if v.estat <> 'sollicitat' or v.enviament_alta is distinct from 'enviant' then
    raise exception 'ja_resolt' using errcode = 'P0001';
  end if;
  update public.vehicles_assegurats set estat = 'enviat', enviament_alta = null where id = p_id;
  insert into public.vehicle_historial (vehicle_id, estat, comentari, usuari_id)
  values (p_id, 'enviat', 'Validada i enviada a la corredoria', v.validat_per);
end $$;

create or replace function public.descarta_alta(p_id uuid) returns void
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
  update public.vehicles_assegurats set enviament_alta = null, validat_per = null, validat_at = null where id = p_id;
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
  if v.estat <> 'sollicitat' or v.enviament_alta is not null then
    raise exception 'ja_resolt' using errcode = 'P0001';
  end if;
  update public.vehicles_assegurats
    set estat = 'rebutjat', motiu_rebuig = trim(p_motiu), validat_per = v_usuari, validat_at = now()
    where id = p_id;
  insert into public.vehicle_historial (vehicle_id, estat, comentari, usuari_id)
  values (p_id, 'rebutjat', trim(p_motiu), v_usuari);
end $$;

-- Administració: Enviat a la corredoria → Assegurat amb el PDF de la pòlissa (fins que hi hagi FR-10).
create or replace function public.marca_assegurat(p_id uuid, p_polissa text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
begin
  if v_usuari is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  update public.vehicles_assegurats set estat = 'assegurat', polissa_path = p_polissa
    where id = p_id and estat = 'enviat' and enviament_alta is null;
  if not found then
    raise exception 'estat_alta' using errcode = 'P0001';
  end if;
  insert into public.vehicle_historial (vehicle_id, estat, comentari, usuari_id)
  values (p_id, 'assegurat', 'Pòlissa rebuda', v_usuari);
end $$;

-- Lectura: Administració tot; cadascú les seves sol·licituds; els Validadors les que poden validar.
drop policy if exists vehicles_assegurats_lectura on public.vehicles_assegurats;
create policy vehicles_assegurats_lectura on public.vehicles_assegurats for select to authenticated
  using (
    public.es_admin()
    or sollicitant_id = public.usuari_actual_id()
    or (estat = 'sollicitat' and public.pot_validar(motiu))
  );

revoke execute on function public.te_rol(public.rol_usuari) from public, anon;
revoke execute on function public.pot_validar(public.motiu_vehicle) from public, anon;
revoke execute on function public.cerca_estoc(text) from public, anon;
revoke execute on function public.crea_sollicitud_alta(text, public.motiu_vehicle, date, smallint, public.cobertura_vehicle, jsonb, text, text, date, text) from public, anon;
revoke execute on function public.prepara_validacio_alta(uuid, public.cobertura_vehicle) from public, anon;
revoke execute on function public.confirma_alta(uuid) from public, anon;
revoke execute on function public.descarta_alta(uuid) from public, anon;
revoke execute on function public.rebutja_alta(uuid, text) from public, anon;
revoke execute on function public.marca_assegurat(uuid, text) from public, anon;
grant execute on function public.te_rol(public.rol_usuari) to authenticated;
grant execute on function public.pot_validar(public.motiu_vehicle) to authenticated;
grant execute on function public.cerca_estoc(text) to authenticated;
grant execute on function public.crea_sollicitud_alta(text, public.motiu_vehicle, date, smallint, public.cobertura_vehicle, jsonb, text, text, date, text) to authenticated;
grant execute on function public.prepara_validacio_alta(uuid, public.cobertura_vehicle) to authenticated;
grant execute on function public.confirma_alta(uuid) to authenticated;
grant execute on function public.descarta_alta(uuid) to authenticated;
grant execute on function public.rebutja_alta(uuid, text) to authenticated;
grant execute on function public.marca_assegurat(uuid, text) to authenticated;
