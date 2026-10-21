const { AppError } = require('../errors');

function requiredText(value, label, maximum, { minimum = 1 } = {}) {
  if (typeof value !== 'string') throw new AppError(`${label} es obligatorio`, 400);
  const text = value.trim();
  if (!text) throw new AppError(`${label} no puede estar vacío`, 400);
  if (text.length < minimum) throw new AppError(`${label} debe tener al menos ${minimum} caracteres`, 400);
  if (text.length > maximum) throw new AppError(`${label} no puede superar ${maximum} caracteres`, 400);
  return text;
}

function personName(value, label) {
  const name = requiredText(value, label, 60, { minimum: 2 }).normalize('NFC');
  if (!/^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u.test(name)) {
    throw new AppError(`${label} solo puede contener letras y espacios simples`, 400);
  }
  if (Array.from(name.replace(/ /g, '')).length < 2) {
    throw new AppError(`${label} debe tener al menos 2 letras`, 400);
  }
  return name;
}

function accountEmail(value) {
  if (typeof value !== 'string' || /\s/.test(value)) {
    throw new AppError('El email no puede contener espacios', 400);
  }
  const email = value.toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)) {
    throw new AppError('Ingresá un email válido de hasta 254 caracteres', 400);
  }
  return email;
}

function accountPassword(value) {
  if (typeof value !== 'string' || value.length < 8 || /\s/.test(value)) {
    throw new AppError('La contraseña debe tener al menos 8 caracteres y no contener espacios', 400);
  }
  return value;
}

function numericIdentifier(value, label = 'Legajo') {
  if (typeof value !== 'string' || !/^\d{1,10}$/.test(value)) {
    throw new AppError(`${label} debe contener de 1 a 10 dígitos`, 400);
  }
  return value;
}

module.exports = { requiredText, personName, accountEmail, accountPassword, numericIdentifier };
