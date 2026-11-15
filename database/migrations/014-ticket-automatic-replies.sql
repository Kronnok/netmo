-- La respuesta automática de NetMO no tiene un usuario humano como autor.
ALTER TABLE ticket_replies ALTER COLUMN author_id DROP NOT NULL;
