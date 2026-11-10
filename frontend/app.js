/* ======================================================================
   ESTADO EN MEMORIA
====================================================================== */
let usuariosRegistrados = [];
let usuariosConTardanzas = [];

let currentUser = null;
let rolActivo = null;
let authToken = null;
let persistSession = false;
let sessionRefreshPromise = null;
const API_BASE = (window.NETMO_CONFIG.apiBaseUrl || '').replace(/\/+$/, '');
const API_CONNECTION_ERROR = 'No se pudo conectar con el servidor. Puede estar iniciando, esperá unos segundos y reintentá';
let loginRequestAttempted = false;

let notebooks = [];
let carros = [];
let ubicaciones = [];
let ticketNotebookHistory = [];
let reservationCarrosLoading = true;
let reservationCarrosError = '';
let stats = {disponibles:0, prestadas:0, mantenimiento:0, total:0};
let prestamosActivos = {};
let historialPrestamos = [];

let historialTardanzas = [];
let historialDevoluciones = [];
let reservas = [];
let tickets = [];
let reservationSubmitting = false;
let lateReturnsInterval = null;
let returnHistorySearchTimer = null;
let loanReminderInterval = null;
let circulationInterval = null;
let circulationSearchTimer = null;
let reservationsSearchTimer = null;
let circulationLoans = [];
let activeTicketRepliesCode = null;
const ticketRepliesLastRead = Object.create(null);
let pendingDeleteCarro = null;
let pendingRestoreBackup = null;
let rolePasswordResolver = null;

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

async function guardarCarro(numero){
  const location = document.getElementById(`carro-ubicacion-${numero}`).value || null;
  const newNumber = document.getElementById(`carro-numero-${numero}`).value.trim();
  if(!/^\d{1,3}$/.test(newNumber) || Number(newNumber)<1){
    showToast('El número de carro debe contener de 1 a 3 dígitos, entre 1 y 999.', 'warn');
    return;
  }
  try{
    await apiRequest(`/api/admin/carros/${numero}`, {
      method:'PATCH', body:JSON.stringify({numero:Number(newNumber), ubicacion:location})
    });
    await cargarEstadoAPI();
    renderAll();
    showToast('Carro actualizado correctamente.', 'success');
  }catch(error){
    showToast(error.message, 'warn');
  }
}

function mostrarDialogoMoverCarro(numero, count){
  pendingDeleteCarro = numero;
  document.getElementById('moveCarroText').textContent =
    `El carro ${numero} tiene ${count} notebooks. Seleccioná un carro de destino para moverlas y eliminarlo en una sola operación.`;
  const destination = document.getElementById('moveCarroDestino');
  destination.innerHTML = carros.filter(carro=>Number(carro.numero)!==Number(numero))
    .map(carro=>`<option value="${escapeHtml(carro.numero)}">Carro ${escapeHtml(carro.numero)}</option>`).join('');
  destination.disabled = destination.options.length===0;
  document.querySelector('#moveCarroModal .btn-primary').disabled = destination.disabled;
  openModal('moveCarroModal');
}

async function eliminarCarro(numero){
  const carro = carros.find(item=>Number(item.numero)===Number(numero));
  if(carro && Number(carro.total)>0){
    mostrarDialogoMoverCarro(numero, Number(carro.total));
    return;
  }
  if(!window.confirm(`¿Eliminar el carro ${numero}?`)) return;
  try{
    await apiRequest(`/api/admin/carros/${numero}`, {method:'DELETE'});
    await cargarEstadoAPI();
    renderAll();
    showToast('Carro eliminado correctamente.', 'success');
  }catch(error){
    if(error.status===409 && error.notebookCount){
      mostrarDialogoMoverCarro(numero, error.notebookCount);
      return;
    }
    showToast(error.message, 'warn');
  }
}

async function confirmarMoverYEliminarCarro(){
  const numero = pendingDeleteCarro;
  const destino = Number(document.getElementById('moveCarroDestino').value);
  if(!numero || !destino) return;
  try{
    await apiRequest(`/api/admin/carros/${numero}`, {
      method:'DELETE', body:JSON.stringify({destino})
    });
    closeModal('moveCarroModal');
    pendingDeleteCarro = null;
    await cargarEstadoAPI();
    renderAll();
    showToast('Notebooks movidas y carro eliminado.', 'success');
  }catch(error){
    showToast(error.message, 'warn');
  }
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
  'admin-profesores':   ['Usuarios', 'Creá cuentas y consultá alumnos y profesores.'],
  'admin-inventario':   ['Inventario completo', 'Estado de todas las notebooks del sistema.'],
  'admin-devoluciones': ['Historial de devoluciones', 'Consultá las recepciones físicas ya confirmadas.'],
  'admin-circulation':  ['Entregas y devoluciones', 'Registrá las entregas y devoluciones de notebooks.'],
  'admin-lotes':        ['Préstamos', 'Aprobá y registrá el retiro de las solicitudes de préstamo (individuales o por lote).'],
  'admin-tickets':      ['Fallas reportadas', 'Tickets enviados por alumnos y profesores. Actualizá el estado del equipo según corresponda.'],
  'admin-tardanzas':    ['Devoluciones tardías', 'Historial de demoras y sanciones a alumnos y profesores.'],
  'admin-backup':       ['Backup', 'Descargá una copia o restaurá los datos del sistema.'],
};

/* ======================================================================
   AUTH: LOGIN / LOGOUT
====================================================================== */
async function apiRequest(path, options={}){
  if(!API_BASE) throw new Error('La API no está configurada');
  if(authToken && !['/api/auth/login', '/api/auth/refresh'].includes(path)){
    await refreshSessionIfNeeded();
  }
  const headers = {'Content-Type':'application/json', ...(options.headers||{})};
  if(authToken) headers.Authorization = 'Bearer '+authToken;
  const response = await fetch(API_BASE+path, {...options, headers});
  const payload = await response.json().catch(()=>({}));
  if(response.status===401 && authToken && path!=='/api/auth/login'){
    expireSession('Tu sesión venció. Iniciá sesión nuevamente.');
  }
  if(!response.ok){
    const error = new Error(payload.error || 'No se pudo completar la operación');
    error.status = response.status;
    Object.assign(error, payload);
    throw error;
  }
  return payload;
}

function isNetworkError(error){
  return error?.name==='AbortError' || error instanceof TypeError;
}

async function requestLogin(email, password){
  for(let attempt=0;attempt<2;attempt++){
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(), 30_000);
    try{
      return await apiRequest('/api/auth/login', {
        method:'POST',
        body:JSON.stringify({email, password}),
        signal:controller.signal
      });
    }catch(error){
      if(!isNetworkError(error)) throw error;
      if(attempt===1) throw new Error(API_CONNECTION_ERROR);
      document.getElementById('loginError').textContent = 'Conectando con el servidor...';
    }finally{
      clearTimeout(timeout);
    }
    await new Promise(resolve=>setTimeout(resolve, 3_000));
  }
  throw new Error(API_CONNECTION_ERROR);
}

function expirationFromToken(token){
  try{
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length/4)*4, '=')));
    return Number.isInteger(decoded.exp) ? decoded.exp : null;
  }catch{
    return null;
  }
}

function saveSessionToken(token, persistent=persistSession){
  try{
    window.localStorage.removeItem('netmo_token');
    window.sessionStorage.removeItem('netmo_token');
    const storage = persistent ? window.localStorage : window.sessionStorage;
    storage.setItem('netmo_token', token);
  }catch{
    throw new Error('No se pudo guardar la sesión en este navegador.');
  }
  persistSession = persistent;
}

function clearStoredSession(){
  const errors = [];
  for(const storageName of ['localStorage', 'sessionStorage']){
    try{
      window[storageName].removeItem('netmo_token');
    }catch{
      errors.push(storageName);
    }
  }
  if(errors.length) throw new Error('No se pudo limpiar completamente la sesión guardada.');
}

function expireSession(message){
  if(lateReturnsInterval) clearInterval(lateReturnsInterval);
  if(loanReminderInterval) clearInterval(loanReminderInterval);
  if(circulationInterval) clearInterval(circulationInterval);
  if(circulationSearchTimer) clearTimeout(circulationSearchTimer);
  if(reservationsSearchTimer) clearTimeout(reservationsSearchTimer);
  if(returnHistorySearchTimer) clearTimeout(returnHistorySearchTimer);
  lateReturnsInterval = null;
  loanReminderInterval = null;
  circulationInterval = null;
  circulationSearchTimer = null;
  reservationsSearchTimer = null;
  returnHistorySearchTimer = null;
  authToken = null;
  currentUser = null;
  rolActivo = null;
  persistSession = false;
  try{
    clearStoredSession();
  }catch(error){
    message = `${message} ${error.message}`;
  }
  document.getElementById('app-root').classList.remove('active');
  document.getElementById('auth-shell').classList.remove('hidden');
  document.getElementById('loginError').textContent = message;
}

async function refreshSessionIfNeeded(){
  if(!authToken || sessionRefreshPromise) return sessionRefreshPromise;
  const expiresAt = expirationFromToken(authToken);
  if(expiresAt === null || expiresAt - Date.now()/1000 >= 2*60*60) return;
  sessionRefreshPromise = (async()=>{
    const response = await fetch(API_BASE+'/api/auth/refresh', {
      method:'POST',
      headers:{'Content-Type':'application/json', Authorization:'Bearer '+authToken},
      body:'{}'
    });
    const payload = await response.json().catch(()=>({}));
    if(response.status===401){
      expireSession('Tu sesión venció. Iniciá sesión nuevamente.');
    }
    if(!response.ok) throw new Error(payload.error || 'No se pudo renovar la sesión.');
    authToken = payload.token;
    saveSessionToken(authToken);
  })();
  try{
    await sessionRefreshPromise;
  }finally{
    sessionRefreshPromise = null;
  }
}

