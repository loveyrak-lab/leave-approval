# Stage 1: คอมไพล์ TypeScript เป็น JavaScript
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src src
RUN npm run build

# Stage 2: image ขนาดเล็กสำหรับรันจริง (เฉพาะ dependency ที่ใช้ตอนรัน)
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist dist
COPY migrations migrations
COPY public public
USER node
EXPOSE 3000
# ตั้งค่าผ่าน env: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, JWT_SECRET
# รัน migrations ก่อน แล้วค่อยเปิดเซิร์ฟเวอร์
CMD ["sh", "-c", "node dist/migrate.js && node dist/index.js"]

