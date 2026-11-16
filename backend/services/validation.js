const { AppError } = require('../errors');

const MAX_TEXT_LENGTH = 50;
// Reuse this allowlist when implementing public account registration.
const ALLOWED_EMAIL_DOMAINS = Object.freeze(['bue.edu.ar', 'alu.bue.edu.ar', 'gmail.com']);

function requiredText(value, label, maximum = MAX_TEXT_LENGTH, { minimum = 1 } = {}) {
  if (typeof value !== 'string') throw new AppError(`${label} es obligatorio`, 400);
  const text = value.trim();
  if (!text) throw new AppError(`${label} no puede estar vacío`, 400);
  if (text.length < minimum) throw new AppError(`${label} debe tener al menos ${minimum} caracteres`, 400);
  if (text.length > maximum) throw new AppError(`${label} no puede superar ${maximum} caracteres`, 400);
  return text;
}

function personName(value, label) {
  const name = requiredText(value, label, MAX_TEXT_LENGTH, { minimum: 2 }).normalize('NFC');
  if (!/^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u.test(name)) {
    throw new AppError(`${label} solo puede contener letras y espacios simples`, 400);
  }
  if (Array.from(name.replace(/ /g, '')).length < 2) {
    throw new AppError(`${label} debe tener al menos 2 letras`, 400);
  }
  return name;
}

function normalizedEmail(value, maximum) {
  if (typeof value !== 'string') {
    throw new AppError('Ingresá un email válido', 400);
  }
  const email = value.trim().toLowerCase();
  if (!email) throw new AppError('El email no puede estar vacío', 400);
  if (/\s/.test(email)) {
    throw new AppError('El email no puede contener espacios', 400);
  }
  if (email.length > maximum || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)) {
    throw new AppError(`Ingresá un email válido de hasta ${maximum} caracteres`, 400);
  }
  return email;
}

function accountEmail(value) {
  return normalizedEmail(value, MAX_TEXT_LENGTH);
}

function loginEmail(value) {
  if (typeof value !== 'string' || /\s/.test(value)
    || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value)) {
    throw new AppError('Ingresá un email válido', 400);
  }
  return value.toLowerCase();
}

function emailType(value) {
  const domain = String(value).trim().toLowerCase().slice(String(value).trim().lastIndexOf('@') + 1);
  if (domain === 'bue.edu.ar') return 'profesor';
  if (domain === 'alu.bue.edu.ar') return 'alumno';
  if (domain === 'gmail.com') return 'gmail';
  return 'otro';
}

function roleFromEmail(email) {
  const domain = String(email).trim().toLowerCase().slice(String(email).trim().lastIndexOf('@') + 1);
  if (!ALLOWED_EMAIL_DOMAINS.includes(domain)) {
    throw new AppError('Usá un correo @bue.edu.ar, @alu.bue.edu.ar o @gmail.com', 400);
  }
  if (domain === 'alu.bue.edu.ar') return 'alumno';
  return 'profesor';
}

// Rol automático del registro público: los institucionales lo tienen fijo y
// @gmail.com queda sin rol hasta que un administrador lo asigne al aprobar.
function registrationRoleFromEmail(email) {
  const domain = String(email).trim().toLowerCase().slice(String(email).trim().lastIndexOf('@') + 1);
  if (!ALLOWED_EMAIL_DOMAINS.includes(domain)) {
    throw new AppError('Usá un correo @bue.edu.ar, @alu.bue.edu.ar o @gmail.com', 400);
  }
  if (domain === 'alu.bue.edu.ar') return 'alumno';
  if (domain === 'bue.edu.ar') return 'profesor';
  return null;
}

function validateEmailRole(email, role) {
  const defaultRole = roleFromEmail(email);
  const domain = String(email).trim().toLowerCase().slice(String(email).trim().lastIndexOf('@') + 1);
  if (domain === 'gmail.com') {
    if (!['alumno', 'profesor'].includes(role)) throw new AppError('Rol inválido', 400);
    return role;
  }
  if (role !== defaultRole) {
    const domainLabel = domain === 'alu.bue.edu.ar' ? '@alu.bue.edu.ar' : '@bue.edu.ar';
    throw new AppError(`Un correo ${domainLabel} solo puede ser ${defaultRole}`, 400);
  }
  return defaultRole;
}

function accountPassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > MAX_TEXT_LENGTH || /\s/.test(value)) {
    throw new AppError('La contraseña debe tener entre 8 y 50 caracteres y no contener espacios', 400);
  }
  return value;
}

function courseDivision(value) {
  const course = requiredText(value, 'El curso', MAX_TEXT_LENGTH);
  if (!/^[1-7]°(?:[1-9]|[1-9]\d)°$/.test(course)) {
    throw new AppError('El curso debe tener formato A°D° (por ejemplo, 2°14°)', 400);
  }
  return course;
}

function dniIdentifier(value) {
  const identifier = typeof value === 'string' ? value.trim() : '';
  if (!identifier) throw new AppError('El DNI no puede estar vacío', 400);
  if (!/^\d{7,10}$/.test(identifier)) {
    throw new AppError('El DNI debe contener de 7 a 10 dígitos numéricos', 400);
  }
  return identifier;
}

module.exports = {
  MAX_TEXT_LENGTH,
  ALLOWED_EMAIL_DOMAINS,
  requiredText,
  personName,
  normalizedEmail,
  accountEmail,
  emailType,
  roleFromEmail,
  registrationRoleFromEmail,
  validateEmailRole,
  loginEmail,
  accountPassword,
  courseDivision,
  dniIdentifier
};
