<<<<<<< HEAD
/* ======================================================================
   ESTADO EN MEMORIA
====================================================================== */
let estadoUsuarios = [
  {legajo:'2024-0417', nombre:'Teo Prado', email:'tprado@ottokrause.edu.ar', rol:'alumno', password:'1234', tardanzas:2, baneado:false, retiradas:14, aTiempoPct:92},
  {legajo:'2024-0528', nombre:'Lucía Fernández', email:'lfernandez@ottokrause.edu.ar', rol:'alumno', password:'1234', tardanzas:0, baneado:false, retiradas:6, aTiempoPct:100},
  {legajo:'2024-0639', nombre:'Mateo Rodríguez', email:'mrodriguez@ottokrause.edu.ar', rol:'alumno', password:'5678', tardanzas:1, baneado:false, retiradas:9, aTiempoPct:97},
  {legajo:'PRF-010', nombre:'Prof. Ana Gómez', email:'agomez@ottokrause.edu.ar', rol:'profesor', password:'1234', tardanzas:0, baneado:false, retiradas:31, aTiempoPct:100},
  {legajo:'PRF-011', nombre:'Prof. Diego Suárez', email:'dsuarez@ottokrause.edu.ar', rol:'profesor', password:'2468', tardanzas:0, baneado:false, retiradas:18, aTiempoPct:100},
  {legajo:'ADM-001', nombre:'Admin NetMO', email:'admin@ottokrause.edu.ar', rol:'admin', password:'admin123', tardanzas:0, baneado:false},
];
let usuariosRegistrados = estadoUsuarios.filter(user=>user.rol!=='admin');
let usuariosConTardanzas = [];

let currentUser = null;   // usuario realmente logueado
let rolActivo = null;     // rol del usuario autenticado
let authToken = null;
const API_BASE = window.NETMO_CONFIG.apiBaseUrl === null ? null : window.NETMO_CONFIG.apiBaseUrl.replace(/\/+$/, '');
document.getElementById('demoHint').style.display = API_BASE === null ? '' : 'none';

let notebooks = [
  {id:'NB-001', estado:'disponible', ubicacion:'Carro 1', act:'Hace 2 min', prestadoA:null},
  {id:'NB-002', estado:'disponible', ubicacion:'Carro 1', act:'Hace 2 min', prestadoA:null},
  {id:'NB-003', estado:'prestada',   ubicacion:'—',       act:'Hace 15 min', prestadoA:'PRF-010 · Prof. Ana Gómez'},
  {id:'NB-004', estado:'mantenimiento', ubicacion:'Taller', act:'Hace 1 día', prestadoA:null},
  {id:'NB-005', estado:'disponible', ubicacion:'Carro 2', act:'Hace 3 min', prestadoA:null},
  {id:'NB-014', estado:'prestada',   ubicacion:'—',       act:'Hace 6 hs', prestadoA:'2024-0417 · Teo Prado'},
];

let stats = {disponibles:0, prestadas:0, mantenimiento:0, total:0};

// Préstamos activos por legajo de alumno. "vencimiento" es la hora límite real de devolución:
// para la demo la dejamos 2 horas en el pasado para poder mostrar el flujo de entrega tardía.
let prestamosActivos = {
  '2024-0417': {id:'NB-014', desde:'Hoy, 08:40', vence:'Hoy, 18:00', vencimiento:new Date(Date.now() - 2*60*60*1000), pendiente:false}
};
let historialPrestamos = [];

// Notificaciones de devolución pendientes de confirmación del Admin
let notificacionesDevolucion = [];
let notifSeq = 1;

// Historial de entregas tardías (para que el Admin pueda ver reincidencias y sancionar)
let historialTardanzas = [
  {legajo:'2024-0417', nombre:'Teo Prado', rol:'alumno', notebookId:'NB-033', fecha:'15 jun'},
  {legajo:'2024-0417', nombre:'Teo Prado', rol:'alumno', notebookId:'NB-021', fecha:'02 jul'},
];

// Reservas: individuales (alumno/profesor) y de lote (profesor -> requiere aprobación admin)
let reservas = [
  {id:'RES-01', ownerLegajo:'2024-0417', ownerNombre:'Teo Prado', tipo:'individual', carro:'Carro 2', cantidad:'1 notebook', fecha:'2026-07-16', hora:'09:00', motivo:'Física — laboratorio', estado:'confirmada'}
];
let reservaSeq = 2;

let tickets = [
  {id:'TCK-014', notebook:'NB-004', motivo:'La pantalla se apaga sola', motivoCompleto:'La pantalla se apaga sola después de unos minutos de uso.', estado:'progreso', fecha:'07 jul', ownerLegajo:'2024-0417', ownerNombre:'Teo Prado', ownerRol:'alumno'}
];
let ticketSeq = 15;

const badgeClass = {disponible:'badge-disponible', prestada:'badge-prestada', reservada:'badge-pendiente_devolucion', mantenimiento:'badge-mantenimiento', pendiente_devolucion:'badge-pendiente_devolucion'};
const badgeLabel = {disponible:'Disponible', prestada:'Prestada', reservada:'Reservada', mantenimiento:'En mantenimiento', pendiente_devolucion:'Pend. devolución'};
const estadosNotebookManuales = ['disponible','mantenimiento'];
const ticketBadgeClass = {abierto:'badge-abierto', progreso:'badge-progreso', resuelto:'badge-resuelto'};
const ticketBadgeLabel = {abierto:'Abierto', progreso:'En progreso', resuelto:'Resuelto'};
const rolLabel = {alumno:'Alumno', profesor:'Profesor', admin:'Administrador'};
const BUSINESS_TIME_ZONE = 'America/Argentina/Buenos_Aires';

