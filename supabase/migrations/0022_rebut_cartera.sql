-- Conciliació del Rebut de cartera (PRD FR-22, FR-23).
-- * Cada semestre (04/06 i 04/12) la Corredoria envia un rebut amb una línia per vehicle (Clase 30) i una línia
--   de la pòlissa mare. Les línies NO es desen a public.rebuts: el rebut definitiu pot repetir el número.
-- * Una conciliació per període (inici únic). La darrera pujada substitueix l'anterior.
-- * Tipus de línia: 'ok', 'sense_control' (no hi ha cap cicle obert), 'cobrat_despres_baixa' (baixa amb data
--   ≤ inici, o sense baixa) i 'absent' (vehicle assegurat abans de l'inici que no surt al rebut).
--   Si data_baixa = inici, la línia té extorn_esperat null: l'extorn es controla a la baixa.
-- * Per a les línies 'ok', la prima del vehicle passa a ser l'equivalent anual de la línia (només si el període
--   no és més antic que el darrer conciliat).
-- * Els extorns (Clase 93) de la mateixa matrícula i amb el mateix inici s'enllacen a la línia
--   'cobrat_despres_baixa' (rebuts.cartera_linia_id; n'hi pot haver diversos). Si la suma quadra (±1 €) amb
--   l'extorn esperat (la prima sencera de la línia), la línia queda liquidada.

create table public.cartera_conciliacions (
  id uuid primary key default gen_random_uuid(),
  inici date not null unique,
  fi date not null check (fi > inici),
  fitxer text not null,
  -- Prima total de la línia de la pòlissa mare (null si el fitxer no la porta).
  prima_mare numeric(10, 2),
  suma_linies numeric(10, 2) not null,
  quadra boolean not null,
  importat_per uuid not null references public.usuaris (id),
  created_at timestamptz not null default now()
);

create table public.cartera_linies (
  id uuid primary key default gen_random_uuid(),
  conciliacio_id uuid not null references public.cartera_conciliacions (id) on delete cascade,
  tipus text not null check (tipus in ('ok', 'sense_control', 'cobrat_despres_baixa', 'absent')),
  -- Null a les línies 'absent' (el vehicle no és al rebut).
  num_rebut text,
  matricula text not null check (matricula ~ '^[A-Z0-9]{4,10}$'),
  polissa text,
  prima_total numeric(10, 2),
  prima_neta numeric(10, 2),
  -- Equivalent anual (prima × 365 ÷ dies del període), calculat a lib/extorns/calcula.ts.
  prima_anual numeric(10, 2),
  prima_neta_anual numeric(10, 2),
  vehicle_id uuid references public.vehicles_assegurats (id),
  baixa_id uuid references public.baixes (id),
  extorn_esperat numeric(10, 2),
  -- Darrer extorn enllaçat (tots els enllaçats són a rebuts.cartera_linia_id).
  extorn_rebut_id uuid references public.rebuts (id),
  liquidat_at timestamptz,
  descartat_at timestamptz,
  comentari_descart text,
  descartat_per uuid references public.usuaris (id),
  created_at timestamptz not null default now()
);

create index cartera_linies_conciliacio on public.cartera_linies (conciliacio_id);
create index cartera_linies_matricula on public.cartera_linies (matricula);
create index cartera_linies_oberta on public.cartera_linies (tipus)
  where tipus <> 'ok' and descartat_at is null and liquidat_at is null;

-- Extorns casats amb una línia de cartera (no tenen baixa_id). En reimportar el període es tornen a enllaçar.
alter table public.rebuts add column if not exists cartera_linia_id uuid
  references public.cartera_linies (id) on delete set null;
create index rebuts_cartera_linia on public.rebuts (cartera_linia_id) where cartera_linia_id is not null;

-- Vehicles creats des d'una línia "Assegurat sense control".
alter table public.vehicles_assegurats drop constraint if exists vehicles_assegurats_origen_check;
alter table public.vehicles_assegurats add constraint vehicles_assegurats_origen_check
  check (origen in ('carrega_inicial', 'sollicitud', 'rebut_cartera'));

-- Bloqueig d'un període de cartera (importació i descarts s'esperen l'un a l'altre). Ús intern.
create or replace function public.bloqueja_periode_cartera(p_inici date) returns void
language sql set search_path = public as $$
  select pg_advisory_xact_lock(hashtext('cartera'), hashtext(p_inici::text))
