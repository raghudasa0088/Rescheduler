#!/usr/bin/env python3
"""Seed script: copies the bundled sample DB into the project's src/db folder as in-use_schedules.db"""
import shutil
import os
from pathlib import Path

SAMPLE_DB = Path(__file__).resolve().parents[1] / "sample_schedules.db"
TARGET_DIR = Path(__file__).resolve().parents[1] / "src" / "db"
TARGET_DIR.mkdir(parents=True, exist_ok=True)
TARGET = TARGET_DIR / "in-use_schedules.db"

# If running from /mnt/data, SAMPLE_DB points to /mnt/data/sample_schedules.db
SAMPLE_DB = Path(TARGET_DIR/"sample_schedules.db")
if not SAMPLE_DB.exists():
    raise SystemExit("Sample DB not found at /mnt/data/sample_schedules.db")

shutil.copy2(str(SAMPLE_DB), str(TARGET))
print(f"Copied sample DB to {TARGET}")
