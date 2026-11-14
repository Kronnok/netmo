const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mapTicketRow } = require('../services/ticket-mapper');

test('mapea tickets con valores faltantes a etiquetas legibles', () => {
  assert.deepEqual(mapTicketRow({}), {
    id: '—',
    notebook: 'Sin equipo',
    loanId: null,
    loanRetiradaAt: null,
    motivo: '—',
    descripcion: '—',
    estado: 'desconocido',
    fecha: null,
    latestAdminReplyAt: null,
    ownerNombre: '—',
    ownerRol: '—'
  });
});

test('conserva los datos de tickets y normaliza equipo vacío', () => {
  assert.deepEqual(mapTicketRow({
    id: 'TCK-1',
    notebook: ' ',
    loan_id: '13',
    loan_retirada_at: '2026-11-14T13:00:00Z',
    motivo: 'Teclado',
    descripcion: 'No responde',
    estado: 'abierto',
    created_at: '2026-11-14T13:00:00Z',
    latest_admin_reply_at: '2026-11-14T14:00:00Z',
    owner_nombre: 'Ana',
    owner_rol: 'profesor'
  }), {
    id: 'TCK-1',
    notebook: 'Sin equipo',
    loanId: '13',
    loanRetiradaAt: '2026-11-14T13:00:00Z',
    motivo: 'Teclado',
    descripcion: 'No responde',
    estado: 'abierto',
    fecha: '2026-11-14T13:00:00Z',
    latestAdminReplyAt: '2026-11-14T14:00:00Z',
    ownerNombre: 'Ana',
    ownerRol: 'profesor'
  });
});
