# Vibe Remote Buddy App

This is the standalone public desktop application, licensed under MIT.
Do not add receiver firmware, private SDKs, recordings, credentials, or local configuration.
Keep this repository independently buildable. Do not use files from its parent directory.
Use Buddy v1 management over RBP/3; USB audio and HID remain receiver responsibilities.
Fix clear audited defects and run relevant tests. Preserve dependency licenses.
Windows is the validated platform; do not imply untested macOS/Linux feature parity.

Commit code proactively at meaningful checkpoints (a coherent feature, fix, or refactor with relevant checks completed). Do not accumulate completed changes across tasks or wait for the user to request a commit. Only purely exploratory experiments may remain uncommitted; once an experiment is adopted into the implementation, commit it at the next checkpoint. Keep commits focused and independently reviewable; exclude unrelated work, secrets, logs, and build outputs. This rule requires local commits, not automatic pushes or releases; follow the user's publishing authorization separately.

Build outputs MUST follow [docs/build-artifacts.md](docs/build-artifacts.md). Use fixed latest paths; never invent per-task delivery directories. Preserve build provenance and package resources with binaries.
