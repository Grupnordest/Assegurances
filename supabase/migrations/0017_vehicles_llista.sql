-- vehicles_llista es va crear amb v.* abans d'afegir columnes noves (pòlissa, sol·licitant, validador…):
-- Postgres va fixar la llista de columnes. Es refà amb les mateixes columnes i les noves al final.
create or replace view public.vehicles_llista with (security_invoker = true) as
  select
    v.id, v.matricula, v.polissa, v.estat, v.motiu, v.responsable_id, v.centre_id, v.cobertura, v.franquicia,
    v.data_alta, v.data_venciment, v.prima_neta, v.prima_total, v.marca_model, v.vin, v.color,
    v.data_prevista_baixa, v.nota, v.origen, v.created_at, v.updated_at,
    c.nom as centre_nom,
    case when v.motiu = 'vs' then cap.id else r.id end as responsable_efectiu_id,
    case when v.motiu = 'vs' then cap.nom else r.nom end as responsable_nom,
    (v.motiu is null
      or (v.motiu = 'vs' and cap.id is null)
      or (v.motiu <> 'vs' and (r.id is null or not r.actiu))) as pendent,
    v.polissa_path, v.sollicitant_id, v.validat_per, v.validat_at
  from public.vehicles_assegurats v
  left join public.centres c on c.id = v.centre_id
  left join public.usuaris r on r.id = v.responsable_id
  left join lateral (
    select u.id, u.nom
    from public.usuaris u
    join public.usuari_rols ur on ur.usuari_id = u.id and ur.rol = 'cap_postvenda'
    where u.actiu
    order by u.nom
    limit 1
  ) cap on true;
