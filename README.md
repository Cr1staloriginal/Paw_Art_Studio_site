# Paw Art Studio

Сайт студии дизайна с регистрацией, подтверждением email, кошельком, промокодами, реферальной системой и админ-панелью.

## Стек

- **Backend:** Node.js 18+, Express, Socket.IO
- **БД:** SQLite (better-sqlite3)
- **Auth:** JWT + bcrypt
- **Почта:** Nodemailer (Gmail SMTP)
- **Платежи:** ЮKassa
- **Frontend:** ванильный HTML/CSS/JS

## Быстрый старт

```bash
# 1. Установить зависимости
npm install

# 2. Создать .env из примера
cp .env.example .env

# 3. Заполнить .env (см. ниже)

# 4. Запустить
npm start
