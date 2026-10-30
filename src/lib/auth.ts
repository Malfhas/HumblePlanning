import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { db } from "@/db";
import { users } from "@/db/schema/users";
import { sessions, accounts, verifications } from "@/db/schema/auth";
import { hashPassword, verifyPassword } from "./password";
import { clientIpHeaders } from "./utils/rate-limit";

// Fallback secret so the process can boot while BETTER_AUTH_SECRET is not
// in .env (the installer `install.sh` generates it; the following restart
// loads the final secret). Sessions created with this temporary secret
// are invalidated on restart.
const authSecret = process.env.BETTER_AUTH_SECRET || `__bootstrap_pending_${Date.now()}`; // i18n-ignore technical value
if (!process.env.BETTER_AUTH_SECRET) {
  console.warn("[auth] BETTER_AUTH_SECRET missing — using a temporary secret (rerun `install.sh` or set it in .env)");
}

export const auth = betterAuth({
  secret: authSecret,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
    // Accounts are created by administrators or the installer, never by sign-up.
    disableSignUp: true,
    password: {
      hash: hashPassword,
      verify: verifyPassword,
    },
  },
  plugins: [
    username({
      minUsernameLength: 1,
      maxUsernameLength: 100,
      usernameNormalization: false,
      // The default validator only accepts [a-zA-Z0-9_.]: a login created
      // through the user form (free text of 1 to 100 characters, see
      // validators/user.ts) containing "-" could not sign in.
      // So we accept whatever the form allows.
      usernameValidator: (value) => value.trim().length > 0,
      // The `users` schema has no display_username column (Better Auth
      // 1.7 checks the Drizzle schema at startup).
      displayUsername: false,
    }),
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  user: {
    modelName: "users",
  },
  advanced: {
    ipAddress: {
      // Same trusted headers as the rest of the application (sessions list, rate limits)
      ipAddressHeaders: clientIpHeaders(),
    },
  },
});
