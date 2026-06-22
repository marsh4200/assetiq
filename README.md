# AssetIQ

In-house **asset register** + **licence / compliance expiry tracker** for AR Tooling.

- **Assets** — numbered register (`#001`, `#002`, …). Each asset keeps its number for life; deleting one retires the number rather than reusing it. Print number labels straight from the Assets tab.
- **Tracker** — licences, fire extinguishers, software, antivirus, vehicle licences, machine services, certificates. Expiry dates for most things; *last + next service* dates for machines.
- **Overview** — traffic-light dashboard. Anything expiring within the lead time (default 2 months) or already expired is flagged green → amber → red. The bell badge shows the live count.
- **Settings** — business name, warning lead time (1–6 months), light/dark theme, and the GitHub self-update button.

Stack: FastAPI + SQLite + vanilla JS. Runs on **port 9920**.

## Install (one line)

```bash
curl -fsSL https://raw.githubusercontent.com/marsh4200/assetiq/main/install.sh | bash
```

Clones to `/opt/assetiq`, builds, and starts on **port 9920**. Re-running the
same command updates an existing install. Overrides:

```bash
ASSETIQ_DIR=/opt/assetiq ASSETIQ_PORT=9920 \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/marsh4200/assetiq/main/install.sh)"
```

### Or by hand

```bash
git clone https://github.com/marsh4200/assetiq.git && cd assetiq
docker compose up -d --build
```

Open `http://<host>:9920` (or point a Cloudflare tunnel at it).

The compose file bind-mounts the project directory, so in-app updates persist.
The database lives in `./data/assetiq.db` and is gitignored. Keep the install
directory put so updates land in the same place.

## Updating

1. Upload your changes to `marsh4200/assetiq` on GitHub and bump `VERSION`.
2. In the app: **Settings → Check for updates → Update now**.

It pulls the `main` branch zip, copies files over the running code (leaving
`data/` untouched), bumps `VERSION`, and restarts the container on the new code.

## Login & users

First run seeds a default admin: **`admin` / `admin`**. You're forced to set a
new password at first login.

- **Settings → Users** (admin only): add users and set their role — **Admin**
  (full access + user management + software updates) or **User** (assets +
  tracker). New users get an initial password and must change it on first login.
- **Settings → Account**: change your own password or log out.
- The last admin can't be deleted or demoted.

## Notes

- Sessions are server-side tokens; "log out" revokes the token.
- Behind a public Cloudflare tunnel this is now login-gated, but still put it
  behind Cloudflare Access too if you want a second layer.
- Dates are stored as `YYYY-MM-DD`.
