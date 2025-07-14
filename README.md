# Customer Management Server

## Features
- Customer signup/signin with SQLite database
- Stores customer info, trip history, and risk status

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   node server.js
   ```

## API
### POST `/api/customers/signup`
- Body: `{ name, email, password, nationality, currently_in_egypt, date_of_arrival?, date_of_leaving? }`
- Creates a new customer.

### POST `/api/customers/signin`
- Body: `{ email, password }`
- Returns customer info if credentials are correct.

--- 