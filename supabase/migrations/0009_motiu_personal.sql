-- Nou Motiu: Personal empresa (vehicle assegurat per a ús del personal de l'empresa).
alter type public.motiu_vehicle add value if not exists 'personal';
