# Private mounts

Diagrams that must never be published (client/startup designs) live in a
cloud-synced folder **outside** the repo and are symlinked in under `tech/`:

```
~/cardforge/drive/Tech Architecture/   ← real files, two-way synced with Drive
tech/cardforge  →  symlink to the above (listed in .gitignore AND .dockerignore)
```

- `pointers.yaml` references them normally (`./tech/cardforge/foo.d2`). Locally
  they render; on diagrams.jbm.eco they're absent from the checkout, so they show
  crossed out.
- `classes: @"../../classes"` imports resolve through the symlink against the repo.
- The tag walker (`scripts/lib/tags.mjs`) follows symlinks; a dangling one is skipped.

## Adding a mount (one-time per client)

Example values are for cardforge — Drive folder
`1ay_RPUvX75iKOAMkF753vMJXrIg1DKZe` ("Tech Architecture").

### 1. Install rclone

```sh
sudo -v && curl https://rclone.org/install.sh | sudo bash   # apt's rclone is often too old for bisync
```

### 1b. Your own Google OAuth client (Drive only)

rclone's shared Drive client_id is being retired during 2026, so create your own.
Do this in **Firefox**, signed in as josh.b.merrell@gmail.com. Every link below
includes `authuser=josh.b.merrell@gmail.com` to force that account.

