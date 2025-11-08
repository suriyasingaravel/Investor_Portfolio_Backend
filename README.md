# 📈 Investor Portfolio — Backend

A lightweight **Node + Express** backend that parses Excel portfolios, fetches live stock prices from **Yahoo Finance**, and scrapes **P/E ratio** & **Latest EPS** from **Google Finance**.

---

## ⚙️ Installation

```bash
git clone https://github.com/<your-username>/Investor_Portfolio_Backend.git
cd Investor_Portfolio_Backend
npm install

Create a .env file in the root directory:
PORT=8080
CORS_ORIGIN=*

Run the server:

# Development
npm run dev

# Production
npm start

🚀 API Endpoints
Method	Endpoint	Description
POST	/api/portfolio/upload	Upload Excel portfolio and parse data
POST	/api/prices	Fetch live CMP (Current Market Price)
POST	/api/fundamentals	Get P/E ratio and Latest EPS from Google Finance
🧠 How It Works

Uses Yahoo Finance for stock prices

Uses Google Finance for fundamentals (P/E & EPS)

Includes rate limiting, caching, and retry logic for reliability

🧩 Tech Stack

Node.js + Express

Yahoo Finance API

Google Finance Scraper

Bottleneck (for rate limiting)

LRU Cache

🛠️ Notes

Requires Node.js v18+

Update CORS_ORIGIN in .env to match your frontend URL

Works seamlessly on Render, Railway, or EC2