function escapeHtml(value){
  return String(value ?? '').replace(/[&<>"']/g, character=>({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[character]);
}

function formatBusinessDateTime(value, options={}){
  return new Date(value).toLocaleString('es-AR', {timeZone:BUSINESS_TIME_ZONE, ...options});
}

function businessDateParts(value){
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone:BUSINESS_TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts(new Date(value)).map(({type, value:part})=>[type, part]));
}

const pageMeta = {
  inicio:   ['¡Hola{NOMBRE}!', 'Aquí podés consultar la disponibilidad de notebooks y realizar reservas.'],
  prestamos:['Mis préstamos', 'Revisá el equipo que tenés retirado y tu historial.'],
  reservas: ['Reservas', 'Programá el retiro de una notebook o un lote para tu curso.'],
  falla:    ['Reportar falla', 'Contanos qué problema encontraste con un equipo.'],
  tickets:  ['Mis tickets', 'Seguimiento de todos los reportes que enviaste.'],
  perfil:   ['Mi perfil', 'Tus datos institucionales y preferencias de la cuenta.'],
  'admin-profesores':   ['Usuarios y roles', 'Consultá las cuentas y asigná los roles habilitados.'],
  'admin-inventario':   ['Inventario completo', 'Estado de todas las notebooks del sistema.'],
  'admin-devoluciones': ['Devoluciones pendientes', 'Confirmá la recepción física de los equipos.'],
  'admin-lotes':        ['Lotes de profesores', 'Aprobá o rechazá solicitudes de carros completos.'],
  'admin-tickets':      ['Fallas reportadas', 'Tickets enviados por alumnos y profesores. Actualizá el estado del equipo según corresponda.'],
  'admin-tardanzas':    ['Devoluciones tardías', 'Historial de demoras y sanciones a alumnos y profesores.'],
};

/* ======================================================================
   AUTH: LOGIN / REGISTRO / LOGOUT
====================================================================== */
function switchAuthView(name){
  document.querySelectorAll('.auth-view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  document.getElementById('loginError').textContent = '';
  document.getElementById('registroError').textContent = '';
}

async function apiRequest(path, options={}){
  if(API_BASE === null) throw new Error('La API no está habilitada en el modo demo');
  const headers = {'Content-Type':'application/json', ...(options.headers||{})};
  if(authToken) headers.Authorization = 'Bearer '+authToken;
  const response = await fetch(API_BASE+path, {...options, headers});
  const payload = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(payload.error || 'No se pudo completar la operación');
  return payload;
}

async function cargarEstadoAPI(){
  const esAdmin = currentUser.rol==='admin';
  const [notebooksData, reservationsData, loansData, ticketsData, preferencesData] = await Promise.all([
    apiRequest('/api/notebooks'), apiRequest(esAdmin ? '/api/admin/reservations' : '/api/reservations'), apiRequest('/api/loans'), apiRequest(esAdmin ? '/api/admin/tickets' : '/api/tickets'), apiRequest('/api/preferences')
  ]);
  currentUser.preferencias = {
    email: Boolean(preferencesData.preferences?.email),
    recordatorio: String(preferencesData.preferences?.recordatorio ?? 30)
  };
  notebooks = notebooksData.notebooks.map(notebook=>({
    id:notebook.id, estado:notebook.estado, ubicacion:notebook.ubicacion,
    act:notebook.actualizada ? formatBusinessDateTime(notebook.actualizada) : 'Recién',
    prestadoA:notebook.prestado_a || null
  }));
  reservas = reservationsData.reservations.map(reserva=>{
    const retiro = businessDateParts(reserva.retiro_at);
    return {
      id:reserva.id || reserva.codigo, ownerLegajo:reserva.legajo || currentUser.legajo, ownerNombre:reserva.nombre || currentUser.nombre,
      tipo:reserva.tipo, curso:reserva.curso, cantidad:`${reserva.cantidad} ${reserva.cantidad===1?'notebook':'notebooks'}`,
      fecha:`${retiro.year}-${retiro.month}-${retiro.day}`, hora:`${retiro.hour}:${retiro.minute}`, motivo:reserva.motivo,
      estado:reserva.estado, notebookIds:reserva.notebook_ids || []
    };
  });
  tickets = ticketsData.tickets.map(ticket=>({
    id:ticket.id, notebook:ticket.notebook || 'otro', motivo:ticket.motivo, motivoCompleto:ticket.descripcion,
    estado:ticket.estado, fecha:formatBusinessDateTime(ticket.created_at, {dateStyle:'short'}), ownerLegajo:currentUser.legajo,
    ownerNombre:ticket.owner_nombre || currentUser.nombre, ownerRol:ticket.owner_rol || currentUser.rol
  }));
  if(esAdmin){
    const [returnsData, lateReturnsData, usersData] = await Promise.all([
      apiRequest('/api/admin/returns'),
      apiRequest('/api/admin/late-returns'),
      apiRequest('/api/admin/users')
    ]);
    notificacionesDevolucion = returnsData.returns.map(item=>({
      id:item.id, notebookId:item.notebook, alumnoLegajo:item.legajo, alumnoNombre:item.nombre,
      curso:item.curso, fechaSolicitud:formatBusinessDateTime(item.solicitado_at), rol:'alumno', returnId:item.id
    }));
    usuariosRegistrados = usersData.users;
    usuariosConTardanzas = lateReturnsData.users;
    historialTardanzas = [];
  }
  prestamosActivos = {};
  historialPrestamos = loansData.loans;
  loansData.loans.filter(loan=>loan.estado !== 'devuelto').forEach(loan=>{
    if(!prestamosActivos[currentUser.legajo]) prestamosActivos[currentUser.legajo] = {id:loan.notebook, curso:loan.curso, desde:formatBusinessDateTime(loan.retirada_at), vence:formatBusinessDateTime(loan.vence_at), pendiente:loan.estado!=='activo', loanId:loan.id};
  });
}

async function login(e){
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPassword').value;

  if(!API_BASE){
    const demoUser = estadoUsuarios.find(u=>u.email.toLowerCase()===email.toLowerCase());
    if(!demoUser || demoUser.password!==pass){
      document.getElementById('loginError').textContent = 'Correo o contraseña incorrectos';
      return;
    }
    if(demoUser.baneado){
      document.getElementById('loginError').textContent = 'Usuario bloqueado por administración';
      return;
    }
    currentUser = Object.fromEntries(Object.entries(demoUser).filter(([key])=>key!=='password'));
    rolActivo = currentUser.rol;
    document.getElementById('loginForm').reset();
    document.getElementById('loginError').textContent = '';
    iniciarSesion();
    return;
  }

  try{
    const result = await apiRequest('/api/auth/login', {method:'POST', body:JSON.stringify({email, password:pass})});
    authToken = result.token;
    currentUser = {...result.user};
    rolActivo = currentUser.rol;
    await cargarEstadoAPI();
    document.getElementById('loginForm').reset();
    document.getElementById('loginError').textContent = '';
    iniciarSesion();
    return;
  }catch(error){
    document.getElementById('loginError').textContent = error.message;
    return;
  }
}

async function registrar(e){
  e.preventDefault();
  const nombre = document.getElementById('regNombre').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  if(password.length < 8){
    document.getElementById('registroError').textContent = 'La contraseña debe tener al menos 8 caracteres.';
    return;
  }

  if(API_BASE){
    try{
      await apiRequest('/api/auth/register', {method:'POST', body:JSON.stringify({nombre, email, password})});
      document.getElementById('registroForm').reset();
      document.getElementById('registroError').textContent = '';
      switchAuthView('login');
      showToast('Registro exitoso. Ahora podés iniciar sesión.', 'success');
      document.getElementById('loginEmail').value = email;
    }catch(error){
      document.getElementById('registroError').textContent = error.message;
    }
    return;
  }

  if(estadoUsuarios.some(u=>u.email.toLowerCase()===email.toLowerCase())){
    document.getElementById('registroError').textContent = 'Ya existe una cuenta registrada con ese correo.';
    return;
  }

  const legajo = 'U-' + Date.now().toString().slice(-8);
  estadoUsuarios.push({legajo, nombre, email, rol:'alumno', password, tardanzas:0, baneado:false, retiradas:0, aTiempoPct:null});
  usuariosRegistrados = estadoUsuarios.filter(user=>user.rol!=='admin');
  document.getElementById('registroForm').reset();
  document.getElementById('registroError').textContent = '';
  switchAuthView('login');
  showToast('Registro exitoso. Ahora podés iniciar sesión.', 'success');
  document.getElementById('loginEmail').value = email;
}

function renderProfesoresTable(){
  const tbody = document.getElementById('profesoresTable');
  if(!tbody) return;
  const query = (document.getElementById('profesoresSearchInput')?.value || '').trim().toLowerCase();
  const usuarios = usuariosRegistrados.filter(usuario=>
    [usuario.nombre, usuario.email, usuario.legajo, usuario.rol].some(value=>String(value || '').toLowerCase().includes(query))
  );
  if(usuarios.length===0){
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">
      <div class="glyph">🧑‍🏫</div><h4>No hay usuarios que coincidan</h4><p>Probá con otro nombre, correo o legajo.</p>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = usuarios.map(usuario=>`
    <tr>
      <td>${escapeHtml(usuario.nombre)}</td>
      <td>${escapeHtml(usuario.email)}</td>
      <td class="mono">${escapeHtml(usuario.legajo)}</td>
      <td>${escapeHtml(rolLabel[usuario.rol] || usuario.rol)}</td>
      <td><select class="btn btn-sm" aria-label="Cambiar rol de ${escapeHtml(usuario.nombre)}"
        onchange="cambiarRol(${escapeHtml(JSON.stringify(usuario.legajo))}, this.value)">
        <option value="alumno" ${usuario.rol==='alumno'?'selected':''}>Alumno</option>
        <option value="profesor" ${usuario.rol==='profesor'?'selected':''}>Profesor</option>
      </select></td>
    </tr>`).join('');
}

function filterProfesores(){
  renderProfesoresTable();
}

async function cambiarRol(legajo, rol){
  const usuario = usuariosRegistrados.find(item=>item.legajo===legajo);
  if(!usuario || !['alumno','profesor'].includes(rol)) return;
  if(authToken){
    try{
      await apiRequest(`/api/admin/users/${encodeURIComponent(legajo)}/rol`, {method:'PATCH', body:JSON.stringify({rol})});
      await cargarEstadoAPI();
      renderAll();
      showToast(`Rol de ${usuario.nombre} actualizado.`, 'success');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }
  usuario.rol = rol;
  renderProfesoresTable();
  renderTardanzas();
  showToast(`Rol de ${usuario.nombre} actualizado.`, 'success');
}

function iniciarSesion(){
  document.getElementById('auth-shell').classList.add('hidden');
  document.getElementById('app-root').classList.add('active');
  const testBanner = document.getElementById('testModeBanner');
  testBanner.style.display = API_BASE ? 'none' : 'inline-flex';
  document.getElementById('demoHint').style.display = API_BASE ? 'none' : '';
  document.getElementById('testModeRole').textContent = `sesión de ${rolLabel[rolActivo]}`;
  renderAll();
  applyRoleVisibility();
  switchView('inicio');
}

function logout(){
  authToken = null;
  currentUser = null;
  rolActivo = null;
  document.getElementById('testModeBanner').style.display = 'none';
  document.getElementById('app-root').classList.remove('active');
  document.getElementById('auth-shell').classList.remove('hidden');
  switchAuthView('login');
  showToast('Sesión cerrada correctamente.', 'warn');
}

function applyRoleVisibility(){
  document.querySelectorAll('li[data-roles]').forEach(li=>{
    const roles = li.dataset.roles.split(',');
    li.classList.toggle('role-visible', roles.includes(rolActivo));
  });
  document.querySelectorAll('.action-card[data-roles]').forEach(btn=>{
    const roles = btn.dataset.roles.split(',');
    btn.style.display = roles.includes(rolActivo) ? '' : 'none';
  });
  document.querySelectorAll('[data-roles-el]').forEach(el=>{
    const roles = el.dataset.rolesEl.split(',');
    el.style.display = roles.includes(rolActivo) ? '' : 'none';
  });
  toggleInicioParaRol();
  const pill = document.getElementById('sidebarRolePill');
  pill.textContent = rolLabel[rolActivo];
  pill.className = 'role-pill role-' + rolActivo;
}

function toggleProfesorUI(){
  const isProf = rolActivo === 'profesor';
  document.getElementById('loteToggleWrap').style.display = isProf ? 'flex' : 'none';
  document.getElementById('resCursoProfesor').required = isProf;
  if(!isProf){
    document.getElementById('loteToggle').checked = false;
    toggleLoteBlock();
  }
  actualizarControlesReserva();
}

function toggleLoteBlock(){
  const checked = document.getElementById('loteToggle').checked;
  document.getElementById('loteBlock').classList.toggle('show', checked);
  document.getElementById('resCantidadWrap').style.display = checked ? 'none' : 'flex';
  document.getElementById('loteCurso').required = checked && rolActivo==='profesor';
  document.getElementById('resSubmitBtn').textContent = checked ? 'Enviar solicitud de lote' : 'Confirmar reserva';
  actualizarControlesReserva();
}

function tieneEquiposPendientes(legajo){
  if(prestamosActivos[legajo]) return true;
  if(notificacionesDevolucion.some(notificacion=>notificacion.alumnoLegajo===legajo)) return true;
  return reservas.some(reserva=>reserva.ownerLegajo===legajo &&
    !['rechazada','cancelada'].includes(reserva.estado) &&
    reserva.notebookIds?.length > 0);
}

function actualizarControlesReserva(){
  const cantidadInput = document.getElementById('resCantidad');
  const loteCantidadInput = document.getElementById('loteCantidad');
  const submitButton = document.getElementById('resSubmitBtn');
  if(!cantidadInput || !loteCantidadInput || !submitButton || !currentUser) return;

  const esProfesor = rolActivo==='profesor';
  const equiposDisponibles = notebooks.filter(nb=>nb.estado==='disponible').length;
  const bloqueado = tieneEquiposPendientes(currentUser.legajo);
  const maxIndividual = esProfesor ? Math.max(1, equiposDisponibles) : 1;
  cantidadInput.max = String(maxIndividual);
  cantidadInput.value = esProfesor ? Math.min(Math.max(Number(cantidadInput.value)||1, 1), maxIndividual) : 1;
  loteCantidadInput.max = String(Math.min(40, equiposDisponibles));
  loteCantidadInput.value = Math.min(Math.max(Number(loteCantidadInput.value)||3, 3), Math.max(3, Math.min(40, equiposDisponibles)));

  cantidadInput.disabled = !esProfesor;
  document.getElementById('loteToggle').disabled = bloqueado || equiposDisponibles < 3;
  loteCantidadInput.disabled = equiposDisponibles < 3;
  document.getElementById('resCursoProfesor').disabled = false;
  submitButton.disabled = bloqueado || (document.getElementById('loteToggle').checked ? equiposDisponibles < 3 : equiposDisponibles < 1);
}

/* ======================================================================
   NAVEGACIÓN
====================================================================== */
function switchView(name){
  const target = document.getElementById('view-'+name);
  if(!target) return;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  target.classList.add('active');
  document.querySelectorAll('.nav-item[data-view]').forEach(b=>b.classList.toggle('active', b.dataset.view===name));

  const [titleTpl, sub] = pageMeta[name];
  const firstName = currentUser ? currentUser.nombre.split(' ')[0] : '';
  document.getElementById('pageTitle').textContent = titleTpl.replace('{NOMBRE}', firstName ? ', '+firstName : '');
  document.getElementById('pageSubtitle').textContent = sub;
  window.scrollTo({top:0, behavior:'smooth'});

  if(name==='inicio' && rolActivo!=='admin') renderMiActividad();
  if(name==='prestamos'){ renderPrestamoActivo(); renderHistorialPrestamos(); }
  if(name==='reservas'){ renderReservas(); toggleProfesorUI(); }
  if(name==='tickets') renderTicketsPropios();
  if(name==='perfil') renderPerfil();
  if(name==='admin-profesores') renderProfesoresTable();
  if(name==='admin-inventario') renderAdminInventario();
  if(name==='admin-devoluciones') renderDevoluciones();
  if(name==='admin-lotes') renderLotes();
  if(name==='admin-tickets') renderAdminTickets();
  if(name==='admin-tardanzas') renderTardanzas();
}

function renderAll(){
  renderHeaderUser();
  renderNotebooks();
  renderPrestamoActivo();
  renderHistorialPrestamos();
  renderReservas();
  renderTicketsPropios();
  renderPerfil();
  renderProfesoresTable();
  renderAdminInventario();
  renderDevoluciones();
  renderLotes();
  renderAdminTickets();
  renderTardanzas();
}

function renderHeaderUser(){
  if(!currentUser) return;
  document.getElementById('headerAvatar').textContent = getInitials(currentUser.nombre);
  document.getElementById('headerNombre').textContent = currentUser.nombre;
  document.getElementById('headerRolCurso').textContent = rolLabel[rolActivo];
}

function getInitials(nombre){
  const parts = nombre.trim().split(/\s+/);
  const first = parts[0]?.[0] || '';
  const last = parts.length>1 ? parts[parts.length-1][0] : '';
  return (first+last).toUpperCase();
}

/* ======================================================================
   TOAST
====================================================================== */
function showToast(msg, type){
  const wrap = document.getElementById('toast-wrap');
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' '+type : '');
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(()=>t.remove(),300); }, 3200);
}

/* ======================================================================
   MODALES
====================================================================== */
function openModal(id){ document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(m=>{
  m.addEventListener('click', e=>{ if(e.target===m) m.classList.remove('open'); });
});

/* ======================================================================
   NOTEBOOKS (Inicio + Admin Inventario)
====================================================================== */
function renderNotebooks(){
  const tbody = document.getElementById('notebookTable');
  tbody.innerHTML = '';
  actualizarStats();
  notebooks.forEach(nb=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="mono">${escapeHtml(nb.id)}</td>
      <td><span class="badge ${escapeHtml(badgeClass[nb.estado])}">${escapeHtml(badgeLabel[nb.estado])}</span></td>
      <td>${escapeHtml(nb.ubicacion)}</td>
      <td>${escapeHtml(nb.act)}</td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('statDisponibles').textContent = stats.disponibles;
  document.getElementById('statPrestadas').textContent = stats.prestadas;
  document.getElementById('statMantenimiento').textContent = stats.mantenimiento;
  document.getElementById('statTotal').textContent = stats.total;
  document.getElementById('statDisponiblesUsuario').textContent = stats.disponibles;
}

function actualizarStats(){
  stats.total = notebooks.length;
  stats.disponibles = notebooks.filter(nb=>nb.estado==='disponible').length;
  stats.prestadas = notebooks.filter(nb=>nb.estado==='prestada' || nb.estado==='pendiente_devolucion').length;
  stats.mantenimiento = notebooks.filter(nb=>nb.estado==='mantenimiento').length;
}

/* ---- Home simplificado para alumno/profesor vs. panel completo del admin ---- */
function toggleInicioParaRol(){
  const esAdmin = rolActivo === 'admin';
  const statsAdmin = document.getElementById('statsGridAdmin');
  const statsUsuario = document.getElementById('statsGridUsuario');
  const cardAdmin = document.getElementById('cardEstadoNotebooks');
  const cardUsuario = document.getElementById('cardMiActividad');
  if(!statsAdmin || !statsUsuario || !cardAdmin || !cardUsuario) return;
  statsAdmin.style.display = esAdmin ? 'grid' : 'none';
  statsUsuario.style.display = esAdmin ? 'none' : 'grid';
  cardAdmin.style.display = esAdmin ? 'block' : 'none';
  cardUsuario.style.display = esAdmin ? 'none' : 'block';
  if(!esAdmin) renderMiActividad();
}

function renderMiActividad(){
  const wrap = document.getElementById('miActividadWrap');
  if(!wrap || !currentUser) return;

  const proximaReserva = reservas
    .filter(r=>r.ownerLegajo===currentUser.legajo && r.estado!=='rechazada')
    .sort((a,b)=>a.fecha.localeCompare(b.fecha))[0];
  const ticketsAbiertos = tickets.filter(t=>t.ownerLegajo===currentUser.legajo && t.estado!=='resuelto').length;
  const prestamo = prestamosActivos[currentUser.legajo];

  let html = '';

  if(prestamo && !prestamo.pendiente){
    html += `
      <div class="action-card" style="cursor:default;margin-bottom:.8rem;">
        <div class="action-icon" style="background:var(--blue-bg);color:var(--blue-text);">💻</div>
        <div class="action-info"><h4>Tenés ${escapeHtml(prestamo.id)} en tu poder</h4><p>Vence ${escapeHtml(prestamo.vence)}</p></div>
      </div>`;
  } else if(prestamo && prestamo.pendiente){
    html += `
      <div class="action-card" style="cursor:default;margin-bottom:.8rem;">
        <div class="action-icon" style="background:var(--green-bg);color:var(--green-text);">✅</div>
        <div class="action-info"><h4>Devolución de ${escapeHtml(prestamo.id)} informada</h4><p>Esperando confirmación de recepción del Administrador.</p></div>
      </div>`;
  }

  if(proximaReserva){
    const detalle = proximaReserva.tipo==='lote' ? (proximaReserva.curso+' · '+proximaReserva.cantidad+' equipos') : (proximaReserva.carro+' · '+proximaReserva.cantidad);
    html += `
      <div class="action-card" style="cursor:default;margin-bottom:.8rem;">
        <div class="action-icon">📅</div>
        <div class="action-info"><h4>${escapeHtml(detalle)}</h4><p>${escapeHtml(formatFecha(proximaReserva.fecha))} · ${escapeHtml(proximaReserva.hora)}</p></div>
      </div>`;
  } else if(!prestamo){
    html += `<div class="empty-state">
      <div class="glyph">🗓️</div>
      <h4>No tenés reservas próximas</h4>
      <p>Reservá una notebook desde acciones rápidas.</p>
    </div>`;
  }

  if(ticketsAbiertos>0){
    html += `
      <div class="action-card" style="cursor:pointer;" onclick="switchView('tickets')">
        <div class="action-icon" style="background:var(--orange-bg);color:var(--orange-text);">⚠️</div>
        <div class="action-info"><h4>${escapeHtml(ticketsAbiertos)} ticket${ticketsAbiertos===1?'':'s'} abierto${ticketsAbiertos===1?'':'s'}</h4><p>Ver seguimiento</p></div>
        <span class="action-arrow">›</span>
      </div>`;
  }

  wrap.innerHTML = html;
}

function filterNotebooks(){
  const q = document.getElementById('searchInput').value.toLowerCase();
  const est = document.getElementById('filterEstado').value;
  document.querySelectorAll('#notebookTable tr').forEach((tr,i)=>{
    const nb = notebooks[i];
    const matchesText = tr.innerText.toLowerCase().includes(q);
    const matchesEstado = !est || nb.estado===est;
    tr.style.display = (matchesText && matchesEstado) ? '' : 'none';
  });
}

function renderAdminInventario(){
  const tbody = document.getElementById('adminInventoryTable');
  if(!tbody) return;
  tbody.innerHTML = notebooks.map(nb=>`
    <tr>
      <td class="mono">${escapeHtml(nb.id)}</td>
      <td><span class="badge ${escapeHtml(badgeClass[nb.estado])}">${escapeHtml(badgeLabel[nb.estado])}</span></td>
      <td>${escapeHtml(nb.ubicacion)}</td>
      <td>${escapeHtml(nb.prestadoA || '—')}</td>
      <td>${escapeHtml(nb.act)}</td>
      <td>
        <select class="btn btn-sm" aria-label="Cambiar estado de ${escapeHtml(nb.id)}" onchange="adminCambiarEstadoNotebook(${escapeHtml(JSON.stringify(nb.id))}, this.value)">
          ${estadosNotebookManuales.includes(nb.estado) ? '' : '<option value="" selected disabled>—</option>'}
          <option value="disponible" ${nb.estado==='disponible'?'selected':''}>Disponible</option>
          <option value="mantenimiento" ${nb.estado==='mantenimiento'?'selected':''}>Mantenimiento</option>
        </select>
      </td>
    </tr>`).join('');
}

// El estado de las notebooks se mueve solo con el uso del sistema (reservas, préstamos, devoluciones
// confirmadas y reportes de falla). La única decisión manual del Admin es habilitar un equipo que
// estaba en mantenimiento y ya se terminó de reparar.
function moverAMantenimiento(nb){
  if(nb.estado==='mantenimiento') return;
  if(nb.estado==='disponible') stats.disponibles = Math.max(0, stats.disponibles-1);
  if(nb.estado==='prestada' || nb.estado==='pendiente_devolucion') stats.prestadas = Math.max(0, stats.prestadas-1);
  stats.mantenimiento += 1;
  nb.estado = 'mantenimiento';
  nb.ubicacion = 'Taller';
  nb.act = 'Recién';
  nb.prestadoA = null;
}

async function habilitarNotebook(id){
  const nb = notebooks.find(n=>n.id===id);
  if(!nb || nb.estado!=='mantenimiento') return;
  if(authToken){
    try{
      await apiRequest('/api/notebooks/'+encodeURIComponent(id), {method:'PATCH', body:JSON.stringify({estado:'disponible'})});
      await cargarEstadoAPI();
      renderAll();
      showToast(`${id} habilitada. Ya figura como disponible.`, 'success');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }
  stats.mantenimiento = Math.max(0, stats.mantenimiento-1);
  stats.disponibles += 1;
  nb.estado = 'disponible';
  nb.ubicacion = 'Carro 1';
  nb.act = 'Recién';
  nb.marcarMantenimientoAlDevolver = false;
  tickets.filter(t=>t.notebook===id && t.estado!=='resuelto').forEach(t=>t.estado='resuelto');

  renderNotebooks();
  renderAdminInventario();
  renderAdminTickets();
  showToast(`${id} habilitada. Ya figura como disponible.`, 'success');
}

async function adminCambiarEstadoNotebook(id, nuevoEstado){
  const nb = notebooks.find(n=>n.id===id);
  if(!nb || !estadosNotebookManuales.includes(nuevoEstado) || nb.estado===nuevoEstado) return;
  if(authToken){
    try{
      await apiRequest('/api/notebooks/'+encodeURIComponent(id), {method:'PATCH', body:JSON.stringify({estado:nuevoEstado})});
      await cargarEstadoAPI();
      renderAll();
      showToast(`${id} actualizada a ${badgeLabel[nuevoEstado].toLowerCase()}.`, 'success');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }

  if(nb.estado==='disponible') stats.disponibles = Math.max(0, stats.disponibles-1);
  if(nb.estado==='prestada' || nb.estado==='pendiente_devolucion') stats.prestadas = Math.max(0, stats.prestadas-1);
  if(nb.estado==='mantenimiento') stats.mantenimiento = Math.max(0, stats.mantenimiento-1);
  if(nuevoEstado==='disponible') stats.disponibles += 1;
  if(nuevoEstado==='prestada') stats.prestadas += 1;
  if(nuevoEstado==='mantenimiento') stats.mantenimiento += 1;

  nb.estado = nuevoEstado;
  nb.act = 'Recién';
  if(nuevoEstado==='disponible'){
    nb.ubicacion = 'Carro 1';
    nb.prestadoA = null;
  } else if(nuevoEstado==='mantenimiento'){
    nb.ubicacion = 'Taller';
    nb.prestadoA = null;
  } else if(nuevoEstado==='pendiente_devolucion'){
    nb.ubicacion = '—';
  } else {
    nb.ubicacion = '—';
    nb.prestadoA = nb.prestadoA || 'Administración';
  }
  if(nuevoEstado==='disponible'){
    tickets.filter(t=>t.notebook===id && t.estado!=='resuelto').forEach(t=>t.estado='resuelto');
  }
  renderNotebooks();
  renderAdminInventario();
  renderAdminTickets();
  showToast(`${id} actualizada a ${badgeLabel[nuevoEstado].toLowerCase()}.`, 'success');
}

function filterAdminNotebooks(){
  const q = document.getElementById('adminSearchInput').value.toLowerCase();
  const est = document.getElementById('adminFilterEstado').value;
  document.querySelectorAll('#adminInventoryTable tr').forEach((tr,i)=>{
    const nb = notebooks[i];
    const matchesText = tr.innerText.toLowerCase().includes(q);
    const matchesEstado = !est || nb.estado===est;
    tr.style.display = (matchesText && matchesEstado) ? '' : 'none';
  });
}

/* ======================================================================
   MIS PRÉSTAMOS + DEVOLUCIÓN ESTRICTA
====================================================================== */
function renderPrestamoActivo(){
  const wrap = document.getElementById('prestamoActivoWrap');
  if(!currentUser) return;
  const prestamo = prestamosActivos[currentUser.legajo];
  if(!prestamo){
    wrap.innerHTML = `<div class="empty-state">
      <div class="glyph">✅</div>
      <h4>No tenés notebooks en préstamo</h4>
      <p>Cuando reserves y retires un equipo, va a aparecer acá.</p>
    </div>`;
    return;
  }
  if(prestamo.pendiente){
    wrap.innerHTML = `
      <div class="action-card" style="cursor:default;">
        <div class="action-icon" style="background:var(--red-bg);color:var(--red-text);">⏳</div>
        <div class="action-info">
          <h4>${escapeHtml(prestamo.id)}</h4>
          <p>Retirada ${escapeHtml(prestamo.desde)} · Devolución informada</p>
        </div>
        <span class="badge badge-pendiente_devolucion">Esperando confirmación del Admin</span>
      </div>
      <p class="hint" style="margin-top:.8rem;">La devolución fue informada y queda pendiente de recepción física por parte del Administrador.</p>`;
    return;
  }
  wrap.innerHTML = `
    <div class="action-card" style="cursor:default;">
      <div class="action-icon" style="background:var(--blue-bg);color:var(--blue-text);">💻</div>
      <div class="action-info">
        <h4>${escapeHtml(prestamo.id)}</h4>
        <p>Retirada ${escapeHtml(prestamo.desde)} · Vence ${escapeHtml(prestamo.vence)}</p>
      </div>
      <button class="btn btn-primary btn-sm" onclick="openReturnModal()">Devolver</button>
    </div>`;
}

function renderHistorialPrestamos(){
  const tbody = document.getElementById('historialPrestamosTable');
  if(!tbody) return;
  if(historialPrestamos.length===0){
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">
      <div class="glyph">📋</div><h4>No tenés historial de préstamos</h4><p>Los préstamos que retires aparecerán acá.</p>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = historialPrestamos.map(loan=>{
    const retirada = formatBusinessDateTime(loan.retirada_at);
    const devuelta = loan.devuelta_at ? formatBusinessDateTime(loan.devuelta_at) : '—';
    const demorada = loan.devuelta_at && new Date(loan.devuelta_at) > new Date(loan.vence_at);
    const label = loan.estado==='devuelto' ? (demorada ? 'Devuelta con demora' : 'Devuelta a tiempo') : (loan.estado==='devolucion_pendiente' ? 'Devolución pendiente' : 'Préstamo activo');
    const badge = loan.estado==='devuelto' ? (demorada ? 'badge-vencido' : 'badge-resuelto') : (loan.estado==='devolucion_pendiente' ? 'badge-pendiente_devolucion' : 'badge-prestada');
    return `<tr><td class="mono">${escapeHtml(loan.notebook)}</td><td>${escapeHtml(retirada)}</td><td>${escapeHtml(devuelta)}</td><td><span class="badge ${escapeHtml(badge)}">${escapeHtml(label)}</span></td></tr>`;
  }).join('');
}

function openReturnModal(){
  const prestamo = prestamosActivos[currentUser.legajo];
  document.getElementById('returnModalText').textContent = `¿Confirmás que estás devolviendo físicamente la notebook ${prestamo.id}? Un administrador deberá confirmar la recepción antes de que quede liberada.`;
  openModal('returnModal');
}

async function confirmarDevolucion(){
  if(authToken){
    const prestamoAPI = prestamosActivos[currentUser.legajo];
    if(!prestamoAPI?.loanId) return;
    try{
      await apiRequest(`/api/loans/${prestamoAPI.loanId}/return`, {method:'POST'});
      await cargarEstadoAPI();
      renderAll();
      closeModal('returnModal');
      showToast('Devolución solicitada. Queda pendiente de confirmación del Administrador.', 'warn');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }
  const prestamo = prestamosActivos[currentUser.legajo];
  if(!prestamo) return;
  const nb = notebooks.find(n=>n.id===prestamo.id);
  if(nb){ nb.estado='pendiente_devolucion'; nb.act='Recién'; }
  prestamo.pendiente = true;

  notificacionesDevolucion.push({
    id: 'DEV-'+String(notifSeq++).padStart(3,'0'),
    notebookId: prestamo.id,
    alumnoLegajo: currentUser.legajo,
    alumnoNombre: currentUser.nombre,
    curso: prestamosActivos[currentUser.legajo]?.curso || 'Curso no informado',
    fechaSolicitud: 'Recién',
    solicitadoEn: new Date(),
    vencimiento: prestamo.vencimiento || null,
    rol: currentUser.rol
  });

  renderNotebooks();
  renderAdminInventario();
  renderPrestamoActivo();
  renderDevoluciones();
  closeModal('returnModal');
  showToast('Devolución solicitada. Queda pendiente de confirmación del Administrador.', 'warn');
}

/* ======================================================================
   ADMIN · DEVOLUCIONES PENDIENTES
====================================================================== */
function renderDevoluciones(){
  const wrap = document.getElementById('devolucionesWrap');
  if(!wrap) return;
  const badge = document.getElementById('devBadge');
  if(notificacionesDevolucion.length===0){
    wrap.innerHTML = `<div class="empty-state">
      <div class="glyph">📭</div>
      <h4>No hay devoluciones pendientes</h4>
      <p>Cuando un alumno solicite devolver un equipo, va a aparecer acá.</p>
    </div>`;
    badge.style.display = 'none';
    return;
  }
  badge.style.display = 'inline-flex';
  badge.textContent = notificacionesDevolucion.length;
  wrap.innerHTML = notificacionesDevolucion.map((n,i)=>`
    <div class="action-card" style="cursor:default;margin-bottom:.8rem;">
      <div class="action-icon" style="background:var(--red-bg);color:var(--red-text);">📥</div>
      <div class="action-info">
        <h4>${escapeHtml(n.notebookId)} · ${escapeHtml(n.alumnoNombre)}</h4>
        <p>${escapeHtml(n.curso)} · Legajo ${escapeHtml(n.alumnoLegajo)} · Solicitado ${escapeHtml(n.fechaSolicitud)}</p>
      </div>
      <button class="btn btn-primary btn-sm" onclick="confirmarRecepcion(${i})">Confirmar recepción física</button>
    </div>`).join('');
}

async function confirmarRecepcion(idx){
  const n = notificacionesDevolucion[idx];
  if(!n) return;
  if(authToken){
    try{
      await apiRequest(`/api/admin/returns/${n.returnId || n.id}/confirm`, {method:'POST'});
      await cargarEstadoAPI();
      renderAll();
      showToast(`Recepción de ${n.notebookId} confirmada.`, 'success');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }
  const nb = notebooks.find(x=>x.id===n.notebookId);
  delete prestamosActivos[n.alumnoLegajo];
  notificacionesDevolucion.splice(idx,1);

  let aviso = `Recepción de ${n.notebookId} confirmada. Deuda de ${n.alumnoNombre} liberada.`;
  if(nb && nb.marcarMantenimientoAlDevolver){
    stats.prestadas = Math.max(0, stats.prestadas-1);
    stats.mantenimiento += 1;
    nb.estado='mantenimiento'; nb.ubicacion='Taller'; nb.act='Recién'; nb.prestadoA=null; nb.marcarMantenimientoAlDevolver=false;
    aviso += ` Como tenía una falla reportada, quedó automáticamente en mantenimiento.`;
  } else if(nb){
    stats.prestadas = Math.max(0, stats.prestadas-1);
    stats.disponibles += 1;
    nb.estado='disponible'; nb.ubicacion='Carro 1'; nb.act='Recién'; nb.prestadoA=null;
  }

  // Entrega tardía: si el alumno/profesor devolvió el equipo después de la hora límite,
  // queda registrado en su historial. Al llegar a 3 demoras, se avisa al Admin.
  if(n.vencimiento && n.solicitadoEn && new Date(n.solicitadoEn) > new Date(n.vencimiento)){
    const u = estadoUsuarios.find(x=>x.legajo===n.alumnoLegajo);
    if(u){
      u.tardanzas = (u.tardanzas||0) + 1;
      historialTardanzas.unshift({legajo:n.alumnoLegajo, nombre:n.alumnoNombre, rol:n.rol||u.rol, notebookId:n.notebookId, fecha:'Recién'});
      aviso += ` ⏰ Se registró como entrega tardía (van ${u.tardanzas}).`;
      if(u.tardanzas >= 3 && !u.baneado){
        showToast(`🚨 Aviso para el Admin: ${u.nombre} acumula ${u.tardanzas} entregas tardías. Podés evaluar una sanción en "Devoluciones tardías".`, 'error');
      }
    }
    renderTardanzas();
  }

  renderNotebooks();
  renderAdminInventario();
  renderDevoluciones();
  renderAdminTickets();
  actualizarControlesReserva();
  if(currentUser && currentUser.legajo===n.alumnoLegajo) renderPrestamoActivo();
  showToast(aviso, 'success');
}

/* ======================================================================
   RESERVAS (individuales) + LOTES (profesor)
====================================================================== */
function formatFecha(iso){
  if(!iso) return '';
  const [y,m,d] = iso.split('-');
  const meses=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${parseInt(d)} ${meses[parseInt(m)-1]}`;
}

function validarFechaHora(fechaStr, horaStr){
  if(!fechaStr || !horaStr) return {valid:false, msg:'Completá fecha y hora para reservar.'};

  const [y,m,d] = fechaStr.split('-').map(Number);
  const [hh,mm] = horaStr.split(':').map(Number);
  const hoy = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone:BUSINESS_TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit'
  }).formatToParts(new Date()).map(({type, value})=>[type, value]));
  const fechaActual = `${hoy.year}-${hoy.month}-${hoy.day}`;

  if(y !== Number(hoy.year)){
    return {valid:false, msg:`Las reservas solo pueden hacerse durante el año ${hoy.year}.`};
  }

  if(fechaStr < fechaActual){
    return {valid:false, msg:'No se pueden reservar fechas pasadas.'};
  }

  const diaSemana = new Date(Date.UTC(y, m-1, d)).getUTCDay();
  if(diaSemana===0 || diaSemana===6){
    return {valid:false, msg:'Sólo se puede reservar de lunes a viernes (días hábiles).'};
  }

  const minutosDelDia = hh*60+mm;
  const dentroDeHorario = (minutosDelDia >= 8*60 && minutosDelDia <= 12*60+10)
    || (minutosDelDia >= 13*60+30 && minutosDelDia <= 17*60+30);
  if(!dentroDeHorario){
    return {valid:false, msg:'Solo se puede reservar de 08:00 a 12:10 y de 13:30 a 17:30.'};
  }

  return {valid:true, msg:''};
}

async function crearReservaAPI(e){
  const fecha = document.getElementById('resFecha').value;
  const hora = document.getElementById('resHora').value;
  const esLote = rolActivo==='profesor' && document.getElementById('loteToggle').checked;
  const cantidad = esLote ? Number(document.getElementById('loteCantidad').value) : (rolActivo==='profesor' ? Number(document.getElementById('resCantidad').value) : 1);
  const curso = rolActivo==='profesor' ? document.getElementById(esLote ? 'loteCurso' : 'resCursoProfesor').value.trim() : null;
  const errorBox = document.getElementById('resFechaError');
  const check = validarFechaHora(fecha, hora);
  if(!check.valid){ errorBox.textContent = check.msg; showToast(check.msg, 'warn'); return; }
  try{
    await apiRequest('/api/reservations', {method:'POST', body:JSON.stringify({
      tipo:esLote ? 'lote' : 'individual', cantidad, curso, retiroAt:`${fecha}T${hora}:00`, motivo:document.getElementById('resMotivo').value || 'Sin especificar'
    })});
    document.getElementById('reservaForm').reset();
    document.getElementById('loteToggle').checked = false;
    toggleLoteBlock();
    await cargarEstadoAPI();
    renderAll();
    showToast(esLote ? 'Solicitud de lote enviada.' : 'Reserva confirmada.', 'success');
  }catch(error){
    errorBox.textContent = error.message;
    showToast(error.message, 'warn');
  }
}

async function crearReserva(e){
  e.preventDefault();
  if(authToken){ await crearReservaAPI(e); return; }
  const errBox = document.getElementById('resFechaError');
  const fecha = document.getElementById('resFecha').value;
  const hora = document.getElementById('resHora').value;
  const equiposDisponibles = notebooks.filter(nb=>nb.estado==='disponible');
  const motivo = document.getElementById('resMotivo').value || 'Sin especificar';
  const esLote = rolActivo==='profesor' && document.getElementById('loteToggle').checked;

  if(tieneEquiposPendientes(currentUser.legajo)){
    const msg = 'No podés pedir más notebooks hasta devolver las que tenés asignadas.';
    errBox.textContent = msg;
    showToast(msg, 'warn');
    actualizarControlesReserva();
    return;
  }

  const check = validarFechaHora(fecha, hora);
  if(!check.valid){
    errBox.textContent = check.msg;
    showToast(check.msg, 'warn');
    return;
  }
  errBox.textContent = '';

  if(esLote){
    const curso = document.getElementById('loteCurso').value.trim();
    const cantidad = parseInt(document.getElementById('loteCantidad').value) || 10;
    if(!curso){
      const msg = 'Escribí el curso del lote.';
      errBox.textContent = msg;
      showToast(msg, 'warn');
      return;
    }
    if(cantidad < 3 || cantidad > equiposDisponibles.length){
      const msg = `El lote debe tener entre 3 y ${equiposDisponibles.length} equipos.`;
      errBox.textContent = msg;
      showToast(msg, 'warn');
      return;
    }
    if(equiposDisponibles.length < cantidad){
      const msg = `No hay suficientes notebooks disponibles para el lote. Disponibles: ${equiposDisponibles.length}.`;
      errBox.textContent = msg;
      showToast(msg, 'warn');
      return;
    }
    const notebookIds = equiposDisponibles.slice(0, cantidad).map(nb=>nb.id);
    notebookIds.forEach(id=>{ const nb=notebooks.find(item=>item.id===id); nb.estado='reservada'; nb.ubicacion='Reservada'; nb.act='Recién'; });
    reservas.unshift({
      id:'RES-'+String(reservaSeq++).padStart(2,'0'),
      ownerLegajo: currentUser.legajo,
      ownerNombre: currentUser.nombre,
      tipo:'lote', curso, cantidad, fecha, hora, motivo, notebookIds,
      estado:'pendiente_aprobacion'
    });
    document.getElementById('reservaForm').reset();
    document.getElementById('loteToggle').checked = false;
    toggleLoteBlock();
    renderReservas();
    renderLotes();
    renderNotebooks();
    renderAdminInventario();
    actualizarControlesReserva();
    showToast('Solicitud de lote enviada. Queda pendiente de aprobación del Administrador.', 'warn');
    return;
  }

  const cantidadNumerica = rolActivo==='profesor' ? Number(document.getElementById('resCantidad').value) : 1;
  const cantidad = `${cantidadNumerica} ${cantidadNumerica===1 ? 'notebook' : 'notebooks'}`;
  const curso = rolActivo==='profesor' ? document.getElementById('resCursoProfesor').value.trim() : null;
  if(rolActivo==='profesor' && !curso){
    const msg = 'Escribí el curso de la reserva.';
    errBox.textContent = msg;
    showToast(msg, 'warn');
    return;
  }
  if(rolActivo!=='profesor' && cantidadNumerica!==1){
    const msg = 'Los alumnos solo pueden pedir una notebook por vez.';
    errBox.textContent = msg;
    showToast(msg, 'warn');
    return;
  }
  if(esLote || (rolActivo==='profesor' && cantidadNumerica > equiposDisponibles.length)){
    const msg = `No podés pedir más equipos que los disponibles: ${equiposDisponibles.length}.`;
    errBox.textContent = msg;
    showToast(msg, 'warn');
    return;
  }
  if(equiposDisponibles.length < cantidadNumerica){
    const msg = `No hay suficientes notebooks disponibles. Disponibles: ${equiposDisponibles.length}.`;
    errBox.textContent = msg;
    showToast(msg, 'warn');
    return;
  }
  const notebookIds = equiposDisponibles.slice(0, cantidadNumerica).map(nb=>nb.id);
  notebookIds.forEach(id=>{ const nb=notebooks.find(item=>item.id===id); nb.estado='reservada'; nb.ubicacion='Reservada'; nb.act='Recién'; });
  reservas.unshift({
    id:'RES-'+String(reservaSeq++).padStart(2,'0'),
    ownerLegajo: currentUser.legajo,
    ownerNombre: currentUser.nombre,
    tipo:'individual', curso, cantidad, fecha, hora, motivo, notebookIds,
    estado:'confirmada'
  });
  document.getElementById('reservaForm').reset();
  renderReservas();
  renderNotebooks();
  renderAdminInventario();
  actualizarControlesReserva();
  showToast('Reserva confirmada para el '+formatFecha(fecha)+' a las '+hora+'.', 'success');
}

async function cancelarReserva(id){
  if(authToken){
    try{
      await apiRequest('/api/reservations/'+encodeURIComponent(id), {method:'DELETE'});
      await cargarEstadoAPI();
      renderAll();
      showToast('Reserva cancelada.', 'warn');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }
  const idx = reservas.findIndex(r=>r.id===id);
  if(idx<0) return;
  reservas[idx].notebookIds?.forEach(notebookId=>{
    const nb = notebooks.find(item=>item.id===notebookId);
    if(nb?.estado==='reservada'){ nb.estado='disponible'; nb.ubicacion='Carro 1'; nb.act='Recién'; }
  });
  reservas.splice(idx,1);
  renderReservas();
  renderLotes();
  renderNotebooks();
  renderAdminInventario();
  actualizarControlesReserva();
  showToast('Reserva cancelada.', 'warn');
}

function renderReservas(){
  const wrap = document.getElementById('reservasListWrap');
  if(!wrap || !currentUser) return;
  actualizarControlesReserva();
  const propias = reservas.filter(r=>r.ownerLegajo===currentUser.legajo);
  if(propias.length===0){
    wrap.innerHTML = `<div class="empty-state">
      <div class="glyph">🗓️</div>
      <h4>Todavía no tenés reservas</h4>
      <p>Completá el formulario para programar un retiro.</p>
    </div>`;
    return;
  }
  const estadoLabelMap = {confirmada:'Confirmada', pendiente_aprobacion:'Pendiente de aprobación', aprobada:'Aprobada', rechazada:'Rechazada'};
  wrap.innerHTML = propias.map(r=>`
    <div class="action-card" style="cursor:default;margin-bottom:.8rem;">
      <div class="action-icon">${r.tipo==='lote' ? '👥' : '📅'}</div>
      <div class="action-info">
        <h4>${escapeHtml(r.tipo==='lote' || r.curso ? (r.curso+' · '+r.cantidad+' equipos') : r.cantidad)}</h4>
        <p>${escapeHtml(formatFecha(r.fecha))} · ${escapeHtml(r.hora)} — ${escapeHtml(r.motivo)}</p>
      </div>
      <span class="badge badge-${escapeHtml(r.estado)}" style="margin-right:.5rem;">${escapeHtml(estadoLabelMap[r.estado] || r.estado)}</span>
      ${r.estado==='pendiente_aprobacion' || r.estado==='confirmada' ? `<button class="btn btn-sm btn-danger-outline" onclick="cancelarReserva(${escapeHtml(JSON.stringify(r.id))})">Cancelar</button>` : ''}
    </div>`).join('');
}

/* ======================================================================
   ADMIN · LOTES DE PROFESORES
====================================================================== */
function renderLotes(){
  const wrap = document.getElementById('lotesWrap');
  if(!wrap) return;
  const badge = document.getElementById('lotesBadge');
  const pendientes = reservas.filter(r=>r.tipo==='lote' && r.estado==='pendiente_aprobacion');
  const aprobadas = reservas.filter(r=>r.tipo==='lote' && r.estado==='aprobada');
  const individuales = reservas.filter(r=>r.tipo==='individual' && r.estado==='confirmada');

  if(pendientes.length===0 && aprobadas.length===0 && individuales.length===0){
    wrap.innerHTML = `<div class="empty-state">
      <div class="glyph">👥</div>
      <h4>No hay solicitudes de lote pendientes</h4>
      <p>Las solicitudes de préstamo por lote de los profesores van a aparecer acá.</p>
    </div>`;
    badge.style.display = 'none';
    return;
  }
  badge.style.display = pendientes.length ? 'inline-flex' : 'none';
  badge.textContent = pendientes.length;

  wrap.innerHTML = pendientes.map(r=>`
    <div class="action-card" style="cursor:default;margin-bottom:.8rem;">
      <div class="action-icon" style="background:var(--purple-bg);color:var(--purple-text);">👥</div>
      <div class="action-info">
        <h4>${escapeHtml(r.curso)} · ${escapeHtml(r.cantidad)} equipos</h4>
        <p>${escapeHtml(r.ownerNombre)} · ${escapeHtml(formatFecha(r.fecha))} ${escapeHtml(r.hora)} — ${escapeHtml(r.motivo)}</p>
      </div>
      <button class="btn btn-sm btn-success-outline" style="margin-right:.5rem;" onclick="aprobarLote(${escapeHtml(JSON.stringify(r.id))})">Aprobar</button>
      <button class="btn btn-sm btn-danger-outline" onclick="pedirRechazoLote(${escapeHtml(JSON.stringify(r.id))})">Rechazar</button>
    </div>`).join('') + aprobadas.map(r=>`
    <div class="action-card" style="cursor:default;margin-bottom:.8rem;">
      <div class="action-icon" style="background:var(--green-bg);color:var(--green-text);">📦</div>
      <div class="action-info">
        <h4>${escapeHtml(r.curso)} · ${escapeHtml(r.cantidad)} equipos</h4>
        <p>${escapeHtml(r.ownerNombre)} · ${escapeHtml(formatFecha(r.fecha))} ${escapeHtml(r.hora)} — Retiro aprobado</p>
      </div>
      <button class="btn btn-sm btn-primary" onclick="registrarRetiro(${escapeHtml(JSON.stringify(r.id))})">Registrar retiro</button>
    </div>`).join('') + individuales.map(r=>`
    <div class="action-card" style="cursor:default;margin-bottom:.8rem;">
      <div class="action-icon" style="background:var(--blue-bg);color:var(--blue-text);">📅</div>
      <div class="action-info">
        <h4>${escapeHtml(r.ownerNombre)} · ${escapeHtml(r.cantidad)}</h4>
        <p>${escapeHtml(formatFecha(r.fecha))} ${escapeHtml(r.hora)} — Reserva confirmada</p>
      </div>
      <button class="btn btn-sm btn-primary" onclick="registrarRetiro(${escapeHtml(JSON.stringify(r.id))})">Registrar retiro</button>
    </div>`).join('');
}

async function aprobarLote(id){
  const r = reservas.find(x=>x.id===id);
  if(!r) return;
  if(authToken){
    try{
      await apiRequest(`/api/admin/reservations/${id}/approve`, {method:'POST'});
      await cargarEstadoAPI();
      renderAll();
      showToast(`Lote de ${r.curso} aprobado.`, 'success');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }
  r.estado = 'aprobada';
  renderLotes();
  renderReservas();
  showToast(`Lote de ${r.curso} aprobado. Falta registrar el retiro físico.`, 'success');
}

async function registrarRetiro(id){
  const r = reservas.find(reserva=>reserva.id===id);
  if(!r) return;
  if(authToken){
    try{
      const result = await apiRequest(`/api/admin/reservations/${id}/checkout`, {method:'POST'});
      await cargarEstadoAPI();
      renderAll();
      showToast(`${result.loansCreated || 0} préstamo(s) creado(s).`, 'success');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }
  const notebookIds = r.notebookIds || [];
  notebookIds.forEach(notebookId=>{
    const nb = notebooks.find(item=>item.id===notebookId);
    if(nb){ nb.estado='prestada'; nb.ubicacion='—'; nb.act='Recién'; nb.prestadoA = r.ownerLegajo+' · '+r.curso; }
  });
  r.estado = 'retirada';
  prestamosActivos[r.ownerLegajo] = {id:notebookIds[0], curso:r.curso, desde:'Recién', vence:'Hoy', pendiente:false};
  renderNotebooks();
  renderAdminInventario();
  renderLotes();
  renderReservas();
  showToast('Retiro registrado y préstamo creado.', 'success');
}

let pendingRejectId = null;
function pedirRechazoLote(id){
  const r = reservas.find(x=>x.id===id);
  if(!r) return;
  pendingRejectId = id;
  document.getElementById('rejectLoteText').textContent = `¿Rechazar la solicitud de lote de ${r.curso} (${r.ownerNombre})?`;
  document.getElementById('rejectLoteConfirmBtn').onclick = confirmarRechazoLote;
  openModal('rejectLoteModal');
}

async function confirmarRechazoLote(){
  const r = reservas.find(x=>x.id===pendingRejectId);
  if(!r) return;
  if(authToken){
    try{
      await apiRequest(`/api/admin/reservations/${encodeURIComponent(r.id)}/reject`, {method:'POST'});
      await cargarEstadoAPI();
      renderAll();
      closeModal('rejectLoteModal');
      showToast('Solicitud de lote rechazada.', 'warn');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }
  if(r) r.estado = 'rechazada';
  r.notebookIds?.forEach(notebookId=>{
    const notebook = notebooks.find(item=>item.id===notebookId);
    if(notebook?.estado==='reservada'){
      notebook.estado = 'disponible';
      notebook.ubicacion = 'Carro 1';
      notebook.act = 'Recién';
    }
  });
  closeModal('rejectLoteModal');
  renderLotes();
  renderReservas();
  renderNotebooks();
  renderAdminInventario();
  actualizarControlesReserva();
  showToast('Solicitud de lote rechazada.', 'warn');
}

/* ======================================================================
   REPORTAR FALLA / TICKETS
====================================================================== */
async function crearTicket(e){
  e.preventDefault();
  const nbSel = document.getElementById('fallaNotebook');
  const desc = document.getElementById('fallaDesc').value.trim();
  if(!nbSel.value || !desc){ showToast('Completá la notebook y la descripción.', 'warn'); return; }
  if(authToken){
    try{
      await apiRequest('/api/tickets', {method:'POST', body:JSON.stringify({
        notebook:nbSel.value==='otro' ? null : nbSel.value, motivo:desc.slice(0,240), descripcion:desc
      })});
      document.getElementById('fallaForm').reset();
      await cargarEstadoAPI();
      renderAll();
      showToast('Reporte enviado al Administrador.', 'success');
      switchView('tickets');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }

  const t = {
    id: 'TCK-0'+(ticketSeq++),
    notebook: nbSel.value==='otro' ? 'Sin identificar' : nbSel.value,
    motivo: desc.length>46 ? desc.slice(0,46)+'…' : desc,
    motivoCompleto: desc,
    estado:'abierto', fecha:'hoy',
    ownerLegajo: currentUser.legajo,
    ownerNombre: currentUser.nombre,
    ownerRol: currentUser.rol
  };
  tickets.unshift(t);
  document.getElementById('fallaForm').reset();
  document.querySelectorAll('#severityGroup .severity-opt').forEach(o=>o.className='severity-opt');
  document.querySelector('.severity-opt[data-val="media"]').classList.add('checked-media');

  // Automatización: si el equipo reportado está disponible, pasa solo a "mantenimiento".
  // Si está prestado, se manda a mantenimiento recién cuando se confirme su devolución.
  let avisoEquipo = '';
  if(t.notebook !== 'Sin identificar'){
    const nb = notebooks.find(n=>n.id===t.notebook);
    if(nb && nb.estado==='disponible'){
      moverAMantenimiento(nb);
      avisoEquipo = ` ${t.notebook} se marcó automáticamente en mantenimiento.`;
    } else if(nb){
      nb.marcarMantenimientoAlDevolver = true;
    }
  }

  updateTicketsBadge();
  updateAdminTicketsBadge();
  renderAdminTickets();
  renderNotebooks();
  renderAdminInventario();
  showToast('Reporte enviado al Administrador. Ticket '+t.id+' creado.'+avisoEquipo, 'success');
  switchView('tickets');
}



function updateTicketsBadge(){
  if(!currentUser) return;
  const abiertos = tickets.filter(t=>t.estado!=='resuelto' && t.ownerLegajo===currentUser.legajo).length;
  const badge = document.getElementById('ticketsBadge');
  if(abiertos>0){ badge.style.display='inline-flex'; badge.textContent = abiertos; }
  else{ badge.style.display='none'; }
}

function renderTicketsPropios(){
  // "Mis tickets" sólo muestra los del usuario logueado (alumno o profesor)
  const tbody = document.getElementById('ticketsTable');
  if(!tbody || !currentUser) return;
  const propios = tickets.filter(t=>t.ownerLegajo===currentUser.legajo);
  if(propios.length===0){
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">
      <div class="glyph">🎫</div><h4>No tenés tickets abiertos</h4><p>Si encontrás un problema con un equipo, reportalo desde acá.</p>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = propios.map(t=>`
    <tr>
      <td class="mono">${escapeHtml(t.id)}</td>
      <td class="mono">${escapeHtml(t.notebook)}</td>
      <td>${escapeHtml(t.motivo)}</td>
      <td><span class="badge ${escapeHtml(ticketBadgeClass[t.estado])}">${escapeHtml(ticketBadgeLabel[t.estado])}</span></td>
      <td>${escapeHtml(t.fecha)}</td>
    </tr>`).join('');
}

/* ---- ADMIN: Fallas / tickets reportados por todos los usuarios ---- */
function renderAdminTickets(){
  const tbody = document.getElementById('adminTicketsTable');
  if(!tbody) return;
  const ticketsActivos = tickets.filter(t=>t.estado!=='resuelto');
  if(ticketsActivos.length===0){
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
      <div class="glyph">🎫</div><h4>No hay fallas reportadas</h4><p>Los reportes de alumnos y profesores van a aparecer acá.</p>
    </div></td></tr>`;
    updateAdminTicketsBadge();
    return;
  }
  tbody.innerHTML = ticketsActivos.map(t=>{
    const nb = notebooks.find(n=>n.id===t.notebook);
    let equipoCol = '<span class="hint">Sin equipo identificado</span>';
    if(nb){
      equipoCol = `<span class="badge ${escapeHtml(badgeClass[nb.estado])}">${escapeHtml(badgeLabel[nb.estado])}</span>`;
      if(nb.estado==='mantenimiento'){
        equipoCol += ` <button class="btn btn-sm btn-success-outline" style="margin-left:.4rem;" onclick="habilitarNotebook(${escapeHtml(JSON.stringify(nb.id))})">Habilitar</button>`;
      } else if(nb.marcarMantenimientoAlDevolver){
        equipoCol += ` <span class="hint">(pasará a mantenimiento al devolverse)</span>`;
      }
    }
    return `
    <tr>
      <td class="mono">${escapeHtml(t.id)}</td>
      <td>${escapeHtml(t.ownerNombre)} <span class="hint">(${escapeHtml(rolLabel[t.ownerRol] || t.ownerRol)})</span></td>
      <td class="mono">${escapeHtml(t.notebook)}</td>
      <td>${escapeHtml(t.motivo)}</td>
      <td>
        <select class="btn btn-sm" style="font-weight:500;" onchange="adminSetTicketEstado(${escapeHtml(JSON.stringify(t.id))}, this.value)">
          <option value="abierto" ${t.estado==='abierto'?'selected':''}>Abierto</option>
          <option value="progreso" ${t.estado==='progreso'?'selected':''}>En progreso</option>
          <option value="resuelto" ${t.estado==='resuelto'?'selected':''}>Resuelto</option>
        </select>
      </td>
      <td>${equipoCol}</td>
    </tr>`;
  }).join('');
  updateAdminTicketsBadge();
}

async function adminSetTicketEstado(idx, nuevoEstado){
  const t = tickets.find(ticket=>ticket.id===idx);
  if(!t) return;
  if(authToken){
    try{
      await apiRequest('/api/tickets/'+encodeURIComponent(idx), {method:'PATCH', body:JSON.stringify({estado:nuevoEstado})});
      await cargarEstadoAPI();
      renderAll();
      showToast(`Ticket ${t.id} actualizado.`, 'success');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }
  t.estado = nuevoEstado;
  renderAdminTickets();
  updateTicketsBadge();
  showToast(`Ticket ${t.id} actualizado a "${ticketBadgeLabel[nuevoEstado]}".`, 'success');
}

function updateAdminTicketsBadge(){
  const badge = document.getElementById('adminTicketsBadge');
  if(!badge) return;
  const abiertos = tickets.filter(t=>t.estado!=='resuelto').length;
  if(abiertos>0){ badge.style.display='inline-flex'; badge.textContent = abiertos; }
  else{ badge.style.display='none'; }
}

/* ======================================================================
   ADMIN · DEVOLUCIONES TARDÍAS Y SANCIONES
====================================================================== */
function renderTardanzas(){
  const wrap = document.getElementById('usuariosTardiosWrap');
  const tbody = document.getElementById('historialTardanzasTable');
  const porUsuarioBody = document.getElementById('historialPorUsuarioTable');
  const badge = document.getElementById('tardanzasBadge');
  if(!wrap || !tbody) return;

  const todosUsuarios = authToken ? usuariosConTardanzas : estadoUsuarios.filter(u=>u.rol!=='admin');

  if(porUsuarioBody){
    if(todosUsuarios.length===0){
      porUsuarioBody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>Todavía no hay alumnos ni profesores registrados.</p></div></td></tr>`;
    } else {
      porUsuarioBody.innerHTML = todosUsuarios.map(u=>`
        <tr>
          <td>${escapeHtml(u.nombre)}</td>
          <td>${escapeHtml(rolLabel[u.rol] || u.rol)}</td>
          <td class="mono">${escapeHtml(u.legajo)}</td>
          <td>${escapeHtml(u.tardanzas ?? 0)}</td>
          <td>${(u.candidato_a_sancion ?? (u.tardanzas >= 3)) ? 'Sí' : 'No'}</td>
        </tr>`).join('');
    }
  }

  const conDemoras = todosUsuarios
    .filter(u=>u.rol!=='admin' && (u.tardanzas||0) > 0)
    .sort((a,b)=>(b.tardanzas||0)-(a.tardanzas||0));

  if(conDemoras.length===0){
    wrap.innerHTML = `<div class="empty-state">
      <div class="glyph">✅</div><h4>Nadie tiene entregas tardías registradas</h4><p>Cuando alguien devuelva un equipo fuera de horario, va a aparecer acá.</p>
    </div>`;
  } else {
    wrap.innerHTML = conDemoras.map(u=>`
      <div class="action-card" style="cursor:default;margin-bottom:.8rem;${u.tardanzas>=3 && !u.baneado ? 'border-color:var(--red-text);' : ''}">
        <div class="action-icon" style="${u.tardanzas>=3 ? 'background:var(--red-bg);color:var(--red-text);' : 'background:var(--orange-bg);color:var(--orange-text);'}">${u.baneado ? '🚫' : '⏰'}</div>
        <div class="action-info">
          <h4>${escapeHtml(u.nombre)} <span class="hint">(${escapeHtml(rolLabel[u.rol] || u.rol)} · ${escapeHtml(u.legajo)})</span></h4>
          <p>${escapeHtml(u.tardanzas)} entrega${u.tardanzas===1?'':'s'} tardía${u.tardanzas===1?'':'s'} registrada${u.tardanzas===1?'':'s'}${u.tardanzas>=3 ? ' · candidato a sanción' : ''}</p>
        </div>
        ${u.baneado
          ? `<button class="btn btn-sm btn-success-outline" onclick="cambiarBaneo(${escapeHtml(JSON.stringify(u.legajo))}, false)">Quitar baneo</button>`
          : `<button class="btn btn-sm btn-danger-outline" onclick="cambiarBaneo(${escapeHtml(JSON.stringify(u.legajo))}, true)">Banear</button>`}
      </div>`).join('');
  }

  const pendientesAviso = conDemoras.filter(u=>u.tardanzas>=3 && !u.baneado).length;
  if(pendientesAviso>0){ badge.style.display='inline-flex'; badge.textContent = pendientesAviso; }
  else{ badge.style.display='none'; }

  if(historialTardanzas.length===0){
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><p>${authToken ? 'El endpoint de demoras entrega un resumen por usuario, no el detalle de cada devolución.' : 'Todavía no hay entregas tardías registradas.'}</p></div></td></tr>`;
  } else {
    tbody.innerHTML = historialTardanzas.map(h=>`
      <tr>
        <td>${escapeHtml(h.nombre)}</td>
        <td>${escapeHtml(rolLabel[h.rol] || h.rol)}</td>
        <td class="mono">${escapeHtml(h.notebookId)}</td>
        <td>${escapeHtml(h.fecha)}</td>
      </tr>`).join('');
  }
}

function permabanear(legajo){
  cambiarBaneo(legajo, true);
}

async function cambiarBaneo(legajo, baneado){
  const u = usuariosRegistrados.find(x=>x.legajo===legajo) || estadoUsuarios.find(x=>x.legajo===legajo);
  if(!u) return;
  if(authToken){
    try{
      await apiRequest('/api/admin/users/'+encodeURIComponent(legajo), {method:'PATCH', body:JSON.stringify({baneado})});
      await cargarEstadoAPI();
      renderTardanzas();
      showToast(baneado ? `${u.nombre} fue baneado permanentemente.` : `Baneo de ${u.nombre} quitado.`, baneado ? 'error' : 'success');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }
  u.baneado = baneado;
  renderTardanzas();
  showToast(baneado ? `${u.nombre} fue baneado permanentemente.` : `Baneo de ${u.nombre} quitado.`, baneado ? 'error' : 'success');
}

/* ======================================================================
   PERFIL (vista + edición)
====================================================================== */
function renderPerfil(){
  if(!currentUser) return;
  document.getElementById('profileAvatarLg').textContent = getInitials(currentUser.nombre);
  document.getElementById('profileNombre').textContent = currentUser.nombre;
  document.getElementById('profileRolCurso').textContent = rolLabel[currentUser.rol];
  document.getElementById('profileLegajo').textContent = currentUser.legajo;
  document.getElementById('profileEmail').textContent = currentUser.email;
  const preferencias = currentUser.preferencias || {email:true, recordatorio:'30'};
  document.getElementById('preferenciasEmail').checked = preferencias.email;
  document.getElementById('preferenciasRecordatorio').value = preferencias.recordatorio;
}

async function actualizarPreferencias(){
  if(!currentUser) return;
  const preferencias = {
    email: document.getElementById('preferenciasEmail').checked,
    recordatorio: document.getElementById('preferenciasRecordatorio').value
  };
  if(authToken){
    try{
      const result = await apiRequest('/api/preferences', {method:'PATCH', body:JSON.stringify(preferencias)});
      currentUser.preferencias = {
        email: Boolean(result.preferences.email),
        recordatorio: String(result.preferences.recordatorio)
      };
    }catch(error){
      renderPerfil();
      showToast(error.message, 'warn');
      return;
    }
  } else {
    currentUser.preferencias = preferencias;
  }
  showToast('Preferencias actualizadas.', 'success');
}

/* ======================================================================
   TEMA OSCURO / CLARO
====================================================================== */
const SUN_ICON = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
const MOON_ICON = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  try{ localStorage.setItem('netmo_theme', theme); }catch(err){ /* modo privado: seguimos sin persistir */ }
  document.querySelectorAll('.theme-toggle-btn').forEach(btn=>{
    btn.innerHTML = theme==='dark' ? SUN_ICON : MOON_ICON;
    btn.title = theme==='dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  });
}

function toggleTheme(){
  const actual = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(actual==='dark' ? 'light' : 'dark');
}

/* ======================================================================
   INIT
====================================================================== */
const today = businessDateParts(new Date());
document.getElementById('resFecha').min = `${today.year}-${today.month}-${today.day}`;
document.getElementById('resFecha').max = `${today.year}-12-31`;

(function initTheme(){
  let saved = null;
  try{ saved = localStorage.getItem('netmo_theme'); }catch(err){ /* ignorar */ }
  if(!saved){ saved = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  applyTheme(saved);
})();
=======
/* ======================================================================
   ESTADO EN MEMORIA
====================================================================== */
let estadoUsuarios = [
  {legajo:'2024-0417', nombre:'Teo Prado', email:'tprado@ottokrause.edu.ar', rol:'alumno', password:'1234', tardanzas:2, baneado:false, retiradas:14, aTiempoPct:92},
  {legajo:'2024-0528', nombre:'Lucía Fernández', email:'lfernandez@ottokrause.edu.ar', rol:'alumno', password:'1234', tardanzas:0, baneado:false, retiradas:6, aTiempoPct:100},
  {legajo:'2024-0639', nombre:'Mateo Rodríguez', email:'mrodriguez@ottokrause.edu.ar', rol:'alumno', password:'5678', tardanzas:1, baneado:false, retiradas:9, aTiempoPct:97},
  {legajo:'PRF-010', nombre:'Prof. Ana Gómez', email:'agomez@ottokrause.edu.ar', rol:'profesor', password:'1234', tardanzas:0, baneado:false, retiradas:31, aTiempoPct:100},
  {legajo:'PRF-011', nombre:'Prof. Diego Suárez', email:'dsuarez@ottokrause.edu.ar', rol:'profesor', password:'2468', tardanzas:0, baneado:false, retiradas:18, aTiempoPct:100},
  {legajo:'ADM-001', nombre:'Admin NetMO', email:'admin@ottokrause.edu.ar', rol:'admin', password:'admin123', tardanzas:0, baneado:false},
];
let profesoresRegistrados = estadoUsuarios.filter(user=>user.rol==='profesor');

let currentUser = null;   // usuario realmente logueado
let rolActivo = null;     // rol del usuario autenticado
let authToken = null;
const API_BASE = window.NETMO_CONFIG.apiBaseUrl === null ? null : window.NETMO_CONFIG.apiBaseUrl.replace(/\/+$/, '');
document.getElementById('demoHint').style.display = API_BASE === null ? '' : 'none';

let notebooks = [
  {id:'NB-001', estado:'disponible', ubicacion:'Carro 1', act:'Hace 2 min', prestadoA:null},
  {id:'NB-002', estado:'disponible', ubicacion:'Carro 1', act:'Hace 2 min', prestadoA:null},
  {id:'NB-003', estado:'prestada',   ubicacion:'—',       act:'Hace 15 min', prestadoA:'PRF-010 · Prof. Ana Gómez'},
  {id:'NB-004', estado:'mantenimiento', ubicacion:'Taller', act:'Hace 1 día', prestadoA:null},
  {id:'NB-005', estado:'disponible', ubicacion:'Carro 2', act:'Hace 3 min', prestadoA:null},
  {id:'NB-014', estado:'prestada',   ubicacion:'—',       act:'Hace 6 hs', prestadoA:'2024-0417 · Teo Prado'},
];

let stats = {disponibles:0, prestadas:0, mantenimiento:0, total:0};

// Préstamos activos por legajo de alumno. "vencimiento" es la hora límite real de devolución:
// para la demo la dejamos 2 horas en el pasado para poder mostrar el flujo de entrega tardía.
let prestamosActivos = {
  '2024-0417': {id:'NB-014', desde:'Hoy, 08:40', vence:'Hoy, 18:00', vencimiento:new Date(Date.now() - 2*60*60*1000), pendiente:false}
};
let historialPrestamos = [];

// Notificaciones de devolución pendientes de confirmación del Admin
let notificacionesDevolucion = [];
let notifSeq = 1;

// Historial de entregas tardías (para que el Admin pueda ver reincidencias y sancionar)
let historialTardanzas = [
  {legajo:'2024-0417', nombre:'Teo Prado', rol:'alumno', notebookId:'NB-033', fecha:'15 jun'},
  {legajo:'2024-0417', nombre:'Teo Prado', rol:'alumno', notebookId:'NB-021', fecha:'02 jul'},
];

// Reservas: individuales (alumno/profesor) y de lote (profesor -> requiere aprobación admin)
let reservas = [
  {id:'RES-01', ownerLegajo:'2024-0417', ownerNombre:'Teo Prado', tipo:'individual', carro:'Carro 2', cantidad:'1 notebook', fecha:'2026-07-16', hora:'09:00', motivo:'Física — laboratorio', estado:'confirmada'}
];
let reservaSeq = 2;

let tickets = [
  {id:'TCK-014', notebook:'NB-004', motivo:'La pantalla se apaga sola', motivoCompleto:'La pantalla se apaga sola después de unos minutos de uso.', estado:'progreso', fecha:'07 jul', ownerLegajo:'2024-0417', ownerNombre:'Teo Prado', ownerRol:'alumno'}
];
let ticketSeq = 15;

const badgeClass = {disponible:'badge-disponible', prestada:'badge-prestada', reservada:'badge-pendiente_devolucion', mantenimiento:'badge-mantenimiento', pendiente_devolucion:'badge-pendiente_devolucion'};
const badgeLabel = {disponible:'Disponible', prestada:'Prestada', reservada:'Reservada', mantenimiento:'En mantenimiento', pendiente_devolucion:'Pend. devolución'};
const estadosNotebookManuales = ['disponible','prestada','mantenimiento','pendiente_devolucion'];
const ticketBadgeClass = {abierto:'badge-abierto', progreso:'badge-progreso', resuelto:'badge-resuelto'};
const ticketBadgeLabel = {abierto:'Abierto', progreso:'En progreso', resuelto:'Resuelto'};
const rolLabel = {alumno:'Alumno', profesor:'Profesor', admin:'Administrador'};

const pageMeta = {
  inicio:   ['¡Hola{NOMBRE}!', 'Aquí podés consultar la disponibilidad de notebooks y realizar reservas.'],
  prestamos:['Mis préstamos', 'Revisá el equipo que tenés retirado y tu historial.'],
  reservas: ['Reservas', 'Programá el retiro de una notebook o un lote para tu curso.'],
  falla:    ['Reportar falla', 'Contanos qué problema encontraste con un equipo.'],
  tickets:  ['Mis tickets', 'Seguimiento de todos los reportes que enviaste.'],
  perfil:   ['Mi perfil', 'Tus datos institucionales y preferencias de la cuenta.'],
  'admin-profesores':   ['Profesores', 'Consultá las cuentas de profesor registradas.'],
  'admin-inventario':   ['Inventario completo', 'Estado de todas las notebooks del sistema.'],
  'admin-devoluciones': ['Devoluciones pendientes', 'Confirmá la recepción física de los equipos.'],
  'admin-lotes':        ['Lotes de profesores', 'Aprobá o rechazá solicitudes de carros completos.'],
  'admin-tickets':      ['Fallas reportadas', 'Tickets enviados por alumnos y profesores. Actualizá el estado del equipo según corresponda.'],
  'admin-tardanzas':    ['Devoluciones tardías', 'Historial de demoras y sanciones a alumnos y profesores.'],
};

/* ======================================================================
   AUTH: LOGIN / REGISTRO / LOGOUT
====================================================================== */
function switchAuthView(name){
  document.querySelectorAll('.auth-view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  document.getElementById('loginError').textContent = '';
  document.getElementById('registroError').textContent = '';
}

async function apiRequest(path, options={}){
  if(API_BASE === null) throw new Error('La API no está habilitada en el modo demo');
  const headers = {'Content-Type':'application/json', ...(options.headers||{})};
  if(authToken) headers.Authorization = 'Bearer '+authToken;
  const response = await fetch(API_BASE+path, {...options, headers});
  const payload = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(payload.error || 'No se pudo completar la operación');
  return payload;
}

async function cargarEstadoAPI(){
  const esAdmin = currentUser.rol==='admin';
  const [notebooksData, reservationsData, loansData, ticketsData, preferencesData] = await Promise.all([
    apiRequest('/api/notebooks'), apiRequest(esAdmin ? '/api/admin/reservations' : '/api/reservations'), apiRequest('/api/loans'), apiRequest(esAdmin ? '/api/admin/tickets' : '/api/tickets'), apiRequest('/api/preferences')
  ]);
  currentUser.preferencias = {
    email: Boolean(preferencesData.preferences?.email),
    recordatorio: String(preferencesData.preferences?.recordatorio ?? 30)
  };
  notebooks = notebooksData.notebooks.map(notebook=>({
    id:notebook.id, estado:notebook.estado, ubicacion:notebook.ubicacion,
    act:notebook.actualizada ? new Date(notebook.actualizada).toLocaleString() : 'Recién',
    prestadoA:notebook.prestado_a || null
  }));
  reservas = reservationsData.reservations.map(reserva=>{
    const retiro = new Date(reserva.retiro_at);
    return {
      id:reserva.id || reserva.codigo, ownerLegajo:reserva.legajo || currentUser.legajo, ownerNombre:reserva.nombre || currentUser.nombre,
      tipo:reserva.tipo, curso:reserva.curso, cantidad:`${reserva.cantidad} ${reserva.cantidad===1?'notebook':'notebooks'}`,
      fecha:retiro.toISOString().slice(0,10), hora:retiro.toTimeString().slice(0,5), motivo:reserva.motivo,
      estado:reserva.estado, notebookIds:reserva.notebook_ids || []
    };
  });
  tickets = ticketsData.tickets.map(ticket=>({
    id:ticket.id, notebook:ticket.notebook || 'otro', motivo:ticket.motivo, motivoCompleto:ticket.descripcion,
    estado:ticket.estado, fecha:new Date(ticket.created_at).toLocaleDateString(), ownerLegajo:currentUser.legajo,
    ownerNombre:ticket.owner_nombre || currentUser.nombre, ownerRol:ticket.owner_rol || currentUser.rol
  }));
  if(esAdmin){
    const [returnsData, lateReturnsData, professorsData] = await Promise.all([
      apiRequest('/api/admin/returns'),
      apiRequest('/api/admin/late-returns'),
      apiRequest('/api/admin/professors')
    ]);
    profesoresRegistrados = professorsData.professors;
    notificacionesDevolucion = returnsData.returns.map(item=>({
      id:item.id, notebookId:item.notebook, alumnoLegajo:item.legajo, alumnoNombre:item.nombre,
      curso:item.curso, fechaSolicitud:new Date(item.solicitado_at).toLocaleString(), rol:'alumno', returnId:item.id
    }));
    lateReturnsData.users.forEach(apiUser=>{
      const localUser = estadoUsuarios.find(user=>user.legajo===apiUser.legajo);
      if(localUser){
        localUser.tardanzas = apiUser.tardanzas;
        localUser.baneado = apiUser.baneado;
      }
    });
  }
  prestamosActivos = {};
  historialPrestamos = loansData.loans;
  loansData.loans.filter(loan=>loan.estado !== 'devuelto').forEach(loan=>{
    if(!prestamosActivos[currentUser.legajo]) prestamosActivos[currentUser.legajo] = {id:loan.notebook, curso:loan.curso, desde:new Date(loan.retirada_at).toLocaleString(), vence:new Date(loan.vence_at).toLocaleString(), pendiente:loan.estado!=='activo', loanId:loan.id};
  });
}

async function login(e){
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPassword').value;

  if(!API_BASE){
    const demoUser = estadoUsuarios.find(u=>u.email.toLowerCase()===email.toLowerCase());
    if(!demoUser || demoUser.password!==pass){
      document.getElementById('loginError').textContent = 'Correo o contraseña incorrectos';
      return;
    }
    if(demoUser.baneado){
      document.getElementById('loginError').textContent = 'Usuario bloqueado por administración';
      return;
    }
    currentUser = {...demoUser};
    rolActivo = currentUser.rol;
    document.getElementById('loginForm').reset();
    document.getElementById('loginError').textContent = '';
    iniciarSesion();
    return;
  }

  try{
    const result = await apiRequest('/api/auth/login', {method:'POST', body:JSON.stringify({email, password:pass})});
    authToken = result.token;
    currentUser = {...result.user, password:pass};
    rolActivo = currentUser.rol;
    await cargarEstadoAPI();
    document.getElementById('loginForm').reset();
    document.getElementById('loginError').textContent = '';
    iniciarSesion();
    return;
  }catch(error){
    document.getElementById('loginError').textContent = error.message;
    return;
  }
}

async function registrar(e){
  e.preventDefault();
  const nombre = document.getElementById('regNombre').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;

  if(API_BASE){
    try{
      await apiRequest('/api/auth/register', {method:'POST', body:JSON.stringify({nombre, email, password})});
      document.getElementById('registroForm').reset();
      document.getElementById('registroError').textContent = '';
      switchAuthView('login');
      showToast('Registro exitoso. Ahora podés iniciar sesión.', 'success');
      document.getElementById('loginEmail').value = email;
    }catch(error){
      document.getElementById('registroError').textContent = error.message;
    }
    return;
  }

  if(estadoUsuarios.some(u=>u.email.toLowerCase()===email.toLowerCase())){
    document.getElementById('registroError').textContent = 'Ya existe una cuenta registrada con ese correo.';
    return;
  }

  const legajo = 'U-' + Date.now().toString().slice(-8);
  estadoUsuarios.push({legajo, nombre, email, rol:'profesor', password, tardanzas:0, baneado:false, retiradas:0, aTiempoPct:null});
  document.getElementById('registroForm').reset();
  document.getElementById('registroError').textContent = '';
  switchAuthView('login');
  showToast('Registro exitoso. Ahora podés iniciar sesión.', 'success');
  document.getElementById('loginEmail').value = email;
}

function renderProfesoresTable(){
  const tbody = document.getElementById('profesoresTable');
  if(!tbody) return;
  const query = (document.getElementById('profesoresSearchInput')?.value || '').trim().toLowerCase();
  const profesores = profesoresRegistrados.filter(profesor=>
    [profesor.nombre, profesor.email, profesor.legajo].some(value=>String(value || '').toLowerCase().includes(query))
  );
  if(profesores.length===0){
    tbody.innerHTML = `<tr><td colspan="3"><div class="empty-state">
      <div class="glyph">🧑‍🏫</div><h4>No hay profesores que coincidan</h4><p>Probá con otro nombre, correo o legajo.</p>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = profesores.map(p=>`
    <tr>
      <td>${p.nombre}</td>
      <td>${p.email}</td>
      <td class="mono">${p.legajo}</td>
    </tr>`).join('');
}

function filterProfesores(){
  renderProfesoresTable();
}

function iniciarSesion(){
  document.getElementById('auth-shell').classList.add('hidden');
  document.getElementById('app-root').classList.add('active');
  const testBanner = document.getElementById('testModeBanner');
  testBanner.style.display = API_BASE ? 'none' : 'inline-flex';
  document.getElementById('demoHint').style.display = API_BASE ? 'none' : '';
  document.getElementById('testModeRole').textContent = `sesión de ${rolLabel[rolActivo]}`;
  renderAll();
  applyRoleVisibility();
  switchView('inicio');
}

function logout(){
  authToken = null;
  currentUser = null;
  rolActivo = null;
  document.getElementById('testModeBanner').style.display = 'none';
  document.getElementById('app-root').classList.remove('active');
  document.getElementById('auth-shell').classList.remove('hidden');
  switchAuthView('login');
  showToast('Sesión cerrada correctamente.', 'warn');
}

function applyRoleVisibility(){
  document.querySelectorAll('li[data-roles]').forEach(li=>{
    const roles = li.dataset.roles.split(',');
    li.classList.toggle('role-visible', roles.includes(rolActivo));
  });
  document.querySelectorAll('.action-card[data-roles]').forEach(btn=>{
    const roles = btn.dataset.roles.split(',');
    btn.style.display = roles.includes(rolActivo) ? '' : 'none';
  });
  document.querySelectorAll('[data-roles-el]').forEach(el=>{
    const roles = el.dataset.rolesEl.split(',');
    el.style.display = roles.includes(rolActivo) ? '' : 'none';
  });
  toggleInicioParaRol();
  const pill = document.getElementById('sidebarRolePill');
  pill.textContent = rolLabel[rolActivo];
  pill.className = 'role-pill role-' + rolActivo;
}

function toggleProfesorUI(){
  const isProf = rolActivo === 'profesor';
  document.getElementById('loteToggleWrap').style.display = isProf ? 'flex' : 'none';
  document.getElementById('resCursoProfesor').required = isProf;
  if(!isProf){
    document.getElementById('loteToggle').checked = false;
    toggleLoteBlock();
  }
  actualizarControlesReserva();
}

function toggleLoteBlock(){
  const checked = document.getElementById('loteToggle').checked;
  document.getElementById('loteBlock').classList.toggle('show', checked);
  document.getElementById('resCantidadWrap').style.display = checked ? 'none' : 'flex';
  document.getElementById('loteCurso').required = checked && rolActivo==='profesor';
  document.getElementById('resSubmitBtn').textContent = checked ? 'Enviar solicitud de lote' : 'Confirmar reserva';
  actualizarControlesReserva();
}

function tieneEquiposPendientes(legajo){
  if(prestamosActivos[legajo]) return true;
  if(notificacionesDevolucion.some(notificacion=>notificacion.alumnoLegajo===legajo)) return true;
  return reservas.some(reserva=>reserva.ownerLegajo===legajo &&
    !['rechazada','cancelada'].includes(reserva.estado) &&
    reserva.notebookIds?.length > 0);
}

function actualizarControlesReserva(){
  const cantidadInput = document.getElementById('resCantidad');
  const loteCantidadInput = document.getElementById('loteCantidad');
  const submitButton = document.getElementById('resSubmitBtn');
  if(!cantidadInput || !loteCantidadInput || !submitButton || !currentUser) return;

  const esProfesor = rolActivo==='profesor';
  const equiposDisponibles = notebooks.filter(nb=>nb.estado==='disponible').length;
  const bloqueado = tieneEquiposPendientes(currentUser.legajo);
  const maxIndividual = esProfesor ? Math.max(1, equiposDisponibles) : 1;
  cantidadInput.max = String(maxIndividual);
  cantidadInput.value = esProfesor ? Math.min(Math.max(Number(cantidadInput.value)||1, 1), maxIndividual) : 1;
  loteCantidadInput.max = String(Math.min(40, equiposDisponibles));
  loteCantidadInput.value = Math.min(Math.max(Number(loteCantidadInput.value)||3, 3), Math.max(3, Math.min(40, equiposDisponibles)));

  cantidadInput.disabled = !esProfesor;
  document.getElementById('loteToggle').disabled = bloqueado || equiposDisponibles < 3;
  loteCantidadInput.disabled = equiposDisponibles < 3;
  document.getElementById('resCursoProfesor').disabled = false;
  submitButton.disabled = bloqueado || (document.getElementById('loteToggle').checked ? equiposDisponibles < 3 : equiposDisponibles < 1);
}

/* ======================================================================
   NAVEGACIÓN
====================================================================== */
function switchView(name){
  const target = document.getElementById('view-'+name);
  if(!target) return;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  target.classList.add('active');
  document.querySelectorAll('.nav-item[data-view]').forEach(b=>b.classList.toggle('active', b.dataset.view===name));

  const [titleTpl, sub] = pageMeta[name];
  const firstName = currentUser ? currentUser.nombre.split(' ')[0] : '';
  document.getElementById('pageTitle').textContent = titleTpl.replace('{NOMBRE}', firstName ? ', '+firstName : '');
  document.getElementById('pageSubtitle').textContent = sub;
  window.scrollTo({top:0, behavior:'smooth'});

  if(name==='inicio' && rolActivo!=='admin') renderMiActividad();
  if(name==='prestamos'){ renderPrestamoActivo(); renderHistorialPrestamos(); }
  if(name==='reservas'){ renderReservas(); toggleProfesorUI(); }
  if(name==='tickets') renderTicketsPropios();
  if(name==='perfil') renderPerfil();
  if(name==='admin-profesores') renderProfesoresTable();
  if(name==='admin-inventario') renderAdminInventario();
  if(name==='admin-devoluciones') renderDevoluciones();
  if(name==='admin-lotes') renderLotes();
  if(name==='admin-tickets') renderAdminTickets();
  if(name==='admin-tardanzas') renderTardanzas();
}

function renderAll(){
  renderHeaderUser();
  renderNotebooks();
  renderPrestamoActivo();
  renderHistorialPrestamos();
  renderReservas();
  renderTicketsPropios();
  renderPerfil();
  renderProfesoresTable();
  renderAdminInventario();
  renderDevoluciones();
  renderLotes();
  renderAdminTickets();
  renderTardanzas();
}

function renderHeaderUser(){
  if(!currentUser) return;
  document.getElementById('headerAvatar').textContent = getInitials(currentUser.nombre);
  document.getElementById('headerNombre').textContent = currentUser.nombre;
  document.getElementById('headerRolCurso').textContent = rolLabel[rolActivo];
}

function getInitials(nombre){
  const parts = nombre.trim().split(/\s+/);
  const first = parts[0]?.[0] || '';
  const last = parts.length>1 ? parts[parts.length-1][0] : '';
  return (first+last).toUpperCase();
}

/* ======================================================================
   TOAST
====================================================================== */
function showToast(msg, type){
  const wrap = document.getElementById('toast-wrap');
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' '+type : '');
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(()=>t.remove(),300); }, 3200);
}

/* ======================================================================
   MODALES
====================================================================== */
function openModal(id){ document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(m=>{
  m.addEventListener('click', e=>{ if(e.target===m) m.classList.remove('open'); });
});

/* ======================================================================
   NOTEBOOKS (Inicio + Admin Inventario)
====================================================================== */
function renderNotebooks(){
  const tbody = document.getElementById('notebookTable');
  tbody.innerHTML = '';
  actualizarStats();
  notebooks.forEach(nb=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="mono">${nb.id}</td>
      <td><span class="badge ${badgeClass[nb.estado]}">${badgeLabel[nb.estado]}</span></td>
      <td>${nb.ubicacion}</td>
      <td>${nb.act}</td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('statDisponibles').textContent = stats.disponibles;
  document.getElementById('statPrestadas').textContent = stats.prestadas;
  document.getElementById('statMantenimiento').textContent = stats.mantenimiento;
  document.getElementById('statTotal').textContent = stats.total;
  document.getElementById('statDisponiblesUsuario').textContent = stats.disponibles;
}

function actualizarStats(){
  stats.total = notebooks.length;
  stats.disponibles = notebooks.filter(nb=>nb.estado==='disponible').length;
  stats.prestadas = notebooks.filter(nb=>nb.estado==='prestada' || nb.estado==='pendiente_devolucion').length;
  stats.mantenimiento = notebooks.filter(nb=>nb.estado==='mantenimiento').length;
}

/* ---- Home simplificado para alumno/profesor vs. panel completo del admin ---- */
function toggleInicioParaRol(){
  const esAdmin = rolActivo === 'admin';
  const statsAdmin = document.getElementById('statsGridAdmin');
  const statsUsuario = document.getElementById('statsGridUsuario');
  const cardAdmin = document.getElementById('cardEstadoNotebooks');
  const cardUsuario = document.getElementById('cardMiActividad');
  if(!statsAdmin || !statsUsuario || !cardAdmin || !cardUsuario) return;
  statsAdmin.style.display = esAdmin ? 'grid' : 'none';
  statsUsuario.style.display = esAdmin ? 'none' : 'grid';
  cardAdmin.style.display = esAdmin ? 'block' : 'none';
  cardUsuario.style.display = esAdmin ? 'none' : 'block';
  if(!esAdmin) renderMiActividad();
}

function renderMiActividad(){
  const wrap = document.getElementById('miActividadWrap');
  if(!wrap || !currentUser) return;

  const proximaReserva = reservas
    .filter(r=>r.ownerLegajo===currentUser.legajo && r.estado!=='rechazada')
    .sort((a,b)=>a.fecha.localeCompare(b.fecha))[0];
  const ticketsAbiertos = tickets.filter(t=>t.ownerLegajo===currentUser.legajo && t.estado!=='resuelto').length;
  const prestamo = prestamosActivos[currentUser.legajo];

  let html = '';

  if(prestamo && !prestamo.pendiente){
    html += `
      <div class="action-card" style="cursor:default;margin-bottom:.8rem;">
        <div class="action-icon" style="background:var(--blue-bg);color:var(--blue-text);">💻</div>
        <div class="action-info"><h4>Tenés ${prestamo.id} en tu poder</h4><p>Vence ${prestamo.vence}</p></div>
      </div>`;
  } else if(prestamo && prestamo.pendiente){
    html += `
      <div class="action-card" style="cursor:default;margin-bottom:.8rem;">
        <div class="action-icon" style="background:var(--green-bg);color:var(--green-text);">✅</div>
        <div class="action-info"><h4>Devolución de ${prestamo.id} informada</h4><p>Esperando confirmación de recepción del Administrador.</p></div>
      </div>`;
  }

  if(proximaReserva){
    const detalle = proximaReserva.tipo==='lote' ? (proximaReserva.curso+' · '+proximaReserva.cantidad+' equipos') : (proximaReserva.carro+' · '+proximaReserva.cantidad);
    html += `
      <div class="action-card" style="cursor:default;margin-bottom:.8rem;">
        <div class="action-icon">📅</div>
        <div class="action-info"><h4>${detalle}</h4><p>${formatFecha(proximaReserva.fecha)} · ${proximaReserva.hora}</p></div>
      </div>`;
  } else if(!prestamo){
    html += `<div class="empty-state">
      <div class="glyph">🗓️</div>
      <h4>No tenés reservas próximas</h4>
      <p>Reservá una notebook desde acciones rápidas.</p>
    </div>`;
  }

  if(ticketsAbiertos>0){
    html += `
      <div class="action-card" style="cursor:pointer;" onclick="switchView('tickets')">
        <div class="action-icon" style="background:var(--orange-bg);color:var(--orange-text);">⚠️</div>
        <div class="action-info"><h4>${ticketsAbiertos} ticket${ticketsAbiertos===1?'':'s'} abierto${ticketsAbiertos===1?'':'s'}</h4><p>Ver seguimiento</p></div>
        <span class="action-arrow">›</span>
      </div>`;
  }

  wrap.innerHTML = html;
}

function filterNotebooks(){
  const q = document.getElementById('searchInput').value.toLowerCase();
  const est = document.getElementById('filterEstado').value;
  document.querySelectorAll('#notebookTable tr').forEach((tr,i)=>{
    const nb = notebooks[i];
    const matchesText = tr.innerText.toLowerCase().includes(q);
    const matchesEstado = !est || nb.estado===est;
    tr.style.display = (matchesText && matchesEstado) ? '' : 'none';
  });
}

function renderAdminInventario(){
  const tbody = document.getElementById('adminInventoryTable');
  if(!tbody) return;
  tbody.innerHTML = notebooks.map(nb=>`
    <tr>
      <td class="mono">${nb.id}</td>
      <td><span class="badge ${badgeClass[nb.estado]}">${badgeLabel[nb.estado]}</span></td>
      <td>${nb.ubicacion}</td>
      <td>${nb.prestadoA || '—'}</td>
      <td>${nb.act}</td>
      <td>
        <select class="btn btn-sm" aria-label="Cambiar estado de ${nb.id}" onchange="adminCambiarEstadoNotebook('${nb.id}', this.value)">
          <option value="disponible" ${nb.estado==='disponible'?'selected':''}>Disponible</option>
          <option value="prestada" ${nb.estado==='prestada'?'selected':''}>Prestada</option>
          <option value="mantenimiento" ${nb.estado==='mantenimiento'?'selected':''}>Mantenimiento</option>
          <option value="pendiente_devolucion" ${nb.estado==='pendiente_devolucion'?'selected':''}>Pend. devolución</option>
        </select>
      </td>
    </tr>`).join('');
}

// El estado de las notebooks se mueve solo con el uso del sistema (reservas, préstamos, devoluciones
// confirmadas y reportes de falla). La única decisión manual del Admin es habilitar un equipo que
// estaba en mantenimiento y ya se terminó de reparar.
function moverAMantenimiento(nb){
  if(nb.estado==='mantenimiento') return;
  if(nb.estado==='disponible') stats.disponibles = Math.max(0, stats.disponibles-1);
  if(nb.estado==='prestada' || nb.estado==='pendiente_devolucion') stats.prestadas = Math.max(0, stats.prestadas-1);
  stats.mantenimiento += 1;
  nb.estado = 'mantenimiento';
  nb.ubicacion = 'Taller';
  nb.act = 'Recién';
  nb.prestadoA = null;
}

async function habilitarNotebook(id){
  const nb = notebooks.find(n=>n.id===id);
  if(!nb || nb.estado!=='mantenimiento') return;
  if(authToken){
    try{
      await apiRequest('/api/notebooks/'+encodeURIComponent(id), {method:'PATCH', body:JSON.stringify({estado:'disponible'})});
      await cargarEstadoAPI();
      renderAll();
      showToast(`${id} habilitada. Ya figura como disponible.`, 'success');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }
  stats.mantenimiento = Math.max(0, stats.mantenimiento-1);
  stats.disponibles += 1;
  nb.estado = 'disponible';
  nb.ubicacion = 'Carro 1';
  nb.act = 'Recién';
  nb.marcarMantenimientoAlDevolver = false;
  tickets.filter(t=>t.notebook===id && t.estado!=='resuelto').forEach(t=>t.estado='resuelto');

  renderNotebooks();
  renderAdminInventario();
  renderAdminTickets();
  showToast(`${id} habilitada. Ya figura como disponible.`, 'success');
}

async function adminCambiarEstadoNotebook(id, nuevoEstado){
  const nb = notebooks.find(n=>n.id===id);
  if(!nb || !estadosNotebookManuales.includes(nuevoEstado) || nb.estado===nuevoEstado) return;
  if(authToken){
    try{
      await apiRequest('/api/notebooks/'+encodeURIComponent(id), {method:'PATCH', body:JSON.stringify({estado:nuevoEstado})});
      await cargarEstadoAPI();
      renderAll();
      showToast(`${id} actualizada a ${badgeLabel[nuevoEstado].toLowerCase()}.`, 'success');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }

  if(nb.estado==='disponible') stats.disponibles = Math.max(0, stats.disponibles-1);
  if(nb.estado==='prestada' || nb.estado==='pendiente_devolucion') stats.prestadas = Math.max(0, stats.prestadas-1);
  if(nb.estado==='mantenimiento') stats.mantenimiento = Math.max(0, stats.mantenimiento-1);
  if(nuevoEstado==='disponible') stats.disponibles += 1;
  if(nuevoEstado==='prestada') stats.prestadas += 1;
  if(nuevoEstado==='mantenimiento') stats.mantenimiento += 1;

  nb.estado = nuevoEstado;
  nb.act = 'Recién';
  if(nuevoEstado==='disponible'){
    nb.ubicacion = 'Carro 1';
    nb.prestadoA = null;
  } else if(nuevoEstado==='mantenimiento'){
    nb.ubicacion = 'Taller';
    nb.prestadoA = null;
  } else if(nuevoEstado==='pendiente_devolucion'){
    nb.ubicacion = '—';
  } else {
    nb.ubicacion = '—';
    nb.prestadoA = nb.prestadoA || 'Administración';
  }
  if(nuevoEstado==='disponible'){
    tickets.filter(t=>t.notebook===id && t.estado!=='resuelto').forEach(t=>t.estado='resuelto');
  }
  renderNotebooks();
  renderAdminInventario();
  renderAdminTickets();
  showToast(`${id} actualizada a ${badgeLabel[nuevoEstado].toLowerCase()}.`, 'success');
}

function agregarNotebook(e){
  e.preventDefault();
  const id = document.getElementById('newNbId').value.trim().toUpperCase();
  const ubicacion = document.getElementById('newNbUbicacion').value;
  if(!id){ showToast('Ingresá un número de notebook.', 'warn'); return; }
  if(notebooks.some(n=>n.id===id)){ showToast('Ya existe una notebook con ese número.', 'warn'); return; }

  // Un equipo nuevo siempre entra como "disponible": no tiene sentido sumarlo ya roto.
  notebooks.push({id, estado:'disponible', ubicacion, act:'Recién', prestadoA:null});
  stats.total += 1;
  stats.disponibles += 1;

  document.getElementById('addNotebookForm').reset();
  closeModal('addNotebookModal');
  renderNotebooks();
  renderAdminInventario();
  showToast(`${id} agregada al stock como disponible.`, 'success');
}

function filterAdminNotebooks(){
  const q = document.getElementById('adminSearchInput').value.toLowerCase();
  const est = document.getElementById('adminFilterEstado').value;
  document.querySelectorAll('#adminInventoryTable tr').forEach((tr,i)=>{
    const nb = notebooks[i];
    const matchesText = tr.innerText.toLowerCase().includes(q);
    const matchesEstado = !est || nb.estado===est;
    tr.style.display = (matchesText && matchesEstado) ? '' : 'none';
  });
}

/* ======================================================================
   MIS PRÉSTAMOS + DEVOLUCIÓN ESTRICTA
====================================================================== */
function renderPrestamoActivo(){
  const wrap = document.getElementById('prestamoActivoWrap');
  if(!currentUser) return;
  const prestamo = prestamosActivos[currentUser.legajo];
  if(!prestamo){
    wrap.innerHTML = `<div class="empty-state">
      <div class="glyph">✅</div>
      <h4>No tenés notebooks en préstamo</h4>
      <p>Cuando reserves y retires un equipo, va a aparecer acá.</p>
    </div>`;
    return;
  }
  if(prestamo.pendiente){
    wrap.innerHTML = `
      <div class="action-card" style="cursor:default;">
        <div class="action-icon" style="background:var(--red-bg);color:var(--red-text);">⏳</div>
        <div class="action-info">
          <h4>${prestamo.id}</h4>
          <p>Retirada ${prestamo.desde} · Devolución informada</p>
        </div>
        <span class="badge badge-pendiente_devolucion">Esperando confirmación del Admin</span>
      </div>
      <p class="hint" style="margin-top:.8rem;">La devolución fue informada y queda pendiente de recepción física por parte del Administrador.</p>`;
    return;
  }
  wrap.innerHTML = `
    <div class="action-card" style="cursor:default;">
      <div class="action-icon" style="background:var(--blue-bg);color:var(--blue-text);">💻</div>
      <div class="action-info">
        <h4>${prestamo.id}</h4>
        <p>Retirada ${prestamo.desde} · Vence ${prestamo.vence}</p>
      </div>
      <button class="btn btn-primary btn-sm" onclick="openReturnModal()">Devolver</button>
    </div>`;
}

function renderHistorialPrestamos(){
  const tbody = document.getElementById('historialPrestamosTable');
  if(!tbody) return;
  if(historialPrestamos.length===0){
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">
      <div class="glyph">📋</div><h4>No tenés historial de préstamos</h4><p>Los préstamos que retires aparecerán acá.</p>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = historialPrestamos.map(loan=>{
    const retirada = new Date(loan.retirada_at).toLocaleString();
    const devuelta = loan.devuelta_at ? new Date(loan.devuelta_at).toLocaleString() : '—';
    const demorada = loan.devuelta_at && new Date(loan.devuelta_at) > new Date(loan.vence_at);
    const label = loan.estado==='devuelto' ? (demorada ? 'Devuelta con demora' : 'Devuelta a tiempo') : (loan.estado==='devolucion_pendiente' ? 'Devolución pendiente' : 'Préstamo activo');
    const badge = loan.estado==='devuelto' ? (demorada ? 'badge-vencido' : 'badge-resuelto') : (loan.estado==='devolucion_pendiente' ? 'badge-pendiente_devolucion' : 'badge-prestada');
    return `<tr><td class="mono">${loan.notebook}</td><td>${retirada}</td><td>${devuelta}</td><td><span class="badge ${badge}">${label}</span></td></tr>`;
  }).join('');
}

function openReturnModal(){
  const prestamo = prestamosActivos[currentUser.legajo];
  document.getElementById('returnModalText').textContent = `¿Confirmás que estás devolviendo físicamente la notebook ${prestamo.id}? Un administrador deberá confirmar la recepción antes de que quede liberada.`;
  openModal('returnModal');
}

async function confirmarDevolucion(){
  if(authToken){
    const prestamoAPI = prestamosActivos[currentUser.legajo];
    if(!prestamoAPI?.loanId) return;
    try{
      await apiRequest(`/api/loans/${prestamoAPI.loanId}/return`, {method:'POST'});
      await cargarEstadoAPI();
      renderAll();
      closeModal('returnModal');
      showToast('Devolución solicitada. Queda pendiente de confirmación del Administrador.', 'warn');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }
  const prestamo = prestamosActivos[currentUser.legajo];
  if(!prestamo) return;
  const nb = notebooks.find(n=>n.id===prestamo.id);
  if(nb){ nb.estado='pendiente_devolucion'; nb.act='Recién'; }
  prestamo.pendiente = true;

  notificacionesDevolucion.push({
    id: 'DEV-'+String(notifSeq++).padStart(3,'0'),
    notebookId: prestamo.id,
    alumnoLegajo: currentUser.legajo,
    alumnoNombre: currentUser.nombre,
    curso: prestamosActivos[currentUser.legajo]?.curso || 'Curso no informado',
    fechaSolicitud: 'Recién',
    solicitadoEn: new Date(),
    vencimiento: prestamo.vencimiento || null,
    rol: currentUser.rol
  });

  renderNotebooks();
  renderAdminInventario();
  renderPrestamoActivo();
  renderDevoluciones();
  closeModal('returnModal');
  showToast('Devolución solicitada. Queda pendiente de confirmación del Administrador.', 'warn');
}

/* ======================================================================
   ADMIN · DEVOLUCIONES PENDIENTES
====================================================================== */
function renderDevoluciones(){
  const wrap = document.getElementById('devolucionesWrap');
  if(!wrap) return;
  const badge = document.getElementById('devBadge');
  if(notificacionesDevolucion.length===0){
    wrap.innerHTML = `<div class="empty-state">
      <div class="glyph">📭</div>
      <h4>No hay devoluciones pendientes</h4>
      <p>Cuando un alumno solicite devolver un equipo, va a aparecer acá.</p>
    </div>`;
    badge.style.display = 'none';
    return;
  }
  badge.style.display = 'inline-flex';
  badge.textContent = notificacionesDevolucion.length;
  wrap.innerHTML = notificacionesDevolucion.map((n,i)=>`
    <div class="action-card" style="cursor:default;margin-bottom:.8rem;">
      <div class="action-icon" style="background:var(--red-bg);color:var(--red-text);">📥</div>
      <div class="action-info">
        <h4>${n.notebookId} · ${n.alumnoNombre}</h4>
        <p>${n.curso} · Legajo ${n.alumnoLegajo} · Solicitado ${n.fechaSolicitud}</p>
      </div>
      <button class="btn btn-primary btn-sm" onclick="confirmarRecepcion(${i})">Confirmar recepción física</button>
    </div>`).join('');
}

async function confirmarRecepcion(idx){
  const n = notificacionesDevolucion[idx];
  if(!n) return;
  if(authToken){
    try{
      await apiRequest(`/api/admin/returns/${n.returnId || n.id}/confirm`, {method:'POST'});
      await cargarEstadoAPI();
      renderAll();
      showToast(`Recepción de ${n.notebookId} confirmada.`, 'success');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }
  const nb = notebooks.find(x=>x.id===n.notebookId);
  delete prestamosActivos[n.alumnoLegajo];
  notificacionesDevolucion.splice(idx,1);

  let aviso = `Recepción de ${n.notebookId} confirmada. Deuda de ${n.alumnoNombre} liberada.`;
  if(nb && nb.marcarMantenimientoAlDevolver){
    stats.prestadas = Math.max(0, stats.prestadas-1);
    stats.mantenimiento += 1;
    nb.estado='mantenimiento'; nb.ubicacion='Taller'; nb.act='Recién'; nb.prestadoA=null; nb.marcarMantenimientoAlDevolver=false;
    aviso += ` Como tenía una falla reportada, quedó automáticamente en mantenimiento.`;
  } else if(nb){
    stats.prestadas = Math.max(0, stats.prestadas-1);
    stats.disponibles += 1;
    nb.estado='disponible'; nb.ubicacion='Carro 1'; nb.act='Recién'; nb.prestadoA=null;
  }

  // Entrega tardía: si el alumno/profesor devolvió el equipo después de la hora límite,
  // queda registrado en su historial. Al llegar a 3 demoras, se avisa al Admin.
  if(n.vencimiento && n.solicitadoEn && new Date(n.solicitadoEn) > new Date(n.vencimiento)){
    const u = estadoUsuarios.find(x=>x.legajo===n.alumnoLegajo);
    if(u){
      u.tardanzas = (u.tardanzas||0) + 1;
      historialTardanzas.unshift({legajo:n.alumnoLegajo, nombre:n.alumnoNombre, rol:n.rol||u.rol, notebookId:n.notebookId, fecha:'Recién'});
      aviso += ` ⏰ Se registró como entrega tardía (van ${u.tardanzas}).`;
      if(u.tardanzas >= 3 && !u.baneado){
        showToast(`🚨 Aviso para el Admin: ${u.nombre} acumula ${u.tardanzas} entregas tardías. Podés evaluar una sanción en "Devoluciones tardías".`, 'error');
      }
    }
    renderTardanzas();
  }

  renderNotebooks();
  renderAdminInventario();
  renderDevoluciones();
  renderAdminTickets();
  actualizarControlesReserva();
  if(currentUser && currentUser.legajo===n.alumnoLegajo) renderPrestamoActivo();
  showToast(aviso, 'success');
}

/* ======================================================================
   RESERVAS (individuales) + LOTES (profesor)
====================================================================== */
function formatFecha(iso){
  if(!iso) return '';
  const [y,m,d] = iso.split('-');
  const meses=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${parseInt(d)} ${meses[parseInt(m)-1]}`;
}

function validarFechaHora(fechaStr, horaStr){
  if(!fechaStr || !horaStr) return {valid:false, msg:'Completá fecha y hora para reservar.'};

  const [y,m,d] = fechaStr.split('-').map(Number);
  const [hh,mm] = horaStr.split(':').map(Number);
  const seleccion = new Date(y, m-1, d, hh, mm);
  const ahora = new Date();
  const hoyInicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const fechaSeleccionadaInicio = new Date(y, m-1, d);

  if(y !== ahora.getFullYear()){
    return {valid:false, msg:`Las reservas solo pueden hacerse durante el año ${ahora.getFullYear()}.`};
  }

  if(fechaSeleccionadaInicio < hoyInicio){
    return {valid:false, msg:'No se pueden reservar fechas pasadas.'};
  }

  const diaSemana = seleccion.getDay(); // 0=domingo, 6=sábado
  if(diaSemana===0 || diaSemana===6){
    return {valid:false, msg:'Sólo se puede reservar de lunes a viernes (días hábiles).'};
  }

  const minutosDelDia = hh*60+mm;
  const dentroDeHorario = (minutosDelDia >= 8*60 && minutosDelDia <= 12*60+10)
    || (minutosDelDia >= 13*60+30 && minutosDelDia <= 17*60+30);
  if(!dentroDeHorario){
    return {valid:false, msg:'Solo se puede reservar de 08:00 a 12:10 y de 13:30 a 17:30.'};
  }

  return {valid:true, msg:''};
}

async function crearReservaAPI(e){
  const fecha = document.getElementById('resFecha').value;
  const hora = document.getElementById('resHora').value;
  const esLote = rolActivo==='profesor' && document.getElementById('loteToggle').checked;
  const cantidad = esLote ? Number(document.getElementById('loteCantidad').value) : (rolActivo==='profesor' ? Number(document.getElementById('resCantidad').value) : 1);
  const curso = rolActivo==='profesor' ? document.getElementById(esLote ? 'loteCurso' : 'resCursoProfesor').value.trim() : null;
  const errorBox = document.getElementById('resFechaError');
  const check = validarFechaHora(fecha, hora);
  if(!check.valid){ errorBox.textContent = check.msg; showToast(check.msg, 'warn'); return; }
  try{
    await apiRequest('/api/reservations', {method:'POST', body:JSON.stringify({
      tipo:esLote ? 'lote' : 'individual', cantidad, curso, retiroAt:`${fecha}T${hora}:00`, motivo:document.getElementById('resMotivo').value || 'Sin especificar'
    })});
    document.getElementById('reservaForm').reset();
    document.getElementById('loteToggle').checked = false;
    toggleLoteBlock();
    await cargarEstadoAPI();
    renderAll();
    showToast(esLote ? 'Solicitud de lote enviada.' : 'Reserva confirmada.', 'success');
  }catch(error){
    errorBox.textContent = error.message;
    showToast(error.message, 'warn');
  }
}

async function crearReserva(e){
  e.preventDefault();
  if(authToken){ await crearReservaAPI(e); return; }
  const errBox = document.getElementById('resFechaError');
  const fecha = document.getElementById('resFecha').value;
  const hora = document.getElementById('resHora').value;
  const equiposDisponibles = notebooks.filter(nb=>nb.estado==='disponible');
  const motivo = document.getElementById('resMotivo').value || 'Sin especificar';
  const esLote = rolActivo==='profesor' && document.getElementById('loteToggle').checked;

  if(tieneEquiposPendientes(currentUser.legajo)){
    const msg = 'No podés pedir más notebooks hasta devolver las que tenés asignadas.';
    errBox.textContent = msg;
    showToast(msg, 'warn');
    actualizarControlesReserva();
    return;
  }

  const check = validarFechaHora(fecha, hora);
  if(!check.valid){
    errBox.textContent = check.msg;
    showToast(check.msg, 'warn');
    return;
  }
  errBox.textContent = '';

  if(esLote){
    const curso = document.getElementById('loteCurso').value.trim();
    const cantidad = parseInt(document.getElementById('loteCantidad').value) || 10;
    if(!curso){
      const msg = 'Escribí el curso del lote.';
      errBox.textContent = msg;
      showToast(msg, 'warn');
      return;
    }
    if(cantidad < 3 || cantidad > equiposDisponibles.length){
      const msg = `El lote debe tener entre 3 y ${equiposDisponibles.length} equipos.`;
      errBox.textContent = msg;
      showToast(msg, 'warn');
      return;
    }
    if(equiposDisponibles.length < cantidad){
      const msg = `No hay suficientes notebooks disponibles para el lote. Disponibles: ${equiposDisponibles.length}.`;
      errBox.textContent = msg;
      showToast(msg, 'warn');
      return;
    }
    const notebookIds = equiposDisponibles.slice(0, cantidad).map(nb=>nb.id);
    notebookIds.forEach(id=>{ const nb=notebooks.find(item=>item.id===id); nb.estado='reservada'; nb.ubicacion='Reservada'; nb.act='Recién'; });
    reservas.unshift({
      id:'RES-'+String(reservaSeq++).padStart(2,'0'),
      ownerLegajo: currentUser.legajo,
      ownerNombre: currentUser.nombre,
      tipo:'lote', curso, cantidad, fecha, hora, motivo, notebookIds,
      estado:'pendiente_aprobacion'
    });
    document.getElementById('reservaForm').reset();
    document.getElementById('loteToggle').checked = false;
    toggleLoteBlock();
    renderReservas();
    renderLotes();
    renderNotebooks();
    renderAdminInventario();
    actualizarControlesReserva();
    showToast('Solicitud de lote enviada. Queda pendiente de aprobación del Administrador.', 'warn');
    return;
  }

  const cantidadNumerica = rolActivo==='profesor' ? Number(document.getElementById('resCantidad').value) : 1;
  const cantidad = `${cantidadNumerica} ${cantidadNumerica===1 ? 'notebook' : 'notebooks'}`;
  const curso = rolActivo==='profesor' ? document.getElementById('resCursoProfesor').value.trim() : null;
  if(rolActivo==='profesor' && !curso){
    const msg = 'Escribí el curso de la reserva.';
    errBox.textContent = msg;
    showToast(msg, 'warn');
    return;
  }
  if(rolActivo!=='profesor' && cantidadNumerica!==1){
    const msg = 'Los alumnos solo pueden pedir una notebook por vez.';
    errBox.textContent = msg;
    showToast(msg, 'warn');
    return;
  }
  if(esLote || (rolActivo==='profesor' && cantidadNumerica > equiposDisponibles.length)){
    const msg = `No podés pedir más equipos que los disponibles: ${equiposDisponibles.length}.`;
    errBox.textContent = msg;
    showToast(msg, 'warn');
    return;
  }
  if(equiposDisponibles.length < cantidadNumerica){
    const msg = `No hay suficientes notebooks disponibles. Disponibles: ${equiposDisponibles.length}.`;
    errBox.textContent = msg;
    showToast(msg, 'warn');
    return;
  }
  const notebookIds = equiposDisponibles.slice(0, cantidadNumerica).map(nb=>nb.id);
  notebookIds.forEach(id=>{ const nb=notebooks.find(item=>item.id===id); nb.estado='reservada'; nb.ubicacion='Reservada'; nb.act='Recién'; });
  reservas.unshift({
    id:'RES-'+String(reservaSeq++).padStart(2,'0'),
    ownerLegajo: currentUser.legajo,
    ownerNombre: currentUser.nombre,
    tipo:'individual', curso, cantidad, fecha, hora, motivo, notebookIds,
    estado:'confirmada'
  });
  document.getElementById('reservaForm').reset();
  renderReservas();
  renderNotebooks();
  renderAdminInventario();
  actualizarControlesReserva();
  showToast('Reserva confirmada para el '+formatFecha(fecha)+' a las '+hora+'.', 'success');
}

async function cancelarReserva(id){
  if(authToken){
    try{
      await apiRequest('/api/reservations/'+encodeURIComponent(id), {method:'DELETE'});
      await cargarEstadoAPI();
      renderAll();
      showToast('Reserva cancelada.', 'warn');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }
  const idx = reservas.findIndex(r=>r.id===id);
  if(idx<0) return;
  reservas[idx].notebookIds?.forEach(notebookId=>{
    const nb = notebooks.find(item=>item.id===notebookId);
    if(nb?.estado==='reservada'){ nb.estado='disponible'; nb.ubicacion='Carro 1'; nb.act='Recién'; }
  });
  reservas.splice(idx,1);
  renderReservas();
  renderLotes();
  renderNotebooks();
  renderAdminInventario();
  actualizarControlesReserva();
  showToast('Reserva cancelada.', 'warn');
}

function renderReservas(){
  const wrap = document.getElementById('reservasListWrap');
  if(!wrap || !currentUser) return;
  actualizarControlesReserva();
  const propias = reservas.filter(r=>r.ownerLegajo===currentUser.legajo);
  if(propias.length===0){
    wrap.innerHTML = `<div class="empty-state">
      <div class="glyph">🗓️</div>
      <h4>Todavía no tenés reservas</h4>
      <p>Completá el formulario para programar un retiro.</p>
    </div>`;
    return;
  }
  const estadoLabelMap = {confirmada:'Confirmada', pendiente_aprobacion:'Pendiente de aprobación', aprobada:'Aprobada', rechazada:'Rechazada'};
  wrap.innerHTML = propias.map(r=>`
    <div class="action-card" style="cursor:default;margin-bottom:.8rem;">
      <div class="action-icon">${r.tipo==='lote' ? '👥' : '📅'}</div>
      <div class="action-info">
        <h4>${r.tipo==='lote' || r.curso ? (r.curso+' · '+r.cantidad+' equipos') : r.cantidad}</h4>
        <p>${formatFecha(r.fecha)} · ${r.hora} — ${r.motivo}</p>
      </div>
      <span class="badge badge-${r.estado}" style="margin-right:.5rem;">${estadoLabelMap[r.estado]}</span>
      ${r.estado==='pendiente_aprobacion' || r.estado==='confirmada' ? `<button class="btn btn-sm btn-danger-outline" onclick="cancelarReserva('${r.id}')">Cancelar</button>` : ''}
    </div>`).join('');
}

/* ======================================================================
   ADMIN · LOTES DE PROFESORES
====================================================================== */
function renderLotes(){
  const wrap = document.getElementById('lotesWrap');
  if(!wrap) return;
  const badge = document.getElementById('lotesBadge');
  const pendientes = reservas.filter(r=>r.tipo==='lote' && r.estado==='pendiente_aprobacion');
  const aprobadas = reservas.filter(r=>r.tipo==='lote' && r.estado==='aprobada');
  const individuales = reservas.filter(r=>r.tipo==='individual' && r.estado==='confirmada');

  if(pendientes.length===0 && aprobadas.length===0 && individuales.length===0){
    wrap.innerHTML = `<div class="empty-state">
      <div class="glyph">👥</div>
      <h4>No hay solicitudes de lote pendientes</h4>
      <p>Las solicitudes de préstamo por lote de los profesores van a aparecer acá.</p>
    </div>`;
    badge.style.display = 'none';
    return;
  }
  badge.style.display = pendientes.length ? 'inline-flex' : 'none';
  badge.textContent = pendientes.length;

  wrap.innerHTML = pendientes.map(r=>`
    <div class="action-card" style="cursor:default;margin-bottom:.8rem;">
      <div class="action-icon" style="background:var(--purple-bg);color:var(--purple-text);">👥</div>
      <div class="action-info">
        <h4>${r.curso} · ${r.cantidad} equipos</h4>
        <p>${r.ownerNombre} · ${formatFecha(r.fecha)} ${r.hora} — ${r.motivo}</p>
      </div>
      <button class="btn btn-sm btn-success-outline" style="margin-right:.5rem;" onclick="aprobarLote('${r.id}')">Aprobar</button>
      <button class="btn btn-sm btn-danger-outline" onclick="pedirRechazoLote('${r.id}')">Rechazar</button>
    </div>`).join('') + aprobadas.map(r=>`
    <div class="action-card" style="cursor:default;margin-bottom:.8rem;">
      <div class="action-icon" style="background:var(--green-bg);color:var(--green-text);">📦</div>
      <div class="action-info">
        <h4>${r.curso} · ${r.cantidad} equipos</h4>
        <p>${r.ownerNombre} · ${formatFecha(r.fecha)} ${r.hora} — Retiro aprobado</p>
      </div>
      <button class="btn btn-sm btn-primary" onclick="registrarRetiro('${r.id}')">Registrar retiro</button>
    </div>`).join('') + individuales.map(r=>`
    <div class="action-card" style="cursor:default;margin-bottom:.8rem;">
      <div class="action-icon" style="background:var(--blue-bg);color:var(--blue-text);">📅</div>
      <div class="action-info">
        <h4>${r.ownerNombre} · ${r.cantidad}</h4>
        <p>${formatFecha(r.fecha)} ${r.hora} — Reserva confirmada</p>
      </div>
      <button class="btn btn-sm btn-primary" onclick="registrarRetiro('${r.id}')">Registrar retiro</button>
    </div>`).join('');
}

async function aprobarLote(id){
  const r = reservas.find(x=>x.id===id);
  if(!r) return;
  if(authToken){
    try{
      await apiRequest(`/api/admin/reservations/${id}/approve`, {method:'POST'});
      await cargarEstadoAPI();
      renderAll();
      showToast(`Lote de ${r.curso} aprobado.`, 'success');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }
  r.estado = 'aprobada';
  renderLotes();
  renderReservas();
  showToast(`Lote de ${r.curso} aprobado. Falta registrar el retiro físico.`, 'success');
}

async function registrarRetiro(id){
  const r = reservas.find(reserva=>reserva.id===id);
  if(!r) return;
  if(authToken){
    try{
      const result = await apiRequest(`/api/admin/reservations/${id}/checkout`, {method:'POST'});
      await cargarEstadoAPI();
      renderAll();
      showToast(`${result.loansCreated || 0} préstamo(s) creado(s).`, 'success');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }
  const notebookIds = r.notebookIds || [];
  notebookIds.forEach(notebookId=>{
    const nb = notebooks.find(item=>item.id===notebookId);
    if(nb){ nb.estado='prestada'; nb.ubicacion='—'; nb.act='Recién'; nb.prestadoA = r.ownerLegajo+' · '+r.curso; }
  });
  r.estado = 'retirada';
  prestamosActivos[r.ownerLegajo] = {id:notebookIds[0], curso:r.curso, desde:'Recién', vence:'Hoy', pendiente:false};
  renderNotebooks();
  renderAdminInventario();
  renderLotes();
  renderReservas();
  showToast('Retiro registrado y préstamo creado.', 'success');
}

let pendingRejectId = null;
function pedirRechazoLote(id){
  const r = reservas.find(x=>x.id===id);
  if(!r) return;
  pendingRejectId = id;
  document.getElementById('rejectLoteText').textContent = `¿Rechazar la solicitud de lote de ${r.curso} (${r.ownerNombre})?`;
  document.getElementById('rejectLoteConfirmBtn').onclick = confirmarRechazoLote;
  openModal('rejectLoteModal');
}

function confirmarRechazoLote(){
  const r = reservas.find(x=>x.id===pendingRejectId);
  if(r) r.estado = 'rechazada';
  closeModal('rejectLoteModal');
  renderLotes();
  renderReservas();
  showToast('Solicitud de lote rechazada.', 'warn');
}

/* ======================================================================
   REPORTAR FALLA / TICKETS
====================================================================== */
async function crearTicket(e){
  e.preventDefault();
  const nbSel = document.getElementById('fallaNotebook');
  const desc = document.getElementById('fallaDesc').value.trim();
  if(!nbSel.value || !desc){ showToast('Completá la notebook y la descripción.', 'warn'); return; }
  if(authToken){
    try{
      await apiRequest('/api/tickets', {method:'POST', body:JSON.stringify({
        notebook:nbSel.value==='otro' ? null : nbSel.value, motivo:desc.slice(0,240), descripcion:desc
      })});
      document.getElementById('fallaForm').reset();
      await cargarEstadoAPI();
      renderAll();
      showToast('Reporte enviado al Administrador.', 'success');
      switchView('tickets');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }

  const t = {
    id: 'TCK-0'+(ticketSeq++),
    notebook: nbSel.value==='otro' ? 'Sin identificar' : nbSel.value,
    motivo: desc.length>46 ? desc.slice(0,46)+'…' : desc,
    motivoCompleto: desc,
    estado:'abierto', fecha:'hoy',
    ownerLegajo: currentUser.legajo,
    ownerNombre: currentUser.nombre,
    ownerRol: currentUser.rol
  };
  tickets.unshift(t);
  document.getElementById('fallaForm').reset();
  document.querySelectorAll('#severityGroup .severity-opt').forEach(o=>o.className='severity-opt');
  document.querySelector('.severity-opt[data-val="media"]').classList.add('checked-media');

  // Automatización: si el equipo reportado está disponible, pasa solo a "mantenimiento".
  // Si está prestado, se manda a mantenimiento recién cuando se confirme su devolución.
  let avisoEquipo = '';
  if(t.notebook !== 'Sin identificar'){
    const nb = notebooks.find(n=>n.id===t.notebook);
    if(nb && nb.estado==='disponible'){
      moverAMantenimiento(nb);
      avisoEquipo = ` ${t.notebook} se marcó automáticamente en mantenimiento.`;
    } else if(nb){
      nb.marcarMantenimientoAlDevolver = true;
    }
  }

  updateTicketsBadge();
  updateAdminTicketsBadge();
  renderAdminTickets();
  renderNotebooks();
  renderAdminInventario();
  showToast('Reporte enviado al Administrador. Ticket '+t.id+' creado.'+avisoEquipo, 'success');
  switchView('tickets');
}



function updateTicketsBadge(){
  if(!currentUser) return;
  const abiertos = tickets.filter(t=>t.estado!=='resuelto' && t.ownerLegajo===currentUser.legajo).length;
  const badge = document.getElementById('ticketsBadge');
  if(abiertos>0){ badge.style.display='inline-flex'; badge.textContent = abiertos; }
  else{ badge.style.display='none'; }
}

function renderTicketsPropios(){
  // "Mis tickets" sólo muestra los del usuario logueado (alumno o profesor)
  const tbody = document.getElementById('ticketsTable');
  if(!tbody || !currentUser) return;
  const propios = tickets.filter(t=>t.ownerLegajo===currentUser.legajo);
  if(propios.length===0){
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">
      <div class="glyph">🎫</div><h4>No tenés tickets abiertos</h4><p>Si encontrás un problema con un equipo, reportalo desde acá.</p>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = propios.map(t=>`
    <tr>
      <td class="mono">${t.id}</td>
      <td class="mono">${t.notebook}</td>
      <td>${t.motivo}</td>
      <td><span class="badge ${ticketBadgeClass[t.estado]}">${ticketBadgeLabel[t.estado]}</span></td>
      <td>${t.fecha}</td>
    </tr>`).join('');
}

/* ---- ADMIN: Fallas / tickets reportados por todos los usuarios ---- */
function renderAdminTickets(){
  const tbody = document.getElementById('adminTicketsTable');
  if(!tbody) return;
  const ticketsActivos = tickets.filter(t=>t.estado!=='resuelto');
  if(ticketsActivos.length===0){
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
      <div class="glyph">🎫</div><h4>No hay fallas reportadas</h4><p>Los reportes de alumnos y profesores van a aparecer acá.</p>
    </div></td></tr>`;
    updateAdminTicketsBadge();
    return;
  }
  tbody.innerHTML = ticketsActivos.map(t=>{
    const nb = notebooks.find(n=>n.id===t.notebook);
    let equipoCol = '<span class="hint">Sin equipo identificado</span>';
    if(nb){
      equipoCol = `<span class="badge ${badgeClass[nb.estado]}">${badgeLabel[nb.estado]}</span>`;
      if(nb.estado==='mantenimiento'){
        equipoCol += ` <button class="btn btn-sm btn-success-outline" style="margin-left:.4rem;" onclick="habilitarNotebook('${nb.id}')">Habilitar</button>`;
      } else if(nb.marcarMantenimientoAlDevolver){
        equipoCol += ` <span class="hint">(pasará a mantenimiento al devolverse)</span>`;
      }
    }
    return `
    <tr>
      <td class="mono">${t.id}</td>
      <td>${t.ownerNombre} <span class="hint">(${rolLabel[t.ownerRol]})</span></td>
      <td class="mono">${t.notebook}</td>
      <td>${t.motivo}</td>
      <td>
        <select class="btn btn-sm" style="font-weight:500;" onchange="adminSetTicketEstado('${t.id}', this.value)">
          <option value="abierto" ${t.estado==='abierto'?'selected':''}>Abierto</option>
          <option value="progreso" ${t.estado==='progreso'?'selected':''}>En progreso</option>
          <option value="resuelto" ${t.estado==='resuelto'?'selected':''}>Resuelto</option>
        </select>
      </td>
      <td>${equipoCol}</td>
    </tr>`;
  }).join('');
  updateAdminTicketsBadge();
}

async function adminSetTicketEstado(idx, nuevoEstado){
  const t = tickets.find(ticket=>ticket.id===idx);
  if(!t) return;
  if(authToken){
    try{
      await apiRequest('/api/tickets/'+encodeURIComponent(idx), {method:'PATCH', body:JSON.stringify({estado:nuevoEstado})});
      await cargarEstadoAPI();
      renderAll();
      showToast(`Ticket ${t.id} actualizado.`, 'success');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }
  t.estado = nuevoEstado;
  renderAdminTickets();
  updateTicketsBadge();
  showToast(`Ticket ${t.id} actualizado a "${ticketBadgeLabel[nuevoEstado]}".`, 'success');
}

function updateAdminTicketsBadge(){
  const badge = document.getElementById('adminTicketsBadge');
  if(!badge) return;
  const abiertos = tickets.filter(t=>t.estado!=='resuelto').length;
  if(abiertos>0){ badge.style.display='inline-flex'; badge.textContent = abiertos; }
  else{ badge.style.display='none'; }
}

/* ======================================================================
   ADMIN · DEVOLUCIONES TARDÍAS Y SANCIONES
====================================================================== */
function renderTardanzas(){
  const wrap = document.getElementById('usuariosTardiosWrap');
  const tbody = document.getElementById('historialTardanzasTable');
  const porUsuarioBody = document.getElementById('historialPorUsuarioTable');
  const badge = document.getElementById('tardanzasBadge');
  if(!wrap || !tbody) return;

  const todosUsuarios = estadoUsuarios.filter(u=>u.rol!=='admin');

  if(porUsuarioBody){
    if(todosUsuarios.length===0){
      porUsuarioBody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>Todavía no hay alumnos ni profesores registrados.</p></div></td></tr>`;
    } else {
      porUsuarioBody.innerHTML = todosUsuarios.map(u=>`
        <tr>
          <td>${u.nombre}</td>
          <td>${rolLabel[u.rol]}</td>
          <td class="mono">${u.legajo}</td>
          <td>${u.retiradas ?? 0}</td>
          <td>${u.aTiempoPct==null ? '<span class="hint">Sin historial</span>' : u.aTiempoPct+'%'}</td>
        </tr>`).join('');
    }
  }

  const conDemoras = todosUsuarios
    .filter(u=>u.rol!=='admin' && (u.tardanzas||0) > 0)
    .sort((a,b)=>(b.tardanzas||0)-(a.tardanzas||0));

  if(conDemoras.length===0){
    wrap.innerHTML = `<div class="empty-state">
      <div class="glyph">✅</div><h4>Nadie tiene entregas tardías registradas</h4><p>Cuando alguien devuelva un equipo fuera de horario, va a aparecer acá.</p>
    </div>`;
  } else {
    wrap.innerHTML = conDemoras.map(u=>`
      <div class="action-card" style="cursor:default;margin-bottom:.8rem;${u.tardanzas>=3 && !u.baneado ? 'border-color:var(--red-text);' : ''}">
        <div class="action-icon" style="${u.tardanzas>=3 ? 'background:var(--red-bg);color:var(--red-text);' : 'background:var(--orange-bg);color:var(--orange-text);'}">${u.baneado ? '🚫' : '⏰'}</div>
        <div class="action-info">
          <h4>${u.nombre} <span class="hint">(${rolLabel[u.rol]} · ${u.legajo})</span></h4>
          <p>${u.tardanzas} entrega${u.tardanzas===1?'':'s'} tardía${u.tardanzas===1?'':'s'} registrada${u.tardanzas===1?'':'s'}${u.tardanzas>=3 ? ' · candidato a sanción' : ''}</p>
        </div>
        ${u.baneado
          ? `<button class="btn btn-sm btn-success-outline" onclick="cambiarBaneo('${u.legajo}', false)">Quitar baneo</button>`
          : `<button class="btn btn-sm btn-danger-outline" onclick="cambiarBaneo('${u.legajo}', true)">Banear</button>`}
      </div>`).join('');
  }

  const pendientesAviso = conDemoras.filter(u=>u.tardanzas>=3 && !u.baneado).length;
  if(pendientesAviso>0){ badge.style.display='inline-flex'; badge.textContent = pendientesAviso; }
  else{ badge.style.display='none'; }

  if(historialTardanzas.length===0){
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><p>Todavía no hay entregas tardías registradas.</p></div></td></tr>`;
  } else {
    tbody.innerHTML = historialTardanzas.map(h=>`
      <tr>
        <td>${h.nombre}</td>
        <td>${rolLabel[h.rol]}</td>
        <td class="mono">${h.notebookId}</td>
        <td>${h.fecha}</td>
      </tr>`).join('');
  }
}

function permabanear(legajo){
  cambiarBaneo(legajo, true);
}

async function cambiarBaneo(legajo, baneado){
  const u = estadoUsuarios.find(x=>x.legajo===legajo);
  if(!u) return;
  if(authToken){
    try{
      await apiRequest('/api/admin/users/'+encodeURIComponent(legajo), {method:'PATCH', body:JSON.stringify({baneado})});
      await cargarEstadoAPI();
      renderTardanzas();
      showToast(baneado ? `${u.nombre} fue baneado permanentemente.` : `Baneo de ${u.nombre} quitado.`, baneado ? 'error' : 'success');
    }catch(error){ showToast(error.message, 'warn'); }
    return;
  }
  u.baneado = baneado;
  renderTardanzas();
  showToast(baneado ? `${u.nombre} fue baneado permanentemente.` : `Baneo de ${u.nombre} quitado.`, baneado ? 'error' : 'success');
}

/* ======================================================================
   PERFIL (vista + edición)
====================================================================== */
function renderPerfil(){
  if(!currentUser) return;
  document.getElementById('profileAvatarLg').textContent = getInitials(currentUser.nombre);
  document.getElementById('profileNombre').textContent = currentUser.nombre;
  document.getElementById('profileRolCurso').textContent = rolLabel[currentUser.rol];
  document.getElementById('profileLegajo').textContent = currentUser.legajo;
  document.getElementById('profileEmail').textContent = currentUser.email;
  const preferencias = currentUser.preferencias || {email:true, recordatorio:'30'};
  document.getElementById('preferenciasEmail').checked = preferencias.email;
  document.getElementById('preferenciasRecordatorio').value = preferencias.recordatorio;
}

async function actualizarPreferencias(){
  if(!currentUser) return;
  const preferencias = {
    email: document.getElementById('preferenciasEmail').checked,
    recordatorio: document.getElementById('preferenciasRecordatorio').value
  };
  if(authToken){
    try{
      const result = await apiRequest('/api/preferences', {method:'PATCH', body:JSON.stringify(preferencias)});
      currentUser.preferencias = {
        email: Boolean(result.preferences.email),
        recordatorio: String(result.preferences.recordatorio)
      };
    }catch(error){
      renderPerfil();
      showToast(error.message, 'warn');
      return;
    }
  } else {
    currentUser.preferencias = preferencias;
  }
  showToast('Preferencias actualizadas.', 'success');
}

/* ======================================================================
   TEMA OSCURO / CLARO
====================================================================== */
const SUN_ICON = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
const MOON_ICON = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  try{ localStorage.setItem('netmo_theme', theme); }catch(err){ /* modo privado: seguimos sin persistir */ }
  document.querySelectorAll('.theme-toggle-btn').forEach(btn=>{
    btn.innerHTML = theme==='dark' ? SUN_ICON : MOON_ICON;
    btn.title = theme==='dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  });
}

function toggleTheme(){
  const actual = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(actual==='dark' ? 'light' : 'dark');
}

/* ======================================================================
   INIT
====================================================================== */
const today = new Date();
document.getElementById('resFecha').min = today.toISOString().split('T')[0];
document.getElementById('resFecha').max = `${today.getFullYear()}-12-31`;

(function initTheme(){
  let saved = null;
  try{ saved = localStorage.getItem('netmo_theme'); }catch(err){ /* ignorar */ }
  if(!saved){ saved = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  applyTheme(saved);
})();
>>>>>>> 219c483 (Publish deployment cleanup with sanitized credentials)
