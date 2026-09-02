INSERT INTO users (legajo, nombre, email, curso, rol, password_hash, baneado) VALUES
  ('2024-0417', 'Teo Prado', 'tprado@ottokrause.edu.ar', '6° Informática "B"', 'alumno', crypt('1234', gen_salt('bf')), FALSE),
  ('2024-0528', 'Lucía Fernández', 'lfernandez@ottokrause.edu.ar', '6° Informática "A"', 'alumno', crypt('1234', gen_salt('bf')), FALSE),
  ('2024-0639', 'Mateo Rodríguez', 'mrodriguez@ottokrause.edu.ar', '6° Computación "A"', 'alumno', crypt('5678', gen_salt('bf')), FALSE),
  ('PRF-010', 'Prof. Ana Gómez', 'agomez@ottokrause.edu.ar', 'Profesor · Cátedra Programación', 'profesor', crypt('1234', gen_salt('bf')), FALSE),
  ('PRF-011', 'Prof. Diego Suárez', 'dsuarez@ottokrause.edu.ar', 'Profesor · Cátedra Redes', 'profesor', crypt('2468', gen_salt('bf')), FALSE),
  ('ADM-001', 'Admin NetMO', 'admin@ottokrause.edu.ar', 'Administración', 'admin', crypt('admin123', gen_salt('bf')), FALSE);

INSERT INTO user_preferences (user_id, email_notifications, return_reminder_minutes)
SELECT id, TRUE, 30 FROM users;

INSERT INTO notebooks (codigo, estado, ubicacion, prestado_a) VALUES
  ('NB-001', 'disponible', 'Carro 1', NULL),
  ('NB-002', 'disponible', 'Carro 1', NULL),
  ('NB-003', 'prestada', '—', (SELECT id FROM users WHERE legajo = 'PRF-010')),
  ('NB-004', 'mantenimiento', 'Taller', NULL),
  ('NB-005', 'disponible', 'Carro 2', NULL),
  ('NB-014', 'prestada', '—', (SELECT id FROM users WHERE legajo = '2024-0417'));

INSERT INTO reservations (codigo, owner_id, tipo, carro, cantidad, retiro_at, motivo, estado)
SELECT 'RES-01', id, 'individual', 'Carro 2', 1,
       make_timestamptz(EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER, 8, 26, 9, 0, 0, 'UTC'),
       'Física — laboratorio', 'confirmada'
FROM users WHERE legajo = '2024-0417';

INSERT INTO loans (notebook_id, user_id, retirada_at, vence_at, estado)
SELECT n.id, u.id, now() - INTERVAL '2 hours', now() - INTERVAL '1 hour', 'activo'
FROM notebooks n CROSS JOIN users u
WHERE n.codigo = 'NB-014' AND u.legajo = '2024-0417';

INSERT INTO tickets (codigo, notebook_id, owner_id, motivo, descripcion, estado)
SELECT 'TCK-014', n.id, u.id, 'La pantalla se apaga sola',
       'La pantalla se apaga sola después de unos minutos de uso.', 'progreso'
FROM notebooks n CROSS JOIN users u
WHERE n.codigo = 'NB-004' AND u.legajo = '2024-0417';

