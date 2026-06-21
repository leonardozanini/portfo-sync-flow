# 📊 Portfo Sync Flow

A full-stack investment portfolio consolidator that aggregates assets across multiple markets — B3 (Brazil), NYSE (US), and crypto — into a single, unified dashboard with real-time price feeds and multi-currency support.

> Built as a personal project to solve a real problem: no existing tool combined Brazilian and international equities in one place with the flexibility I needed.

---

## ✨ Features

- 📈 **Multi-market support** — B3, NYSE/ETFs, and cryptocurrency in one dashboard
- 💱 **Multi-currency view** — toggle between BRL, USD, EUR, and GBP
- 🔄 **Real-time price feeds** — powered by Twelve Data (primary) and Stooq (fallback)
- 📊 **Portfolio analytics** — KPIs, allocation charts, and performance tracking
- 🔐 **Authentication** — secure user accounts via Supabase Auth
- 📱 **Responsive design** — works on desktop and mobile

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript |
| State & Data | TanStack Query |
| Backend / DB | Supabase (PostgreSQL + Auth) |
| Hosting | Vercel |
| Version Control | GitHub |
| AI-assisted dev | Claude (Anthropic) |

---

## 📡 Price Feed Architecture

| Source | Used For |
|--------|----------|
| [Twelve Data](https://twelvedata.com) | NYSE stocks, ETFs, international assets |
| [Stooq](https://stooq.com) | Fallback (`.us`, `.sa`, `.de` suffixes) |
| Yahoo Finance | Cryptocurrency pairs (e.g. BTC-EUR) |

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- A [Twelve Data](https://twelvedata.com) API key

### Installation

```bash
git clone https://github.com/leonardozanini/portfo-sync-flow.git
cd portfo-sync-flow
npm install
```

### Environment Variables

Create a `.env.local` file in the root:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
TWELVE_DATA_API_KEY=your_twelve_data_api_key
```

### Run Locally

```bash
npm run dev
```

---

## 🌐 Live Demo

👉 [portfo-sync-flow.vercel.app](https://portfo-sync-flow.vercel.app)

---

## 📁 Project Structure

```
portfo-sync-flow/
├── src/
│   ├── components/      # UI components
│   ├── pages/           # Route pages
│   ├── hooks/           # Custom React hooks
│   ├── lib/             # Supabase client, utilities
│   └── types/           # TypeScript interfaces
├── public/
├── .env.local           # Environment variables (not committed)
└── README.md
```

---

## 🤖 AI-Assisted Development

This project was built using **Claude (Anthropic)** as a development partner — describing features in natural language, reviewing generated code, and iterating via GitHub + Vercel's auto-deploy pipeline. It reflects a modern workflow combining human domain knowledge with AI code generation.

---

## 👤 Author

**Leonardo Zanini**
- GitHub: [@leonardozanini](https://github.com/leonardozanini)
- Project: [portfo-sync-flow.vercel.app](https://portfo-sync-flow.vercel.app)

---

## 📄 License

All rights reserved. This project is publicly visible for portfolio purposes only.
Copying, distributing, or using this code for commercial purposes is not permitted
without explicit written permission from the author.
