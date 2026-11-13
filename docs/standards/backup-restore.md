---
title: Backup And Restore
status: active
owner: engineering
last_reviewed: 2026-11-13
---

# Backup And Restore

## Create A Backup

From the project root on Windows or Linux, with Docker and both Compose database services running:

```sh
npm run backup
npm run backup -- --output /secure/backups --include /path/to/external/keys
```

Repeat `--include` for additional external files or directories. Quote paths containing spaces. Defaults save `backups/<timestamp>.zip` and an uncompressed folder alongside it. Keep the ZIP on protected storage and copy it off the machine. ZIP compression is not encryption. Default backups are Git ignored; custom output paths require equivalent protection.

Each database dump has its own consistent snapshot. Pause writes to both applications if recovery must represent one coordinated point in time. This command does not stop applications automatically.

## File Inventory

| Archive path                                               | Contents and recovery purpose                                                                                                                                                                                           |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vcms.dump`                                                | PostgreSQL custom-format dump of the application database: users, sessions, PECs, allocations, barcode sequences/history, templates, settings, stored encrypted QZ credentials, and other application tables.           |
| `vcms-roles.sql`                                           | Cluster-wide PostgreSQL roles and attributes for the app database server, potentially including password hashes. Review before applying.                                                                                |
| `ehrbase.dump`                                             | Custom-format dump of the `ehrbase` database containing its clinical repository data and schema.                                                                                                                        |
| `ehrbase-roles.sql`                                        | Cluster-wide roles/attributes for the EHRbase PostgreSQL server; potentially includes password hashes.                                                                                                                  |
| `project/.env` and other `.env*` files                     | Database/auth settings, secrets and encryption keys. The QZ encryption key must match the encrypted credentials in the restored database.                                                                               |
| `project/**` certificate/key files                         | Discovered project files ending in `.pem`, `.key`, `.p12`, `.pfx`, `.jks`, `.crt`, or `.cer`, retaining relative paths. Dependency, build, vendor, log, temporary, and PM2 state folders are excluded from this search. |
| `project/compose.yaml`                                     | Database/EHRbase service definitions, ports and volume configuration.                                                                                                                                                   |
| `project/ecosystem.config.cjs`                             | PM2 app configuration, including the fixed port 3000.                                                                                                                                                                   |
| `project/package.json` and `project/package-lock.json`     | Dependency versions and npm commands needed to reproduce the runtime tooling.                                                                                                                                           |
| `project/.gitmodules`                                      | Customized Tray submodule URL and branch; obtain the pinned commit from the matching Git checkout.                                                                                                                      |
| `project/scripts/`                                         | Startup, backup, scheduled-task installers and other operational scripts.                                                                                                                                               |
| `project/WINDOWS.txt`                                      | Operational command reference at backup time.                                                                                                                                                                           |
| `pm2/dump.pm2`, `pm2/dump.pm2.bak`, `pm2/module_conf.json` | Available saved PM2 process list/configuration. May contain environment secrets and machine-specific paths. Not a copy of the running process.                                                                          |
| `extra/1`, `extra/2`, etc.                                 | Explicit `--include` sources. `manifest.json` maps these numbered entries to source paths.                                                                                                                              |
| `manifest.json`                                            | Backup timestamp, format, extra-source paths and SHA-256 checksum/size for each captured file.                                                                                                                          |

Optional files are present only when they exist. PM2 location comes from `PM2_HOME`, otherwise `%LOCALAPPDATA%/vcms-pm2` on Windows or `~/.pm2` on Linux. Separate QZ installation files, workstation keys outside the project, OS credentials, Docker images/volumes, logs, and the complete app source are not automatically included. Use `--include` for external material and retain the Git commit used by the deployment.

## Verify Before Recovery

Extract the ZIP with a trusted archive tool into a private directory outside the source tree. Never use `.zip.partial` or a folder containing `INCOMPLETE`. Compare extracted files against the SHA-256 values in `manifest.json` before recovery. Checksums detect accidental changes, not tampering by someone who can replace both files and manifest.

The commands below assume the extracted files are in `restore-input` at the project root. Keep this directory outside Git or explicitly ignore it. Transfer binary dumps with Docker copy rather than shell text redirection:

```sh
docker compose cp ./restore-input/vcms.dump db:/tmp/vcms.dump
docker compose cp ./restore-input/ehrbase.dump ehrbase-db:/tmp/ehrbase.dump
docker compose exec -T db pg_restore --list /tmp/vcms.dump
docker compose exec -T ehrbase-db pg_restore --list /tmp/ehrbase.dump
```

## Isolated Restore Test

Use the configured application database user in place of `root` below if different. These commands create new databases; they do not replace live databases. Use a PostgreSQL version compatible with the source and a `pg_restore` version capable of reading the archive.

```sh
docker compose exec -T db createdb -U root vcms_restore_test
docker compose exec -T db pg_restore --exit-on-error --no-owner --no-privileges -U root -d vcms_restore_test /tmp/vcms.dump
docker compose exec -T ehrbase-db createdb -U postgres ehrbase_restore_test
docker compose exec -T ehrbase-db pg_restore --exit-on-error --no-owner --no-privileges -U postgres -d ehrbase_restore_test /tmp/ehrbase.dump
```

Test database names must be unused; if they already exist, choose new names. This test omits original ownership/grants intentionally. Verify table counts, sequences, constraints and application data. An EHRbase production recovery also requires its expected roles, owners and grants; the isolated data test alone does not validate those permissions.

## Live Recovery

1. Take a fresh backup of the current environment and stop application writes. Stop the PM2 app and the EHRbase service during recovery. Do not remove Docker volumes.
2. Restore into newly created databases first, using reviewed role definitions, original owners and grants where required. The role SQL applies to an entire PostgreSQL cluster and may conflict with existing roles; never apply it blindly. Keep role passwords and restored `.env` connection settings consistent.
3. Verify restoration and permissions before switching application connections to the restored databases. Updating `.env` alone may not override environment values already held by PM2 or Compose; verify effective configuration and recreate/restart the relevant services deliberately.
4. Restore the matching `.env` and required key files to their original locations with restricted permissions. Preserve the QZ credential encryption key and Better Auth secret where continuity is required. Reissue sessions if the authentication secret changes.
5. Check out the matching application version from Git, initialize submodules, run `npm ci`, and build the app. Do not run seed or force-push schema changes over recovered data.
6. Re-register startup tasks for the current account and recreate PM2 configuration from the project. Review old PM2 dumps before using them: their paths and account environment may belong to the old machine. Task Scheduler registrations themselves are not in this backup.
7. Start services and verify login/Logout, PEC allocations, barcode next serials, templates, QZ credential decryption, a sample print and EHRbase access. Keep the pre-recovery databases until these checks pass.

The initial backup command was executed successfully against both local databases and its captured-file checksums were verified. A complete live restore has not been performed. Run and record an isolated restore test before treating a backup as a proven recovery procedure.
