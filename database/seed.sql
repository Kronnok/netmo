INSERT INTO users (legajo, nombre, email, rol, password_hash, baneado) VALUES
  ('2024-0417', 'Teo Prado', 'tprado@ottokrause.edu.ar', 'alumno', crypt(current_setting('netmo.seed.student_password'), gen_salt('bf')), FALSE),
  ('2024-0528', 'Lucía Fernández', 'lfernandez@ottokrause.edu.ar', 'alumno', crypt(current_setting('netmo.seed.student_password'), gen_salt('bf')), FALSE),
  ('2024-0639', 'Mateo Rodríguez', 'mrodriguez@ottokrause.edu.ar', 'alumno', crypt(current_setting('netmo.seed.student_password'), gen_salt('bf')), FALSE),
  ('PRF-010', 'Prof. Ana Gómez', 'agomez@ottokrause.edu.ar', 'profesor', crypt(current_setting('netmo.seed.teacher_password'), gen_salt('bf')), FALSE),
  ('PRF-011', 'Prof. Diego Suárez', 'dsuarez@ottokrause.edu.ar', 'profesor', crypt(current_setting('netmo.seed.network_teacher_password'), gen_salt('bf')), FALSE),
  ('ADM-001', 'Admin NetMO', 'admin@ottokrause.edu.ar', 'admin', crypt(current_setting('netmo.seed.admin_password'), gen_salt('bf')), FALSE)
ON CONFLICT (legajo) DO NOTHING;

INSERT INTO user_preferences (user_id, email_notifications, return_reminder_minutes)
SELECT id, TRUE, 30 FROM users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO carros (numero) VALUES (1), (2) ON CONFLICT (numero) DO NOTHING;

INSERT INTO notebooks (codigo, estado, ubicacion, prestado_a, carro_id) VALUES
  ('NB-001', 'disponible', 'Carro 1', NULL, 1),
  ('NB-002', 'disponible', 'Carro 1', NULL, 1),
  ('NB-003', 'prestada', '—', (SELECT id FROM users WHERE legajo = 'PRF-010'), NULL),
  ('NB-004', 'mantenimiento', 'Taller', NULL, NULL),
  ('NB-005', 'disponible', 'Carro 2', NULL, 2),
  ('NB-014', 'prestada', '—', (SELECT id FROM users WHERE legajo = '2024-0417'), NULL)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO reservations (codigo, owner_id, tipo, carro, cantidad, retiro_at, motivo, estado)
SELECT 'RES-01', id, 'individual', 'Carro 2', 1,
       (date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires')
        + CASE EXTRACT(ISODOW FROM now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::integer
            WHEN 5 THEN INTERVAL '3 days'
            WHEN 6 THEN INTERVAL '2 days'
            ELSE INTERVAL '1 day'
          END + INTERVAL '9 hours') AT TIME ZONE 'America/Argentina/Buenos_Aires',
       'Física — laboratorio', 'confirmada'
FROM users WHERE legajo = '2024-0417'
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO loans (notebook_id, user_id, retirada_at, vence_at, estado)
SELECT n.id, u.id, now() - INTERVAL '2 hours', now() - INTERVAL '1 hour', 'activo'
FROM notebooks n CROSS JOIN users u
WHERE n.codigo = 'NB-014' AND u.legajo = '2024-0417'
ON CONFLICT DO NOTHING;

INSERT INTO tickets (codigo, notebook_id, owner_id, motivo, descripcion, estado)
SELECT 'TCK-014', n.id, u.id, 'La pantalla se apaga sola',
       'La pantalla se apaga sola después de unos minutos de uso.', 'progreso'
FROM notebooks n CROSS JOIN users u
WHERE n.codigo = 'NB-004' AND u.legajo = '2024-0417'
ON CONFLICT (codigo) DO NOTHING;
