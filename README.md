# Backend API

## Setup Instructions

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file (see `.env.example`)

3. Set up PostgreSQL database and update `DATABASE_URL` in `.env`

4. Generate Prisma client:
```bash
npm run prisma:generate
```

5. Run migrations:
```bash
npm run prisma:migrate
```

6. Start development server:
```bash
npm run dev
```

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret key for JWT tokens
- `JWT_EXPIRES_IN` - Token expiration time (default: 7d)
- `PORT` - Server port (default: 5000)
- `EMAIL_HOST` - SMTP server host
- `EMAIL_PORT` - SMTP server port
- `EMAIL_USER` - Email address for sending emails
- `EMAIL_PASS` - Email password or app password
- `FRONTEND_URL` - Frontend URL for CORS

