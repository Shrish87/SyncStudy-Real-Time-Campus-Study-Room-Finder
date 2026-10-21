# SyncStudy

SyncStudy is a real-time, domain-restricted campus collaboration platform. Built with Next.js and Supabase, it features live study rooms, WebSockets-based group chat, secure file sharing, and a gamified Pomodoro focus leaderboard.

## Features
- **Institutional Authentication**: Google OAuth 2.0 restricted to authorized domains.
- **Real-Time Collaboration**: Live WebSockets-based chat and room participant tracking.
- **Resource Vault**: Secure file uploading and sharing using Supabase Storage.
- **Productivity Tracking**: Gamified Pomodoro clock and leaderboard.
- **Screen Sharing**: Peer-to-peer screen broadcasting capabilities.
- **Google Calendar Export**: One-click session scheduling.

## Tech Stack
- Frontend: Next.js, React, Tailwind CSS
- Backend/BaaS: Supabase (PostgreSQL, Auth, Realtime, Storage)
- Deployment: Vercel

## Setup Instructions
1. Clone the repository.
2. Run `npm install` to install dependencies.
3. Add your Supabase and Google OAuth credentials to `.env.local`.
4. Run `npm run dev` to start the local development server on `localhost:3000`.
