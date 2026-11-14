function mapTicketRow(ticket) {
  return {
    id: ticket.id || '—',
    notebook: typeof ticket.notebook === 'string' && ticket.notebook.trim() ? ticket.notebook : 'Sin equipo',
    loanId: ticket.loan_id || null,
    loanRetiradaAt: ticket.loan_retirada_at || null,
    motivo: typeof ticket.motivo === 'string' && ticket.motivo.trim() ? ticket.motivo : '—',
    descripcion: typeof ticket.descripcion === 'string' && ticket.descripcion.trim() ? ticket.descripcion : '—',
    estado: typeof ticket.estado === 'string' && ticket.estado ? ticket.estado : 'desconocido',
    fecha: ticket.created_at || null,
    latestAdminReplyAt: ticket.latest_admin_reply_at || null,
    ownerNombre: ticket.owner_nombre || '—',
    ownerRol: ticket.owner_rol || '—'
  };
}

module.exports = { mapTicketRow };