$$;

-- Recalcula una línia 'cobrat_despres_baixa' a partir de tots els extorns enllaçats (ús intern), com la branca
-- baixa de casa_rebut: liquidat = −suma; quadra si és > 0 i |esperat − liquidat| ≤ 1 €. Retorna 'liquidat',
-- 'incorrecte' o null (sense extorns).
create or replace function public.recalcula_linia_cartera(p_linia uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  l record;
  v_total numeric;
  v_darrer uuid;
begin
  select * into l from public.cartera_linies where id = p_linia for update;
  select -sum(prima_total) into v_total from public.rebuts where cartera_linia_id = p_linia;
  select id into v_darrer from public.rebuts where cartera_linia_id = p_linia order by created_at desc, num_rebut desc limit 1;
  if v_darrer is null then
    update public.cartera_linies set extorn_rebut_id = null, liquidat_at = null where id = p_linia;
    return null;
  end if;
  if v_total > 0 and l.extorn_esperat is not null and abs(l.extorn_esperat - v_total) <= 1 then
    update public.cartera_linies set extorn_rebut_id = v_darrer, liquidat_at = coalesce(liquidat_at, now()) where id = p_linia;
    return 'liquidat';
  end if;
  update public.cartera_linies set extorn_rebut_id = v_darrer, liquidat_at = null where id = p_linia;
  return 'incorrecte';
end $$;

-- casa_rebut: a la branca extorn,
--   1) una baixa enviada no liquidada amb data_baixa = inici de l'extorn té prioritat (és el seu extorn, també
--      quan la línia de cartera és del mateix dia: aquella línia no té extorn esperat propi);
--   2) si no, una línia 'cobrat_despres_baixa' no liquidada ni descartada del mateix període (s'hi poden
--      sumar diversos extorns, p. ex. un de correctiu);
--   3) si no, la branca baixa de 0021.
create or replace function public.casa_rebut(p_rebut uuid, p_usuari uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  x record;
  v_vehicle_id uuid;
  v_vehicle_prima numeric;
  v_baixa record;
  v_linia record;
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

  -- Extorn del semestre cobrat després de la baixa (si no hi ha una baixa pròpia amb la mateixa data).
  if not exists (
    select 1 from public.baixes b join public.vehicles_assegurats v on v.id = b.vehicle_id
    where v.matricula = x.matricula and b.estat = 'enviada' and b.liquidada_at is null and b.data_baixa = x.inici
  ) then
    select l.* into v_linia
      from public.cartera_linies l join public.cartera_conciliacions c on c.id = l.conciliacio_id
      where l.tipus = 'cobrat_despres_baixa' and l.matricula = x.matricula and c.inici = x.inici
        and l.liquidat_at is null and l.descartat_at is null
      limit 1
      for update of l;
    if found then
      update public.rebuts set vehicle_id = coalesce(v_linia.vehicle_id, v_vehicle_id), cartera_linia_id = v_linia.id
        where id = p_rebut;
      return public.recalcula_linia_cartera(v_linia.id);
    end if;
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

-- importa_rebuts: igual que a 0021, però els extorns enllaçats a una línia de cartera no es tornen a casar.
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
    select r.id from public.rebuts r
    where r.descartat_at is null and not (r.id = any(v_nous)) and r.cartera_linia_id is null
      and ((r.tipus = 'emissio' and r.vehicle_id is null) or (r.tipus = 'extorn' and r.baixa_id is null))
    order by case when r.tipus = 'emissio' then 0 else 1 end, r.inici, r.num_rebut
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

-- Importa el Rebut de cartera d'un període i, si el fitxer en porta, la resta de rebuts (p_rebuts, el mateix
-- format que importa_rebuts), tot en una sola transacció: si alguna cosa falla, no queda cap canvi.
-- Idempotent: pujar el mateix fitxer dues vegades dona el mateix resultat.
-- p_linies: [{num_rebut, polissa, inici, fi, prima_total, prima_neta, prima_anual, prima_neta_anual, matricula}]
-- p_mare: {inici, prima_total} o null.
create or replace function public.importa_cartera(p_linies jsonb, p_mare jsonb, p_fitxer text, p_rebuts jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
  v_inici date;
  v_fi date;
  v_mare numeric;
  v_suma numeric;
  v_quadra boolean;
  v_actualitza_prima boolean;
  v_conciliacio uuid;
  v_descarts jsonb;
  v_extorns jsonb;
  x record;
  v record;
  v_baixa_id uuid;
  v_data_baixa date;
  v_tipus text;
  v_linia uuid;
  r record;
  v_resum jsonb;
  v_rebuts jsonb;
begin
  if v_usuari is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  if p_linies is null or jsonb_typeof(p_linies) <> 'array' or jsonb_array_length(p_linies) = 0
     or p_fitxer is null or length(btrim(p_fitxer)) = 0
     or (p_mare is not null and jsonb_typeof(p_mare) not in ('object', 'null'))
     or (p_rebuts is not null and jsonb_typeof(p_rebuts) not in ('array', 'null')) then
    raise exception 'dades' using errcode = 'P0001';
  end if;

  select min((e ->> 'inici')::date), min((e ->> 'fi')::date) into v_inici, v_fi from jsonb_array_elements(p_linies) e;
  -- Un sol període per crida (i cap línia sense dades obligatòries).
  if v_inici is null or v_fi is null or v_fi <= v_inici or exists (
    select 1 from jsonb_to_recordset(p_linies) as l(num_rebut text, inici date, fi date, prima_total numeric, matricula text)
    where l.inici is distinct from v_inici or l.fi is distinct from v_fi or l.prima_total is null
      or l.num_rebut is null or length(btrim(l.num_rebut)) = 0
      or l.matricula is null or l.matricula !~ '^[A-Z0-9]{4,10}$'
  ) then
    raise exception 'dades' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_linies) as l(matricula text) group by l.matricula having count(*) > 1
  ) then
    raise exception 'matricula_repetida' using errcode = 'P0001';
  end if;
  if p_mare is not null and jsonb_typeof(p_mare) = 'object' then
    if (p_mare ->> 'inici')::date is distinct from v_inici or (p_mare ->> 'prima_total') is null then
      raise exception 'dades' using errcode = 'P0001';
    end if;
    v_mare := round((p_mare ->> 'prima_total')::numeric, 2);
  end if;

  perform public.bloqueja_periode_cartera(v_inici);

  -- Un període més antic que el darrer conciliat no sobreescriu les primes dels vehicles.
  v_actualitza_prima := v_inici >= coalesce((select max(inici) from public.cartera_conciliacions), v_inici);

  -- De la conciliació anterior d'aquest període es conserven:
  -- * els descarts, només si la línia nova té el mateix tipus, vehicle i prima;
  -- * els extorns enllaçats, per matrícula (es tornen a enllaçar si la línia nova continua sent 'cobrat').
  select coalesce(jsonb_object_agg(l.matricula, jsonb_build_object(
      'tipus', l.tipus, 'vehicle_id', l.vehicle_id, 'prima_total', l.prima_total,
      'descartat_at', l.descartat_at, 'comentari_descart', l.comentari_descart, 'descartat_per', l.descartat_per)), '{}'::jsonb)
    into v_descarts
    from public.cartera_linies l join public.cartera_conciliacions c on c.id = l.conciliacio_id
    where c.inici = v_inici and l.descartat_at is not null;
  select coalesce(jsonb_agg(jsonb_build_object('rebut', x2.id, 'matricula', l.matricula)), '[]'::jsonb)
    into v_extorns
    from public.rebuts x2
    join public.cartera_linies l on l.id = x2.cartera_linia_id
    join public.cartera_conciliacions c on c.id = l.conciliacio_id
    where c.inici = v_inici;
  -- En esborrar la conciliació, rebuts.cartera_linia_id queda a null (on delete set null).
  delete from public.cartera_conciliacions where inici = v_inici;

  select round(sum((e ->> 'prima_total')::numeric), 2) into v_suma from jsonb_array_elements(p_linies) e;
  v_quadra := v_mare is not null and abs(v_mare - v_suma) <= 0.01;
  insert into public.cartera_conciliacions (inici, fi, fitxer, prima_mare, suma_linies, quadra, importat_per)
  values (v_inici, v_fi, left(p_fitxer, 200), v_mare, v_suma, v_quadra, v_usuari)
  returning id into v_conciliacio;

  for x in
    select * from jsonb_to_recordset(p_linies) as l(
      num_rebut text, polissa text, prima_total numeric, prima_neta numeric,
      prima_anual numeric, prima_neta_anual numeric, matricula text
    )
    order by l.matricula
  loop
    -- Cicle obert del vehicle (mateix criteri que casa_rebut); bloqueja abans el vehicle i després la baixa.
    select id, estat, polissa into v from public.vehicles_assegurats
      where matricula = x.matricula and estat not in ('rebutjat', 'tancat')
      order by created_at desc
      limit 1
      for update;
    v_baixa_id := null;
    v_data_baixa := null;
    if not found then
      v_tipus := 'sense_control';
    elsif v.estat in ('baixa_enviada', 'donat_de_baixa') then
      -- Darrera baixa del vehicle que no s'ha anul·lat ni ha fallat
      -- (estats possibles: pendent_polissa, enviant, enviada, anullant).
      select id, data_baixa into v_baixa_id, v_data_baixa from public.baixes
        where vehicle_id = v.id and estat not in ('anullada', 'fallida')
        order by created_at desc
        limit 1
        for update;
      -- data_baixa > inici → 'ok' (l'extorn de la baixa ja cobreix el cas).
      -- data_baixa ≤ inici → 'cobrat_despres_baixa' (no s'hauria d'haver cobrat). Cas especial data_baixa = inici:
      --   l'extorn esperat de la pròpia baixa (fins a fiPeriodeCartera, estrictament posterior) ja és el semestre
      --   sencer, així que la línia queda amb extorn_esperat null per no reclamar-lo dues vegades: l'import es
      --   concilia per la baixa (casa_rebut li dona prioritat) i la línia surt a la safata com a excepció.
      -- Sense baixa (o sense data, p. ex. vehicles de la càrrega inicial) no hi ha res que el cobreixi → 'cobrat'.
      v_tipus := case when v_data_baixa is not null and v_data_baixa > v_inici then 'ok' else 'cobrat_despres_baixa' end;
    else
      v_tipus := 'ok';
    end if;

    insert into public.cartera_linies (
      conciliacio_id, tipus, num_rebut, matricula, polissa, prima_total, prima_neta, prima_anual, prima_neta_anual,
      vehicle_id, baixa_id, extorn_esperat
    ) values (
      v_conciliacio, v_tipus, left(btrim(x.num_rebut), 50), x.matricula, left(x.polissa, 50),
      round(x.prima_total, 2), round(x.prima_neta, 2), round(x.prima_anual, 2), round(x.prima_neta_anual, 2),
      v.id, case when v_tipus = 'cobrat_despres_baixa' then v_baixa_id end,
      case when v_tipus = 'cobrat_despres_baixa' and v_data_baixa is distinct from v_inici then round(x.prima_total, 2) end
    );

    if v_tipus = 'ok' and v_actualitza_prima and x.prima_anual is not null and x.prima_anual > 0 then
      update public.vehicles_assegurats
        set prima_total = round(x.prima_anual, 2),
            prima_neta = coalesce(round(x.prima_neta_anual, 2), prima_neta),
            polissa = coalesce(polissa, left(x.polissa, 50))
        where id = v.id;
      update public.baixes
        set extorn_esperat = public.extorn_esperat_de(round(x.prima_anual, 2), data_baixa)
        where vehicle_id = v.id and extorn_esperat is null
          and estat in ('pendent_polissa', 'enviant', 'enviada', 'anullant')
          and liquidada_at is null and extorn_liquidat is null;
    end if;
  end loop;

  -- Vehicles assegurats abans de l'inici que no surten al rebut (es salten matrícules que no passen el format).
  insert into public.cartera_linies (conciliacio_id, tipus, matricula, polissa, vehicle_id)
  select v_conciliacio, 'absent', va.matricula, va.polissa, va.id
    from public.vehicles_assegurats va
    where va.estat = 'assegurat' and va.data_alta < v_inici and va.matricula ~ '^[A-Z0-9]{4,10}$'
      and not exists (select 1 from public.cartera_linies l where l.conciliacio_id = v_conciliacio and l.matricula = va.matricula);

  -- Descarts: només si no ha canviat res de la línia.
  update public.cartera_linies l
    set descartat_at = (k.value ->> 'descartat_at')::timestamptz,
        comentari_descart = k.value ->> 'comentari_descart',
        descartat_per = (k.value ->> 'descartat_per')::uuid
    from jsonb_each(v_descarts) k
    where l.conciliacio_id = v_conciliacio and k.key = l.matricula
      and l.tipus = k.value ->> 'tipus'
      and l.vehicle_id is not distinct from (k.value ->> 'vehicle_id')::uuid
      and l.prima_total is not distinct from (k.value ->> 'prima_total')::numeric;

  -- Extorns enllaçats abans: tornen a la línia de la mateixa matrícula si continua sent 'cobrat'. Si no, queden
  -- sense línia ni baixa (surten com a extorn no identificat) i no es reassignen a cap baixa.
  update public.rebuts x2
    set cartera_linia_id = l.id
    from jsonb_to_recordset(v_extorns) as e(rebut uuid, matricula text)
    join public.cartera_linies l on l.conciliacio_id = v_conciliacio and l.matricula = e.matricula
      and l.tipus = 'cobrat_despres_baixa'
    where x2.id = e.rebut;

  -- Extorns del període encara sense casar (p. ex. arribats abans que el rebut) amb una línia 'cobrat'.
  for r in
    select x2.id from public.rebuts x2
    where x2.tipus = 'extorn' and x2.inici = v_inici and x2.baixa_id is null and x2.cartera_linia_id is null
      and x2.descartat_at is null
      and not (x2.id in (select (e ->> 'rebut')::uuid from jsonb_array_elements(v_extorns) e))
      and exists (
        select 1 from public.cartera_linies l
        where l.conciliacio_id = v_conciliacio and l.tipus = 'cobrat_despres_baixa' and l.matricula = x2.matricula
      )
    order by x2.num_rebut
  loop
    perform public.casa_rebut(r.id, v_usuari);
  end loop;

  -- Revalida la liquidació de totes les línies 'cobrat' amb l'extorn esperat nou (±1 €).
  for r in
    select id from public.cartera_linies where conciliacio_id = v_conciliacio and tipus = 'cobrat_despres_baixa'
  loop
    perform public.recalcula_linia_cartera(r.id);
  end loop;

  select jsonb_build_object(
      'ok', count(*) filter (where tipus = 'ok'),
      'sense_control', count(*) filter (where tipus = 'sense_control'),
      'cobrat_despres_baixa', count(*) filter (where tipus = 'cobrat_despres_baixa'),
      'absent', count(*) filter (where tipus = 'absent'),
      'quadra', v_quadra,
      'prima_mare', v_mare,
      'suma_linies', v_suma
    ) into v_resum
    from public.cartera_linies where conciliacio_id = v_conciliacio;

  -- La resta de línies del fitxer (emissions i extorns), dins la mateixa transacció.
  if p_rebuts is not null and jsonb_typeof(p_rebuts) = 'array' and jsonb_array_length(p_rebuts) > 0 then
    v_rebuts := public.importa_rebuts(p_rebuts, p_fitxer);
  end if;
  return v_resum || jsonb_build_object('rebuts', v_rebuts);
end $$;

-- Administració dona per revisada una línia de cartera (sense control, absent o cobrada després de la baixa).
create or replace function public.descarta_linia_cartera(p_linia uuid, p_comentari text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
  v_inici date;
begin
  if v_usuari is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  if p_comentari is null or length(btrim(p_comentari)) = 0 then
    raise exception 'comentari' using errcode = 'P0001';
  end if;
  select c.inici into v_inici
    from public.cartera_linies l join public.cartera_conciliacions c on c.id = l.conciliacio_id
    where l.id = p_linia;
  if not found then
    raise exception 'estat_linia' using errcode = 'P0001';
  end if;
  -- Mateix bloqueig que la importació del període: una pujada simultània no perd el descart.
  perform public.bloqueja_periode_cartera(v_inici);
  update public.cartera_linies
    set descartat_at = now(), comentari_descart = left(btrim(p_comentari), 1000), descartat_per = v_usuari
    where id = p_linia and tipus <> 'ok' and descartat_at is null and liquidat_at is null;
  if not found then
    raise exception 'estat_linia' using errcode = 'P0001';
  end if;
end $$;

-- "Crear com a Assegurat": crea el vehicle d'una línia sense control (estat assegurat, sense Motiu,
-- amb la prima anual i la pòlissa del rebut) i la línia passa a 'ok'. Retorna l'id del vehicle.
create or replace function public.crea_vehicle_de_cartera(p_linia uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_usuari uuid := public.usuari_actual_id();
  l record;
  v_id uuid;
begin
  if v_usuari is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  select li.*, c.inici into l
    from public.cartera_linies li join public.cartera_conciliacions c on c.id = li.conciliacio_id
    where li.id = p_linia
    for update of li;
  if not found or l.tipus <> 'sense_control' or l.descartat_at is not null then
    raise exception 'estat_linia' using errcode = 'P0001';
  end if;
  -- Mateix criteri de cicle obert que la resta: mentrestant s'hi pot haver donat d'alta el vehicle.
  perform 1 from public.vehicles_assegurats
    where matricula = l.matricula and estat not in ('rebutjat', 'tancat');
  if found then
    raise exception 'matricula_oberta' using errcode = 'P0001';
  end if;
  insert into public.vehicles_assegurats (matricula, polissa, estat, data_alta, prima_total, prima_neta, origen)
  values (l.matricula, l.polissa, 'assegurat', l.inici, l.prima_anual, l.prima_neta_anual, 'rebut_cartera')
  returning id into v_id;
  insert into public.vehicle_historial (vehicle_id, estat, comentari, usuari_id)
  values (v_id, 'assegurat', 'Creat des del Rebut de cartera (rebut ' || coalesce(l.num_rebut, '—') || ')', v_usuari);
  update public.cartera_linies set tipus = 'ok', vehicle_id = v_id where id = p_linia;
  return v_id;
end $$;

-- Permisos.
alter table public.cartera_conciliacions enable row level security;
create policy cartera_conciliacions_lectura on public.cartera_conciliacions for select to authenticated
  using (public.es_admin());
grant select on public.cartera_conciliacions to authenticated;
grant all on public.cartera_conciliacions to service_role;

alter table public.cartera_linies enable row level security;
create policy cartera_linies_lectura on public.cartera_linies for select to authenticated
  using (public.es_admin());
grant select on public.cartera_linies to authenticated;
grant all on public.cartera_linies to service_role;

-- Funcions d'ús intern (casa_rebut es torna a crear: es reafirmen els permisos).
revoke execute on function public.casa_rebut(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.recalcula_linia_cartera(uuid) from public, anon, authenticated;
revoke execute on function public.bloqueja_periode_cartera(date) from public, anon, authenticated;
grant execute on function public.casa_rebut(uuid, uuid) to service_role;
grant execute on function public.recalcula_linia_cartera(uuid) to service_role;
grant execute on function public.bloqueja_periode_cartera(date) to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'importa_rebuts(jsonb, text)',
    'importa_cartera(jsonb, jsonb, text, jsonb)',
    'descarta_linia_cartera(uuid, text)',
    'crea_vehicle_de_cartera(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