async function cargarEstadoAPI(){
  const esAdmin = currentUser.rol==='admin';
  const requests = [
    ['notebooks', apiRequest('/api/notebooks')],
    ['reservations', apiRequest(esAdmin ? '/api/admin/reservations' : '/api/reservations')],
    ['tickets', apiRequest(esAdmin ? '/api/admin/tickets' : '/api/tickets')],
    ['carros', apiRequest(esAdmin ? '/api/admin/carros' : '/api/carros')]
  ];
  if(!esAdmin){
    requests.push(
      ['loans', apiRequest('/api/loans')],
      ['preferences', apiRequest('/api/preferences')],
      ['ticketNotebooks', apiRequest('/api/tickets/notebooks')]
    );
  }else{
    requests.push(
      ['lateReturns', apiRequest('/api/admin/late-returns')],
      ['users', apiRequest('/api/admin/users')]
    );
  }
  const loaded = Object.fromEntries(await Promise.all(requests.map(async([key, promise])=>[key, await promise])));
  const {notebooksData, reservationsData, ticketsData} = {
    notebooksData:loaded.notebooks,
    reservationsData:loaded.reservations,
    ticketsData:loaded.tickets
  };
  const loansData = loaded.loans || {loans:[]};
  carros = loaded.carros.carros;
  ubicaciones = loaded.carros.ubicaciones || [];
  ticketNotebookHistory = loaded.ticketNotebooks?.notebooks || [];
  reservationCarrosLoading = false;
  reservationCarrosError = '';
  if(loaded.preferences){
    currentUser.preferencias = {
      email: Boolean(loaded.preferences.preferences?.email),
      recordatorio: String(loaded.preferences.preferences?.recordatorio ?? 30)
    };
  }
  notebooks = notebooksData.notebooks.map(notebook=>({
    id:notebook.id, estado:notebook.estado, ubicacion:notebook.ubicacion,
    act:notebook.actualizada ? formatBusinessDateTime(notebook.actualizada) : 'Recién',
    prestadoA:notebook.prestado_a || null, carro_id:notebook.carro_id
  }));
  reservas = reservationsData.reservations.map(reserva=>{
    const retiro = businessDateParts(reserva.retiro_at);
    return {
      id:reserva.id || reserva.codigo, ownerDni:reserva.dni || currentUser.dni, ownerNombre:reserva.nombre || currentUser.nombre,
      tipo:reserva.tipo, carro:reserva.carro, curso:reserva.curso, cantidad:`${reserva.cantidad} ${reserva.cantidad===1?'notebook':'notebooks'}`,
      fecha:`${retiro.year}-${retiro.month}-${retiro.day}`, hora:`${retiro.hour}:${retiro.minute}`,
      horaDevolucion:reserva.hora_devolucion ? String(reserva.hora_devolucion).slice(0,5) : null,
      motivo:reserva.motivo,
      estado:reserva.estado, notebookIds:reserva.notebook_ids || []
    };
  });
  tickets = ticketsData.tickets.map(ticket=>({
    id:ticket.id, notebook:ticket.notebook || 'otro', motivo:ticket.motivo, motivoCompleto:ticket.descripcion,
    estado:ticket.estado, fecha:formatBusinessDateTime(ticket.created_at, {dateStyle:'short'}), ownerDni:currentUser.dni,
    latestAdminReplyAt:ticket.latest_admin_reply_at,
    ownerNombre:ticket.owner_nombre || currentUser.nombre, ownerRol:ticket.owner_rol || currentUser.rol
  }));
  if(esAdmin){
    usuariosRegistrados = loaded.users.users;
    usuariosConTardanzas = loaded.lateReturns.users;
    historialTardanzas = loaded.lateReturns.history.map(item=>({
      ...item, notebookId:item.notebook_id, fecha:formatBusinessDateTime(item.fecha)
    }));
  }
  renderReservaCarros();
  prestamosActivos = {};
  historialPrestamos = loansData.loans;
  loansData.loans.filter(loan=>loan.estado !== 'devuelto').forEach(loan=>{
    if(!prestamosActivos[currentUser.dni]) prestamosActivos[currentUser.dni] = [];
    prestamosActivos[currentUser.dni].push({
      id:loan.notebook, curso:loan.curso, desde:formatBusinessDateTime(loan.retirada_at),
      vence:formatBusinessDateTime(loan.vence_at),
      venceAt:loan.vence_at,
      horaDevolucion:loan.hora_devolucion ? String(loan.hora_devolucion).slice(0,5) : null,
      vencido:Boolean(loan.vencido),
      horaPrevista:loan.hora_prevista ? String(loan.hora_prevista).slice(0,5) : null,
      pendiente:loan.estado!=='activo', loanId:loan.id
    });
  });
  renderLoanReminders();
}

async function login(e){
  e.preventDefault();
  loginRequestAttempted = true;
  const submitButton = document.getElementById('loginSubmit');
  const originalLabel = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = 'Ingresando...';
  document.getElementById('loginError').textContent = '';
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPassword').value;

  try{
    const result = await requestLogin(email, pass);
    authToken = result.token;
    persistSession = document.getElementById('rememberSession').checked;
    saveSessionToken(authToken);
    currentUser = {...result.user};
    rolActivo = currentUser.rol;
    await cargarEstadoAPI();
    document.getElementById('loginForm').reset();
    document.getElementById('loginError').textContent = '';
    iniciarSesion();
    return;
  }catch(error){
    document.getElementById('loginError').textContent = isNetworkError(error)
      ? API_CONNECTION_ERROR
      : error.message;
    return;
  }finally{
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
}

function mostrarRecuperacion(){
  document.getElementById('view-login').classList.remove('active');
  document.getElementById('view-forgot-password').classList.add('active');
  document.getElementById('forgotEmail').value = document.getElementById('loginEmail').value.trim();
  document.getElementById('forgotPasswordMessage').textContent = '';
}

function mostrarLogin(){
  document.getElementById('view-forgot-password').classList.remove('active');
  document.getElementById('view-login').classList.add('active');
}

async function solicitarCodigoRecuperacion(){
  const message = document.getElementById('forgotPasswordMessage');
  const email = document.getElementById('forgotEmail').value.trim();
  try{
    const result = await apiRequest('/api/auth/forgot', {method:'POST', body:JSON.stringify({email})});
    document.getElementById('forgotCodeFields').hidden = false;
    document.getElementById('forgotRequestButton').hidden = true;
    document.getElementById('forgotSubmitButton').hidden = false;
    document.getElementById('forgotResendButton').hidden = false;
    message.textContent = result.message;
  }catch(error){
    message.textContent = error.message;
  }
}

async function restablecerPassword(){
  const message = document.getElementById('forgotPasswordMessage');
  const code = document.getElementById('forgotCode').value.trim();
  const password = document.getElementById('forgotPassword').value;
  const repeatedPassword = document.getElementById('forgotPasswordRepeat').value;
  if(password !== repeatedPassword){
    message.textContent = 'Las contraseñas no coinciden.';
    return;
  }
  if(password.length < 8 || /\s/.test(password)){
    message.textContent = 'La contraseña debe tener al menos 8 caracteres y no contener espacios.';
    return;
  }
  try{
    const result = await apiRequest('/api/auth/reset', {
      method:'POST',
      body:JSON.stringify({email:document.getElementById('forgotEmail').value.trim(), code, password})
    });
    message.textContent = result.message;
    document.getElementById('forgotCodeFields').hidden = true;
    document.getElementById('forgotSubmitButton').hidden = true;
    document.getElementById('forgotResendButton').hidden = true;
    document.getElementById('forgotRequestButton').hidden = false;
    document.getElementById('forgotPasswordForm')?.reset();
    mostrarLogin();
    document.getElementById('loginError').textContent = '';
    showToast(result.message, 'success');
  }catch(error){
    message.textContent = error.message;
  }
}

async function solicitarCambioPassword(){
  const message = document.getElementById('changePasswordMessage');
  try{
    const result = await apiRequest('/api/auth/change-password/request', {method:'POST', body:'{}'});
    document.getElementById('changePasswordForm').hidden = false;
    message.textContent = result.message;
  }catch(error){
    message.textContent = error.message;
  }
}

async function cambiarPassword(event){
  event.preventDefault();
  const form = document.getElementById('changePasswordForm');
  const message = document.getElementById('changePasswordMessage');
  const password = document.getElementById('changePasswordNew').value;
  if(password !== document.getElementById('changePasswordRepeat').value){
    message.textContent = 'Las contraseñas no coinciden.';
    return;
  }
  if(password.length < 8 || /\s/.test(password)){
    message.textContent = 'La contraseña debe tener al menos 8 caracteres y no contener espacios.';
    return;
  }
  try{
    const result = await apiRequest('/api/auth/change-password', {
      method:'POST',
      body:JSON.stringify({code:document.getElementById('changePasswordCode').value.trim(), password})
    });
    form.reset();
    form.hidden = true;
    message.textContent = result.message;
    showToast(result.message, 'success');
  }catch(error){
    message.textContent = error.message;
  }
}

function togglePasswordVisibility(inputId, button){
  const input = document.getElementById(inputId);
  input.type = input.type === 'password' ? 'text' : 'password';
  button.textContent = input.type === 'password' ? 'Mostrar' : 'Ocultar';
}

function toggleLoginPasswordVisibility(){
  const input = document.getElementById('loginPassword');
  const button = document.getElementById('loginPasswordToggle');
  const isVisible = input.type === 'password';
  input.type = isVisible ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(isVisible));
  button.setAttribute('aria-label', isVisible ? 'Ocultar contraseña' : 'Mostrar contraseña');
}

function validarNombreCuenta(value, label){
  const name = value.trim().normalize('NFC');
  if(!name) return `${label} no puede estar vacío`;
  if(name.length<2) return `${label} debe tener al menos 2 caracteres`;
  if(name.length>50) return `${label} no puede superar 50 caracteres`;
  if(!/^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u.test(name)) return `${label} solo puede contener letras y espacios simples`;
  if(Array.from(name.replace(/ /g, '')).length<2) return `${label} debe tener al menos 2 letras`;
  return '';
}

async function crearUsuarioAdmin(e){
  e.preventDefault();
  const error = document.getElementById('adminUserError');
  const nombre = document.getElementById('userNombre').value.trim();
  const apellido = document.getElementById('userApellido').value.trim();
  const email = document.getElementById('userEmail').value.trim().toLowerCase();
  const dni = document.getElementById('userDni').value.trim();
  const rol = document.getElementById('userRol').value;
  const password = document.getElementById('userPassword').value;
  error.textContent = validarNombreCuenta(nombre, 'El nombre') || validarNombreCuenta(apellido, 'El apellido');
  if(!error.textContent && (!/^\d{7,10}$/.test(dni))) error.textContent = 'El DNI debe contener de 7 a 10 dígitos numéricos';
  if(!error.textContent && /\s/.test(email)) error.textContent = 'El email no puede contener espacios';
  if(!error.textContent && (email.length > 50 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email))) error.textContent = 'Ingresá un email válido de hasta 50 caracteres';
  if(!error.textContent && (password.length < 8 || password.length > 50 || /\s/.test(password))) error.textContent = 'La contraseña debe tener entre 8 y 50 caracteres y no contener espacios';
  if(error.textContent){ showToast(error.textContent, 'warn'); return; }
  try{
    await apiRequest('/api/admin/users', {method:'POST', body:JSON.stringify({nombre, apellido, email, dni, rol, password})});
    document.getElementById('adminUserForm').reset();
    error.textContent = '';
    await cargarEstadoAPI();
    renderAll();
    showToast('Usuario creado correctamente.', 'success');
  }catch(requestError){
    error.textContent = requestError.message;
    showToast(requestError.message, 'warn');
  }
}

