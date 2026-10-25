const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const jsFiles = [];

function collectJavaScript(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectJavaScript(fullPath);
    else if (entry.isFile() && entry.name.endsWith('.js')) jsFiles.push(fullPath);
  }
}

function fail(message) {
  console.error(`FALLA ${message}`);
  process.exitCode = 1;
}

collectJavaScript(path.join(root, 'backend'));
collectJavaScript(path.join(root, 'frontend'));
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) fail(`node --check: ${path.relative(root, file)}`);
}
if (!process.exitCode) console.log(`OK node --check (${jsFiles.length} archivos)`);

const frontendFiles = ['app.js', 'index.html', 'styles.css'].map((name) =>
  path.join(root, 'frontend', name)
);
const frontend = frontendFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const riskyInnerHtml = [];
const safeHtmlVariables = new Set(['counts', 'durationControl', 'banAction', 'equipoCol']);

function skipQuoted(source, index, quote) {
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\') cursor += 1;
    else if (source[cursor] === quote) return cursor + 1;
  }
  return source.length;
}

function readTemplate(source, index, expressions) {
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\') {
      cursor += 1;
    } else if (source[cursor] === '`') {
      return cursor + 1;
    } else if (source[cursor] === '$' && source[cursor + 1] === '{') {
      const start = cursor + 2;
      let depth = 1;
      cursor = start;
      while (cursor < source.length && depth) {
        const character = source[cursor];
        if (character === "'" || character === '"') {
          cursor = skipQuoted(source, cursor, character);
          continue;
        }
        if (character === '`') {
          cursor = readTemplate(source, cursor, []);
          continue;
        }
        if (character === '/' && source[cursor + 1] === '/') {
          const newline = source.indexOf('\n', cursor + 2);
          cursor = newline < 0 ? source.length : newline + 1;
          continue;
        }
        if (character === '/' && source[cursor + 1] === '*') {
          const close = source.indexOf('*/', cursor + 2);
          cursor = close < 0 ? source.length : close + 2;
          continue;
        }
        if (character === '{') depth += 1;
        if (character === '}') depth -= 1;
        cursor += 1;
      }
      expressions.push(source.slice(start, cursor - 1).trim());
      cursor -= 1;
    }
  }
  return source.length;
}

function findTopLevelConditional(source) {
  let round = 0;
  let square = 0;
  let curly = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "'" || character === '"') {
      index = skipQuoted(source, index, character) - 1;
    } else if (character === '`') {
      const ignored = [];
      index = readTemplate(source, index, ignored) - 1;
    } else if (character === '(') round += 1;
    else if (character === ')') round -= 1;
    else if (character === '[') square += 1;
    else if (character === ']') square -= 1;
    else if (character === '{') curly += 1;
    else if (character === '}') curly -= 1;
    else if (!round && !square && !curly && character === '?'
        && source[index + 1] !== '?' && source[index + 1] !== '.') {
      let nested = 0;
      for (let next = index + 1; next < source.length; next += 1) {
        if (source[next] === "'" || source[next] === '"') {
          next = skipQuoted(source, next, source[next]) - 1;
        } else if (source[next] === '`') {
          const ignored = [];
          next = readTemplate(source, next, ignored) - 1;
        } else if (source[next] === '?'
            && source[next + 1] !== '?' && source[next + 1] !== '.') {
          nested += 1;
        } else if (source[next] === ':' && source[next + 1] !== ':') {
          if (nested === 0) return { question: index, colon: next };
          nested -= 1;
        }
      }
      return null;
    }
  }
  return null;
}

function isStaticChoice(expression) {
  const value = expression.trim().replace(/^\((.*)\)$/s, '$1').trim();
  const conditional = findTopLevelConditional(value);
  if (!conditional) return /^(?:'[^']*'|"[^"]*"|`[^`]*`|-?\d+(?:\.\d+)?|true|false|null|undefined)$/.test(value);
  return isStaticChoice(value.slice(conditional.question + 1, conditional.colon))
    && isStaticChoice(value.slice(conditional.colon + 1));
}

