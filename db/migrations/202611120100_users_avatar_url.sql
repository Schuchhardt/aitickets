-- Foto de perfil del productor (y de cada miembro del equipo) en el panel. NULL = sin foto: se muestra la inicial.
-- Guarda la URL pública de la imagen en el bucket "Events" (user-avatars/<user_id>-…), ya sea subida por el usuario
-- o copiada desde su foto de Google (no se enlaza la de googleusercontent.com, que caduca y limita las descargas).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url text;