function renderProfesoresTable(){
  const query = (document.getElementById('profesoresSearchInput')?.value || '').trim().toLowerCase();
  const filtered = usuariosRegistrados.filter(usuario=>
    [usuario.nombre, usuario.email, usuario.dni, usuario.rol].some(value=>String(value || '').toLowerCase().includes(query))
  );
  for(const [rol, tbodyId] of [
    ['alumno', 'alumnosTable'], ['profesor', 'profesoresTable'], ['admin', 'administradoresTable']
  ]){
    const tbody = document.getElementById(tbodyId);
    if(!tbody) continue;
    const users = filtered.filter(usuario=>usuario.rol===rol);
    if(!users.length){
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>No hay ${rol==='alumno'?'alumnos':'profesores'} que coincidan.</p></div></td></tr>`;
      continue;
    }
    tbody.innerHTML = users.map(usuario=>`
    <tr>
      <td>${escapeHtml(usuario.nombre)}</td>
      <td>${escapeHtml(usuario.email)}</td>
      <td class="mono">${escapeHtml(usuario.dni)}</td>
      <td>${escapeHtml(rolLabel[usuario.rol] || usuario.rol)}</td>
      <td><select class="btn btn-sm" aria-label="Cambiar rol de ${escapeHtml(usuario.nombre)}"
        ${usuario.dni===currentUser.dni?'disabled':''}
        onchange="cambiarRol(${escapeHtml(JSON.stringify(usuario.dni))}, this.value, this)">
        <option value="alumno" ${usuario.rol==='alumno'?'selected':''}>Alumno</option>
        <option value="profesor" ${usuario.rol==='profesor'?'selected':''}>Profesor</option>
        <option value="admin" ${usuario.rol==='admin'?'selected':''}>Administrador</option>
      </select></td>
    </tr>`).join('');
  }
}

function filterProfesores(){
  renderProfesoresTable();
}

async function cambiarRol(dni, rol, select){
  const usuario = usuariosRegistrados.find(item=>item.dni===dni);
  if(!usuario || !['alumno','profesor','admin'].includes(rol)) return;
  const previous = usuario.rol;
  let password;
  if(rol==='admin' && previous!=='admin'){
    password = await solicitarPasswordAdministrador(usuario.nombre);
    if(password===null){
      select.value = previous;
      return;
    }
  }
  try{
    const body = {rol};
    if(password!==undefined) body.password = password;
    await apiRequest(`/api/admin/users/${encodeURIComponent(dni)}/rol`, {method:'PATCH', body:JSON.stringify(body)});
    await cargarEstadoAPI();
    renderAll();
    showToast(`Rol de ${usuario.nombre} actualizado.`, 'success');
  }catch(error){
    if(select) select.value = previous;
    showToast(error.message, 'warn');
  }finally{
    password = undefined;
  }
}

function iniciarSesion(){
  document.getElementById('auth-shell').classList.add('hidden');
  document.getElementById('app-root').classList.add('active');
  renderAll();
  applyRoleVisibility();
  switchView('inicio');
  if(loanReminderInterval) clearInterval(loanReminderInterval);
  loanReminderInterval = setInterval(()=>{
    renderPrestamoActivo();
    renderLoanReminders();
  },60_000);
}

function logout(){
  if(lateReturnsInterval) clearInterval(lateReturnsInterval);
  lateReturnsInterval = null;
  let storageError = '';
  try{
    clearStoredSession();
  }catch(error){
    storageError = ` ${error.message}`;
  }
  authToken = null;
  currentUser = null;
  rolActivo = null;
  persistSession = false;
  document.getElementById('app-root').classList.remove('active');
  document.getElementById('auth-shell').classList.remove('hidden');
  document.getElementById('loginError').textContent = '';
  if(storageError) document.getElementById('loginError').textContent = storageError.trim();
  else showToast('Sesión cerrada correctamente.', 'warn');
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
  document.getElementById('resCursoAnio').required = isProf;
  document.getElementById('resCursoDivision').required = isProf;
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
  document.getElementById('resCursoAnio').required = rolActivo==='profesor';
  document.getElementById('resCursoDivision').required = rolActivo==='profesor';
  document.getElementById('resSubmitBtn').textContent = checked ? 'Enviar solicitud de lote' : 'Enviar solicitud';
  actualizarControlesReserva();
}

function tieneEquiposPendientes(dni){
  if(prestamosActivos[dni]?.length) return true;
  return reservas.some(reserva=>reserva.ownerDni===dni &&
    !['rechazada','cancelada'].includes(reserva.estado) &&
    reserva.notebookIds?.length > 0);
}

function actualizarControlesReserva(){
  const cantidadInput = document.getElementById('resCantidad');
  const loteCantidadInput = document.getElementById('loteCantidad');
  const submitButton = document.getElementById('resSubmitBtn');
  if(!cantidadInput || !loteCantidadInput || !submitButton || !currentUser) return;

  const esProfesor = rolActivo==='profesor';
  const ubicacion = document.getElementById('resUbicacion')?.value || 'todas';
  const selectedCarro = document.getElementById('resCarro')?.value || '';
  const allowedCarros = carros.filter(carro=>
    (ubicacion==='todas' || carro.ubicacion===ubicacion)
    && (!selectedCarro || String(carro.numero)===selectedCarro)
  );
  const allowedCarroNumbers = new Set(allowedCarros.map(carro=>Number(carro.numero)));
  const equiposDisponibles = notebooks.filter(nb=>
    nb.estado==='disponible' && allowedCarroNumbers.has(Number(nb.carro_id))
  ).length;
  const bloqueado = tieneEquiposPendientes(currentUser.dni);
  const maxIndividual = esProfesor ? Math.max(1, Math.min(2, equiposDisponibles)) : 1;
  cantidadInput.max = String(maxIndividual);
  cantidadInput.value = esProfesor ? Math.min(Math.max(Number(cantidadInput.value)||1, 1), maxIndividual) : 1;
  const maxLote = Math.min(10, equiposDisponibles);
  loteCantidadInput.max = String(Math.max(3, maxLote));
  loteCantidadInput.value = Math.min(Math.max(Number(loteCantidadInput.value)||3, 3), Math.max(3, maxLote));

  cantidadInput.disabled = !esProfesor;
  document.getElementById('loteToggle').disabled = bloqueado || equiposDisponibles < 3;
  loteCantidadInput.disabled = equiposDisponibles < 3;
  document.getElementById('resCursoAnio').disabled = false;
  document.getElementById('resCursoDivision').disabled = false;
  const cantidadSolicitada = document.getElementById('loteToggle').checked
    ? Number(loteCantidadInput.value) : Number(cantidadInput.value);
  submitButton.disabled = reservationSubmitting || bloqueado || equiposDisponibles < cantidadSolicitada;
}

/* ======================================================================
   NAVEGACIÓN
====================================================================== */
function switchView(name){
  const target = document.getElementById('view-'+name);
  if(!target) return;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  target.classList.add('active');
  document.getElementById('resCarro').required = false;
  document.querySelectorAll('.nav-item[data-view]').forEach(b=>b.classList.toggle('active', b.dataset.view===name));

  const [titleTpl, sub] = pageMeta[name];
  const firstName = currentUser ? currentUser.nombre.split(' ')[0] : '';
  document.getElementById('pageTitle').textContent = titleTpl.replace('{NOMBRE}', firstName ? ', '+firstName : '');
  document.getElementById('pageSubtitle').textContent = sub;
  window.scrollTo({top:0, behavior:'smooth'});

  if(name==='inicio' && rolActivo!=='admin') renderMiActividad();
  if(name==='prestamos'){ renderPrestamoActivo(); renderHistorialPrestamos(); }
  if(name==='reservas'){
    renderReservas();
    toggleProfesorUI();
    renderReservaCarros();
    if(authToken) void cargarCarrosReserva();
  }
  if(name==='tickets'){
    renderTicketsPropios();
    if(authToken) void refreshOwnTickets();
  }
  if(name==='perfil') renderPerfil();
  if(name==='admin-profesores') renderProfesoresTable();
  if(name==='admin-inventario') renderAdminInventario();
  if(name==='admin-devoluciones'){
    renderDevoluciones();
    if(authToken && rolActivo==='admin'){
      const query = document.getElementById('returnsHistorySearch').value.trim();
      void buscarHistorialDevoluciones(query);
    }
  }
  if(name==='admin-lotes') renderLotes();
  if(name==='admin-tickets') renderAdminTickets();
  if(name==='admin-backup'){
    document.getElementById('backupFile').value = '';
    document.getElementById('backupPreview').hidden = true;
    document.getElementById('restoreBackupForm').hidden = true;
    document.getElementById('restoreBackupError').textContent = '';
    pendingRestoreBackup = null;
  }
  if(lateReturnsInterval) clearInterval(lateReturnsInterval);
  lateReturnsInterval = null;
  if(circulationInterval) clearInterval(circulationInterval);
  circulationInterval = null;
  if(name==='admin-tardanzas'){
    renderTardanzas();
    if(authToken && rolActivo==='admin'){
      void refreshAdminLateReturns();
      lateReturnsInterval = setInterval(()=>void refreshAdminLateReturns(), 30000);
    }
  }
  if(name==='admin-circulation' && authToken && rolActivo==='admin'){
    const search = document.getElementById('circulationSearch').value.trim();
    void buscarPrestamosAdmin(search);
    circulationInterval = setInterval(()=>{
      const currentSearch = document.getElementById('circulationSearch').value.trim();
      void buscarPrestamosAdmin(currentSearch);
    }, 30000);
  }
  if(authToken && ['prestamos', 'admin-lotes'].includes(name)){
    void cargarEstadoAPI().then(renderAll).catch(error=>showToast(error.message, 'warn'));
  }
}

async function refreshAdminLateReturns(){
  if(!authToken || rolActivo!=='admin' || !document.getElementById('view-admin-tardanzas').classList.contains('active')) return;
  try{
    const data = await apiRequest('/api/admin/late-returns');
    usuariosConTardanzas = data.users;
    historialTardanzas = data.history.map(item=>({
      ...item, notebookId:item.notebook_id, fecha:formatBusinessDateTime(item.fecha)
    }));
    renderTardanzas();
  }catch(error){
    showToast(error.message, 'warn');
  }
}

async function descargarBackup(){
  try{
    const response = await fetch(API_BASE+'/api/admin/backup', {
      headers:{Authorization:'Bearer '+authToken}
    });
    if(!response.ok){
      const payload = await response.json().catch(()=>({}));
      throw new Error(payload.error || 'No se pudo descargar el backup.');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || 'netmo-backup.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }catch(error){
    showToast(error.message, 'warn');
  }
}

async function previsualizarBackup(event){
  const file = event.target.files?.[0];
  const preview = document.getElementById('backupPreview');
  const form = document.getElementById('restoreBackupForm');
  const error = document.getElementById('restoreBackupError');
  pendingRestoreBackup = null;
  form.hidden = true;
  error.textContent = '';
  if(!file){
    preview.hidden = true;
    return;
  }
  if(file.size > 25 * 1024 * 1024){
    preview.textContent = 'El archivo supera el límite permitido de 25 MB.';
    preview.hidden = false;
    return;
  }
  try{
    const backup = JSON.parse(await file.text());
    if(!backup || typeof backup !== 'object' || !backup.metadata || typeof backup.metadata !== 'object' ||
      !backup.metadata.conteos || typeof backup.metadata.conteos !== 'object'){
      throw new Error('El archivo no tiene metadatos de backup válidos.');
    }
    pendingRestoreBackup = backup;
    const fecha = backup.metadata.fecha && Number.isFinite(Date.parse(backup.metadata.fecha))
      ? new Date(backup.metadata.fecha).toLocaleString('es-AR')
      : backup.metadata.fecha || 'No disponible';
    const counts = Object.entries(backup.metadata.conteos)
      .map(([table, count])=>`<li><span>${escapeHtml(table)}</span>: ${escapeHtml(count)}</li>`).join('');
    preview.innerHTML = `<h4>Vista previa</h4>
      <p>Fecha: ${escapeHtml(fecha)}</p>
      <p>Versión del esquema: ${escapeHtml(backup.metadata.version_esquema || 'No disponible')}</p>
      <ul>${counts}</ul>`;
    preview.hidden = false;
    form.hidden = false;
  }catch(parseError){
    preview.textContent = parseError instanceof SyntaxError ? 'El archivo no contiene JSON válido.' : parseError.message;
    preview.hidden = false;
  }
}

async function restaurarBackup(event){
  event.preventDefault();
  const error = document.getElementById('restoreBackupError');
  if(!pendingRestoreBackup){
    error.textContent = 'Seleccioná un archivo de backup válido.';
    return;
  }
  if(document.getElementById('restoreConfirmation').value !== 'RESTAURAR'){
    error.textContent = 'La frase debe ser exactamente RESTAURAR.';
    return;
  }
  const confirmation = window.confirm('Esta operación reemplazará todos los datos actuales. ¿Continuar?');
  if(!confirmation) return;
  try{
    const response = await fetch(API_BASE+'/api/admin/restore', {
      method:'POST',
      headers:{'Content-Type':'application/json', Authorization:'Bearer '+authToken},
      body:JSON.stringify({
        backup:pendingRestoreBackup,
        password:document.getElementById('restoreAdminPassword').value,
        confirmation:document.getElementById('restoreConfirmation').value
      })
    });
    const payload = await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(payload.error || 'No se pudo restaurar el backup.');
    window.location.reload();
  }catch(restoreError){
    error.textContent = restoreError.message;
  }
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
  renderInventarioForms();
  renderFallaNotebookOptions();
  renderCirculationLoans();
  renderLoanReminders();
}

function renderInventarioForms(){
  const list = document.getElementById('carrosList');
  if(list){
    list.innerHTML = carros.length
      ? `<div class="inventory-table-scroll"><table class="inventory-table inventory-table-carros"><thead><tr><th>Carro</th><th>Ubicación</th><th>Nuevo número</th><th>Acciones</th></tr></thead><tbody>${carros.map(carro=>`
        <tr>
          <td>Carro ${escapeHtml(carro.numero)} · ${escapeHtml(carro.disponibles)} disponibles / ${escapeHtml(carro.total)} total</td>
          <td><select id="carro-ubicacion-${escapeHtml(carro.numero)}" aria-label="Ubicación del carro ${escapeHtml(carro.numero)}">
            <option value="" ${carro.ubicacion===null?'selected':''}>Sin ubicación</option>
            ${ubicaciones.map(location=>`<option value="${escapeHtml(location.slug)}" ${carro.ubicacion===location.slug?'selected':''}>${escapeHtml(location.nombre)}</option>`).join('')}
          </select></td>
          <td><input class="inventory-input" id="carro-numero-${escapeHtml(carro.numero)}" type="text" inputmode="numeric" pattern="[0-9]{1,3}" maxlength="3" value="${escapeHtml(carro.numero)}" aria-label="Nuevo número para el carro ${escapeHtml(carro.numero)}"></td>
          <td><div class="inventory-actions"><button class="btn btn-sm" onclick="guardarCarro(${escapeHtml(carro.numero)})">Guardar</button>
            <button class="btn btn-sm btn-danger-outline" onclick="eliminarCarro(${escapeHtml(carro.numero)})">Eliminar</button></div></td>
        </tr>`).join('')}</tbody></table></div>`
      : '<p class="empty-state">Todavía no hay carros.</p>';
  }
  renderUbicacionesManager();
  const select = document.getElementById('notebookCarro');
  if(select){
    const selected = select.value;
    select.innerHTML = carros.map(carro=>`<option value="${escapeHtml(carro.numero)}">Carro ${escapeHtml(carro.numero)}</option>`).join('');
    if(selected && carros.some(carro=>String(carro.numero)===selected)) select.value = selected;
    select.disabled = carros.length===0;
  }
}

function renderUbicacionesManager(){
  const list = document.getElementById('ubicacionesList');
  if(!list) return;
  list.innerHTML = ubicaciones.length
    ? `<div class="inventory-table-scroll"><table class="inventory-table inventory-table-locations"><thead><tr><th>Ubicación</th><th>Slug</th><th>Acciones</th></tr></thead><tbody>${ubicaciones.map(location=>`
      <tr><td><input class="inventory-input" id="ubicacion-${escapeHtml(location.slug)}" type="text" maxlength="50" minlength="2" value="${escapeHtml(location.nombre)}" aria-label="Nombre de ${escapeHtml(location.nombre)}"></td>
      <td class="mono">${escapeHtml(location.slug)}</td>
      <td><div class="inventory-actions"><button class="btn btn-sm" onclick="renombrarUbicacion(${escapeHtml(JSON.stringify(location.slug))})">Guardar</button>
      <button class="btn btn-sm btn-danger-outline" onclick="eliminarUbicacion(${escapeHtml(JSON.stringify(location.slug))})">Eliminar</button></div></td></tr>`).join('')}</tbody></table></div>`
    : '<p class="empty-state">Todavía no hay ubicaciones.</p>';
}

function actualizarContadorUbicacion(){
  const input = document.getElementById('ubicacionNombre');
  const counter = document.getElementById('ubicacionNombreCounter');
  if(input && counter) counter.textContent = `${input.value.length}/50`;
}

async function crearUbicacion(event){
  event.preventDefault();
  const input = document.getElementById('ubicacionNombre');
  try{
    await apiRequest('/api/admin/ubicaciones', {
      method:'POST', body:JSON.stringify({nombre:input.value})
    });
    input.value = '';
    actualizarContadorUbicacion();
    await cargarEstadoAPI();
    renderAll();
    showToast('Ubicación creada.', 'success');
  }catch(error){ showToast(error.message, 'warn'); }
}

async function renombrarUbicacion(slug){
  const nombre = document.getElementById(`ubicacion-${slug}`).value;
  try{
    await apiRequest(`/api/admin/ubicaciones/${encodeURIComponent(slug)}`, {
      method:'PATCH', body:JSON.stringify({nombre})
    });
    await cargarEstadoAPI();
    renderAll();
    showToast('Ubicación actualizada.', 'success');
  }catch(error){ showToast(error.message, 'warn'); }
}

async function eliminarUbicacion(slug){
  const location = ubicaciones.find(item=>item.slug===slug);
  if(!location || !window.confirm(`¿Eliminar la ubicación ${location.nombre}?`)) return;
  try{
    await apiRequest(`/api/admin/ubicaciones/${encodeURIComponent(slug)}`, {method:'DELETE'});
    await cargarEstadoAPI();
    renderAll();
    showToast('Ubicación eliminada.', 'success');
  }catch(error){ showToast(error.message, 'warn'); }
}

function renderReservaCarros(){
  const select = document.getElementById('resCarro');
  if(!select) return;
  const status = document.getElementById('resCarroStatus');
  const retry = document.getElementById('resCarroRetry');
  const selected = select.value;
  const locationSelect = document.getElementById('resUbicacion');
  if(locationSelect){
    const currentLocation = locationSelect.value || 'todas';
    locationSelect.innerHTML = '<option value="todas">Todas</option>'
      + ubicaciones.map(location=>`<option value="${escapeHtml(location.slug)}">${escapeHtml(location.nombre)}</option>`).join('');
    locationSelect.value = ubicaciones.some(location=>location.slug===currentLocation) || currentLocation==='todas'
      ? currentLocation
      : 'todas';
  }
  const ubicacion = document.getElementById('resUbicacion')?.value || 'todas';
  const filteredCarros = ubicacion==='todas' ? carros : carros.filter(carro=>carro.ubicacion===ubicacion);
  const options = filteredCarros.map(carro=>`<option value="${escapeHtml(carro.numero)}" ${Number(carro.disponibles)===0?'disabled':''}>Carro ${escapeHtml(carro.numero)} · ${escapeHtml(carro.disponibles ?? 0)} disponibles</option>`).join('');
  if(reservationCarrosLoading){
    select.innerHTML = '<option value="">Cargando carros...</option>';
  }else if(reservationCarrosError){
    select.innerHTML = '<option value="">No se pudieron cargar los carros</option>';
  }else if(!carros.length){
    select.innerHTML = '<option value="">No hay carros cargados</option>';
  }else if(!filteredCarros.length){
    select.innerHTML = '<option value="">No hay carros en esta ubicación</option>';
  }else{
    select.innerHTML = '<option value="">Seleccioná un carro</option>'+options;
  }
  if(selected && filteredCarros.some(carro=>String(carro.numero)===selected && Number(carro.disponibles)>0)) select.value = selected;
  const hasAvailableCarros = !reservationCarrosLoading && !reservationCarrosError
    && filteredCarros.some(carro=>Number(carro.disponibles)>0);
  select.disabled = !hasAvailableCarros;
  select.required = Boolean(hasAvailableCarros && document.getElementById('view-reservas')?.classList.contains('active'));
  status.hidden = reservationCarrosLoading || (!reservationCarrosError && hasAvailableCarros);
  status.textContent = reservationCarrosError || (!carros.length && !reservationCarrosLoading
    ? 'No hay carros disponibles para reservar.'
    : !filteredCarros.length ? 'No hay carros en la ubicación seleccionada.'
      : 'Los carros disponibles actualmente tienen 0 notebooks.');
  retry.hidden = !reservationCarrosError;
  actualizarControlesReserva();
}

async function cargarCarrosReserva(){
  reservationCarrosLoading = true;
  reservationCarrosError = '';
  renderReservaCarros();
  try{
    const data = await apiRequest(currentUser?.rol==='admin' ? '/api/admin/carros' : '/api/carros');
    if(!Array.isArray(data.carros)) throw new Error('La respuesta de carros no es válida.');
    carros = data.carros;
    ubicaciones = data.ubicaciones || [];
  }catch(error){
    reservationCarrosError = error.message;
  }finally{
    reservationCarrosLoading = false;
    renderReservaCarros();
    actualizarControlesReserva();
  }
}

function renderFallaNotebookOptions(){
  const select = document.getElementById('fallaNotebook');
  if(!select) return;
  const selected = select.value;
  select.innerHTML = '<option value="">Seleccioná una notebook</option>'
    + ticketNotebookHistory.map(notebook=>`<option value="${escapeHtml(notebook.codigo)}">${escapeHtml(notebook.codigo)} · último uso ${escapeHtml(formatBusinessDateTime(notebook.ultimo_uso, {dateStyle:'short'}))}</option>`).join('')
    + '<option value="otro">Otra / no sé</option>';
  if([...select.options].some(option=>option.value===selected)) select.value = selected;
}

async function crearCarro(e){
  e.preventDefault();
  const input = document.getElementById('carroNumero');
  const error = document.getElementById('carroError');
  if(!/^\d{1,3}$/.test(input.value) || Number(input.value)<1){
    error.textContent = 'El número de carro debe contener de 1 a 3 dígitos, entre 1 y 999.';
    return;
  }
  try{
    await apiRequest('/api/admin/carros', {method:'POST', body:JSON.stringify({numero:Number(input.value)})});
    document.getElementById('carroForm').reset();
    error.textContent = '';
    await cargarEstadoAPI();
    renderAll();
    showToast('Carro agregado correctamente.', 'success');
  }catch(requestError){
    error.textContent = requestError.message;
    showToast(requestError.message, 'warn');
  }
}

async function crearNotebooks(e){
  e.preventDefault();
  const numero = document.getElementById('notebookNumero').value;
  const carro_id = Number(document.getElementById('notebookCarro').value);
  const cantidad = Number(document.getElementById('notebookCantidad').value);
  const error = document.getElementById('notebookError');
  if(!/^\d{1,3}$/.test(numero) || Number(numero)<1 || Number(numero)+cantidad-1>999){
    error.textContent = 'El número debe estar entre 1 y 999 y la serie no puede superar 999.';
    return;
  }
  if(!Number.isInteger(cantidad) || cantidad<1 || cantidad>10 || !carro_id){
    error.textContent = 'Seleccioná un carro y una cantidad de 1 a 10.';
    return;
  }
  try{
    await apiRequest('/api/admin/notebooks', {method:'POST', body:JSON.stringify({numero, carro_id, cantidad})});
    document.getElementById('notebookForm').reset();
    error.textContent = '';
    await cargarEstadoAPI();
    renderAll();
    showToast('Notebooks agregadas correctamente.', 'success');
  }catch(requestError){
    error.textContent = requestError.message;
    showToast(requestError.message, 'warn');
  }
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
function closeModal(id){
  document.getElementById(id).classList.remove('open');
  if(id==='rolePasswordModal' && rolePasswordResolver){
    const resolve = rolePasswordResolver;
    rolePasswordResolver = null;
    resolve(null);
  }
}
document.querySelectorAll('.modal-overlay').forEach(m=>{
  m.addEventListener('click', e=>{ if(e.target===m) closeModal(m.id); });
});

function solicitarPasswordAdministrador(nombre){
  return new Promise(resolve=>{
    rolePasswordResolver = resolve;
    document.getElementById('rolePasswordMessage').textContent =
      `Confirmá tu contraseña para ascender a ${nombre} a administrador.`;
    document.getElementById('roleAdminPassword').value = '';
    openModal('rolePasswordModal');
    document.getElementById('roleAdminPassword').focus();
  });
}

function confirmarPasswordAdmin(){
  const password = document.getElementById('roleAdminPassword').value;
  document.getElementById('rolePasswordModal').classList.remove('open');
  if(!rolePasswordResolver) return;
  const resolve = rolePasswordResolver;
  rolePasswordResolver = null;
  resolve(password);
}

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
    .filter(r=>r.ownerDni===currentUser.dni && r.estado!=='rechazada')
    .sort((a,b)=>a.fecha.localeCompare(b.fecha))[0];
  const ticketsAbiertos = tickets.filter(t=>t.ownerDni===currentUser.dni && t.estado!=='resuelto').length;
  const prestamos = prestamosActivos[currentUser.dni] || [];
  const prestamo = prestamos[0];

  let html = '';

  if(prestamo && !prestamo.pendiente){
    html += `
      <div class="action-card" style="cursor:default;margin-bottom:.8rem;">
        <div class="action-icon" style="background:var(--blue-bg);color:var(--blue-text);">💻</div>
        <div class="action-info"><h4>${prestamos.length>1?`Tenés ${prestamos.length} notebooks en tu poder`:`Tenés ${escapeHtml(prestamo.id)} en tu poder`}</h4><p>Vence ${escapeHtml(prestamo.vence)}</p></div>
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
  tbody.innerHTML = notebooks.length ? notebooks.map(nb=>`
    <tr>
      <td class="mono">${escapeHtml(nb.id)}</td>
      <td><span class="badge ${escapeHtml(badgeClass[nb.estado])}">${escapeHtml(badgeLabel[nb.estado])}</span></td>
      <td>${escapeHtml(nb.ubicacion)}</td>
      <td>${escapeHtml(nb.prestadoA || '—')}</td>
      <td>${escapeHtml(nb.act)}</td>
      <td>
        ${renderAdminStateSelect(`Cambiar estado de ${escapeHtml(nb.id)}`, nb.estado, estadosNotebookManuales, 'notebook', nb.id)}
      </td>
      <td>${renderNotebookCarroSelect(nb)}</td>
    </tr>`).join('')
  : '<tr><td colspan="7"><p class="empty-state">Todavía no hay notebooks en el inventario.</p></td></tr>';
}

function renderNotebookCarroSelect(notebook){
  const options = carros.map(carro=>`<option value="${escapeHtml(carro.numero)}" ${Number(notebook.carro_id)===Number(carro.numero)?'selected':''}>Carro ${escapeHtml(carro.numero)}</option>`).join('');
  return `<select class="inventory-select" aria-label="Cambiar carro de ${escapeHtml(notebook.id)}"
    data-current-carro="${escapeHtml(notebook.carro_id ?? '')}"
    ${carros.length?'':'disabled'}
    onchange="cambiarCarroNotebook('${escapeHtml(notebook.id)}', this)">
    <option value="" ${notebook.carro_id===null?'selected':''} disabled>Sin carro</option>${options}
  </select>`;
}

async function cambiarCarroNotebook(codigo, select){
  const previous = select.dataset.currentCarro;
  const carro = select.value;
  if(!carro || carro===previous) return;
  select.disabled = true;
  try{
    await apiRequest(`/api/notebooks/${encodeURIComponent(codigo)}`, {
      method:'PATCH', body:JSON.stringify({carro:Number(carro)})
    });
    await cargarEstadoAPI();
    renderAll();
    showToast(`Notebook ${codigo} trasladada al carro ${carro}.`, 'success');
  }catch(error){
    select.value = previous;
    select.disabled = false;
    showToast(error.message, 'warn');
  }
}

function renderAdminStateSelect(label, current, states, kind, id){
  const choices = states.map(state=>{
    const stateLabel = kind==='ticket' ? ticketBadgeLabel[state] : badgeLabel[state];
    return `<option value="${escapeHtml(state)}" ${current===state?'selected':''}>${escapeHtml(stateLabel)}</option>`;
  }).join('');
  const selectClass = kind==='notebook' ? 'inventory-select' : 'btn btn-sm';
  return `<select class="${selectClass}" aria-label="${escapeHtml(label)}" data-state-kind="${escapeHtml(kind)}"
    data-state-id="${escapeHtml(id)}" data-current-state="${escapeHtml(current)}" onchange="adminChangeState(this)">
    ${states.includes(current) ? '' : '<option value="" selected disabled>—</option>'}${choices}
  </select>`;
}

async function adminChangeState(select){
  const {stateKind:kind, stateId:id, currentState:previous} = select.dataset;
  const next = select.value;
  const allowed = kind==='ticket' ? Object.keys(ticketBadgeLabel) : estadosNotebookManuales;
  if(!allowed.includes(next) || next===previous) return;
  select.disabled = true;
  try{
    const path = kind==='ticket'
      ? '/api/tickets/'+encodeURIComponent(id)
      : '/api/notebooks/'+encodeURIComponent(id);
    await apiRequest(path, {method:'PATCH', body:JSON.stringify({estado:next})});
    await cargarEstadoAPI();
    renderAll();
    const label = kind==='ticket' ? ticketBadgeLabel[next] : badgeLabel[next];
    showToast(`${kind==='ticket'?'Ticket':'Notebook'} ${id} actualizado a ${label.toLowerCase()}.`, 'success');
  }catch(error){
    select.value = previous;
    select.disabled = false;
    showToast(error.message, 'warn');
  }
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
  const prestamos = prestamosActivos[currentUser.dni] || [];
  if(!prestamos.length){
    wrap.innerHTML = `<div class="empty-state">
      <div class="glyph">✅</div>
      <h4>No tenés notebooks en préstamo</h4>
      <p>Cuando reserves y retires un equipo, va a aparecer acá.</p>
    </div>`;
    return;
  }
  wrap.innerHTML = prestamos.map(prestamo=>{
    const remaining = Math.ceil((new Date(prestamo.venceAt).getTime()-Date.now())/60_000);
    const countdown = remaining >= 0 ? `Vence en ${remaining} min` : `Vencido hace ${Math.abs(remaining)} min`;
    return `
    <div class="action-card" style="cursor:default;margin-bottom:.8rem;">
      <div class="action-icon" style="background:var(--blue-bg);color:var(--blue-text);">💻</div>
      <div class="action-info"><h4>${escapeHtml(prestamo.id)}</h4><p>Entregada. La devolución la registra el administrador · Retirada ${escapeHtml(prestamo.desde)} · Vence ${escapeHtml(prestamo.vence)} · ${escapeHtml(countdown)}</p></div>
      ${prestamo.vencido ? '<span class="badge badge-vencido">Plazo vencido</span>' : ''}
    </div>`;
  }).join('');
  renderLoanReminders();
}

function renderLoanReminders(){
  const home = document.getElementById('homeLoanReminder');
  const loansBanner = document.getElementById('loansReminderBanner');
  if(!home || !loansBanner) return;
  const minutes = Number(currentUser?.preferencias?.recordatorio || 0);
  const loans = prestamosActivos[currentUser?.dni] || [];
  const dueSoon = minutes > 0 ? loans.map(loan=>({
    notebook:loan.id,
    remaining:Math.ceil((new Date(loan.venceAt).getTime()-Date.now())/60_000)
  })).filter(loan=>loan.remaining >= 0 && loan.remaining <= minutes) : [];
  const html = dueSoon.map(loan=>
    `<p>Notebook ${escapeHtml(loan.notebook)}: vence en ${escapeHtml(loan.remaining)} min.</p>`
  ).join('');
  home.innerHTML = html;
  loansBanner.innerHTML = html;
  home.hidden = dueSoon.length===0;
  loansBanner.hidden = dueSoon.length===0;
}

function renderHistorialPrestamos(){
  const tbody = document.getElementById('historialPrestamosTable');
  if(!tbody) return;
  if(historialPrestamos.length===0){
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">
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
    const horaDevolucion = loan.hora_devolucion ? String(loan.hora_devolucion).slice(0,5) : '—';
    const horaPrevista = loan.hora_prevista ? String(loan.hora_prevista).slice(0,5) : '—';
    const overdueLabel = loan.estado==='activo' && loan.vencido ? ' · Plazo vencido' : '';
    return `<tr><td class="mono">${escapeHtml(loan.notebook)}</td><td>${escapeHtml(retirada)}</td><td>${escapeHtml(horaDevolucion)}</td><td>${escapeHtml(horaPrevista)}</td><td>${escapeHtml(devuelta)}</td><td><span class="badge ${escapeHtml(badge)}">${escapeHtml(label+overdueLabel)}</span></td></tr>`;
  }).join('');
}

/* ======================================================================
   ADMIN · HISTORIAL DE DEVOLUCIONES
====================================================================== */
function renderDevoluciones(message=''){
  const wrap = document.getElementById('devolucionesWrap');
  if(!wrap) return;
  if(message){
    wrap.textContent = message;
    return;
  }
  if(!historialDevoluciones.length){
    wrap.innerHTML = `<div class="empty-state">
      <div class="glyph">📚</div>
      <h4>No hay devoluciones registradas</h4>
      <p>Las recepciones confirmadas aparecerán acá.</p>
    </div>`;
    return;
  }
  wrap.innerHTML = `<div class="inventory-table-scroll"><table class="inventory-table">
    <thead><tr><th>Notebook</th><th>Devolvió</th><th>DNI</th><th>Préstamo</th><th>Recibió</th><th>Fecha y hora</th><th>Estado</th></tr></thead>
    <tbody>${historialDevoluciones.map(item=>{
      const state = item.demorada ? 'Devuelta con demora' : 'Devuelta a tiempo';
      return `<tr><td class="mono">${escapeHtml(item.notebook)}</td>
        <td>${escapeHtml(item.nombre)}</td><td>${escapeHtml(item.dni)}</td>
        <td class="mono">#${escapeHtml(item.loan_id)}</td>
        <td>${escapeHtml(item.recibido_por || '—')}</td>
        <td>${escapeHtml(item.devuelta_at ? formatBusinessDateTime(item.devuelta_at) : '—')}</td>
        <td><span class="badge ${item.demorada?'badge-vencido':'badge-resuelto'}">${state}</span></td></tr>`;
    }).join('')}</tbody></table></div>`;
}

async function buscarHistorialDevoluciones(query=''){
  if(!authToken || rolActivo!=='admin') return;
  const search = query.trim();
  const url = `/api/admin/returns?estado=confirmada${search ? `&q=${encodeURIComponent(search)}` : ''}`;
  renderDevoluciones('Cargando historial de devoluciones…');
  try{
    const data = await apiRequest(url);
    historialDevoluciones = data.returns;
    renderDevoluciones();
  }catch(error){
    historialDevoluciones = [];
    renderDevoluciones(error.message);
  }
}

function programarBusquedaHistorialDevoluciones(value){
  if(returnHistorySearchTimer) clearTimeout(returnHistorySearchTimer);
  returnHistorySearchTimer = setTimeout(()=>void buscarHistorialDevoluciones(value),300);
}

function mensajeErrorDevolucion(error){
  return error?.status >= 500
    ? 'No se pudo registrar la devolución. Revisá el estado del préstamo e intentá de nuevo'
    : error.message;
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
  const hoy = businessDateParts(new Date());
  const fechaActual = `${hoy.year}-${hoy.month}-${hoy.day}`;

  if(y !== Number(hoy.year)){
    return {valid:false, msg:`Las reservas solo pueden hacerse durante el año ${hoy.year}.`};
  }

  if(fechaStr < fechaActual || (fechaStr === fechaActual && `${horaStr}:00` <= `${hoy.hour}:${hoy.minute}:00`)){
    return {valid:false, msg:'La fecha y hora de reserva deben ser futuras (hora de Buenos Aires).'};
  }

  const diaSemana = new Date(Date.UTC(y, m-1, d)).getUTCDay();
  if(diaSemana===0 || diaSemana===6){
    return {valid:false, msg:'Sólo se puede reservar de lunes a viernes (días hábiles).'};
  }

  const minutosDelDia = hh*60+mm;
  const dentroDeHorario = (minutosDelDia >= 8*60 && minutosDelDia <= 11*60+50)
    || (minutosDelDia >= 13*60+30 && minutosDelDia <= 17*60+40);
  if(!dentroDeHorario){
    return {valid:false, msg:'Solo se puede reservar de 08:00 a 11:50 y de 13:30 a 17:40.'};
  }

  return {valid:true, msg:''};
}

function validarHoraDevolucionReserva(horaRetiro, horaDevolucion){
  if(!horaDevolucion) return 'Completá la hora de devolución.';
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(horaDevolucion)
    || horaDevolucion <= horaRetiro || horaDevolucion > '17:30'){
    return 'La hora de devolución debe ser posterior al retiro y no superar las 17:30 (Buenos Aires).';
  }
  return '';
}