function statementEnd(source, start) {
  const depth = { round: 0, square: 0, curly: 0 };
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === "'" || character === '"') {
      index = skipQuoted(source, index, character) - 1;
    } else if (character === '`') {
      index = readTemplate(source, index, []) - 1;
    } else if (character === '(') depth.round += 1;
    else if (character === ')') depth.round -= 1;
    else if (character === '[') depth.square += 1;
    else if (character === ']') depth.square -= 1;
    else if (character === '{') depth.curly += 1;
    else if (character === '}') depth.curly -= 1;
    else if (character === ';' && !depth.round && !depth.square && !depth.curly) return index;
  }
  return source.length;
}

function isPreEscapedVariable(name) {
  if (!safeHtmlVariables.has(name)) return false;
  const declaration = new RegExp(`(?:const|let)\\s+${name}\\s*=`);
  const match = declaration.exec(frontend);
  if (!match) return false;
  const end = statementEnd(frontend, match.index + match[0].length);
  return frontend.slice(match.index, end).includes('escapeHtml(');
}

for (const match of frontend.matchAll(/innerHTML\s*=\s*/g)) {
  const start = match.index + match[0].length;
  const end = statementEnd(frontend, start);
  const expression = frontend.slice(start, end);
  const interpolations = [];
  for (let index = 0; index < expression.length; index += 1) {
    if (expression[index] !== '`') continue;
    const templateStart = index;
    const nestedInterpolations = [];
    index = readTemplate(expression, index, nestedInterpolations) - 1;
    const preceding = expression.slice(0, templateStart);
    const declarations = [...preceding.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)];
    const intermediate = declarations.at(-1);
    const declarationIsCurrent = intermediate
      && !preceding.slice(intermediate.index).includes(';');
    if (!declarationIsCurrent
        || !new RegExp(`escapeHtml\\(\\s*${intermediate[1]}\\s*\\)`).test(expression)) {
      interpolations.push(...nestedInterpolations);
    }
  }
  for (const interpolation of interpolations) {
    const safeVariable = /^[A-Za-z_$][\w$]*$/.test(interpolation)
      && isPreEscapedVariable(interpolation);
    if (!interpolation.includes('escapeHtml(') && !isStaticChoice(interpolation) && !safeVariable) {
      const line = frontend.slice(0, match.index).split('\n').length;
      riskyInnerHtml.push({ line, interpolation });
      break;
    }
  }
}
if (riskyInnerHtml.length) {
  const details = [...new Map(riskyInnerHtml.map((item) => [item.line, item])).values()]
    .map(({ line, interpolation }) => `${line} (${interpolation})`).join(', ');
  fail(`innerHTML dinámico sin escapeHtml en frontend, ${details}`);
} else {
  console.log('OK innerHTML dinámico revisado');
}

const applicationFiles = [
  ...frontendFiles,
  ...jsFiles.filter((file) => !file.includes(`${path.sep}test${path.sep}`)
    && path.basename(file) !== 'static-checks.js')
];
const forbidden = /\b(?:docker|nginx)\b|\b(?:admin|alumno|profesor)@(?:demo|example\.com)\b/i;
const localFrontendUrl = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i;
let forbiddenFound = false;
let localUrlFound = false;
for (const file of applicationFiles) {
  const source = fs.readFileSync(file, 'utf8');
  if (forbidden.test(source)) {
    fail(`referencia a Docker/Nginx o cuenta demo en ${path.relative(root, file)}`);
    forbiddenFound = true;
  }
  if (file.startsWith(path.join(root, 'frontend')) && localFrontendUrl.test(source)) {
    fail(`URL localhost en ${path.relative(root, file)}`);
    localUrlFound = true;
  }
}
if (!forbiddenFound) console.log('OK sin referencias Docker/Nginx ni cuentas demo en código');
if (!localUrlFound) console.log('OK frontend sin rutas localhost');
