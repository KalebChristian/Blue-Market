# Blue Market

Host a prediction market for your friends, club, or community. Set up your site, make it your own in Admin, and trade on your own questions with virtual credits.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FKalebChristian%2FBlue-Market)

![Blue Market home with market cards and a featured price chart](docs/screenshots/markets.jpg)

## Features

* Virtual credit trading
* Yes or no markets and markets with multiple outcomes
* Interactive price charts
* Positions, payouts, and trade history
* Leaderboard and audit log
* Custom name, logo, colors, and currency
* Sign Ups, account roles, and market permissions

## Installation

| Platform | Requirements |
| --- | --- |
| Render | A paid web service with persistent storage |
| Docker | A machine running Docker |
| Node.js or Pterodactyl | Node.js 24 |

See the [deployment guide](docs/deployment.md) for Docker, Render, and Pterodactyl instructions. After startup, open the app and create your admin account using the setup code in the server logs.

## Screenshots

<p>
  <img src="docs/screenshots/trading.jpg" width="49%" alt="Market detail with an interactive price chart and trading controls">
  <img src="docs/screenshots/positions.jpg" width="49%" alt="Positions with account value, profit and loss, and holdings">
</p>
<p>
  <img src="docs/screenshots/admin.jpg" width="49%" alt="Admin appearance settings with a branding preview">
  <img src="docs/screenshots/leaderboard.jpg" width="49%" alt="Leaderboard with ranked accounts and trading statistics">
</p>

## Development

```sh
npm run demo
npm test
```

The demo runs locally at [http://localhost:3000](http://localhost:3000) and resets when stopped.

## License

[MIT](LICENSE)