async function crearReservaAPI(e){
  if(reservationSubmitting) return;
  const fecha = document.getElementById('resFecha').value;
  const hora = document.getElementById('resHora').value;
  const horaDevolucion = document.getElementById('resHoraDevolucion').value;
  const esLote = rolActivo==='profesor' && document.getElementById('loteToggle').checked;
  const cantidad = esLote ? Number(document.getElementById('loteCantidad').value) : (rolActivo==='profesor' ? Number(document.getElementById('resCantidad').value) : 1);
  const anio = document.getElementById('resCursoAnio').value;
  const division = document.getElementById('resCursoDivision').value;
  const curso = rolActivo==='profesor' && anio && division ? `${anio}°${division}°` : null;
  const motivoInput = document.getElementById('resMotivo').value;
  const motivo = motivoInput.trim();
  const carro = document.getElementById('resCarro').value;
  const errorBox = document.getElementById('resFechaError');
  const check = validarFechaHora(fecha, hora);
  if(!check.valid){ errorBox.textContent = check.msg; showToast(check.msg, 'warn'); return; }
  const returnTimeError = validarHoraDevolucionReserva(hora, horaDevolucion);
  if(returnTimeError){ errorBox.textContent = returnTimeError; showToast(returnTimeError, 'warn'); return; }
  if(!carro){
    errorBox.textContent = 'Seleccioná un carro con notebooks disponibles.';
    showToast(errorBox.textContent, 'warn');
    return;
  }
  if(rolActivo==='profesor' && (!curso || !/^[1-7]°(?:[1-9]|[1-9]\d)°$/.test(curso))){
    errorBox.textContent = 'Ingresá un año de 1 a 7 y una división de 1 a 99.';
    showToast(errorBox.textContent, 'warn');
    return;
  }
  if(motivoInput && !motivo){
    errorBox.textContent = 'El motivo no puede estar vacío';
    showToast(errorBox.textContent, 'warn');
    return;
  }
  if(motivo.length>50){
    errorBox.textContent = 'El motivo no puede superar 50 caracteres.';
    showToast(errorBox.textContent, 'warn');
    return;
  }
  const cantidadValida = esLote ? cantidad >= 3 && cantidad <= 10
    : cantidad >= 1 && cantidad <= (rolActivo==='profesor' ? 2 : 1);
  if(!Number.isInteger(cantidad) || !cantidadValida){
    errorBox.textContent = esLote ? 'Un lote debe incluir entre 3 y 10 notebooks.' : 'Una solicitud individual admite hasta 2 notebooks.';
    showToast(errorBox.textContent, 'warn');
    return;
  }
  reservationSubmitting = true;
  actualizarControlesReserva();
  try{
    await apiRequest('/api/reservations', {method:'POST', body:JSON.stringify({
      tipo:esLote ? 'lote' : 'individual', cantidad, curso, carro,
      ubicacion:document.getElementById('resUbicacion').value,
      retiroAt:`${fecha}T${hora}:00`, horaDevolucion, motivo
    })});
    document.getElementById('reservaForm').reset();
    document.getElementById('loteToggle').checked = false;
    toggleLoteBlock();
    await cargarEstadoAPI();
    renderAll();
    showToast(esLote ? 'Solicitud de lote enviada a aprobación.' : 'Solicitud enviada a aprobación.', 'success');
  }catch(error){
    errorBox.textContent = error.message;
    showToast(error.message, 'warn');
  }finally{
    reservationSubmitting = false;
    actualizarControlesReserva();
  }
}

