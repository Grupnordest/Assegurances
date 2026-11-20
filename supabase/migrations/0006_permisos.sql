-- Permisos de taula explícits. Els projectes nous de Supabase ja no donen accés per defecte
-- als rols de l'API (anon, authenticated, service_role); sense això, fins i tot la clau de
-- servei rep "permission denied". Les polítiques RLS continuen decidint quines files es veuen.

-- Clau de servei (només servidor): accés complet; salta RLS.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Usuaris amb sessió: lectura (filtrada per RLS).
grant usage on schema public to authenticated;
grant select on
  public.centres, public.usuaris, public.usuari_rols,
  public.estoc_carregues, public.estoc_vehicles, public.estoc_vigent,
  public.vehicles_assegurats, public.vehicle_historial, public.vehicles_llista, public.carregues_flota,
  public.relacions_flota_vo, public.relacio_flota_vigent, public.baixes
  to authenticated;

-- desa_usuari() és security invoker: escriu amb els permisos de qui crida (i RLS: només admins).
grant insert, update on public.usuaris to authenticated;
grant insert, delete on public.usuari_rols to authenticated;

-- anon no llegeix res.
revoke all on all tables in schema public from anon;

-- Taules futures: la clau de servei hi té accés; per a authenticated cal concedir-ho a cada migració.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
