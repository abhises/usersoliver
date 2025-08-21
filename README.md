# Users Service

This project provides a robust backend service for managing user data, presence status, and caching, with support for multiple environments (development, stage, production). It uses Redis for caching and PostgreSQL for persistent storage, and is designed to be easily testable and maintainable.

---

## 📁 Complete File and Folder Structure

```
users/
├── test/                        # Automated test scripts for all major features
│   ├── index.js
│   ├── redisTest.js
│   ├── setUserName.js
│   ├── getCriticalUserData.js
│   ├── presenceStatus.js
│   ├── updatePresenceFromSocket.js
│   ├── setPresenceOverride.js
│   ├── isUsernameTaken.js
│   ├── getUserField.js
│   ├── updateUserField.js
│   ├── buildUserData.js
│   ├── buildUserSettings.js
│   ├── buildUserProfile.js
│   ├── getCriticalUsersData.js
│   └── getBatchOnlineStatus.js
├── utils/                       # Utility classes and helpers
│   ├── Redis.js                 # Redis cache abstraction (environment-aware)
│   ├── UtilityLogger.js         # Logging utility
│   └── ErrorHandler.js          # Error handling utility
├── .env                         # Environment variables
├── README.md                    # Project documentation
└── ...other source files        # Main application logic and modules
```

---

## ⚙️ Environment Setup

Create a `.env` file in the root directory with the following variables:

```env
APP_ENVIRONMENT=development         # or 'stage' or 'production'
LAMBDA_URL=https://your-lambda-url/ # Required for development
REDIS_HOST=localhost                # For production/stage
REDIS_PORT=6379
REDIS_PASSWORD=yourpassword         # Optional
REDIS_URL=redis://localhost:6379
POSTGRES_USER=user_test
POSTGRES_PASSWORD=user_test
POSTGRES_DB=user_test
PGHOST=127.0.0.1
PGPORT=5432
NODE_ENV=local
LOGGING_ENABLED=1
LOGGING_CONSOLE_ENABLED=1
```

---

## 🚀 Features

- **Environment-aware Redis caching**:
  - Direct connection in production/stage.
  - Lambda proxy in development.
- **Key prefixing**: Prevents key collisions across environments.
- **Comprehensive logging and error handling**.
- **Test suite**: Automated tests for all major features.
- **Extensible utility structure**.

---

## scripts

    | Command               | Description                                                      |

| --------------------- | ---------------------------------------------------------------- |
| `npm run createTable` | Creates the database tables |
| `npm run dropTables` | Drops all existing tables |
| `npm run seed` | Seeds the database with sample user data |
| `npm run deleteUser` | Deletes a user (script implementation inside `db/deleteUser.js`) |
| `npm run test` | Runs Jest tests |
| `npm run test:manual` | Runs manual test script (`test/index.js`) |

## 🧪 Running Tests

All test scripts are in the `test/` folder. Example test functions include:

- `testRedisConnection` – Checks Redis connectivity and basic operations.
- `setUserNameTest`, `testGetCriticalUserData`, etc. – Test user and presence features.

To run a test, import and execute the desired function from `test/index.js`:

```javascript
import { testRedisConnection } from "./test/index.js";

testRedisConnection().then((result) => {
  if (result) {
    console.log("Redis test passed!");
  } else {
    console.log("Redis test failed!");
  }
});
```

Or run all tests by creating a runner script that imports and executes each exported test.

---

## 🛠️ Dependencies

- Node.js
- [redis](https://www.npmjs.com/package/redis) npm package
- PostgreSQL (for user data)
- Custom utilities: `UtilityLogger.js`, `ErrorHandler.js`

---

## 📝 Notes

- **Key Prefixing**: Keys are automatically prefixed by environment (`#dev_`, `#stage_`, or none for production).
- **Logging**: Controlled by `LOGGING_ENABLED` and `LOGGING_CONSOLE_ENABLED` in `.env`.
- **Lambda Proxy**: In development, ensure your Lambda proxy is deployed and accessible.
- **Database**: Make sure PostgreSQL is running and accessible with the credentials in `.env`.

---

---

\*\*Feel free to update this README as your
