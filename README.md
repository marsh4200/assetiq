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

## Asset label numbers

Each asset has an editable **label number** (shown as `#001`). On *Add*, the form
pre-fills the lowest free number — so if you delete `#001`, the next new asset is
offered `001` again. You can also type any number yourself; duplicates are
rejected. Internally the database keeps a separate hidden id, so renumbering
never collides with history.

## Backup (Samba)

**Settings → Backup** (admin only):

- Enter the Samba **host/IP**, **share**, optional **folder**, and credentials.
- **Test connection** checks it's reachable.
- **Daily auto-backup** pushes one zip per day to the share and keeps the newest
  **N** (the "backups to keep" setting); the oldest rolls off. Set it to 2 for a
  rotate-the-oldest-of-two pattern.
- **Back up now** / **Download** / **Restore from file** / **Restore from share**
  for on-demand use.

A backup is a zip of the whole SQLite database (assets, tracker, users,
settings). Restore validates the zip, swaps the database atomically, and reloads.
The daily job runs inside the app — no cron needed.

> Samba credentials are stored in the database in plain text (same as the rest of
> the app's settings). Keep the host on your LAN / behind the tunnel.

## Updating

1. Upload your changes to `marsh4200/assetiq` on GitHub and bump `VERSION`.
2. In the app: **Settings → Check for updates → Update now**.

It pulls the `main` branch zip, copies files over the running code (leaving
`data/` untouched), bumps `VERSION`, and restarts the container on the new code.


## Updating (how it works)

**Settings → Software → Check for updates.** When an update is available you'll
see a progress screen with live steps: download & apply → restart → back online.
The page polls the server and reloads itself automatically once it returns.

The container reinstalls Python requirements on every start (via `entrypoint.sh`),
so an update that adds a new library self-heals on restart — no manual rebuild.
The app shell is served no-cache with version-stamped JS/CSS, so a new version
always shows immediately without a hard refresh.

If an update ever doesn't come back, check logs with `docker compose logs --tail=50`.

## Backup & restore

**Settings → Backup** (admin only). Point it at a Samba/SMB share and it keeps a
rolling set of database backups.

- **Daily backup** — toggle on. Once a day the app writes a timestamped
  `assetiq-backup-YYYYMMDD-HHMMSS.zip` to the share.
- **Keep copies** — rolling retention (default **2**). When a new backup pushes
  the count past the limit, the oldest is deleted.
- **Back up now** / **Download backup** — on-demand copy to the share, or
  straight to your browser.
- **Restore** — from an uploaded `.zip`, or from any backup listed on the share
  (**Restore from share**). A restore replaces the whole database and signs
  everyone out (the session lives in the database).

The SMB password is stored in the local database and is never sent back to the
browser once saved.

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
- Asset numbers are editable and reusable: the form suggests the smallest free
  number (so a deleted `001` is offered again), but you can type any unused one.
- Dates are stored as `YYYY-MM-DD`.