async function crearReserva(e){
  e.preventDefault();
  await crearReservaAPI(e);
}

async function cancelarReserva(id){
  try{
    await apiRequest('/api/reservations/'+encodeURIComponent(id), {method:'DELETE'});
    await cargarEstadoAPI();
    renderAll();
    showToast('Reserva cancelada.', 'warn');
  }catch(error){ showToast(error.message, 'warn'); }
}

function renderReservas(){
  const wrap = document.getElementById('reservasListWrap');
  if(!wrap || !currentUser) return;
  actualizarControlesReserva();
  const propias = reservas.filter(r=>r.ownerDni===currentUser.dni);
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
        <p>Retiro ${escapeHtml(formatFecha(r.fecha))} · ${escapeHtml(r.hora)} · Devolución ${escapeHtml(r.horaDevolucion || '—')} — ${escapeHtml(r.motivo)}</p>
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
  const adminReservations = reservas.filter(r=>!['cancelada','retirada'].includes(r.estado));
  if(adminReservations.length===0){
    wrap.innerHTML = `<div class="empty-state">
      <div class="glyph">📦</div>
      <h4>No hay solicitudes de préstamo</h4>
      <p>Las reservas individuales y por lote aparecerán acá.</p>
    </div>`;
    badge.style.display = 'none';
    return;
  }
  const actionable = adminReservations.filter(r=>['pendiente_aprobacion','confirmada','aprobada'].includes(r.estado)).length;
  badge.style.display = actionable ? 'inline-flex' : 'none';
  badge.textContent = actionable;
  const labels = {
    pendiente_aprobacion:'Pendiente de aprobación', confirmada:'Confirmada', aprobada:'Aprobada',
    rechazada:'Rechazada'
  };
  const priority = {confirmada:0, aprobada:0, pendiente_aprobacion:1, rechazada:2};
  wrap.innerHTML = [...adminReservations].sort((a,b)=>
    (priority[a.estado] ?? 2) - (priority[b.estado] ?? 2) || b.fecha.localeCompare(a.fecha)
  ).map(r=>{
    const canApprove = r.estado==='pendiente_aprobacion';
    const canReject = ['pendiente_aprobacion','aprobada'].includes(r.estado);
    const canCheckout = ['confirmada','aprobada'].includes(r.estado);
    const heading = r.curso ? `${r.curso} · ${r.cantidad} equipos` : `${r.cantidad} · ${r.tipo==='lote'?'Lote':'Individual'}`;
    return `<div class="action-card" style="cursor:default;margin-bottom:.8rem;">
      <div class="action-icon" style="background:${r.tipo==='lote'?'var(--purple-bg)':'var(--blue-bg)'};color:${r.tipo==='lote'?'var(--purple-text)':'var(--blue-text)'};">${r.tipo==='lote'?'👥':'📅'}</div>
      <div class="action-info">
        <h4>${escapeHtml(heading)}</h4>
        <p>${escapeHtml(r.ownerNombre)} · Retiro ${escapeHtml(formatFecha(r.fecha))} ${escapeHtml(r.hora)} · Devolución ${escapeHtml(r.horaDevolucion || '—')} · ${escapeHtml(r.motivo || 'Sin especificar')}</p>
      </div>
      <span class="badge">${escapeHtml(labels[r.estado] || r.estado)}</span>
      ${canApprove && r.tipo==='lote'?`<button class="btn btn-sm btn-primary" onclick="aprobarYEntregar(${escapeHtml(JSON.stringify(r.id))})">Aprobar y entregar</button>`:''}
      ${canApprove && r.tipo!=='lote'?`<button class="btn btn-sm btn-success-outline" onclick="aprobarSolicitud(${escapeHtml(JSON.stringify(r.id))})">Aprobar</button>`:''}
      ${canReject?`<button class="btn btn-sm btn-danger-outline" onclick="pedirRechazoSolicitud(${escapeHtml(JSON.stringify(r.id))})">Rechazar</button>`:''}
      ${canCheckout?`<button class="btn btn-sm btn-primary" onclick="registrarRetiro(${escapeHtml(JSON.stringify(r.id))})">Registrar entrega</button>`:''}
    </div>`;
  }).join('');
}

