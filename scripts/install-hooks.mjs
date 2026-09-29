// Points Git at the versioned hooks in .githooks/ — runs from `npm install`
// (the "prepare" script), so every clone of this repo gets the pre-push check
// without anyone remembering to set it up.
//
// WHY THIS EXISTS: CI went red on 2026-09-24 over one misplaced
// eslint-disable comment and STAYED red for 26 pushes across four days. Nobody
// noticed, because red had become the normal colour — and while it was red,
// the Test job never ran, so a real regression in the sign-up form went
// unreported for the same four days. A guard nobody looks at is not a guard.
// The pre-push hook makes types + lint pass on the machine doing the pushing,
// so the CI badge only turns red for something new.
//
// Silent no-op anywhere there is no .git directory (Vercel builds, `npm ci`
// in a tarball) or no git on PATH. It must never fail an install.
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (!existsSync(join(root, ".git")) || process.env.CI) process.exit(0);

try {
  const current = execFileSync("git", ["config", "--get", "core.hooksPath"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (current === ".githooks") process.exit(0);
} catch {
  /* unset — fall through and set it */
}
try {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: root, stdio: "ignore" });
  console.log("git hooks: core.hooksPath → .githooks (pre-push runs tsc + eslint)");
} catch {
  /* no git, or not allowed to write config — the hook is a convenience, not a dependency */
}
