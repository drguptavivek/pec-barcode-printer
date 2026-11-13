---
title: Windows Deployment
status: active
owner: engineering
last_reviewed: 2026-11-13
---

# Windows Deployment

Run the application under the regular Windows account that operates it. Docker Compose runs PostgreSQL and EHRbase; PM2 runs the SvelteKit app separately on port 3000.

## First Installation

Install Node.js/npm, Git, and Docker Desktop. The regular user needs write access to the project and access to Docker Desktop. In normal PowerShell:

```powershell
git clone --recurse-submodules https://github.com/drguptavivek/pec-barcode-printer.git
cd pec-barcode-printer
npm.cmd ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Configure database settings, ORIGIN="http://localhost:3000", DEV_LOGIN_ENABLED="false", a strong BETTER_AUTH_SECRET, and QZ_CREDENTIAL_ENCRYPTION_KEY in .env before starting. Replace example passwords before deployment. Preserve the encryption key across upgrades to keep stored QZ credentials readable. Never commit .env or private keys.

```powershell
docker compose up -d
docker compose ps
```

For a new local/disposable database only, review and run npm.cmd run db:push and npm.cmd run seed. Schema push uses --force; seed resets seeded passwords and can add printer templates. Do not run these blindly on existing deployments. Back up existing databases before reviewed schema changes. Do not delete Docker volumes to troubleshoot app errors.

## Regular-User PM2

From the project root, in normal PowerShell:

```powershell
PowerShell -ExecutionPolicy Bypass -File .\scripts\vcms-local-user.ps1 start
PowerShell -ExecutionPolicy Bypass -File .\scripts\vcms-local-user.ps1 status
PowerShell -ExecutionPolicy Bypass -File .\scripts\vcms-local-user.ps1 logs
PowerShell -ExecutionPolicy Bypass -File .\scripts\vcms-local-user.ps1 stop
PowerShell -ExecutionPolicy Bypass -File .\scripts\vcms-local-user.ps1 restart
```

Both start and restart run npm run build (Vite). Restart builds before stopping the existing process, so stop first during maintenance when replacing builds or dependencies. The script does not explicitly check every native command exit code: inspect build output, PM2 status, and the app after deployment.

PM2 state is in %LOCALAPPDATA%\vcms-pm2; the script sets PM2_HOME consistently. ecosystem.config.cjs fixes PORT to 3000, overriding the script's -Port intention. Open http://localhost:3000.

scripts/start-production.mjs loads the project .env and imports build/index.js. Existing process environment variables take precedence. Build and log directories need regular-user write access. Configured logs are logs/pm2-combined.log, logs/pm2-out.log, and logs/pm2-error.log; actual filenames may include an instance suffix.

## Start After Boot

Register as the intended regular user:

```powershell
PowerShell -ExecutionPolicy Bypass -File .\scripts\install-pm2-windows-startup-task-aiims.ps1 -TaskName "VCMS PM2 User"
Start-ScheduledTask -TaskName "VCMS PM2 User"
schtasks /Query /TN "VCMS PM2 User" /V /FO LIST
```

The existing installer filename is retained for compatibility. It uses the current Windows identity, an interactive logon trigger, and limited privileges, without storing a password. It runs when that user logs in after boot, not before login. The task calls start, so Vite builds again at every logon. PM2 supervises the application afterward. Docker Desktop must also run for the database services.

Open taskschd.msc and check Task Scheduler Library. Verify Run As User is the intended user, not SYSTEM. To remove the task:

```powershell
PowerShell -ExecutionPolicy Bypass -File .\scripts\uninstall-pm2-windows-startup-task-aiims.ps1 -TaskName "VCMS PM2 User"
```

## Migration From SYSTEM PM2

The earlier boot task "VCMS PM2" ran as SYSTEM with state in .pm2-vcms. Regular-user commands encountered connect EPERM on rpc.sock when accessing the protected daemon. Remove the old task once from Administrator Command Prompt:

```cmd
schtasks /Delete /TN "VCMS PM2" /F
schtasks /Query /TN "VCMS PM2"
netstat -ano | findstr :3000
```

Deleting or disabling a task does not stop its running daemon or app. Identify the listener and parent before stopping the verified old SYSTEM PM2 process tree with administrative access. Killing just the child lets PM2 respawn it with a new PID. Do not trust a stale pm2.pid or kill every Node process. A regular user cannot stop SYSTEM-owned processes.

Then use the local-user script and user logon task. Keep one PM2 owner and the matching PM2_HOME. Run local pm2.cmd from the project root. PowerShell environment syntax is $env:PM2_HOME = "$env:LOCALAPPDATA\vcms-pm2"; CMD syntax is set "PM2_HOME=%LOCALAPPDATA%\vcms-pm2". Sandbox access-denied errors alone did not prove incorrect Windows account permissions.

## Backup

Run `npm run backup` from the project root on Windows or Linux while Docker Desktop/Engine and both Compose database services are running. No PowerShell script is used. Output is `backups/<timestamp>.zip`, excluded from Git. An uncompressed recovery copy is retained alongside it. Failed archives retain a `.zip.partial` suffix.

The command saves custom-format dumps of VCMS and EHRbase, PostgreSQL roles, project `.env` files and certificate/key files, deployment configuration, startup scripts, and available PM2 dump/config files. QZ credentials stored in the app database are covered by its dump; retain the matching encryption key from `.env`. Keys or workstation configuration outside the project require explicit inclusion: `npm run backup -- --include /path/to/keys`. Repeat `--include` for more paths. `--output /secure/backup/location` selects another destination; protect custom output paths from Git yourself.

Backups contain credentials and are not encrypted. Store them on protected, preferably encrypted storage and keep an off-machine copy. `manifest.json` contains SHA-256 checksums. `INCOMPLETE` marks a failed backup; only use a backup reported complete. Each database dump is transactionally consistent independently; pause application writes for coordinated recovery across both databases. This is a logical backup, not a filesystem/Windows image or a copy of every key on the workstation.

See [Backup and restore](backup-restore.md) for the file inventory, verification, isolated restore commands, and live recovery procedure. A successful backup and checksum check do not prove a full restore has been tested.

## Application Updates

Back up the database, retain .env, and schedule downtime:

```powershell
PowerShell -ExecutionPolicy Bypass -File .\scripts\vcms-local-user.ps1 stop
git pull --ff-only
git submodule update --init --recursive
npm.cmd ci
PowerShell -ExecutionPolicy Bypass -File .\scripts\vcms-local-user.ps1 start
PowerShell -ExecutionPolicy Bypass -File .\scripts\vcms-local-user.ps1 status
```

Review database changes separately. Verify login, PEC rows, saved printer settings, and a sample print.

An empty dashboard recovered after logging in again; the database still contained 22 PECs and valid allocations. The exact session cause was not established. Development on 5173 and production on 3000 can share localhost cookies because cookies are not isolated by port. Set ORIGIN for the server in use. Use Logout and sign in again to check session behavior. Regular users require permitted roles and PEC allocations; admins can see all PECs.

## QZ Tray

Install QZ on the printing workstation and configure the app's QZ credentials, printer selection, and template. vendor/qz-tray is a submodule pinned to branch `vcms/v2.3.0` of the VCMS fork (drguptavivek/tray), which is upstream QZ Tray v2.3.0 plus the VCMS trusted root CA changes (Java only). Normal app builds do not compile Java/QZ.

Get the build from the fork's GitHub release (tag `v2.3.0-vcms.N`), built by its `vcms-jar` workflow:

- Windows: `qz-tray-vcms-2.3.0-windows-x86_64.zip`. It is the payload of the official upstream-signed v2.3.0 installer with only `qz-tray.jar` replaced. Unzip, then in an Administrator PowerShell in that folder run `PowerShell -ExecutionPolicy Bypass -File .\install-from-zip.ps1`. It runs the same `preinstall`, `install` and `certgen` steps as the official installer into `C:\Program Files\QZ Tray` and starts QZ. Installing over an older build is fine; QZ data in `%APPDATA%\qz`, `C:\ProgramData\qz` and `%USERPROFILE%\.qz\trusted-root-certs` is kept.
- macOS: `qz-tray-vcms-2.3.0-macos-aarch64.dmg` (Apple silicon) or `qz-tray-vcms-2.3.0-macos-x86_64.dmg` (Intel), signed with the AIIMS Developer ID and notarized.

Verify on Windows: `qz-tray.exe`, `runtime\bin\zip.dll` and `runtime\bin\java.dll` show a Valid signature from QZ Industries, LLC (`Get-AuthenticodeSignature`), then do a sample print. Re-run `install-from-zip.ps1` after any QZ upgrade, since an upstream installer replaces the VCMS jar.

Why: the earlier self-built installer signed its exe and runtime DLLs with a self-signed certificate. With Smart App Control On, Code Integrity events 3077/3033 blocked `zip.dll`. Smart App Control does not check `.jar` files, so keeping upstream's signed exe/DLLs and replacing only the jar avoids the block without our own Windows code-signing certificate. Antivirus exclusions do not resolve an application-control block, and disabling security is not a deployment step.
