-- La baixa de Tot risc adjunta la pòlissa AXA del vehicle (Certificat de pòlissa, PDF), no la
-- Relació de Flota VO de Proassa (que és d'una altra pòlissa). El PDF es desa al vehicle i es reaprofita.

alter table public.vehicles_assegurats add column if not exists polissa_path text;

alter table public.baixes drop constraint baixes_justificant_tipus_check;
alter table public.baixes add constraint baixes_justificant_tipus_check
  check (justificant_tipus in ('relacio', 'nou_titular', 'polissa'));

-- Desa (o substitueix) el PDF de la pòlissa d'un vehicle. Només Administració.
create or replace function public.desa_polissa(p_vehicle uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.usuari_actual_id() is null or not public.es_admin() then
    raise exception 'permis' using errcode = '42501';
  end if;
  update public.vehicles_assegurats set polissa_path = p_path where id = p_vehicle;
  if not found then
    raise exception 'no_trobat' using errcode = 'P0001';
  end if;
end $$;

revoke execute on function public.desa_polissa(uuid, text) from public, anon;
grant execute on function public.desa_polissa(uuid, text) to authenticated;