async function aprobarSolicitud(id){
  const r = reservas.find(x=>x.id===id);
  if(!r || r.estado!=='pendiente_aprobacion') return;
  try{
    await apiRequest(`/api/admin/reservations/${id}/approve`, {method:'POST'});
    await cargarEstadoAPI();
    renderAll();
    showToast('Solicitud aprobada.', 'success');
  }catch(error){ showToast(error.message, 'warn'); }
}

async function registrarRetiro(id){
  const r = reservas.find(reserva=>reserva.id===id);
  if(!r) return;
  try{
    const result = await apiRequest(`/api/admin/reservations/${id}/checkout`, {method:'POST'});
    await cargarEstadoAPI();
    renderAll();
    showToast(`${result.loansCreated || 0} préstamo(s) creado(s).`, 'success');
  }catch(error){ showToast(error.message, 'warn'); }
}

async function aprobarYEntregar(id){
  try{
    const result = await apiRequest(`/api/admin/reservations/${id}/approve-checkout`, {method:'POST'});
    await cargarEstadoAPI();
    renderAll();
    showToast(`${result.loansCreated || 0} préstamo(s) entregado(s).`, 'success');
  }catch(error){ showToast(error.message, 'warn'); }
}

function buscarReservasAdmin(value){
  if(reservationsSearchTimer) clearTimeout(reservationsSearchTimer);
  const query = value.trim();
  const results = document.getElementById('adminReservationSearchWrap');
  const list = document.getElementById('lotesWrap');
  if(query.length < 2){
    results.hidden = true;
    list.hidden = false;
    return;
  }
  reservationsSearchTimer = setTimeout(async()=>{
    try{
      const data = await apiRequest(`/api/admin/reservations?q=${encodeURIComponent(query)}`);
      list.hidden = true;
      results.hidden = false;
      if(!data.reservations.length){
        results.innerHTML = '<p class="hint">No se encontraron solicitudes pendientes de entrega.</p>';
        return;
      }
      results.innerHTML = data.reservations.map((item)=>{
        const heading = item.curso ? `${item.curso} · ${item.cantidad} equipos` : `${item.cantidad} · ${item.tipo}`;
        const approveAndDeliver = item.estado==='pendiente_aprobacion' && item.tipo==='lote'
          ? `<button class="btn btn-sm btn-primary" onclick="aprobarYEntregar(${escapeHtml(JSON.stringify(item.id))})">Aprobar y entregar</button>` : '';
        const approve = item.estado==='pendiente_aprobacion' && item.tipo!=='lote'
          ? `<button class="btn btn-sm btn-success-outline" onclick="aprobarSolicitud(${escapeHtml(JSON.stringify(item.id))})">Aprobar</button>` : '';
        const checkout = ['confirmada','aprobada'].includes(item.estado)
          ? `<button class="btn btn-sm btn-primary" onclick="registrarRetiro(${escapeHtml(JSON.stringify(item.id))})">Registrar entrega</button>` : '';
        const reject = ['pendiente_aprobacion','aprobada'].includes(item.estado)
          ? `<button class="btn btn-sm btn-danger-outline" onclick="pedirRechazoSolicitud(${escapeHtml(JSON.stringify(item.id))})">Rechazar</button>` : '';
        return `<div class="action-card" style="cursor:default;margin:.7rem 0">
          <div class="action-info"><h4>${escapeHtml(heading)}</h4><p>${escapeHtml(item.nombre)} · ${escapeHtml(item.email)}</p></div>
          <span class="badge">${escapeHtml(item.estado)}</span>${approveAndDeliver}${approve}${checkout}${reject}
        </div>`;
      }).join('');
    }catch(error){
      results.hidden = false;
      results.textContent = error.message;
    }
  },300);
}

function programarBusquedaPrestamos(value){
  if(circulationSearchTimer) clearTimeout(circulationSearchTimer);
  const query = value.trim();
  circulationSearchTimer = setTimeout(()=>void buscarPrestamosAdmin(query),300);
}

