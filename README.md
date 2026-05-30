# Discord-TikTok-Activity
# RU: Как запустить?

# 1. Создание Discord Application

Перейдите в Discord Developer Portal (https://discord.com/developers/applications/).

Нажмите **New Application** и создайте новое приложение.

В разделе **OAuth2** скопируйте **Client ID** и **Client Secret**, а в **Redirect URIs** укажите `https://127.0.0.1`.

В разделе **Bot** создайте бота и скопируйте его **Bot Token**.

# 2. Конфигурация проекта — переменные окружения

**Фронтенд:** переименуйте `client/.env.example` в `client/.env` и укажите там ваш Discord Client ID:

```env
VITE_DISCORD_CLIENT_ID=ВАШ_DISCORD_CLIENT_ID
```

**Бэкенд:** переименуйте `config/.env.example` в `config/.env` и заполните следующие значения:

```env
DISCORD_CLIENT_ID
DISCORD_CLIENT_SECRET
DISCORD_BOT_TOKEN
```

`DISCORD_ACTIVITY_URL` — публичный домен, на котором будет развернут веб-сайт приложения. Обязательно должен включать протокол `https://`.

`JWT_SECRET` — любая длинная случайная строка, используемая для генерации авторизационных сессий.

`ADMIN_DISCORD_IDS` — Discord ID одного или нескольких пользователей, у которых должен быть доступ к панели модерации. Указываются через запятую.

# 3. Установка и сборка

В корневом каталоге проекта выполните следующие команды:

```bash
# Установка библиотек бэкенда
npm install

# Установка библиотек фронтенда и его компиляция
cd client
npm install
npm run build
cd ..
```

После завершения сборки будет создана готовая папка `client/dist/`.

# 4. Запуск бэкенда

Для непрерывной работы в фоне используйте PM2:

```bash
pm2 start server/index.js --name "tiktok-activity"
```

Сервер запустится локально на порту `3000`. Папка для загрузок `/var/www/tiktok/uploads/` и файл базы данных `/var/www/tiktok/database/tiktok.db` будут автоматически созданы при первом запуске сервера.

# 5. Настройка SSL/HTTPS

Встраиваемые активности, такие как Discord Activity, работают строго по протоколу HTTPS. Настройте обратный прокси-сервер. Пример конфигурации для Caddy:

```caddy
your-domain.com {
    reverse_proxy 127.0.0.1:3000
}
```

Либо аналогично настройте проксирование через Nginx или Cloudflare с SSL-сертификатом на порт `3000`.
# EN: How to Run?

# 1. Creating a Discord Application

Go to the Discord Developer Portal (https://discord.com/developers/applications/).

Click **New Application** and create a new application.

In the **OAuth2** section, copy the **Client ID** and **Client Secret**, and set the **Redirect URIs** to `https://127.0.0.1`.

In the **Bot** section, create a bot and copy its **Bot Token**.

# 2. Project Configuration (Environment Variables)

**Frontend:** Rename `client/.env.example` to `client/.env` and enter your Discord Client ID there:

```env
VITE_DISCORD_CLIENT_ID=YOUR_DISCORD_CLIENT_ID
```

**Backend:** Rename `config/.env.example` to `config/.env` and fill in the following:

```env
DISCORD_CLIENT_ID
DISCORD_CLIENT_SECRET
DISCORD_BOT_TOKEN
```

`DISCORD_ACTIVITY_URL` — the public domain where you will deploy the application website. It must include the `https://` protocol.

`JWT_SECRET` — any long random string used to generate authorization sessions.

`ADMIN_DISCORD_IDS` — the Discord ID of one or more users who should have access to the moderation panel, separated by commas.

# 3. Installation and Build

In the root directory of the project, run the following commands:

```bash
# Install backend libraries
npm install

# Install frontend libraries and compile it
cd client
npm install
npm run build
cd ..
```

After the build is complete, the ready-to-use `client/dist/` folder will be generated.

# 4. Starting the Backend

For continuous background operation, use PM2:

```bash
pm2 start server/index.js --name "tiktok-activity"
```

The server will start locally on port `3000`. The upload folder `/var/www/tiktok/uploads/` and the database file `/var/www/tiktok/database/tiktok.db` will be created automatically when the server starts for the first time.

# 5. Setting Up SSL/HTTPS

Embedded activities, such as Discord Activity, work strictly over HTTPS. Configure a reverse proxy server. Example configuration for Caddy:

```caddy
your-domain.com {
    reverse_proxy 127.0.0.1:3000
}
```

Alternatively, configure proxying via Nginx or Cloudflare with an SSL certificate to port `3000`.

# My Telegram Channel: https://t.me/tempestdevelop
