# NetMO

Sistema web para gestionar el préstamo, reserva y mantenimiento de notebooks de la escuela.
Arquitectura desacoplada: frontend en HTML/CSS/JS, API REST en Node.js y base de datos PostgreSQL en Docker.

## Estructura

- `index.html`: frontend (consume la API con `fetch`)
- `backend/`: API REST (Node.js + pg)
- `database/`: esquema SQL, datos de prueba y configuración de Docker
- `specs/`: especificaciones técnicas

## Requisitos

- Docker Desktop
- Python 3 (solo para servir el frontend) o cualquier servidor estático

## Instalación

```sh
git clone https://github.com/Kronnok/netmo.git
cd netmo/database
cp .env.example .env
```

Editá `.env` y definí contraseñas propias para `POSTGRES_PASSWORD` y las cuatro `NETMO_SEED_*_PASSWORD`.

## Levantar el sistema

Base de datos y API:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
curl http://localhost:3000/health
```

Frontend (desde la carpeta `database`):

```sh
python -m http.server 5500 --directory ..
```

Abrí http://localhost:5500/index.html

## Variables de entorno

Ver `database/.env.example`. El archivo `.env` real no se sube al repositorio.

## Usuarios de prueba

Definidos en `database/seed.sql`; las contraseñas son las que cargaste en `.env`.

| Rol | Email |
|---|---|
| Alumno | tprado@ottokrause.edu.ar |
| Profesor | agomez@ottokrause.edu.ar |
| Admin | admin@ottokrause.edu.ar |

## Detener

```sh
docker compose down
```

No uses `docker compose down -v`: borra los datos de la base.

## Equipo

- Agueda Munive, Martin Cosmelli, Franco Bravo, Marcos Lens y Teo Prado. Todos desarrolladores
