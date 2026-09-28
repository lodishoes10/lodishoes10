# ============================================================
# LodiShoes POS — SATU container untuk Railway/Render:
#   Stage 1: build frontend (Vite -> dist)
#   Stage 2: backend FastAPI menyajikan API (/api) + frontend statis
# Frontend & backend satu origin -> cookie login httpOnly langsung jalan.
# ============================================================

# ---------- Stage 1: build frontend ----------
FROM node:20-alpine AS fe
WORKDIR /fe

# Paket internal Emergent (@emergentbase/*) tidak diperlukan untuk produksi &
# host-nya mungkin tidak bisa diakses dari Railway -> dilepas sebelum install.
COPY frontend/package.json frontend/yarn.lock ./
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));delete p.devDependencies['@emergentbase/overlay'];delete p.devDependencies['@emergentbase/visual-edits'];fs.writeFileSync('package.json',JSON.stringify(p,null,2))"
RUN yarn install --ignore-engines

COPY frontend/ ./
# PLAIN_BUILD=true -> vite.config.ts melewatkan plugin internal Emergent.
# Type-check hanya src (tsconfig.node.json memeriksa vite.config.ts yang mengimpor paket internal).
RUN yarn tsc -p tsconfig.app.json --noEmit && PLAIN_BUILD=true yarn vite build

# ---------- Stage 2: runtime (backend + frontend statis) ----------
FROM python:3.11-slim
WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/
COPY --from=fe /fe/dist ./frontend/dist

WORKDIR /app/backend

# Railway/Render mengisi env PORT otomatis.
ENV PORT=8001
EXPOSE 8001
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT}"]
