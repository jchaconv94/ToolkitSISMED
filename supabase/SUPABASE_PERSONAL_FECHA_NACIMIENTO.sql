-- Fecha de nacimiento del personal (Perfil de Usuario, 2026-10-05).
-- La pantalla de Perfil ya la muestra y la guarda; sin esta columna, guardar el
-- perfil conserva todo lo demás y avisa que la fecha no se guardó.
-- Se puede ejecutar más de una vez.

alter table public.personnel
  add column if not exists birth_date date;
