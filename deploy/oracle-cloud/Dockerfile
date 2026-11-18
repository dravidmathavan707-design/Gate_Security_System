FROM node:22-alpine AS frontend

WORKDIR /src/frontend/student
COPY frontend/student/package.json frontend/student/package-lock.json ./
RUN npm ci
COPY frontend/student/ ./

ARG VITE_API_BASE_URL=
ARG VITE_OFFLINE_PUBLIC_KEY=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_OFFLINE_PUBLIC_KEY=${VITE_OFFLINE_PUBLIC_KEY}
RUN npm run build

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN python -m pip install --no-cache-dir -r /app/backend/requirements.txt
COPY backend/ /app/backend/
COPY --from=frontend /src/frontend/student/dist /app/frontend/student/dist
RUN mkdir -p /data /app/backend/uploads \
    && chown -R 10001:10001 /data /app/backend/uploads

USER 10001:10001
WORKDIR /app/backend
EXPOSE 8000
CMD ["sh", "-c", "python -m alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]
