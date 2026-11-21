-- Nou Motiu: Família (vehicle assegurat per a ús d'un familiar).
alter type public.motiu_vehicle add value if not exists 'familia';
