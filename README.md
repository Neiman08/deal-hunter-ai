# 🎯 Deal Hunter AI

Sistema inteligente de detección de súper ofertas, liquidaciones y errores de precio en tiendas como Walmart, Home Depot, Target, Best Buy y Lowe's.

---

## 🚀 Inicio Rápido (VSCode)

### Requisitos
- Node.js 18+
- PostgreSQL 14+
- Redis (opcional, para caché)
- Git

### 1. Clonar e instalar dependencias

```bash
# Instalar dependencias del backend
cd backend
npm install

# Instalar dependencias del frontend
cd ../frontend
npm install
```

### 2. Configurar variables de entorno

```bash
# En la carpeta backend/
cp .env.example .env
# Edita .env con tus credenciales
```

### 3. Configurar base de datos

```bash
cd backend
npm run db:migrate    # Crea las tablas
npm run db:seed       # Carga datos de prueba
```

### 4. Correr en desarrollo

**Terminal 1 – Backend:**
```bash
cd backend
npm run dev
# Corre en http://localhost:3001
```

**Terminal 2 – Frontend:**
```bash
cd frontend
npm run dev
# Abre http://localhost:5173
```

---

## 📁 Estructura del Proyecto

```
deal-hunter-ai/
├── frontend/          # React + Vite + Tailwind
│   └── src/
│       ├── components/   # Componentes reutilizables
│       ├── pages/        # Páginas principales
│       ├── hooks/        # Custom hooks
│       ├── context/      # Estado global
│       └── utils/        # Utilidades
├── backend/           # Node.js + Express
│   └── src/
│       ├── routes/       # Endpoints API
│       ├── services/     # Lógica de negocio
│       ├── models/       # Modelos de datos
│       ├── jobs/         # Cron jobs de escaneo
│       └── middleware/   # Auth, rate limiting
└── README.md
```

---

## 🌐 Deploy en Render

### Backend (Web Service)
1. Conecta tu repo de GitHub en render.com
2. Selecciona "Web Service"
3. Build Command: `cd backend && npm install`
4. Start Command: `cd backend && npm start`
5. Agrega las variables de entorno de `.env.example`

### Frontend (Static Site)
1. Selecciona "Static Site"
2. Build Command: `cd frontend && npm install && npm run build`
3. Publish Directory: `frontend/dist`
4. Agrega `VITE_API_URL` con la URL del backend

### Base de datos
1. Crea un "PostgreSQL" en Render
2. Copia la connection string a `DATABASE_URL` en el backend

---

## 💳 Planes de Suscripción

| Plan | Precio | Alertas | Búsquedas | Mapa | WhatsApp |
|------|--------|---------|-----------|------|----------|
| Free | $0 | 3/mes | 10/día | ❌ | ❌ |
| Pro | $19/mes | Ilimitadas | Ilimitadas | ✅ | ❌ |
| Elite | $49/mes | Ilimitadas | Ilimitadas | ✅ | ✅ |

---

## 🛠 Tecnologías

- **Frontend**: React 18, Vite, Tailwind CSS, Recharts, Leaflet
- **Backend**: Node.js, Express, Playwright, Axios, node-cron
- **Base de datos**: PostgreSQL, Redis
- **Alertas**: Twilio (WhatsApp/SMS), Nodemailer
- **Auth**: JWT + bcrypt