async function buscarPrestamosAdmin(query=''){
  if(!authToken || rolActivo!=='admin') return;
  try{
    const search = query.trim();
    const suffix = search ? `&q=${encodeURIComponent(search)}` : '';
    const data = await apiRequest(`/api/admin/loans?estado=pendientes${suffix}`);
    circulationLoans = data.loans;
    renderCirculationLoans();
  }catch(error){
    renderCirculationLoans(error.message);
  }
}

function renderCirculationLoans(message=''){
  const wrap = document.getElementById('circulationResults');
  if(!wrap) return;
  if(message){
    wrap.textContent = message;
    return;
  }
  if(!circulationLoans.length){
    wrap.innerHTML = '<p class="hint">No hay préstamos pendientes de devolución.</p>';
    return;
  }
  const groups = new Map();
  for(const loan of circulationLoans){
    const key = String(loan.user_id);
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(loan);
  }
  wrap.innerHTML = [...groups.values()].map((loans)=>{
    const first = loans[0];
    const cards = loans.map(loan=>{
      const overdue = Boolean(loan.vencido);
      const returnPending = loan.estado==='devolucion_pendiente';
      const stateLabel = returnPending ? 'Devolución informada; falta confirmar la recepción física' : 'Préstamo activo';
      return `<div class="action-card" style="cursor:default;margin:.6rem 0;${overdue?'border-color:var(--red-text);color:var(--red-text);':''}">
        <div class="action-info"><h4>${escapeHtml(loan.notebook)} · ${escapeHtml(loan.curso || 'Sin curso')}</h4>
          <p>${escapeHtml(stateLabel)} · Retirada ${escapeHtml(formatBusinessDateTime(loan.retirada_at))} · Vence ${escapeHtml(formatBusinessDateTime(loan.vence_at))}${overdue?' · VENCIDA':''}</p></div>
        <button class="btn btn-sm btn-primary" onclick="registrarDevolucionAdmin(${escapeHtml(JSON.stringify(loan.id))}, ${escapeHtml(JSON.stringify(loan.notebook))})">${returnPending?'Confirmar recepción':'Registrar devolución'}</button>
      </div>`;
    }).join('');
    const allButton = loans.length>1
      ? `<button class="btn btn-primary" onclick="registrarTodasDevolucionesAdmin(${escapeHtml(JSON.stringify(loans.map(loan=>loan.id)))})">Registrar todas (${loans.length})</button>`
      : '';
    return `<section class="card" style="margin-top:1rem"><h4>${escapeHtml(first.usuario)} · ${escapeHtml(first.email)} · DNI ${escapeHtml(first.dni)}</h4>${cards}${allButton}</section>`;
  }).join('');
}

async function registrarDevolucionAdmin(id, notebook){
  if(!window.confirm(`¿Registrar la devolución de ${notebook}?`)) return;
  try{
    await apiRequest(`/api/admin/loans/${id}/return`, {method:'POST'});
    showToast(`Devolución de ${notebook} registrada.`, 'success');
    await refreshAdminCirculationLoans();
  }catch(error){ showToast(mensajeErrorDevolucion(error), 'warn'); }
}

async function registrarTodasDevolucionesAdmin(ids){
  if(!window.confirm(`¿Registrar la devolución de las ${ids.length} notebooks?`)) return;
  try{
    const result = await apiRequest('/api/admin/loans/return', {
      method:'POST', body:JSON.stringify({loanIds:ids})
    });
    showToast(result.message, 'success');
    await refreshAdminCirculationLoans();
  }catch(error){ showToast(mensajeErrorDevolucion(error), 'warn'); }
}

async function refreshAdminCirculationLoans(){
  await cargarEstadoAPI();
  renderAll();
  await buscarPrestamosAdmin(document.getElementById('circulationSearch').value);
}

let pendingRejectId = null;
function pedirRechazoSolicitud(id){
  const r = reservas.find(x=>x.id===id);
  if(!r) return;
  pendingRejectId = id;
  document.getElementById('rejectLoteText').textContent = `¿Rechazar la solicitud de ${r.ownerNombre}?`;
  document.getElementById('rejectLoteConfirmBtn').onclick = confirmarRechazoSolicitud;
  openModal('rejectLoteModal');
}

async function confirmarRechazoSolicitud(){
  const r = reservas.find(x=>x.id===pendingRejectId);
  if(!r) return;
  try{
    await apiRequest(`/api/admin/reservations/${encodeURIComponent(r.id)}/reject`, {method:'POST'});
    await cargarEstadoAPI();
    renderAll();
    closeModal('rejectLoteModal');
    showToast('Solicitud rechazada.', 'warn');
  }catch(error){ showToast(error.message, 'warn'); }
}

/* ======================================================================
   REPORTAR FALLA / TICKETS
====================================================================== */
async function crearTicket(e){
  e.preventDefault();
  const nbSel = document.getElementById('fallaNotebook');
  const motivo = document.getElementById('fallaMotivo').value.trim();
  const desc = document.getElementById('fallaDesc').value.trim();
  if(!nbSel.value || !motivo || !desc){
    showToast('Completá la notebook, el motivo y la descripción.', 'warn');
    return;
  }
  if(motivo.length>50 || desc.length>50){
    showToast('El motivo y la descripción admiten hasta 50 caracteres.', 'warn');
    return;
  }
  try{
    await apiRequest('/api/tickets', {method:'POST', body:JSON.stringify({
      notebook:nbSel.value==='otro' ? null : nbSel.value, motivo, descripcion:desc
    })});
    document.getElementById('fallaForm').reset();
    await cargarEstadoAPI();
    renderAll();
    showToast('Reporte enviado al Administrador.', 'success');
    switchView('tickets');
  }catch(error){ showToast(error.message, 'warn'); }
}



function updateTicketsBadge(){
  if(!currentUser) return;
  const abiertos = tickets.filter(t=>t.estado!=='resuelto' && t.ownerDni===currentUser.dni).length;
  const badge = document.getElementById('ticketsBadge');
  if(abiertos>0){ badge.style.display='inline-flex'; badge.textContent = abiertos; }
  else{ badge.style.display='none'; }
}

function renderTicketsPropios(){
  // "Mis tickets" sólo muestra los del usuario logueado (alumno o profesor)
  const tbody = document.getElementById('ticketsTable');
  if(!tbody || !currentUser) return;
  const propios = tickets.filter(t=>t.ownerDni===currentUser.dni);
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
      <td><button class="btn btn-sm" onclick="abrirRespuestasTicket(${escapeHtml(JSON.stringify(t.id))})">Ver respuestas</button>
        ${ticketTieneRespuestaAdminSinLeer(t) ? '<span class="badge badge-progreso" aria-label="Respuesta nueva sin leer">Respuesta nueva</span>' : ''}</td>
    </tr>`).join('');
}

function ticketReplyReadKey(code){
  return `netmo_ticket_reply_read:${currentUser?.dni || currentUser?.id || 'user'}:${code}`;
}

function ticketTieneRespuestaAdminSinLeer(ticket){
  const latestReplyAt = Date.parse(ticket.latestAdminReplyAt);
  if(!Number.isFinite(latestReplyAt)) return false;
  const key = ticketReplyReadKey(ticket.id);
  let lastReadAt = ticketRepliesLastRead[key] || 0;
  try{
    lastReadAt = Math.max(lastReadAt, Number(localStorage.getItem(key)) || 0);
  }catch{}
  return latestReplyAt > lastReadAt;
}

function marcarRespuestasAdminLeidas(code, replies){
  const latestReplyAt = replies
    .filter(reply=>reply.author_role==='admin')
    .reduce((latest, reply)=>Math.max(latest, Date.parse(reply.created_at) || 0), 0);
  if(!latestReplyAt) return;
  const key = ticketReplyReadKey(code);
  ticketRepliesLastRead[key] = latestReplyAt;
  try{ localStorage.setItem(key, String(latestReplyAt)); }catch{}
  renderTicketsPropios();
}

/* ---- ADMIN: Fallas / tickets reportados por todos los usuarios ---- */
function renderAdminTickets(){
  const tbody = document.getElementById('adminTicketsTable');
  if(!tbody) return;
  if(tickets.length===0){
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
      <div class="glyph">🎫</div><h4>No hay fallas reportadas</h4><p>Los reportes de alumnos y profesores van a aparecer acá.</p>
    </div></td></tr>`;
    updateAdminTicketsBadge();
    return;
  }
  tbody.innerHTML = tickets.map(t=>{
    const nb = notebooks.find(n=>n.id===t.notebook);
    const equipoCol = nb
      ? `<span class="badge ${escapeHtml(badgeClass[nb.estado])}">${escapeHtml(badgeLabel[nb.estado])}</span>`
      : '<span class="hint">Sin equipo identificado</span>';
    return `
    <tr>
      <td class="mono">${escapeHtml(t.id)}</td>
      <td>${escapeHtml(t.ownerNombre)} <span class="hint">(${escapeHtml(rolLabel[t.ownerRol] || t.ownerRol)})</span></td>
      <td class="mono">${escapeHtml(t.notebook)}</td>
      <td>${escapeHtml(t.motivo)}</td>
      <td>
        ${renderAdminStateSelect(`Cambiar estado del ticket ${escapeHtml(t.id)}`, t.estado, Object.keys(ticketBadgeLabel), 'ticket', t.id)}
      </td>
      <td>${equipoCol}</td>
      <td><button class="btn btn-sm" onclick="abrirRespuestasTicket(${escapeHtml(JSON.stringify(t.id))})">Ver / responder</button></td>
    </tr>`;
  }).join('');
  updateAdminTicketsBadge();
}

async function abrirRespuestasTicket(code){
  activeTicketRepliesCode = code;
  document.getElementById('ticketRepliesTitle').textContent = `Respuestas · ${code}`;
  document.getElementById('ticketReplyMessage').value = '';
  actualizarContadorRespuesta();
  const canReply = currentUser?.rol==='admin';
  const form = document.getElementById('ticketReplyForm');
  const submit = document.getElementById('ticketReplySubmit');
  form.hidden = !canReply;
  form.setAttribute('aria-hidden', String(!canReply));
  form.querySelectorAll('textarea, button').forEach(control=>{ control.disabled = !canReply; });
  submit.hidden = !canReply;
  submit.disabled = !canReply;
  openModal('ticketRepliesModal');
  await cargarRespuestasTicket();
}

async function cargarRespuestasTicket(){
  if(!activeTicketRepliesCode) return;
  const thread = document.getElementById('ticketRepliesThread');
  thread.textContent = 'Cargando respuestas…';
  try{
    const data = await apiRequest(`/api/tickets/${encodeURIComponent(activeTicketRepliesCode)}/replies`);
    thread.innerHTML = data.replies.length
      ? data.replies.map(reply=>`<div class="action-card" style="cursor:default;margin:.5rem 0">
          <div class="action-info"><h4>${escapeHtml(reply.autor)} · ${escapeHtml(rolLabel[reply.author_role] || reply.author_role)}</h4>
            <p>${escapeHtml(formatBusinessDateTime(reply.created_at))}</p><p>${escapeHtml(reply.mensaje)}</p></div>
        </div>`).join('')
      : '<p class="hint">Todavía no hay respuestas.</p>';
    if(currentUser?.rol!=='admin') marcarRespuestasAdminLeidas(activeTicketRepliesCode, data.replies);
  }catch(error){ thread.textContent = error.message; }
}

function actualizarContadorRespuesta(){
  const input = document.getElementById('ticketReplyMessage');
  document.getElementById('ticketReplyCounter').textContent = `${input.value.length}/500`;
}

