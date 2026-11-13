import { pool } from "./db";
import { hashPassword } from "./password";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email");
  const password = arg("password");
  const role = arg("role") ?? "EMPLOYEE";
  const name = arg("name") ?? email;

  if (!email || !password) {
    console.error("usage: npm run create-user -- --email a@b.com --password secret123 [--name Name] [--role ADMIN]");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("password must be at least 8 characters");
    process.exit(1);
  }
  if (!["EMPLOYEE", "MANAGER", "ADMIN"].includes(role)) {
    console.error("role must be EMPLOYEE, MANAGER or ADMIN");
    process.exit(1);
  }

  // For an existing email only the password is replaced; name, role and manager stay as they are.
  const r = await pool.query(
    `INSERT INTO employee (name, email, role, password_hash) VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id, email, role`,
    [name, email.trim().toLowerCase(), role, await hashPassword(password)]
  );
  console.log("ok", r.rows[0]);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
