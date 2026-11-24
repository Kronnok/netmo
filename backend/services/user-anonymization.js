// Borra los datos personales de una cuenta sin eliminar la fila: préstamos,
// reservas, tickets y tardanzas necesitan seguir apuntando a un usuario.
async function anonymizeUser(client, userId) {
  const updated = await client.query(`UPDATE users SET
    nombre = 'Cuenta eliminada',
    email = 'eliminado+' || id || '@netmo.invalid',
    dni = 'ELIM-' || id,
    password_hash = crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf')),
    baneado = FALSE,
    baneado_hasta = NULL,
    baneo_origen = NULL,
    tardanzas_reset_at = NULL,
    eliminado_at = COALESCE(eliminado_at, now()),
    estado_registro = 'rechazado',
    registro_revisado_at = COALESCE(registro_revisado_at, now())
    WHERE id = $1
    RETURNING dni, nombre, email, rol, eliminado_at`, [userId]);
  await client.query(`UPDATE reservation_notebooks SET active = FALSE
    WHERE active AND reservation_id IN (SELECT id FROM reservations WHERE owner_id = $1)`, [userId]);
  await client.query(`UPDATE reservations SET estado = 'cancelada'
    WHERE owner_id = $1 AND estado IN ('confirmada', 'pendiente_aprobacion', 'aprobada')`, [userId]);
  await client.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM user_preferences WHERE user_id = $1', [userId]);
  return updated.rows[0] || null;
}

module.exports = { anonymizeUser };
