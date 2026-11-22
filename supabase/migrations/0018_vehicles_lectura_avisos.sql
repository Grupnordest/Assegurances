-- Els destinataris d'un Avís han de poder veure el vehicle a la seva safata (Inici), i el
-- Responsable, els seus vehicles. Funció security definer: evita encadenar polítiques RLS.
create or replace function public.te_avis_del_vehicle(p_vehicle uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.avisos a join public.avis_enllacos e on e.avis_id = a.id
    where a.vehicle_id = p_vehicle and e.usuari_id = public.usuari_actual_id()
  )
$$;
revoke execute on function public.te_avis_del_vehicle(uuid) from public, anon;
grant execute on function public.te_avis_del_vehicle(uuid) to authenticated;

drop policy if exists vehicles_assegurats_lectura on public.vehicles_assegurats;
create policy vehicles_assegurats_lectura on public.vehicles_assegurats for select to authenticated
  using (
    public.es_admin()
    or sollicitant_id = public.usuari_actual_id()
    or responsable_id = public.usuari_actual_id()
    or (estat = 'sollicitat' and public.pot_validar(motiu))
    or public.te_avis_del_vehicle(id)
  );