**Current setup:** the project is [`rclone-jbm-261107`](https://console.cloud.google.com/home/dashboard?project=rclone-jbm-261107&authuser=josh.b.merrell@gmail.com).
Steps 1 and 2 are already done (with `gcloud`). Steps 3–5 can only be done in
the Cloud Console. `gcloud` can't create a consent screen or a Desktop client
for a personal account (`Project must belong to an organization`).

1. ✅ Create a project. `gcloud projects create <id>`
2. ✅ Enable the Drive API. `gcloud services enable drive.googleapis.com --project=<id>`
3. Open the [consent screen](https://console.cloud.google.com/auth/overview?project=rclone-jbm-261107&authuser=josh.b.merrell@gmail.com)
   and click **Get started**. Give it any app name, choose **External**, and use
   your own email for the support and contact addresses.
4. Open [Audience](https://console.cloud.google.com/auth/audience?project=rclone-jbm-261107&authuser=josh.b.merrell@gmail.com)
   and click **Publish app** to set it to *In production*. While the app stays in
   *Testing*, Google expires the refresh token after 7 days and the sync silently
   stops. It doesn't need to go through Google's verification, because only you
   use it.
   - **Publish app is greyed out** and says to complete the Branding page? Scroll
     to the bottom of [Branding](https://console.cloud.google.com/auth/branding?project=rclone-jbm-261107&authuser=josh.b.merrell@gmail.com).
     Fill in **Developer contact information → Email addresses** (your email) and
     click **Save**. Leave the logo, domains and links empty. A logo would trigger
     verification.
   - This step doesn't block step 5. You can create the client first and publish
     afterwards. The 7-day expiry applies only to tokens issued while the app is
     in Testing, so if you publish later, re-run step 2 to get a fresh token.
5. Open [Clients](https://console.cloud.google.com/auth/clients?project=rclone-jbm-261107&authuser=josh.b.merrell@gmail.com)
   and choose **Create client → Application type: Desktop app → Create**. In the
   dialog, click **Download JSON**. Google shows the secret only once. The JSON
   holds `client_id` (`….apps.googleusercontent.com`) and `client_secret`
   (`GOCSPX-…`), and Claude can read both from it.

One client can serve every Drive remote you create.

#### Troubleshooting the Firefox sign-in

- **`Error 403: access_denied` / "has not completed the Google verification
  process"**: the app is still in *Testing*, and your account isn't on its
  test-user list. Open [Audience](https://console.cloud.google.com/auth/audience?project=rclone-jbm-261107&authuser=josh.b.merrell@gmail.com),
  go to **Test users → + Add users**, enter `josh.b.merrell@gmail.com` and click
  **Save**. Then retry the sign-in. As long as `rclone authorize` is still
  running, the same `auth?state=…` URL works.
- **Where does the token JSON go?** Pass it straight to `rclone config update
  <remote> token='…'` (step 3). rclone stores it in `~/.config/rclone/rclone.conf`.
  Don't keep any other copy.

- **`Error 400: redirect_uri_mismatch`**: the client was created as a *Web
  application* (its JSON has a top-level `"web"` key) instead of a *Desktop app*.
  You can keep it. Open [the cardforge client](https://console.cloud.google.com/auth/clients/930580358630-59fte61b9k5emnk3qsh77bkhciq4boce.apps.googleusercontent.com?project=rclone-jbm-261107&authuser=josh.b.merrell@gmail.com),
  add `http://127.0.0.1:53682/` (with the trailing slash) under **Authorized
  redirect URIs**, and click **Save**. The change can take a few minutes to
  apply. Then re-run `rclone authorize`.
- **The wrong Google account shows** (e.g. brant.merrell): Firefox's default
  Google session wins. Open the `127.0.0.1:53682/auth?…` URL in a **Private
  Window** (Ctrl+Shift+P) and sign in there as josh.b.merrell. That works because
  the redirect goes back to localhost, which the private window can reach.
- **Why re-authorize at all?** A refresh token belongs to the client that issued
  it. The token from the first setup was issued to rclone's shared client, so it
  can't be used with your own client. A switch needs exactly one new sign-in.

### 2. Authorize the right Google account (in Firefox)

```sh
rclone authorize drive "<client_id>" "<client_secret>" --auth-no-open-browser
```

It prints a `http://127.0.0.1:53682/auth?state=…` URL. Paste it into **Firefox**
(not Chrome — its profiles pick the wrong account), choose
**josh.b.merrell@gmail.com**, approve. The terminal prints a token JSON blob
`{"access_token":…}`; copy it whole.

### 3. Create the remote, rooted at the shared folder

```sh
rclone config create cardforge drive scope=drive \
  root_folder_id=1ay_RPUvX75iKOAMkF753vMJXrIg1DKZe \
  client_id='<client_id>' client_secret='<client_secret>' \
  token='<paste token JSON here>' --non-interactive
rclone lsf cardforge:          # should list the files you pasted into Tech Architecture
```

If `lsf` errors with "file not found", the token is for an account without
access — redo step 2 with the right account.

For OneDrive/Dropbox, swap `drive` for `onedrive`/`dropbox` in steps 2–3 (Dropbox:
point REMOTE at `name:Path/To/Folder` instead of using `root_folder_id`).

### 4. Mount config

```sh
mkdir -p ~/.config/diagrams-private-mounts
cat > ~/.config/diagrams-private-mounts/cardforge.env <<'EOF'
REMOTE=cardforge:
LOCAL="$HOME/cardforge/drive/Tech Architecture"
SVG_THEME=dark
FORMAT=png
PNG_SCALE=2
EOF
```

`SVG_THEME` (`dark` | `light` | `none`) and `FORMAT` (`png` | `svg`) control
the rendered diagrams in the cloud. The cloud folder has the same layout as the
local one, `foo.d2` plus `foo/<layer>.*`, with no extra folders:

- **Locally**, `foo/<layer>.svg` is d2's raw output, which the viewer themes when
  it displays it.
- **In the cloud**, `foo/<layer>.png` (or `.svg` with `FORMAT=svg`) has the
  viewer's theming built in. `bake_svgs.py` flattens the theming to plain CSS,
  because Drive's previewer rejects the viewer's `[data-diagram-theme]`
  attribute selectors. It then renders a PNG with headless Chrome at
  `PNG_SCALE`× (capped at 8192 px / 40 MP), because Drive previews SVGs as a
  blurry low-res raster. All of this happens in
  `~/.cache/diagrams-private-mounts/<name>/` (never inside the mount), and
  `sync.sh` pushes the results one way.

So rendered-output paths only flow local → cloud, and editing them in Drive
gets overwritten. Everything else (`.d2` files, other files, hand-placed images)
syncs both ways. A diagram is re-rendered only when its SVG changes. The first
full render takes about 1.5 minutes for ~30 layers. After changing `FORMAT`,
delete the old format's files from the cloud folders, since filtered files
aren't removed, then run `sync.sh <name> --resync`.

### 5. First sync, then move local-only files in, then symlink

```sh
scripts/private-mounts/sync.sh cardforge --resync            # pulls Drive down
# move any tech/cardforge/*.d2 not already in Drive into "$LOCAL", then:
mv tech/cardforge ~/cardforge/tech-cardforge.bak             # keep until verified
ln -s "$HOME/cardforge/drive/Tech Architecture" tech/cardforge
scripts/private-mounts/sync.sh cardforge                     # pushes the moved files up
```

### 6. Periodic sync (every 5 min)

```sh
mkdir -p ~/.config/systemd/user
cp scripts/private-mounts/diagrams-sync@.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now diagrams-sync@cardforge.timer
journalctl --user -u diagrams-sync@cardforge -f              # watch it
```

`bun run start` (`scripts/dev.sh`) also starts every configured mount's timer
and triggers an immediate sync. To force a sync, restart the dev server with
Ctrl+C and `bun run start`.

### 7. Ignore it

Add `tech/<name>` (no trailing slash — that wouldn't match a symlink) to the
"Private mounts" section of both `.gitignore` and `.dockerignore`. Verify:
`git check-ignore -v tech/<name>`.
