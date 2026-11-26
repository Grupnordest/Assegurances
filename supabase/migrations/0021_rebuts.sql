-- Extorns i rebuts (PRD FR-24, FR-25): rebuts de la Corredoria, conciliació d'extorns i reclamació.
-- * Cada línia de rebut es desa una sola vegada (únic per num_rebut) i no s'esborra mai.
-- * Emissió (Clase 00/02): dona la prima al vehicle si no en té i recalcula les baixes en curs sense esperat.
-- * Extorn (Clase 93): es casa per matrícula amb la baixa 'enviada' no liquidada; si la suma dels extorns quadra (±1 €), es liquida.
-- * Les baixes 'anullada' o 'fallida' no es toquen mai.

create table public.rebuts (
  id uuid primary key default gen_random_uuid(),
  num_rebut text not null unique,
  polissa text,
  clase text not null,
  tipus text not null check (tipus in ('emissio', 'extorn')),
  inici date not null,
  fi date not null,
  prima_total numeric(10, 2) not null,
  prima_neta numeric(10, 2),
  liquid numeric(10, 2),
  situacio text,
  data_situacio date,
  matricula text not null check (matricula ~ '^[A-Z0-9]{4,10}$'),
  vehicle_id uuid references public.vehicles_assegurats (id),
  baixa_id uuid references public.baixes (id),
  fitxer text not null,
  importat_per uuid not null references public.usuaris (id),
  created_at timestamptz not null default now()
);

create index rebuts_matricula on public.rebuts (matricula);
create index rebuts_baixa on public.rebuts (baixa_id) where baixa_id is not null;
create index rebuts_created on public.rebuts (created_at desc);

alter table public.baixes add column if not exists extorn_liquidat numeric(10, 2);
alter table public.baixes add column if not exists liquidada_at timestamptz;
alter table public.baixes add column if not exists reclamada_at timestamptz;
alter table public.baixes add column if not exists comentari_liquidacio text;

-- Mateix càlcul que extornEsperat() de lib/extorns/calcula.ts: prima anual × dies fins al final
-- del Període de cartera (el pròxim 04/06 o 04/12 estrictament posterior) ÷ 365, a cèntims.
create or replace function public.extorn_esperat_de(p_prima numeric, p_data date) returns numeric
language sql immutable set search_path = public as $$
  select case when p_prima is null or p_prima <= 0 or p_data is null then null else
    round(p_prima * ((
      select min(c) from unnest(array[
        make_date(extract(year from p_data)::int, 6, 4),
        make_date(extract(year from p_data)::int, 12, 4),
        make_date(extract(year from p_data)::int + 1, 6, 4)
      ]) c where c > p_data
    ) - p_data) / 365.0, 2) end
$$;