async function enviarRespuestaTicket(event){
  event.preventDefault();
  if(currentUser?.rol!=='admin') return;
  const input = document.getElementById('ticketReplyMessage');
  const mensaje = input.value.trim();
  if(!mensaje || mensaje.length>500){
    showToast('La respuesta debe tener entre 1 y 500 caracteres.', 'warn');
    return;
  }
  try{
    await apiRequest(`/api/tickets/${encodeURIComponent(activeTicketRepliesCode)}/replies`, {
      method:'POST', body:JSON.stringify({mensaje})
    });
    input.value = '';
    actualizarContadorRespuesta();
    await cargarRespuestasTicket();
    showToast('Respuesta enviada.', 'success');
  }catch(error){ showToast(error.message, 'warn'); }
}

async function refreshOwnTickets(){
  try{
    const data = await apiRequest('/api/tickets');
    tickets = data.tickets.map(ticket=>({
      id:ticket.id, notebook:ticket.notebook || 'otro', motivo:ticket.motivo, motivoCompleto:ticket.descripcion,
      estado:ticket.estado, fecha:formatBusinessDateTime(ticket.created_at, {dateStyle:'short'}),
      latestAdminReplyAt:ticket.latest_admin_reply_at,
      ownerDni:currentUser.dni, ownerNombre:currentUser.nombre, ownerRol:currentUser.rol
    }));
    renderTicketsPropios();
    updateTicketsBadge();
  }catch(error){
    showToast(error.message, 'warn');
  }
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

  const todosUsuarios = usuariosConTardanzas;

  if(porUsuarioBody){
    if(todosUsuarios.length===0){
      porUsuarioBody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>Todavía no hay alumnos ni profesores registrados.</p></div></td></tr>`;
    } else {
      porUsuarioBody.innerHTML = todosUsuarios.map(u=>`
        <tr>
          <td>${escapeHtml(u.nombre)}</td>
          <td>${escapeHtml(rolLabel[u.rol] || u.rol)}</td>
          <td class="mono">${escapeHtml(u.dni)}</td>
          <td>${escapeHtml(u.tardanzas ?? 0)}</td>
          <td>${(u.candidato_a_sancion ?? (u.tardanzas >= 3)) ? 'Sí' : 'No'}</td>
        </tr>`).join('');
    }
  }

  const ordenados = [...todosUsuarios].sort((a,b)=>(b.tardanzas||0)-(a.tardanzas||0) || a.nombre.localeCompare(b.nombre));
  if(ordenados.length===0){
    wrap.innerHTML = `<div class="empty-state">
      <div class="glyph">✅</div><h4>No hay alumnos ni profesores registrados</h4><p>Las cuentas creadas desde Usuarios aparecerán acá.</p>
    </div>`;
  } else {
    wrap.innerHTML = ordenados.map(u=>{
      const durationControl = `<select class="ban-duration" id="ban-duration-${escapeHtml(u.dni)}" aria-label="Duración del baneo para ${escapeHtml(u.nombre)}">
        <option value="1">1 día</option><option value="3">3 días</option><option value="7">7 días</option>
        <option value="15">15 días</option><option value="30">30 días</option><option value="indefinido">Indefinido</option>
      </select>`;
      const banAction = u.baneado
        ? `<button class="btn btn-sm btn-success-outline" onclick="cambiarBaneo(${escapeHtml(JSON.stringify(u.dni))}, false)">Desbanear</button>`
        : `${durationControl}<button class="btn btn-sm btn-danger-outline" onclick="cambiarBaneo(${escapeHtml(JSON.stringify(u.dni))}, true, document.getElementById('ban-duration-${escapeHtml(u.dni)}').value)">Banear</button>`;
      const until = u.baneado ? (u.baneado_hasta ? ` · hasta ${formatBusinessDateTime(u.baneado_hasta)}` : ' · indefinido') : '';
      return `
      <div class="action-card" style="cursor:default;margin-bottom:.8rem;${u.tardanzas>=3 && !u.baneado ? 'border-color:var(--red-text);' : ''}">
        <div class="action-icon" style="${u.tardanzas>=3 ? 'background:var(--red-bg);color:var(--red-text);' : 'background:var(--orange-bg);color:var(--orange-text);'}">${u.baneado ? '🚫' : '⏰'}</div>
        <div class="action-info">
          <h4>${escapeHtml(u.nombre)} <span class="hint">(${escapeHtml(rolLabel[u.rol] || u.rol)} · ${escapeHtml(u.dni)})</span></h4>
          <p>${escapeHtml(u.tardanzas ?? 0)} entrega${u.tardanzas===1?'':'s'} tardía${u.tardanzas===1?'':'s'} registrada${u.tardanzas===1?'':'s'}${u.tardanzas>=3 ? ' · candidato a sanción' : ''}${escapeHtml(until)}</p>
        </div>
        ${banAction}
      </div>`;
    }).join('');
  }

  const pendientesAviso = ordenados.filter(u=>u.tardanzas>=3 && !u.baneado).length;
  if(pendientesAviso>0){ badge.style.display='inline-flex'; badge.textContent = pendientesAviso; }
  else{ badge.style.display='none'; }

  if(historialTardanzas.length===0){
    tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><p>Todavía no hay entregas tardías registradas.</p></div></td></tr>';
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

async function cambiarBaneo(dni, baneado, duracion){
  const u = usuariosConTardanzas.find(x=>x.dni===dni);
  if(!u) return;
  try{
    const duracionDias = duracion === 'indefinido' || !baneado ? null : Number(duracion);
    await apiRequest('/api/admin/users/'+encodeURIComponent(dni), {
      method:'PATCH', body:JSON.stringify({baneado, duracionDias})
    });
    await refreshAdminLateReturns();
    showToast(baneado ? `Baneo de ${u.nombre} actualizado.` : `Baneo de ${u.nombre} quitado.`, baneado ? 'error' : 'success');
  }catch(error){
    showToast(error.message, 'warn');
  }
}

/* ======================================================================
   PERFIL (vista + edición)
====================================================================== */
function renderPerfil(){
  if(!currentUser) return;
  document.getElementById('profileAvatarLg').textContent = getInitials(currentUser.nombre);
  document.getElementById('profileNombre').textContent = currentUser.nombre;
  document.getElementById('profileRolCurso').textContent = rolLabel[currentUser.rol];
  document.getElementById('profileDni').textContent = currentUser.dni;
  document.getElementById('profileEmail').textContent = currentUser.email;
  const preferencias = currentUser.preferencias || {email:true, recordatorio:'30'};
  document.getElementById('preferenciasEmail').checked = preferencias.email;
  document.getElementById('preferenciasRecordatorio').value = preferencias.recordatorio;
  document.getElementById('preferenciasRecordatorioInfo').textContent =
    'Las preferencias se guardan, pero el envío de notificaciones no está disponible hasta integrar Gmail.';
}

async function actualizarPreferencias(){
  if(!currentUser) return;
  const preferencias = {
    email: document.getElementById('preferenciasEmail').checked,
    recordatorio: document.getElementById('preferenciasRecordatorio').value
  };
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
function updateReservationMinima(){
  const dateInput = document.getElementById('resFecha');
  const timeInput = document.getElementById('resHora');
  const returnTimeInput = document.getElementById('resHoraDevolucion');
  const now = businessDateParts(new Date());
  const today = `${now.year}-${now.month}-${now.day}`;
  dateInput.min = today;
  dateInput.max = `${now.year}-12-31`;
  timeInput.min = dateInput.value===today ? `${now.hour}:${now.minute}` : '08:00';
  timeInput.max = '17:40';
  returnTimeInput.max = '17:30';
  if(timeInput.value){
    const [hour, minute] = timeInput.value.split(':').map(Number);
    const nextMinute = Math.min(hour * 60 + minute + 1, 17 * 60 + 31);
    returnTimeInput.min = `${String(Math.floor(nextMinute / 60)).padStart(2, '0')}:${String(nextMinute % 60).padStart(2, '0')}`;
  }else{
    returnTimeInput.min = '08:01';
  }
}

function initializeTextLimits(){
  const selector = 'input:not([type="number"]):not([type="date"]):not([type="time"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="hidden"]), textarea';
  document.querySelectorAll(selector).forEach(input=>{
    if(['loginEmail', 'loginPassword'].includes(input.id)) return;
    const currentLimit = Number(input.getAttribute('maxlength'));
    const hasCustomLimit = input.hasAttribute('data-no-counter');
    const maximum = hasCustomLimit ? currentLimit || 50 : 50;
    if(!currentLimit || currentLimit>maximum) input.setAttribute('maxlength', String(maximum));
    const isFreeText = input.tagName==='TEXTAREA'
      || ['text', 'search', 'email', 'url', 'tel'].includes(input.type);
    if(!isFreeText || hasCustomLimit || input.inputMode==='numeric' || input.pattern?.startsWith('[0-9]')) return;
    const counter = document.createElement('span');
    counter.className = 'hint char-counter';
    counter.setAttribute('aria-live', 'polite');
    const counterMaximum = Number(input.getAttribute('maxlength')) || 50;
    const update = ()=>{ counter.textContent = `${input.value.length}/${counterMaximum}`; };
    input.insertAdjacentElement('afterend', counter);
    input.addEventListener('input', update);
    input.form?.addEventListener('reset', ()=>setTimeout(update));
    update();
  });
}

updateReservationMinima();
document.getElementById('resFecha').addEventListener('change', updateReservationMinima);
document.getElementById('resHora').addEventListener('focus', updateReservationMinima);
document.getElementById('resHora').addEventListener('input', updateReservationMinima);
document.getElementById('reservaForm').addEventListener('reset', ()=>{
  document.getElementById('resCursoPreview').textContent = 'Se enviará como A°D° (por ejemplo, 2°14°).';
  setTimeout(updateReservationMinima);
});
initializeTextLimits();
document.getElementById('ubicacionNombre').addEventListener('input', actualizarContadorUbicacion);
actualizarContadorUbicacion();
['resCursoAnio', 'resCursoDivision'].forEach(id=>{
  document.getElementById(id).addEventListener('input', ()=>{
    const anio = document.getElementById('resCursoAnio').value;
    const division = document.getElementById('resCursoDivision').value;
    document.getElementById('resCursoPreview').textContent = anio && division
      ? `Curso: ${anio}°${division}°`
      : 'Se enviará como A°D° (por ejemplo, 2°14°).';
  });
});

(function initTheme(){
  let saved = null;
  try{ saved = localStorage.getItem('netmo_theme'); }catch(err){ /* ignorar */ }
  if(!saved){ saved = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  applyTheme(saved);
})();

async function warmApi(){
  if(!API_BASE) return;
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), 30_000);
  try{
    const health = await fetch(API_BASE+'/health', {signal:controller.signal});
    if(!health.ok) throw new Error('La API todavía no está disponible. Podés volver a intentar iniciar sesión.');
  }catch(error){
    if(!loginRequestAttempted) document.getElementById('loginError').textContent = isNetworkError(error)
      ? API_CONNECTION_ERROR
      : error.message;
  }finally{
    clearTimeout(timeout);
  }
}

async function restoreSavedSession(){
  let localToken;
  let tabToken;
  try{
    localToken = window.localStorage.getItem('netmo_token');
    tabToken = window.sessionStorage.getItem('netmo_token');
  }catch{
    document.getElementById('loginError').textContent = 'No se pudo leer la sesión guardada en este navegador.';
    return;
  }
  const savedToken = localToken || tabToken;
  if(!savedToken) return;
  authToken = savedToken;
  persistSession = Boolean(localToken);
  try{
    await refreshSessionIfNeeded();
    const result = await apiRequest('/api/me');
    currentUser = result.user;
    rolActivo = currentUser.rol;
    await cargarEstadoAPI();
    document.getElementById('loginForm').reset();
    document.getElementById('loginError').textContent = '';
    iniciarSesion();
  }catch(error){
    if(authToken) document.getElementById('loginError').textContent = isNetworkError(error)
      ? API_CONNECTION_ERROR
      : error.message;
  }
}

void warmApi();
void restoreSavedSession();
