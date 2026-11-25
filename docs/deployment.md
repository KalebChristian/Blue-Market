# Deployment

Blue Market has no npm dependencies. A fresh installation starts with an empty database.

## Render

Use the [Deploy to Render button](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FKalebChristian%2FBlue-Market). The blueprint creates a paid web service and a disk mounted at `/data`. Review the cost before deploying. If the repository is private, grant Render access before using the button.

## Docker

From the repository directory:

```sh
docker build -t blue-market .
docker run --name blue-market -p 3000:3000 -v blue-market-data:/data blue-market
```

Open [http://localhost:3000](http://localhost:3000). Keep the `blue-market-data` volume when replacing the container.

## Node.js and Pterodactyl

Install Node.js 24, then run:

```sh
node server.js
```

On Pterodactyl, extract the source into the server root and set the startup file to `server.js`. Open the assigned web address after starting. Keep the `data/` directory when updating.

## First run

1. Copy the setup code from your server logs and use it to create the first admin account.
2. In **Admin**, customize your site and choose whether to open Sign Ups or create accounts yourself.
3. Select **Create Market**, add the outcomes, and set the closing time and resolution rules.

## Configuration

| Variable | Purpose |
| --- | --- |
| `BLUE_DATA` | SQLite data directory. Defaults to `data/`, or `/data` in Docker. |
| `SERVER_PORT` | Listening port. Takes precedence over `PORT`. |
| `PORT` | Listening port when `SERVER_PORT` is unset. Defaults to `3000`. |
| `BLUE_SETUP_CODE` | Optional private setup code. The server generates one by default. |

## Backups

Run one instance per SQLite database and store its data on a persistent disk. To back up a running instance, use `node server.js --backup /path/to/backup.sqlite` with the same `BLUE_DATA` as the app. To restore, stop the app and place the backup in a clean data directory as `market.sqlite`.