-- Rebuts que Administració dona per revisats sense casar (no s'esborren mai).
alter table public.rebuts add column if not exists descartat_at timestamptz;
alter table public.rebuts add column if not exists comentari_descart text;
alter table public.rebuts add column if not exists descartat_per uuid references public.usuaris (id);
-- Valor de reclamada_at abans de la reserva, per poder-la desfer si el correu no surt.
alter table public.baixes add column if not exists reclamada_anterior timestamptz;

-- Una baixa amb un extorn ja rebut no es pot anul·lar.
create or replace function public.bloqueja_anullacio_amb_extorn() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.estat in ('anullant', 'anullada') and new.estat is distinct from old.estat and new.extorn_liquidat is not null then
    raise exception 'extorn_rebut' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger baixes_anullacio_amb_extorn before update on public.baixes
  for each row execute function public.bloqueja_anullacio_amb_extorn();

-- Tanca una baixa amb l'extorn liquidat (ús intern; no es pot cridar des de l'API).
-- Si la data de baixa encara no ha arribat, el vehicle es queda en Baixa enviada (la tasca diària el passarà
-- a Donat de baixa); si no, passa a Tancat.
create or replace function public.tanca_baixa_liquidada(
  p_baixa uuid, p_liquidat numeric, p_comentari text, p_usuari uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  b record;
  v_text text;
begin
  select * into b from public.baixes where id = p_baixa for update;
  if not found or b.estat <> 'enviada' or b.liquidada_at is not null then
    raise exception 'estat_baixa' using errcode = 'P0001';
  end if;
  update public.baixes
    set extorn_liquidat = p_liquidat, liquidada_at = now(), comentari_liquidacio = p_comentari
    where id = p_baixa;
  v_text := 'Extorn liquidat de ' || replace(to_char(p_liquidat, 'FM9999999990.00'), '.', ',') || ' €'
    || coalesce(' (esperat ' || replace(to_char(b.extorn_esperat, 'FM9999999990.00'), '.', ',') || ' €)', '')
    || coalesce('. ' || p_comentari, '');
  if b.data_baixa <= public.avui_madrid() then
    update public.vehicles_assegurats set estat = 'tancat'
      where id = b.vehicle_id and estat in ('baixa_enviada', 'donat_de_baixa');
    if found then
      insert into public.vehicle_historial (vehicle_id, estat, comentari, usuari_id)
      values (b.vehicle_id, 'tancat', v_text, p_usuari);
      return;
    end if;
  end if;
  -- Sense canvi d'estat: queda constància de l'extorn a l'historial.
  insert into public.vehicle_historial (vehicle_id, estat, comentari, usuari_id)
  select id, estat, v_text, p_usuari from public.vehicles_assegurats where id = b.vehicle_id;
end $$;

-- Casa una línia de rebut ja desada i sense casar (ús intern). Retorna el resultat:
-- 'emissio', 'prima', 'sense_vehicle', 'liquidat', 'incorrecte' o 'no_identificat'.
create or replace function public.casa_rebut(p_rebut uuid, p_usuari uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  x record;
  v_vehicle_id uuid;
  v_vehicle_prima numeric;
  v_baixa record;
  v_prima numeric;
  v_total numeric;
begin
  select * into x from public.rebuts where id = p_rebut for update;

  -- Bloqueja abans el vehicle i després la baixa (mateix ordre que les altres funcions de baixa).
  select id, prima_total into v_vehicle_id, v_vehicle_prima from public.vehicles_assegurats
    where matricula = x.matricula and estat not in ('rebutjat', 'tancat')
    order by created_at desc
    limit 1
    for update;

  if x.tipus = 'emissio' then
    if v_vehicle_id is null then
      return 'sense_vehicle';
    end if;
    update public.rebuts set vehicle_id = v_vehicle_id where id = p_rebut;
    if v_vehicle_prima is null and x.prima_total > 0 and x.fi > x.inici then
      v_prima := round(x.prima_total * 365 / (x.fi - x.inici), 2);
      update public.vehicles_assegurats
        set prima_total = v_prima, polissa = coalesce(polissa, x.polissa)
        where id = v_vehicle_id;
      update public.baixes
        set extorn_esperat = public.extorn_esperat_de(v_prima, data_baixa)
        where vehicle_id = v_vehicle_id and extorn_esperat is null
          and estat in ('pendent_polissa', 'enviant', 'enviada', 'anullant')
          and liquidada_at is null and extorn_liquidat is null;
      return 'prima';
    end if;
    return 'emissio';
  end if;

  -- Extorn: baixa enviada no liquidada del vehicle (també si ja té un extorn que no quadrava).
  select b.* into v_baixa
    from public.baixes b join public.vehicles_assegurats v on v.id = b.vehicle_id
    where v.matricula = x.matricula and b.estat = 'enviada' and b.liquidada_at is null
    order by (b.data_baixa = x.inici) desc, b.data_baixa desc, b.created_at desc
    limit 1
    for update of b;
  if not found then
    update public.rebuts set vehicle_id = v_vehicle_id where id = p_rebut;
    return 'no_identificat';
  end if;
  update public.rebuts set vehicle_id = v_baixa.vehicle_id, baixa_id = v_baixa.id where id = p_rebut;
  -- Liquidat = suma dels extorns enllaçats (els extorns porten import negatiu).
  select -sum(prima_total) into v_total from public.rebuts where baixa_id = v_baixa.id;
  -- Un extorn amb import positiu o zero no tanca mai res.
  if x.prima_total < 0 and v_total > 0
     and (v_baixa.extorn_esperat is null or abs(v_baixa.extorn_esperat - v_total) <= 1) then
    perform public.tanca_baixa_liquidada(v_baixa.id, v_total, null, p_usuari);
    return 'liquidat';
  end if;
  update public.baixes set extorn_liquidat = v_total where id = v_baixa.id;
  return 'incorrecte';
end $$;

-- Importa les línies d'un fitxer de rebuts en una sola transacció i reintenta casar les línies
-- anteriors que havien quedat sense casar. Retorna els comptadors.
create or replace function public.importa_rebuts(p_rebuts jsonb, p_fitxer text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
  x record;
  v_id uuid;
  v_nous uuid[] := '{}';
  v_res text;
  n_importades integer := 0;
  n_repetides integer := 0;
  n_recasades integer := 0;
  n jsonb := '{}';
begin
  if v_usuari is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  if p_rebuts is null or jsonb_typeof(p_rebuts) <> 'array' or p_fitxer is null or length(btrim(p_fitxer)) = 0 then
    raise exception 'dades' using errcode = 'P0001';
  end if;

  for x in
    select * from jsonb_to_recordset(p_rebuts) as r(
      num_rebut text, polissa text, clase text, tipus text, inici date, fi date,
      prima_total numeric, prima_neta numeric, liquid numeric, situacio text, data_situacio date, matricula text
    )
  loop
    if x.tipus is null or x.tipus not in ('emissio', 'extorn') or x.num_rebut is null or length(btrim(x.num_rebut)) = 0
       or x.matricula is null or x.inici is null or x.fi is null or x.prima_total is null or x.clase is null then
      raise exception 'dades' using errcode = 'P0001';
    end if;
    v_id := null;
    insert into public.rebuts (
      num_rebut, polissa, clase, tipus, inici, fi, prima_total, prima_neta, liquid,
      situacio, data_situacio, matricula, fitxer, importat_per
    ) values (
      btrim(x.num_rebut), left(x.polissa, 50), left(x.clase, 100), x.tipus, x.inici, x.fi,
      round(x.prima_total, 2), round(x.prima_neta, 2), round(x.liquid, 2),
      left(x.situacio, 100), x.data_situacio, x.matricula, left(p_fitxer, 200), v_usuari
    )
    on conflict (num_rebut) do nothing
    returning id into v_id;
    if v_id is null then
      n_repetides := n_repetides + 1;
    else
      n_importades := n_importades + 1;
      v_nous := v_nous || v_id;
    end if;
  end loop;

  -- Primer les emissions (donen la prima) i després els extorns, per data.
  for x in
    select id from public.rebuts where id = any(v_nous)
    order by case when tipus = 'emissio' then 0 else 1 end, inici, num_rebut
  loop
    v_res := public.casa_rebut(x.id, v_usuari);
    n := jsonb_set(n, array[v_res], to_jsonb(coalesce((n ->> v_res)::int, 0) + 1));
  end loop;

  -- Línies anteriors sense casar (p. ex. l'emissió va arribar abans que l'alta del vehicle).
  for x in
    select id from public.rebuts
    where descartat_at is null and not (id = any(v_nous))
      and ((tipus = 'emissio' and vehicle_id is null) or (tipus = 'extorn' and baixa_id is null))
    order by case when tipus = 'emissio' then 0 else 1 end, inici, num_rebut
  loop
    v_res := public.casa_rebut(x.id, v_usuari);
    if v_res not in ('sense_vehicle', 'no_identificat') then
      n_recasades := n_recasades + 1;
      n := jsonb_set(n, array[v_res], to_jsonb(coalesce((n ->> v_res)::int, 0) + 1));
    end if;
  end loop;

  return jsonb_build_object(
    'importades', n_importades, 'repetides', n_repetides, 'recasades', n_recasades,
    'emissions', coalesce((n ->> 'emissio')::int, 0) + coalesce((n ->> 'prima')::int, 0),
    'primes', coalesce((n ->> 'prima')::int, 0),
    'sense_vehicle', coalesce((n ->> 'sense_vehicle')::int, 0),
    'liquidats', coalesce((n ->> 'liquidat')::int, 0),
    'incorrectes', coalesce((n ->> 'incorrecte')::int, 0),
    'no_identificats', coalesce((n ->> 'no_identificat')::int, 0)
  );
end $$;

-- Administració accepta un extorn que no quadra, amb un comentari: la baixa queda liquidada.
create or replace function public.accepta_extorn(p_baixa uuid, p_comentari text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
  v_vehicle uuid;
  b record;
begin
  if v_usuari is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  if p_comentari is null or length(btrim(p_comentari)) = 0 then
    raise exception 'comentari' using errcode = 'P0001';
  end if;
  select vehicle_id into v_vehicle from public.baixes where id = p_baixa;
  if not found then
    raise exception 'no_trobat' using errcode = 'P0001';
  end if;
  perform 1 from public.vehicles_assegurats where id = v_vehicle for update;
  select * into b from public.baixes where id = p_baixa for update;
  if b.estat <> 'enviada' or b.liquidada_at is not null or b.extorn_liquidat is null then
    raise exception 'estat_baixa' using errcode = 'P0001';
  end if;
  perform public.tanca_baixa_liquidada(p_baixa, b.extorn_liquidat, left(btrim(p_comentari), 1000), v_usuari);
end $$;

-- Administració dona per revisada una línia sense casar (rebut sense vehicle o extorn no identificat).
create or replace function public.descarta_rebut(p_rebut uuid, p_comentari text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
begin
  if v_usuari is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  if p_comentari is null or length(btrim(p_comentari)) = 0 then
    raise exception 'comentari' using errcode = 'P0001';
  end if;
  update public.rebuts
    set descartat_at = now(), comentari_descart = left(btrim(p_comentari), 1000), descartat_per = v_usuari
    where id = p_rebut and descartat_at is null
      and ((tipus = 'emissio' and vehicle_id is null) or (tipus = 'extorn' and baixa_id is null));
  if not found then
    raise exception 'estat_rebut' using errcode = 'P0001';
  end if;
end $$;

-- Reclamació (FR-25), en dues fases per no enviar correus duplicats:
-- 1) reserva: amb bloqueig, marca només les baixes encara elegibles i les retorna;
-- 2) si el correu segur que no ha sortit, allibera torna reclamada_at al valor anterior.
create or replace function public.reserva_reclamacio(p_baixes uuid[]) returns setof uuid
language plpgsql security definer set search_path = public as $$
begin
  if public.usuari_actual_id() is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  -- L'UPDATE torna a avaluar les condicions sobre la fila bloquejada: un segon clic simultani no en marca cap.
  return query
    update public.baixes
      set reclamada_anterior = reclamada_at, reclamada_at = now()
      where id = any(coalesce(p_baixes, '{}')) and estat = 'enviada'
        and liquidada_at is null and extorn_liquidat is null
        and data_baixa + 60 <= public.avui_madrid()
        and (reclamada_at is null or reclamada_at <= now() - interval '15 days')
      returning id;
end $$;

create or replace function public.allibera_reclamacio(p_baixes uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.usuari_actual_id() is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  update public.baixes
    set reclamada_at = reclamada_anterior, reclamada_anterior = null
    where id = any(coalesce(p_baixes, '{}')) and reclamada_at is not null;
end $$;

-- Permisos.
alter table public.rebuts enable row level security;
create policy rebuts_lectura on public.rebuts for select to authenticated
  using (public.es_admin());
grant select on public.rebuts to authenticated;
grant all on public.rebuts to service_role;

revoke execute on function public.extorn_esperat_de(numeric, date) from public, anon, authenticated;
revoke execute on function public.tanca_baixa_liquidada(uuid, numeric, text, uuid) from public, anon, authenticated;
revoke execute on function public.casa_rebut(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.bloqueja_anullacio_amb_extorn() from public, anon, authenticated;
grant execute on function public.extorn_esperat_de(numeric, date) to service_role;
grant execute on function public.tanca_baixa_liquidada(uuid, numeric, text, uuid) to service_role;
grant execute on function public.casa_rebut(uuid, uuid) to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'importa_rebuts(jsonb, text)',
    'accepta_extorn(uuid, text)',
    'descarta_rebut(uuid, text)',
    'reserva_reclamacio(uuid[])',
    'allibera_reclamacio(uuid[])'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
