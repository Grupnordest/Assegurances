-- Enduriment indicat per l'assessor de seguretat de Supabase.

-- search_path fix a les funcions que no en tenien.
alter function public.toca_updated_at() set search_path = public;
alter function public.email_sessio() set search_path = public;

-- La funció del disparador no s'ha de poder cridar per l'API (els disparadors no necessiten EXECUTE).
revoke execute on function public.comprova_ultim_admin() from public, anon, authenticated;

-- Les polítiques RLS són només per a "authenticated": anon no necessita aquestes funcions.
revoke execute on function public.es_admin() from public, anon;
revoke execute on function public.usuari_actual_id() from public, anon;
grant execute on function public.es_admin() to authenticated;
grant execute on function public.usuari_actual_id() to authenticated;
